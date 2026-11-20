// Fixed-window rate limits for the public entries: starting a checkout, saving a payment method,
// retrying a payment, the return page. The client names the keys (a signed-in user, else the payer's
// email, plus a global one); all of a call's keys must have room, or none is counted.
import { ConvexError, v } from 'convex/values';
import { mutation } from './_generated/server.js';
export const limitsArg = v.array(v.object({
    key: v.string(),
    max: v.number(),
    windowMs: v.number(),
    /** Said to the caller when this key is full. */
    message: v.string(),
}));
/** Counts one against every key, or throws the first full key's message without counting any. */
export async function takeAll(ctx, limits, now) {
    const rows = await Promise.all(limits.map(async (l) => ({
        l,
        row: await ctx.db
            .query('limits')
            .withIndex('by_key', (q) => q.eq('key', l.key))
            .first(),
    })));
    for (const { l, row } of rows) {
        if (row && now - row.windowStart < l.windowMs && row.count >= l.max)
            throw new ConvexError(l.message);
    }
    for (const { l, row } of rows) {
        if (!row)
            await ctx.db.insert('limits', { key: l.key, windowStart: now, count: 1 });
        else if (now - row.windowStart >= l.windowMs)
            await ctx.db.patch(row._id, { windowStart: now, count: 1 });
        else
            await ctx.db.patch(row._id, { count: row.count + 1 });
    }
}
/** Hands back one counted against `key` in its current window (a start the buyer closed again). */
export async function giveBackOne(ctx, key, now, windowMs) {
    const row = await ctx.db
        .query('limits')
        .withIndex('by_key', (q) => q.eq('key', key))
        .first();
    if (row && now - row.windowStart < windowMs && row.count > 0)
        await ctx.db.patch(row._id, { count: row.count - 1 });
}
export const take = mutation({
    args: { limits: limitsArg, now: v.number() },
    returns: v.null(),
    handler: async (ctx, { limits, now }) => {
        await takeAll(ctx, limits, now);
        return null;
    },
});
//# sourceMappingURL=limits.js.map