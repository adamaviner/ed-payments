// Shared by the component's modules: the checkout and refund views, calling the host's callbacks,
// and opening issues.
import { ConvexError, v, type Infer } from 'convex/values'
import type { FunctionHandle } from 'convex/server'
import type { Doc, Id } from './_generated/dataModel.js'
import type { MutationCtx } from './_generated/server.js'
import { checkoutStatus, issueKind, method, payer, processor, ref, refundOrigin, refundStatus } from './schema.js'

export const checkoutView = v.object({
  id: v.string(),
  app: v.string(),
  ref,
  purpose: v.string(),
  description: v.string(),
  amountCents: v.number(),
  processor,
  method,
  payer,
  status: checkoutStatus,
  processorCheckoutId: v.union(v.string(), v.null()),
  paymentRef: v.union(v.string(), v.null()),
  paidCents: v.union(v.number(), v.null()),
  refundedCents: v.number(),
  processorFeeCents: v.union(v.number(), v.null()),
  disputed: v.boolean(),
  context: v.any(),
  returnUrl: v.string(),
  cancelUrl: v.string(),
  expiresAt: v.number(),
  createdAt: v.number(),
  settledAt: v.union(v.number(), v.null()),
  lastError: v.union(v.string(), v.null()),
})
export type CheckoutView = Infer<typeof checkoutView>

export function view(c: Doc<'checkouts'>): CheckoutView {
  return {
    id: c._id,
    app: c.app,
    ref: c.ref,
    purpose: c.purpose,
    description: c.description,
    amountCents: c.amountCents,
    processor: c.processor,
    method: c.method,
    payer: c.payer,
    status: c.status,
    processorCheckoutId: c.processorCheckoutId ?? null,
    paymentRef: c.paymentRef ?? null,
    paidCents: c.paidCents ?? null,
    refundedCents: c.refundedCents,
    processorFeeCents: c.processorFeeCents ?? null,
    disputed: c.disputed ?? false,
    context: c.context ?? null,
    returnUrl: c.returnUrl,
    cancelUrl: c.cancelUrl,
    expiresAt: c.expiresAt,
    createdAt: c.createdAt,
    settledAt: c.settledAt ?? null,
    lastError: c.lastError ?? null,
  }
}

export const refundView = v.object({
  id: v.string(),
  checkoutId: v.string(),
  amountCents: v.number(),
  reason: v.string(),
  origin: refundOrigin,
  status: refundStatus,
  requestedBy: v.union(v.string(), v.null()),
  approvedBy: v.union(v.string(), v.null()),
  processorRefundId: v.union(v.string(), v.null()),
  note: v.union(v.string(), v.null()),
  error: v.union(v.string(), v.null()),
  createdAt: v.number(),
  updatedAt: v.number(),
  sentAt: v.union(v.number(), v.null()),
})
export type RefundView = Infer<typeof refundView>

export function refundViewOf(r: Doc<'refunds'>): RefundView {
  return {
    id: r._id,
    checkoutId: r.checkoutId,
    amountCents: r.amountCents,
    reason: r.reason,
    origin: r.origin,
    status: r.status,
    requestedBy: r.requestedBy ?? null,
    approvedBy: r.approvedBy ?? null,
    processorRefundId: r.processorRefundId ?? null,
    note: r.note ?? null,
    error: r.error ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    sentAt: r.sentAt ?? null,
  }
}

/**
 * A thrown error as one sentence. Errors from the host's functions arrive as
 * "Uncaught Error: <message>\n    at handler (...)"; the stack and prefix are dropped.
 */
export function errorText(err: unknown): string {
  if (err instanceof ConvexError) return typeof err.data === 'string' ? err.data : JSON.stringify(err.data)
  const text = err instanceof Error ? err.message : String(err)
  return (text.split('\n')[0] ?? '').replace(/^Uncaught (\w*Error: )?/, '').trim() || 'Unknown error'
}

export type HostCall<R> = { ok: true; value: R } | { ok: false; error: string }

/**
 * Calls one of the host's callbacks in this transaction. If it throws, only its own writes roll back
 * (checked at stage 0 in convex-test and on a local backend) and the error comes back.
 */
export async function callHost<R>(ctx: MutationCtx, handle: string, args: Record<string, unknown>): Promise<HostCall<R>> {
  try {
    return { ok: true, value: await ctx.runMutation(handle as FunctionHandle<'mutation', Record<string, unknown>, R>, args) }
  } catch (err) {
    return { ok: false, error: errorText(err) }
  }
}

/** The fields every callback gets about its checkout. */
export function callbackBase(c: Doc<'checkouts'>) {
  return { checkoutId: c._id as string, ref: c.ref, purpose: c.purpose, processor: c.processor, method: c.method, payer: c.payer, context: c.context ?? null }
}

export type IssueKind = Infer<typeof issueKind>

/** Opens an issue, or updates the detail of the one already open for this key and kind. Returns whether it is new. */
export async function openIssue(
  ctx: MutationCtx,
  i: { kind: IssueKind; key: string; checkoutId?: Id<'checkouts'>; processor: Doc<'checkouts'>['processor']; paymentRef?: string; detail: string; now: number },
): Promise<boolean> {
  const open = await ctx.db
    .query('issues')
    .withIndex('by_key_kind', (q) => q.eq('key', i.key).eq('kind', i.kind).eq('resolvedAt', undefined))
    .first()
  if (open) {
    if (open.detail !== i.detail) await ctx.db.patch(open._id, { detail: i.detail })
    return false
  }
  await ctx.db.insert('issues', { kind: i.kind, key: i.key, checkoutId: i.checkoutId, processor: i.processor, paymentRef: i.paymentRef, detail: i.detail, openedAt: i.now })
  return true
}

export async function resolveIssue(ctx: MutationCtx, key: string, kind: IssueKind, now: number): Promise<boolean> {
  const open = await ctx.db
    .query('issues')
    .withIndex('by_key_kind', (q) => q.eq('key', key).eq('kind', kind).eq('resolvedAt', undefined))
    .first()
  if (!open) return false
  await ctx.db.patch(open._id, { resolvedAt: now })
  return true
}

/** Calls a callback that can't refuse anything (failed, refunded, refund needed, dispute); a throw becomes a callback_failed issue. */
export async function notifyHost(ctx: MutationCtx, c: Doc<'checkouts'>, name: 'onFailed' | 'onRefunded' | 'onRefundNeeded' | 'onDispute', args: Record<string, unknown>, now: number) {
  const handle = c.callbacks[name]
  if (!handle) return
  const res = await callHost<unknown>(ctx, handle, { ...callbackBase(c), ...args })
  if (!res.ok) {
    await openIssue(ctx, { kind: 'callback_failed', key: `${c._id}:${name}`, checkoutId: c._id, processor: c.processor, paymentRef: c.paymentRef, detail: `${name} failed: ${res.error}`, now })
  }
}

/** Refunds in progress or done, which the remaining amount is reduced by. */
export const COMMITTED_REFUND: ReadonlySet<Doc<'refunds'>['status']> = new Set(['requested', 'approved', 'sending'])

export async function refundsOf(ctx: MutationCtx, checkoutId: Id<'checkouts'>) {
  return await ctx.db
    .query('refunds')
    .withIndex('by_checkout', (q) => q.eq('checkoutId', checkoutId))
    .collect()
}
