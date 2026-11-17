// Stage 0 feasibility check against a real backend; see src/component/probe.ts.
import { createFunctionHandle } from 'convex/server'
import { v } from 'convex/values'
import { components, internal } from './_generated/api.js'
import { internalMutation, mutation, query } from './_generated/server.js'

export const hostWrite = internalMutation({
  args: { fail: v.boolean() },
  handler: async (ctx, { fail }): Promise<string> => {
    await ctx.db.insert('hostRows', { note: fail ? 'should roll back' : 'kept' })
    if (fail) throw new Error('refused by the host')
    return 'ok'
  },
})

export const run = mutation({
  args: { fail: v.boolean() },
  handler: async (ctx, { fail }): Promise<{ caught: string | null; returned: string | null }> =>
    await ctx.runMutation(components.payments.probe.callHost, { handle: await createFunctionHandle(internal.probe.hostWrite), fail }),
})

export const state = query({
  args: {},
  handler: async (ctx) => ({ host: (await ctx.db.query('hostRows').collect()).map((r) => r.note), component: await ctx.runQuery(components.payments.probe.notes, {}) }),
})
