// Things a person should look at: differences from the processors (reconcile), disputes and host
// callbacks that failed. One open issue per key and kind; a difference that goes away resolves it.
import { v } from 'convex/values';
import { paginationOptsValidator, paginationResultValidator } from 'convex/server';
import { mutation, query } from './_generated/server.js';
import { openIssue, resolveIssue } from './lib.js';
import { issueKind, processor } from './schema.js';
export const issueView = v.object({
    id: v.string(),
    kind: issueKind,
    key: v.string(),
    checkoutId: v.union(v.string(), v.null()),
    processor,
    paymentRef: v.union(v.string(), v.null()),
    detail: v.string(),
    openedAt: v.number(),
    resolvedAt: v.union(v.number(), v.null()),
    reportedAt: v.union(v.number(), v.null()),
});
const issueViewOf = (i) => ({
    id: i._id,
    kind: i.kind,
    key: i.key,
    checkoutId: i.checkoutId ?? null,
    processor: i.processor,
    paymentRef: i.paymentRef ?? null,
    detail: i.detail,
    openedAt: i.openedAt,
    resolvedAt: i.resolvedAt ?? null,
    reportedAt: i.reportedAt ?? null,
});
/** The kinds reconcile decides; it never resolves disputes or callback failures. */
const COMPARED = ['missing_here', 'missing_there', 'amount_differs', 'status_differs'];
/**
 * Reconcile's verdict on one payment: opens the kinds found (updating their detail), resolves the
 * compared kinds that are no longer found. Returns how many were opened and resolved.
 */
export const sync = mutation({
    args: {
        key: v.string(),
        processor,
        checkoutId: v.optional(v.string()),
        paymentRef: v.optional(v.string()),
        found: v.array(v.object({ kind: v.union(...COMPARED.map((k) => v.literal(k))), detail: v.string() })),
        /** The kinds this check decides; others for the key are left alone. Default: all compared kinds. */
        only: v.optional(v.array(v.union(...COMPARED.map((k) => v.literal(k))))),
        now: v.number(),
    },
    returns: v.object({ opened: v.number(), resolved: v.number() }),
    handler: async (ctx, a) => {
        const checkoutId = a.checkoutId ? (ctx.db.normalizeId('checkouts', a.checkoutId) ?? undefined) : undefined;
        let opened = 0;
        let resolved = 0;
        for (const f of a.found)
            if (await openIssue(ctx, { kind: f.kind, key: a.key, checkoutId, processor: a.processor, paymentRef: a.paymentRef, detail: f.detail, now: a.now }))
                opened++;
        for (const kind of a.only ?? COMPARED)
            if (!a.found.some((f) => f.kind === kind) && (await resolveIssue(ctx, a.key, kind, a.now)))
                resolved++;
        return { opened, resolved };
    },
});
/** Marks an issue resolved by hand. */
export const resolve = mutation({
    args: { id: v.string(), now: v.number() },
    returns: v.null(),
    handler: async (ctx, { id, now }) => {
        const nid = ctx.db.normalizeId('issues', id);
        const i = nid ? await ctx.db.get(nid) : null;
        if (i && i.resolvedAt === undefined)
            await ctx.db.patch(i._id, { resolvedAt: now });
        return null;
    },
});
/** Open issues (resolvedAt unset) first by age, or all, paginated. */
export const list = query({
    args: { open: v.boolean(), paginationOpts: paginationOptsValidator },
    returns: paginationResultValidator(issueView),
    handler: async (ctx, { open, paginationOpts }) => {
        const page = open
            ? await ctx.db
                .query('issues')
                .withIndex('by_resolvedAt', (q) => q.eq('resolvedAt', undefined))
                .paginate(paginationOpts)
            : await ctx.db.query('issues').order('desc').paginate(paginationOpts);
        return { ...page, page: page.page.map(issueViewOf) };
    },
});
/** How many are open (up to `cap`), for a badge. */
export const openCount = query({
    args: { cap: v.optional(v.number()) },
    returns: v.number(),
    handler: async (ctx, { cap = 100 }) => (await ctx.db
        .query('issues')
        .withIndex('by_resolvedAt', (q) => q.eq('resolvedAt', undefined))
        .take(cap)).length,
});
/** Issues nobody was told about yet, oldest first, for the host's digest email. */
export const unreported = query({
    args: { limit: v.optional(v.number()) },
    returns: v.array(issueView),
    handler: async (ctx, { limit = 100 }) => {
        const rows = await ctx.db
            .query('issues')
            .withIndex('by_reportedAt', (q) => q.eq('reportedAt', undefined))
            .take(limit);
        return rows.map(issueViewOf);
    },
});
export const markReported = mutation({
    args: { ids: v.array(v.string()), now: v.number() },
    returns: v.null(),
    handler: async (ctx, { ids, now }) => {
        for (const id of ids) {
            const nid = ctx.db.normalizeId('issues', id);
            const i = nid ? await ctx.db.get(nid) : null;
            if (i && i.reportedAt === undefined)
                await ctx.db.patch(i._id, { reportedAt: now });
        }
        return null;
    },
});
//# sourceMappingURL=issues.js.map