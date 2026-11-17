// Decision 5 of the plan: the component settles a checkout and calls the host's onPaid in the same
// transaction. These check the two things that needs from Convex.
import { expect, test } from 'vitest'
import { defined } from '../testing/app.js'

const { api, createTest } = defined

test('a component mutation calls a host function handle, and the host write lands with it', async () => {
  const t = createTest()
  expect(await t.mutation(api.probe.run, { fail: false })).toEqual({ caught: null, returned: 'ok' })
  expect(await t.query(api.probe.state, {})).toEqual({ host: ['kept'], component: ['before', 'after'] })
})

test('a throw in the handle is caught by the component; only the handle’s writes roll back', async () => {
  const t = createTest()
  const res = await t.mutation(api.probe.run, { fail: true })
  expect(res.caught).toContain('refused by the host')
  expect(await t.query(api.probe.state, {})).toEqual({ host: [], component: ['before', 'caught'] })
})
