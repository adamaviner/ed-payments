// A small host app for the library's own tests.
import { createFunctionHandle, defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import { defineTestApp } from 'convex-test'
import paymentsTest from '../test.js'

export const app = defineTestApp({
  schema: defineSchema({
    hostRows: defineTable({ note: v.string() }),
  }),
  components: { payments: paymentsTest },
})

export const defined = app.defineModules({
  probe: {
    hostWrite: app.internalMutation({
      args: { fail: v.boolean() },
      handler: async (ctx, { fail }): Promise<string> => {
        await ctx.db.insert('hostRows', { note: fail ? 'should roll back' : 'kept' })
        if (fail) throw new Error('refused by the host')
        return 'ok'
      },
    }),
    run: app.mutation({
      args: { fail: v.boolean() },
      handler: async (ctx, { fail }): Promise<{ caught: string | null; returned: string | null }> =>
        await ctx.runMutation(app.components.payments.probe.callHost, { handle: await createFunctionHandle(defined.internal.probe.hostWrite), fail }),
    }),
    state: app.query({
      args: {},
      handler: async (ctx): Promise<{ host: string[]; component: string[] }> => ({
        host: (await ctx.db.query('hostRows').collect()).map((r) => r.note),
        component: await ctx.runQuery(app.components.payments.probe.notes, {}),
      }),
    }),
  },
})
