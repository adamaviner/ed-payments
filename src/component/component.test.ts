// The component on its own: the checkout state machine, the refund ledger, events, issues, disputes,
// limits and cleanup, with the host's callbacks from src/testing/app.ts.
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server'
import { describe, expect, test } from 'vitest'
import { app, defined } from '../testing/app.js'

const { api, createTest } = defined
const pay = app.components.payments
const NOW = Date.UTC(2030, 0, 1, 12)
const DAY = 24 * 60 * 60_000

function setup() {
  const t = createTest()
  const mutate = <F extends FunctionReference<'mutation', 'internal'>>(fn: F, args: FunctionArgs<F>) => t.run(async (ctx): Promise<FunctionReturnType<F>> => await ctx.runMutation(fn, args))
  const read = <F extends FunctionReference<'query', 'internal'>>(fn: F, args: FunctionArgs<F>) => t.run(async (ctx): Promise<FunctionReturnType<F>> => await ctx.runQuery(fn, args))
  const create = (o: { amountCents?: number; processor?: 'stripe' | 'paypal'; context?: unknown; limitKey?: string; now?: number } = {}) => t.mutation(api.host.create, { now: NOW, ...o })
  const checkout = async (id: string) => (await read(pay.checkouts.get, { id }))!
  const calls = (name?: string) => t.query(api.host.calls, {}).then((cs) => cs.filter((c) => !name || c.name === name))
  const paid = async (o: { amountCents?: number; context?: unknown } = {}) => {
    const id = await create(o)
    await mutate(pay.checkouts.attach, { id, processorCheckoutId: `cs_${id}` })
    expect(await mutate(pay.checkouts.settlePaid, { id, paymentRef: `pi_${id}`, paidCents: o.amountCents ?? 2500, now: NOW })).toEqual({ outcome: 'paid' })
    return id
  }
  return { t, mutate, read, create, checkout, calls, paid }
}

describe('checkouts', () => {
  test('created → pending → paid; onPaid records the order in the same transaction; repeats are already_handled', async () => {
    const { t, mutate, create, checkout, calls } = setup()
    const id = await create({ context: { buyer: 'Ana' } })
    expect((await checkout(id)).status).toBe('created')
    expect(await mutate(pay.checkouts.attach, { id, processorCheckoutId: 'cs_1' })).toEqual({ outcome: 'attached' })
    expect(await mutate(pay.checkouts.attach, { id, processorCheckoutId: 'cs_2' })).toEqual({ outcome: 'already_handled', status: 'pending' })
    expect(await mutate(pay.checkouts.settlePaid, { id, paymentRef: 'pi_1', paidCents: 2500, processorFeeCents: 103, now: NOW })).toEqual({ outcome: 'paid' })
    expect(await checkout(id)).toMatchObject({ status: 'paid', paymentRef: 'pi_1', paidCents: 2500, processorFeeCents: 103, refundedCents: 0, settledAt: NOW, processorCheckoutId: 'cs_1' })
    expect(await t.query(api.host.orders, {})).toMatchObject([{ checkoutId: id, paymentRef: 'pi_1', paidCents: 2500 }])
    const [onPaid] = await calls('onPaid')
    expect(onPaid.args).toMatchObject({
      checkoutId: id,
      ref: { type: 'offering', id: 'o1' },
      purpose: 'order',
      amountCents: 2500,
      paidCents: 2500,
      processor: 'stripe',
      method: 'card',
      paymentRef: 'pi_1',
      payer: { email: 'ana@example.org' },
      context: { buyer: 'Ana' },
    })
    expect(await mutate(pay.checkouts.settlePaid, { id, paymentRef: 'pi_1', paidCents: 2500, now: NOW })).toEqual({ outcome: 'already_handled', status: 'paid' })
    expect(await calls('onPaid')).toHaveLength(1)
    expect(await t.query(api.host.orders, {})).toHaveLength(1)
  })

  test('onPaid refusing: refund_needed, a refund for the whole amount, onRefundNeeded told, no order', async () => {
    const { t, mutate, create, checkout, calls, read } = setup()
    const id = await create({ context: { paid: { refuse: 'Sold to someone else' } } })
    const res = await mutate(pay.checkouts.settlePaid, { id, paymentRef: 'pi_1', paidCents: 2500, now: NOW })
    expect(res).toMatchObject({ outcome: 'refund_needed', reason: 'Sold to someone else' })
    expect(await checkout(id)).toMatchObject({ status: 'refund_needed', lastError: 'Sold to someone else', paidCents: 2500 })
    expect(await t.query(api.host.orders, {})).toEqual([])
    expect(await read(pay.refunds.forCheckout, { checkoutId: id })).toMatchObject([{ amountCents: 2500, origin: 'needed', status: 'requested', reason: 'Sold to someone else' }])
    expect((await calls('onRefundNeeded'))[0].args).toMatchObject({ checkoutId: id, reason: 'Sold to someone else', paidCents: 2500, paymentRef: 'pi_1' })
  })

  test('onPaid throwing after it wrote: its writes roll back, the throw becomes the refund reason (decision 5)', async () => {
    const { t, mutate, create, checkout, calls } = setup()
    const id = await create({ context: { paid: { throwAfterWrite: 'This item already sold' } } })
    expect(await mutate(pay.checkouts.settlePaid, { id, paymentRef: 'pi_1', paidCents: 2500, now: NOW })).toMatchObject({ outcome: 'refund_needed', reason: 'This item already sold' })
    expect(await t.query(api.host.orders, {})).toEqual([])
    expect((await calls()).map((c) => c.name)).toEqual(['onRefundNeeded'])
    expect((await checkout(id)).status).toBe('refund_needed')
  })

  test('the processor taking a different amount is refund_needed without asking the host', async () => {
    const { mutate, create, calls } = setup()
    const id = await create()
    expect(await mutate(pay.checkouts.settlePaid, { id, paymentRef: 'pi_1', paidCents: 2400, now: NOW })).toMatchObject({
      outcome: 'refund_needed',
      reason: 'The processor took $24.00, not the $25.00 asked.',
    })
    expect(await calls('onPaid')).toEqual([])
  })

  test('bank payments: processing, then paid or failed (onFailed); a final row is already_handled', async () => {
    const { mutate, create, checkout, calls } = setup()
    const a = await create()
    expect(await mutate(pay.checkouts.markProcessing, { id: a, paymentRef: 'pi_a' })).toEqual({ outcome: 'processing' })
    expect(await mutate(pay.checkouts.abandon, { id: a, now: NOW })).toEqual({ outcome: 'already_handled', status: 'processing' })
    expect(await mutate(pay.checkouts.settlePaid, { id: a, paymentRef: 'pi_a', paidCents: 2500, now: NOW })).toEqual({ outcome: 'paid' })
    const b = await create()
    await mutate(pay.checkouts.markProcessing, { id: b })
    expect(await mutate(pay.checkouts.settleFailed, { id: b, reason: 'The bank returned the debit.', now: NOW })).toEqual({ outcome: 'failed' })
    expect(await checkout(b)).toMatchObject({ status: 'failed', lastError: 'The bank returned the debit.' })
    expect((await calls('onFailed'))[0].args).toMatchObject({ checkoutId: b, reason: 'The bank returned the debit.' })
    expect(await mutate(pay.checkouts.settleFailed, { id: a, reason: 'x', now: NOW })).toEqual({ outcome: 'already_handled', status: 'paid' })
    expect(await mutate(pay.checkouts.markProcessing, { id: a })).toEqual({ outcome: 'already_handled', status: 'paid' })
  })

  test('abandoned, then paid anyway (a late capture): money taken is still settled', async () => {
    const { mutate, create, checkout } = setup()
    const id = await create()
    await mutate(pay.checkouts.attach, { id, processorCheckoutId: 'O1' })
    expect(await mutate(pay.checkouts.abandon, { id, now: NOW })).toEqual({ outcome: 'abandoned' })
    expect(await mutate(pay.checkouts.abandon, { id, now: NOW })).toEqual({ outcome: 'already_handled', status: 'abandoned' })
    expect(await mutate(pay.checkouts.settlePaid, { id, paymentRef: 'CAP1', paidCents: 2500, now: NOW })).toEqual({ outcome: 'paid' })
    expect((await checkout(id)).status).toBe('paid')
  })

  test('a start that failed at the processor closes the row', async () => {
    const { mutate, create, checkout } = setup()
    const id = await create()
    await mutate(pay.checkouts.failStart, { id, error: 'Stripe is down', now: NOW })
    expect(await checkout(id)).toMatchObject({ status: 'failed', lastError: 'Stripe is down' })
  })

  test('lookups by processor id, payment reference and ref', async () => {
    const { read, paid } = setup()
    const id = await paid()
    expect((await read(pay.checkouts.byProcessorId, { processorCheckoutId: `cs_${id}` }))?.id).toBe(id)
    expect((await read(pay.checkouts.byPaymentRef, { paymentRef: `pi_${id}` }))?.id).toBe(id)
    expect(await read(pay.checkouts.byPaymentRef, { paymentRef: 'nope' })).toBeNull()
    expect((await read(pay.checkouts.byRef, { ref: { type: 'offering', id: 'o1' } })).map((c) => c.id)).toEqual([id])
    expect(await read(pay.checkouts.get, { id: 'not-an-id' })).toBeNull()
  })

  test('the rate limit: three per buyer per window, five in all per minute', async () => {
    const { create } = setup()
    for (let i = 0; i < 3; i++) await create({ limitKey: 'Ana@example.org' })
    await expect(create({ limitKey: 'ana@example.org ' })).rejects.toThrow(/Too many checkouts were started for you/)
    await create({ limitKey: 'ana@example.org', now: NOW + 10 * 60_000 })
    await create({ limitKey: 'ben@example.org', now: NOW + 10 * 60_000 })
    await create({ limitKey: 'cy@example.org', now: NOW + 10 * 60_000 })
    await create({ limitKey: 'di@example.org', now: NOW + 10 * 60_000 })
    await create({ limitKey: 'ed@example.org', now: NOW + 10 * 60_000 })
    await expect(create({ limitKey: 'fay@example.org', now: NOW + 10 * 60_000 })).rejects.toThrow(/right now/)
  })
})

describe('refunds', () => {
  test('partial refunds up to what is left, and not beyond; sent ones count and tell the host', async () => {
    const { mutate, read, paid, checkout, calls } = setup()
    const id = await paid()
    const r1 = await mutate(pay.refunds.request, { checkoutId: id, amountCents: 1000, reason: 'Broken lid', by: 'admin', now: NOW })
    await expect(mutate(pay.refunds.request, { checkoutId: id, amountCents: 1501, reason: 'x', now: NOW })).rejects.toThrow(/Only \$15.00 is left/)
    await expect(mutate(pay.refunds.begin, { refundId: r1, skipApproval: false, now: NOW })).rejects.toThrow(/needs approving/)
    await mutate(pay.refunds.approve, { refundId: r1, by: 'boss', now: NOW })
    const go = await mutate(pay.refunds.begin, { refundId: r1, skipApproval: false, now: NOW })
    expect(go).toMatchObject({ state: 'send', paymentRef: `pi_${id}`, amountCents: 1000, processor: 'stripe', app: 'test' })
    expect(await mutate(pay.refunds.begin, { refundId: r1, skipApproval: false, now: NOW })).toEqual({ state: 'already', status: 'sending' })
    await mutate(pay.refunds.finish, { refundId: r1, ok: true, done: true, processorRefundId: 're_1', now: NOW })
    expect((await checkout(id)).refundedCents).toBe(1000)
    expect((await calls('onRefunded'))[0].args).toMatchObject({ refundId: r1, amountCents: 1000, refundedCents: 1000, paidCents: 2500, origin: 'requested' })
    const rest = await mutate(pay.refunds.request, { checkoutId: id, reason: 'The rest', now: NOW })
    expect((await read(pay.refunds.get, { refundId: rest }))?.amountCents).toBe(1500)
    await expect(mutate(pay.refunds.request, { checkoutId: id, reason: 'more', now: NOW })).rejects.toThrow(/Nothing is left/)
    await mutate(pay.refunds.begin, { refundId: rest, skipApproval: true, by: 'admin', now: NOW })
    await mutate(pay.refunds.finish, { refundId: rest, ok: true, done: true, processorRefundId: 're_2', now: NOW })
    expect((await checkout(id)).refundedCents).toBe(2500)
    expect(await read(pay.refunds.listOpen, {})).toEqual([])
  })

  test('a failed send can be sent again; pending stays sending until it is done', async () => {
    const { mutate, read, paid, checkout } = setup()
    const id = await paid()
    const r = await mutate(pay.refunds.request, { checkoutId: id, reason: 'x', now: NOW })
    await mutate(pay.refunds.begin, { refundId: r, skipApproval: true, now: NOW })
    await mutate(pay.refunds.finish, { refundId: r, ok: false, done: false, error: 'Card closed', now: NOW })
    expect(await read(pay.refunds.get, { refundId: r })).toMatchObject({ status: 'failed', error: 'Card closed' })
    await mutate(pay.refunds.begin, { refundId: r, skipApproval: false, now: NOW })
    await mutate(pay.refunds.finish, { refundId: r, ok: true, done: false, processorRefundId: 're_9', now: NOW })
    expect(await read(pay.refunds.stuck, { before: NOW + 1, limit: 10 })).toMatchObject([{ id: r, processorRefundId: 're_9' }])
    expect(await mutate(pay.refunds.recordExternal, { processor: 'stripe', paymentRef: `pi_${id}`, processorRefundId: 're_9', amountCents: 2500, state: 'done', now: NOW })).toBe('updated')
    expect((await checkout(id)).refundedCents).toBe(2500)
  })

  test('marked done by hand, or dismissed; a later webhook for the hand refund isn’t counted twice', async () => {
    const { mutate, read, paid, checkout } = setup()
    const id = await paid()
    const r = await mutate(pay.refunds.request, { checkoutId: id, amountCents: 500, reason: 'x', now: NOW })
    await mutate(pay.refunds.markManual, { refundId: r, by: 'admin', note: ' done in the dashboard ', now: NOW })
    expect(await read(pay.refunds.get, { refundId: r })).toMatchObject({ status: 'manual', note: 'done in the dashboard' })
    expect((await checkout(id)).refundedCents).toBe(500)
    expect(await mutate(pay.refunds.recordExternal, { processor: 'stripe', paymentRef: `pi_${id}`, processorRefundId: 're_d', amountCents: 500, state: 'done', now: NOW })).toBe('updated')
    expect(await mutate(pay.refunds.recordExternal, { processor: 'stripe', paymentRef: `pi_${id}`, processorRefundId: 're_d', amountCents: 500, state: 'done', now: NOW })).toBe('unchanged')
    expect((await checkout(id)).refundedCents).toBe(500)
    const d = await mutate(pay.refunds.request, { checkoutId: id, amountCents: 500, reason: 'y', now: NOW })
    await mutate(pay.refunds.dismiss, { refundId: d, note: 'kept the item', now: NOW })
    await expect(mutate(pay.refunds.markManual, { refundId: d, now: NOW })).rejects.toThrow(/already dismissed/)
  })

  test('refunded in the dashboard, webhook first, then marked done by hand: closed against the external refund, not counted twice', async () => {
    const { mutate, read, create, checkout, calls } = setup()
    const id = await create({ context: { paid: { refuse: 'Sold out' } } })
    await mutate(pay.checkouts.settlePaid, { id, paymentRef: `pi_${id}`, paidCents: 2500, now: NOW })
    const [needed] = await read(pay.refunds.forCheckout, { checkoutId: id })
    await mutate(pay.refunds.recordExternal, { processor: 'stripe', paymentRef: `pi_${id}`, processorRefundId: 're_dash', amountCents: 2500, state: 'done', now: NOW })
    await mutate(pay.refunds.markManual, { refundId: needed.id, by: 'admin', now: NOW })
    expect((await checkout(id)).refundedCents).toBe(2500)
    const rows = await read(pay.refunds.forCheckout, { checkoutId: id })
    expect(rows.map((r) => `${r.origin} ${r.status}`).sort((a, b) => a.localeCompare(b))).toEqual(['external sent', 'needed dismissed'])
    expect(rows.find((r) => r.origin === 'external')).toMatchObject({ reason: 'Sold out', requestedBy: 'admin' })
    expect(await calls('onRefunded')).toHaveLength(1)
  })

  test('the host’s notes on a refund are kept, passed to onRefunded, and only a few short strings', async () => {
    const { mutate, read, paid, calls } = setup()
    const id = await paid()
    const plain = await mutate(pay.refunds.request, { checkoutId: id, amountCents: 500, reason: 'x', now: NOW })
    const noted = await mutate(pay.refunds.request, { checkoutId: id, reason: 'The rest', hostData: { relist: 'no' }, now: NOW })
    expect(await read(pay.refunds.get, { refundId: plain })).toMatchObject({ hostData: null })
    expect(await read(pay.refunds.get, { refundId: noted })).toMatchObject({ hostData: { relist: 'no' } })
    await mutate(pay.refunds.markManual, { refundId: plain, now: NOW })
    await mutate(pay.refunds.markManual, { refundId: noted, now: NOW })
    const args = (await calls('onRefunded')).map((c) => c.args)
    expect(args[0]).not.toHaveProperty('hostData')
    expect(args[1]).toMatchObject({ refundedCents: 2500, hostData: { relist: 'no' } })
    const many = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, 'v']))
    await expect(mutate(pay.refunds.request, { checkoutId: id, reason: 'x', hostData: many, now: NOW })).rejects.toThrow(/at most 10 notes/)
    await expect(mutate(pay.refunds.request, { checkoutId: id, reason: 'x', hostData: { k: 'v'.repeat(201) }, now: NOW })).rejects.toThrow(/at most 200 characters/)
  })

  test('marking a refund done by hand never counts past what was paid', async () => {
    const { mutate, paid, checkout } = setup()
    const id = await paid()
    const r = await mutate(pay.refunds.request, { checkoutId: id, amountCents: 2000, reason: 'x', now: NOW })
    await mutate(pay.refunds.recordExternal, { processor: 'stripe', paymentRef: `pi_${id}`, processorRefundId: 're_other', amountCents: 1000, state: 'done', now: NOW })
    await expect(mutate(pay.refunds.markManual, { refundId: r, now: NOW })).rejects.toThrow(/Only \$15.00 is left unrefunded/)
    expect((await checkout(id)).refundedCents).toBe(1000)
  })

  test('a refund made in the dashboard arrives as external and is counted once; another app’s is foreign', async () => {
    const { mutate, read, paid, checkout, calls } = setup()
    const id = await paid()
    const ext = { processor: 'stripe' as const, paymentRef: `pi_${id}`, processorRefundId: 're_x', amountCents: 700, state: 'done' as const, now: NOW }
    expect(await mutate(pay.refunds.recordExternal, ext)).toBe('recorded')
    expect(await mutate(pay.refunds.recordExternal, ext)).toBe('unchanged')
    expect((await checkout(id)).refundedCents).toBe(700)
    expect(await read(pay.refunds.forCheckout, { checkoutId: id })).toMatchObject([{ origin: 'external', status: 'sent', amountCents: 700 }])
    expect((await calls('onRefunded'))[0].args).toMatchObject({ origin: 'external', refundedCents: 700 })
    expect(await mutate(pay.refunds.recordExternal, { ...ext, paymentRef: 'pi_someone_else' })).toBe('foreign')
    expect(await mutate(pay.refunds.recordExternal, { ...ext, processor: 'paypal' })).toBe('foreign')
  })

  test('the tag finds the library’s own refund before finish recorded its id (webhook first)', async () => {
    const { mutate, read, paid, checkout } = setup()
    const id = await paid()
    const r = await mutate(pay.refunds.request, { checkoutId: id, amountCents: 1000, reason: 'x', now: NOW })
    await mutate(pay.refunds.begin, { refundId: r, skipApproval: true, now: NOW })
    expect(await mutate(pay.refunds.recordExternal, { processor: 'stripe', paymentRef: `pi_${id}`, processorRefundId: 're_t', amountCents: 1000, state: 'done', refundId: r, now: NOW })).toBe(
      'updated',
    )
    await mutate(pay.refunds.finish, { refundId: r, ok: true, done: true, processorRefundId: 're_t', now: NOW })
    expect((await checkout(id)).refundedCents).toBe(1000)
    expect(await read(pay.refunds.forCheckout, { checkoutId: id })).toHaveLength(1)
  })

  test('a sent refund the processor later fails is uncounted and opens an issue', async () => {
    const { mutate, read, paid, checkout } = setup()
    const id = await paid()
    await mutate(pay.refunds.recordExternal, { processor: 'stripe', paymentRef: `pi_${id}`, processorRefundId: 're_f', amountCents: 700, state: 'done', now: NOW })
    expect(await mutate(pay.refunds.recordExternal, { processor: 'stripe', paymentRef: `pi_${id}`, processorRefundId: 're_f', amountCents: 700, state: 'failed', now: NOW })).toBe('updated')
    expect((await checkout(id)).refundedCents).toBe(0)
    expect((await read(pay.issues.unreported, {})).map((i) => i.kind)).toEqual(['status_differs'])
  })

  test('only paid checkouts take refunds', async () => {
    const { mutate, create } = setup()
    const id = await create()
    await expect(mutate(pay.refunds.request, { checkoutId: id, reason: 'x', now: NOW })).rejects.toThrow(/Only a paid checkout/)
  })
})

describe('events, disputes, issues', () => {
  test('a delivery handled once is seen after; one that failed half way is new again', async () => {
    const { mutate } = setup()
    const e = { processor: 'stripe' as const, eventId: 'evt_1', type: 'checkout.session.completed', now: NOW }
    expect(await mutate(pay.events.begin, e)).toBe('new')
    expect(await mutate(pay.events.begin, e)).toBe('new')
    await mutate(pay.events.finish, { processor: 'stripe', eventId: 'evt_1', outcome: 'handled' })
    expect(await mutate(pay.events.begin, e)).toBe('seen')
    expect(await mutate(pay.events.begin, { ...e, processor: 'paypal' })).toBe('new')
  })

  test('a dispute marks the checkout, opens an issue and tells the host; closing resolves it', async () => {
    const { mutate, read, paid, checkout, calls } = setup()
    const id = await paid()
    const d = { processor: 'stripe' as const, paymentRef: `pi_${id}`, disputeId: 'dp_1', reason: 'fraudulent', amountCents: 2500, now: NOW }
    expect(await mutate(pay.disputes.record, { ...d, status: 'opened' })).toBe('recorded')
    expect((await checkout(id)).disputed).toBe(true)
    expect(await read(pay.issues.unreported, {})).toMatchObject([{ kind: 'dispute', key: 'dp_1', detail: 'The buyer disputed A bowl for $25.00 (fraudulent).' }])
    expect(await read(pay.issues.openCount, {})).toBe(1)
    expect(await mutate(pay.disputes.record, { ...d, status: 'closed', outcome: 'won' })).toBe('recorded')
    expect(await read(pay.issues.openCount, {})).toBe(0)
    expect((await calls('onDispute')).map((c) => c.args.status)).toEqual(['opened', 'closed'])
    expect(await mutate(pay.disputes.record, { ...d, paymentRef: 'pi_other', status: 'opened' })).toBe('foreign')
  })

  test('a callback that throws (other than onPaid) becomes a callback_failed issue, and the change stands', async () => {
    const { mutate, read, paid, checkout } = setup()
    const id = await paid({ context: { disputeThrows: true } })
    await mutate(pay.disputes.record, { processor: 'stripe', paymentRef: `pi_${id}`, disputeId: 'dp_2', status: 'opened', now: NOW })
    expect((await checkout(id)).disputed).toBe(true)
    expect((await read(pay.issues.unreported, {})).find((i) => i.kind === 'callback_failed')?.detail).toBe('onDispute failed: the dispute handler broke')
  })

  test('sync opens what reconcile found and resolves what went away; reported once', async () => {
    const { mutate, read } = setup()
    const base = { key: 'pi_1', processor: 'stripe' as const, paymentRef: 'pi_1', now: NOW }
    expect(await mutate(pay.issues.sync, { ...base, found: [{ kind: 'amount_differs', detail: 'Stripe has $24.00' }] })).toEqual({ opened: 1, resolved: 0 })
    expect(await mutate(pay.issues.sync, { ...base, found: [{ kind: 'amount_differs', detail: 'Stripe has $23.00' }] })).toEqual({ opened: 0, resolved: 0 })
    const open = await read(pay.issues.unreported, {})
    expect(open).toMatchObject([{ kind: 'amount_differs', detail: 'Stripe has $23.00' }])
    await mutate(pay.issues.markReported, { ids: open.map((i) => i.id), now: NOW })
    expect(await read(pay.issues.unreported, {})).toEqual([])
    expect(await mutate(pay.issues.sync, { ...base, found: [] })).toEqual({ opened: 0, resolved: 1 })
    expect(await read(pay.issues.openCount, {})).toBe(0)
  })
})

describe('cleanup', () => {
  test('keeps paid checkouts and refunds forever; deletes old abandoned ones, old events and old resolved issues', async () => {
    const { mutate, read, create, paid } = setup()
    const kept = await paid()
    await mutate(pay.refunds.request, { checkoutId: kept, amountCents: 100, reason: 'x', now: NOW })
    const gone = await create()
    await mutate(pay.checkouts.abandon, { id: gone, now: NOW })
    const alsoOld = await create({ now: NOW + 100 * DAY })
    await mutate(pay.checkouts.abandon, { id: alsoOld, now: NOW + 100 * DAY })
    await mutate(pay.events.begin, { processor: 'stripe', eventId: 'evt_old', type: 'x', now: NOW })
    await mutate(pay.issues.sync, { key: 'k', processor: 'stripe', found: [{ kind: 'missing_here', detail: 'x' }], now: NOW })
    await mutate(pay.issues.sync, { key: 'k', processor: 'stripe', found: [], now: NOW })
    const later = NOW + 200 * DAY
    // The events and issues are dated by when the test wrote them (now, by the real clock), so clean as of far in the future.
    const res = await mutate(pay.maintenance.cleanup, { now: Math.max(later, Date.now() + 200 * DAY) })
    expect(res.more).toBe(false)
    expect(await read(pay.checkouts.get, { id: gone })).toBeNull()
    expect(await read(pay.checkouts.get, { id: kept })).not.toBeNull()
    expect(await read(pay.refunds.forCheckout, { checkoutId: kept })).toHaveLength(1)
    expect(await read(pay.checkouts.get, { id: alsoOld })).toBeNull()
    expect(await mutate(pay.events.begin, { processor: 'stripe', eventId: 'evt_old', type: 'x', now: later })).toBe('new')
  })

  test('keeps an abandoned checkout inside the retention', async () => {
    const { mutate, read, create } = setup()
    const id = await create()
    await mutate(pay.checkouts.abandon, { id, now: NOW })
    await mutate(pay.maintenance.cleanup, { now: NOW + 30 * DAY })
    expect(await read(pay.checkouts.get, { id })).not.toBeNull()
  })
})
