// A monthly membership: a schedule the library charges every month. The first payment, on the app's
// page, also saves the card, bank account or PayPal account (startScheduleCheckout); the processor for
// a new card is the cheaper one for the monthly amount, which is the app's choice to make.
import type { StartedEmbedded, StartedOnPage, StartedRedirect } from '@earthdance/payments'
import { ConvexError, v } from 'convex/values'
import { internalMutation, mutation, action } from './_generated/server.js'
import { payments } from './payments.js'

const MONTHLY_CENTS = 1500

/** Starts a membership: the first month is paid now, on the app's page (src/Membership.tsx). */
export const start = action({
  args: { email: v.string(), how: v.union(v.literal('card'), v.literal('bank'), v.literal('paypal')) },
  handler: async (ctx, { email, how }): Promise<(StartedEmbedded | StartedRedirect) & { scheduleId: string }> => {
    const me = await ctx.auth.getUserIdentity()
    if (!me) throw new ConvexError('Sign in to join.')
    const card = payments.cardProcessorFor(MONTHLY_CENTS).processor
    const [processor, method] = how === 'bank' ? (['stripe', 'ach'] as const) : how === 'paypal' ? (['paypal', 'paypal'] as const) : ([card, 'card'] as const)
    const started = await payments.startScheduleCheckout(ctx, {
      owner: { type: 'user', id: me.subject },
      ref: { type: 'membership', id: me.subject },
      purpose: 'membership',
      description: 'Monthly membership',
      payer: { email },
      amountCents: MONTHLY_CENTS,
      context: { memberId: me.subject },
      processor,
      method,
      returnPath: '/membership/thanks',
      cancelPath: '/membership',
    })
    if ('onPage' in started) throw new ConvexError('The payment couldn’t be started here.')
    return started
  },
})

/**
 * Starts a membership when the payer presses the button on the one-step form (src/JoinOnPage.tsx, OnPagePayment). The
 * page shows the card fields of the processor the quote gives, so the server prices with the same quote and refuses
 * any other. `replaces` is the checkout the last press started, which OnPagePayment keeps.
 */
export const startOnPage = action({
  args: {
    name: v.string(),
    email: v.string(),
    method: v.union(v.literal('card'), v.literal('ach'), v.literal('paypal')),
    processor: v.union(v.literal('stripe'), v.literal('paypal')),
    replaces: v.optional(v.string()),
  },
  handler: async (ctx, { name, email, method, processor, replaces }): Promise<StartedOnPage & { scheduleId: string }> => {
    const me = await ctx.auth.getUserIdentity()
    if (!me) throw new ConvexError('Sign in to join.')
    const quoted = payments.quote({ amountCents: MONTHLY_CENTS, method, coverFee: false })
    if (quoted.processor !== processor) throw new ConvexError('The price changed. Reload the page and try again.')
    const started = await payments.startScheduleCheckout(ctx, {
      owner: { type: 'user', id: me.subject },
      ref: { type: 'membership', id: me.subject },
      purpose: 'membership',
      description: 'Monthly membership',
      payer: { email, name },
      amountCents: quoted.totalCents,
      context: { memberId: me.subject },
      processor,
      method,
      ui: 'onPage',
      replaces,
      returnPath: '/membership/thanks',
      cancelPath: '/membership',
    })
    if (!('onPage' in started)) throw new ConvexError('The payment couldn’t be started here.')
    return started
  },
})

/**
 * The one-step form's fallback when a processor's script won't load (OnPagePayment's startRedirect): the same first
 * payment as a redirect to the processor's page, closing the checkout the last press started (replaces).
 */
export const startRedirect = action({
  args: {
    email: v.string(),
    method: v.union(v.literal('card'), v.literal('ach'), v.literal('paypal')),
    processor: v.union(v.literal('stripe'), v.literal('paypal')),
    replaces: v.optional(v.string()),
  },
  handler: async (ctx, { email, method, processor, replaces }): Promise<StartedRedirect & { scheduleId: string }> => {
    const me = await ctx.auth.getUserIdentity()
    if (!me) throw new ConvexError('Sign in to join.')
    const quoted = payments.quote({ amountCents: MONTHLY_CENTS, method, coverFee: false })
    if (quoted.processor !== processor) throw new ConvexError('The price changed. Reload the page and try again.')
    const started = await payments.startScheduleCheckout(ctx, {
      owner: { type: 'user', id: me.subject },
      ref: { type: 'membership', id: me.subject },
      purpose: 'membership',
      description: 'Monthly membership',
      payer: { email },
      amountCents: quoted.totalCents,
      context: { memberId: me.subject },
      processor,
      method,
      ui: 'redirect',
      replaces,
      returnPath: '/membership/thanks',
      cancelPath: '/membership',
    })
    if (!('redirectUrl' in started)) throw new ConvexError('The payment couldn’t be started.')
    return started
  },
})

/** The member stops: no more charges. */
export const cancel = mutation({
  args: { scheduleId: v.string() },
  handler: async (ctx, { scheduleId }) => {
    const me = await ctx.auth.getUserIdentity()
    const s = await payments.getSchedule(ctx, scheduleId)
    if (!me || !s || s.owner.id !== me.subject) throw new ConvexError('Not your membership.')
    await payments.cancelSchedule(ctx, { scheduleId, reason: 'Cancelled by the member', by: me.subject })
  },
})

// A real app records each month and emails the member from these.
export const onCharged = internalMutation({ args: payments.args.scheduleCharged, handler: async (_ctx, a) => console.info(`Membership ${a.scheduleId} paid for ${a.period}`) })
export const onFailed = internalMutation({
  args: payments.args.scheduleFailed,
  handler: async (_ctx, a) => console.warn(`Membership ${a.scheduleId}: ${a.reason}${a.final ? ' (lapsed)' : `, retried ${a.nextRetryAt}`}`),
})
export const onChanged = internalMutation({ args: payments.args.scheduleChanged, handler: async (_ctx, a) => console.info(`Membership ${a.scheduleId}: ${a.changes.join(', ')}`) })
