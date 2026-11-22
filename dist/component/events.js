// Webhook de-duplication. A delivery is recorded as received before it is acted on and marked with
// its outcome after; a repeat of one already handled is answered at once, while a repeat of one that
// failed half way (still "received") is acted on again, which is safe because every transition is.
import { v } from 'convex/values';
import { mutation } from './_generated/server.js';
import { eventOutcome, processor } from './schema.js';
export const begin = mutation({
    args: { processor, eventId: v.string(), type: v.string(), now: v.number() },
    returns: v.union(v.literal('new'), v.literal('seen')),
    handler: async (ctx, { processor, eventId, type, now }) => {
        const row = await ctx.db
            .query('events')
            .withIndex('by_processor_eventId', (q) => q.eq('processor', processor).eq('eventId', eventId))
            .first();
        if (row && row.outcome !== 'received')
            return 'seen';
        if (!row)
            await ctx.db.insert('events', { processor, eventId, type, receivedAt: now, outcome: 'received' });
        return 'new';
    },
});
export const finish = mutation({
    args: { processor, eventId: v.string(), outcome: eventOutcome },
    returns: v.null(),
    handler: async (ctx, { processor, eventId, outcome }) => {
        const row = await ctx.db
            .query('events')
            .withIndex('by_processor_eventId', (q) => q.eq('processor', processor).eq('eventId', eventId))
            .first();
        if (row && row.outcome !== outcome)
            await ctx.db.patch(row._id, { outcome });
        return null;
    },
});
//# sourceMappingURL=events.js.map