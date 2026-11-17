// Stage 0 feasibility check (decision 5): can a component mutation call a host function handle in
// its own transaction, and does a throw in the handle roll back only the handle's writes?
import { v } from 'convex/values'
import type { FunctionHandle } from 'convex/server'
import { mutation, query } from './_generated/server.js'

export const callHost = mutation({
  args: { handle: v.string(), fail: v.boolean() },
  returns: v.object({ caught: v.union(v.string(), v.null()), returned: v.union(v.string(), v.null()) }),
  handler: async (ctx, { handle, fail }) => {
    await ctx.db.insert('probes', { note: 'before' })
    let caught: string | null = null
    let returned: string | null = null
    try {
      returned = await ctx.runMutation(handle as FunctionHandle<'mutation', { fail: boolean }, string>, { fail })
    } catch (err) {
      caught = err instanceof Error ? err.message : String(err)
    }
    await ctx.db.insert('probes', { note: caught === null ? 'after' : 'caught' })
    return { caught, returned }
  },
})

export const notes = query({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => (await ctx.db.query('probes').collect()).map((p) => p.note),
})
