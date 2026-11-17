// The one settings row: retention, and the cached PayPal token (encrypted by the client; the
// component never has the key).
import { ConvexError, v } from 'convex/values'
import { mutation, query, type QueryCtx } from './_generated/server.js'

/** About three months for abandoned and failed checkouts. Paid ones and refunds are kept forever. */
export const DEFAULT_RETENTION_DAYS = 90

export async function readSettings(ctx: QueryCtx) {
  const row = await ctx.db.query('settings').first()
  return { row, retentionDays: row?.retentionDays ?? DEFAULT_RETENTION_DAYS }
}

export const get = query({
  args: {},
  returns: v.object({ retentionDays: v.number() }),
  handler: async (ctx) => ({ retentionDays: (await readSettings(ctx)).retentionDays }),
})

export const update = mutation({
  args: { retentionDays: v.number() },
  returns: v.null(),
  handler: async (ctx, { retentionDays }) => {
    if (!Number.isInteger(retentionDays) || retentionDays < 7 || retentionDays > 3650) throw new ConvexError('Keep unpaid checkouts for a whole number of days, from 7 to 3650.')
    const { row } = await readSettings(ctx)
    if (row) await ctx.db.patch(row._id, { retentionDays })
    else await ctx.db.insert('settings', { retentionDays })
    return null
  },
})

export const paypalToken = query({
  args: {},
  returns: v.union(v.object({ sealed: v.string(), expiresAt: v.number(), account: v.string() }), v.null()),
  handler: async (ctx) => {
    const { row } = await readSettings(ctx)
    return row?.paypalToken && row.paypalTokenExpiresAt && row.paypalTokenAccount ? { sealed: row.paypalToken, expiresAt: row.paypalTokenExpiresAt, account: row.paypalTokenAccount } : null
  },
})

export const savePaypalToken = mutation({
  args: { sealed: v.string(), expiresAt: v.number(), account: v.string() },
  returns: v.null(),
  handler: async (ctx, { sealed, expiresAt, account }) => {
    const { row } = await readSettings(ctx)
    const patch = { paypalToken: sealed, paypalTokenExpiresAt: expiresAt, paypalTokenAccount: account }
    if (row) await ctx.db.patch(row._id, patch)
    else await ctx.db.insert('settings', patch)
    return null
  },
})

/** When PayPal last refused Transaction Search (null: never, or it worked since). */
export const searchRefusedAt = query({
  args: {},
  returns: v.union(v.number(), v.null()),
  handler: async (ctx) => (await readSettings(ctx)).row?.searchRefusedAt ?? null,
})

export const setSearchRefused = mutation({
  args: { at: v.union(v.number(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { at }) => {
    const { row } = await readSettings(ctx)
    const patch = { searchRefusedAt: at ?? undefined }
    if (row) await ctx.db.patch(row._id, patch)
    else if (at !== null) await ctx.db.insert('settings', patch)
    return null
  },
})
