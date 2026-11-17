// What the host's callbacks receive. Use these as the `args` of the internal mutations passed to
// start (onPaid: { args: paidArgs, returns: paidReturns }), so a change here fails the host's typecheck.
import { v, type Infer } from 'convex/values'
import type { FunctionReference } from 'convex/server'

const processor = v.union(v.literal('stripe'), v.literal('paypal'))
const method = v.union(v.literal('card'), v.literal('ach'), v.literal('paypal'))

const base = {
  checkoutId: v.string(),
  ref: v.object({ type: v.string(), id: v.string() }),
  purpose: v.string(),
  processor,
  method,
  payer: v.object({ name: v.optional(v.string()), email: v.string() }),
  /** What the host passed to start as `context`, or null. */
  context: v.any(),
}

/** onPaid: the money arrived. Record the sale; return null, or { refuse } to have it refunded instead (throwing does the same). */
export const paidArgs = { ...base, amountCents: v.number(), paidCents: v.number(), paymentRef: v.string() }
export const paidReturns = v.union(v.null(), v.object({ refuse: v.string() }))

/** onFailed: the processor said no (a declined capture, a bounced bank debit). */
export const failedArgs = { ...base, reason: v.string() }

/** onRefunded: a refund went back to the buyer (sent, done by hand, or made at the processor). */
export const refundedArgs = {
  ...base,
  refundId: v.string(),
  amountCents: v.number(),
  refundedCents: v.number(),
  paidCents: v.number(),
  origin: v.union(v.literal('requested'), v.literal('needed'), v.literal('external')),
}

/** onRefundNeeded: money arrived for a sale the host refused; a refund for it is waiting. */
export const refundNeededArgs = { ...base, amountCents: v.number(), paidCents: v.number(), paymentRef: v.string(), refundId: v.string(), reason: v.string() }

/** onDispute: the buyer disputed the payment (opened), or the dispute ended (closed). */
export const disputeArgs = {
  ...base,
  paymentRef: v.string(),
  disputeId: v.string(),
  status: v.union(v.literal('opened'), v.literal('closed')),
  outcome: v.union(v.string(), v.null()),
  reason: v.union(v.string(), v.null()),
  amountCents: v.union(v.number(), v.null()),
}

export type Paid = Infer<ReturnType<typeof v.object<typeof paidArgs>>>
export type PaidResult = Infer<typeof paidReturns>
export type Failed = Infer<ReturnType<typeof v.object<typeof failedArgs>>>
export type Refunded = Infer<ReturnType<typeof v.object<typeof refundedArgs>>>
export type RefundNeeded = Infer<ReturnType<typeof v.object<typeof refundNeededArgs>>>
export type Dispute = Infer<ReturnType<typeof v.object<typeof disputeArgs>>>

/** The host's callbacks, as internal mutations. */
export interface Callbacks {
  onPaid?: FunctionReference<'mutation', 'internal', Paid, PaidResult>
  onFailed?: FunctionReference<'mutation', 'internal', Failed, unknown>
  onRefunded?: FunctionReference<'mutation', 'internal', Refunded, unknown>
  onRefundNeeded?: FunctionReference<'mutation', 'internal', RefundNeeded, unknown>
  onDispute?: FunctionReference<'mutation', 'internal', Dispute, unknown>
}
