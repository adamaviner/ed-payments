// What grows with use and when it goes. Paid and refund_needed checkouts and every refund are kept
// forever: they are the financial record. Abandoned and failed checkouts go after the retention
// (default 90 days), webhook events after 30 days, resolved issues after 180 days, rate-limit
// counters after a day.
import { v } from 'convex/values'
import { mutation } from './_generated/server.js'
import { readSettings } from './settings.js'

const DAY = 24 * 60 * 60 * 1000
export const EVENT_DAYS = 30
export const RESOLVED_ISSUE_DAYS = 180

export const cleanup = mutation({
  args: { now: v.number(), batch: v.optional(v.number()) },
  returns: v.object({ deleted: v.number(), more: v.boolean() }),
  handler: async (ctx, { now, batch = 200 }) => {
    const { retentionDays } = await readSettings(ctx)
    let deleted = 0
    let more = false
    for (const status of ['abandoned', 'failed'] as const) {
      // expiresAt is never later than a checkout's end, so "expired before the cutoff" is old enough.
      const old = await ctx.db
        .query('checkouts')
        .withIndex('by_status_expiresAt', (q) => q.eq('status', status).lt('expiresAt', now - retentionDays * DAY))
        .take(batch)
      for (const c of old) {
        // A failed checkout with a refund row (a failure after money moved) stays with its refund.
        const refund = await ctx.db
          .query('refunds')
          .withIndex('by_checkout', (q) => q.eq('checkoutId', c._id))
          .first()
        if (refund) continue
        await ctx.db.delete(c._id)
        deleted++
      }
      more ||= old.length === batch && deleted > 0
    }
    const events = await ctx.db
      .query('events')
      .withIndex('by_creation_time', (q) => q.lt('_creationTime', now - EVENT_DAYS * DAY))
      .take(batch)
    for (const e of events) await ctx.db.delete(e._id)
    const issues = await ctx.db
      .query('issues')
      .withIndex('by_resolvedAt', (q) => q.gt('resolvedAt', 0).lt('resolvedAt', now - RESOLVED_ISSUE_DAYS * DAY))
      .take(batch)
    for (const i of issues) await ctx.db.delete(i._id)
    const limits = await ctx.db
      .query('limits')
      .withIndex('by_windowStart', (q) => q.lt('windowStart', now - DAY))
      .take(batch)
    for (const l of limits) await ctx.db.delete(l._id)
    deleted += events.length + issues.length + limits.length
    return { deleted, more: more || events.length === batch || issues.length === batch || limits.length === batch }
  },
})
