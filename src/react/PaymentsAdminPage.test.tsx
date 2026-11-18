// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { PaymentsAdminPage } from './PaymentsAdminPage.js'
import type { RefundQuestion } from './PaymentsAdminPage.js'
import type { CheckoutSummary, OpenRefund, PaymentIssue, PaymentsAdminApi } from './types.js'

const checkout: CheckoutSummary = {
  id: 'c1',
  ref: { type: 'order', id: 'o1' },
  purpose: 'order',
  kind: 'hosted',
  description: 'Weekend retreat',
  processor: 'stripe',
  method: 'card',
  payer: { name: 'Ana', email: 'ana@example.org' },
  status: 'paid',
  paymentRef: 'pi_1',
  amountCents: 10000,
  paidCents: 10000,
  refundedCents: 1000,
  createdAt: Date.UTC(2026, 10, 14, 15),
}

const openRefund: OpenRefund = {
  id: 'r1',
  checkoutId: 'c1',
  amountCents: 2000,
  reason: 'Left early',
  origin: 'requested',
  status: 'requested',
  requestedBy: 'Sam',
  approvedBy: null,
  processorRefundId: null,
  note: null,
  error: null,
  createdAt: Date.UTC(2026, 10, 15),
  updatedAt: Date.UTC(2026, 10, 15),
  sentAt: null,
  attempts: 0,
  hostData: null,
  checkout,
}

const issue: PaymentIssue = {
  id: 'i1',
  kind: 'charge_unknown',
  key: 'pi_2',
  checkoutId: 'c2',
  processor: 'stripe',
  paymentRef: null,
  detail: 'Stripe didn’t answer three times.',
  openedAt: Date.UTC(2026, 10, 16),
  resolvedAt: null,
  reportedAt: null,
}

type Fn<R> = (args: unknown) => Promise<R>
const calls = {
  requestRefund: vi.fn<Fn<string>>(async () => 'r2'),
  sendRefund: vi.fn<Fn<{ status: string; error: string | null } | null>>(async () => ({ status: 'sent', error: null })),
  approveRefund: vi.fn<Fn<null>>(async () => null),
  markRefundedManually: vi.fn<Fn<null>>(async () => null),
  dismissRefund: vi.fn<Fn<null>>(async () => null),
  resolveIssue: vi.fn<Fn<null>>(async () => null),
  retryCharge: vi.fn<Fn<null>>(async () => null),
  giveUpCharge: vi.fn<Fn<{ status: string }>>(async () => ({ status: 'failed' })),
}
type Name = keyof typeof calls

vi.mock('convex/react', () => ({
  useQuery: (fn: string) => (fn === 'openRefunds' ? [openRefund] : undefined),
  usePaginatedQuery: (fn: string) => ({ results: fn === 'refundable' ? [checkout] : [issue], status: 'Exhausted', loadMore: () => {} }),
  useMutation: (fn: Name) => calls[fn],
  useAction: (fn: Name) => calls[fn],
}))

const api = Object.fromEntries(['openRefunds', 'refundable', 'issues', ...Object.keys(calls)].map((k) => [k, k])) as unknown as PaymentsAdminApi

beforeEach(() => {
  for (const fn of Object.values(calls)) fn.mockClear()
})
afterEach(cleanup)

/** The list row an element is in. */
function rowOf(el: HTMLElement): HTMLElement {
  const row = el.closest('li')
  if (!row) throw new Error('Not in a row.')
  return row
}

/** What the amount box says is wrong with it: the text its aria-describedby points at. */
function amountError(row: HTMLElement): string {
  const id = within(row).getByLabelText('Amount ($)').getAttribute('aria-describedby')
  return (id && document.getElementById(id)?.textContent) || ''
}

/** The row of the "Refund a payment" list. */
const refundRow = () => rowOf(screen.getByLabelText('Amount ($)'))

test('what is left counts the open refund; more than that is refused in place', () => {
  render(<PaymentsAdminPage api={api} auth={{ token: 't' }} skipApproval />)
  const row = refundRow()
  // $100 paid, $10 refunded, $20 asked for and not sent: $70 left.
  expect(within(row).getByText('$70.00 left')).toBeTruthy()
  fireEvent.change(within(row).getByLabelText('Amount ($)'), { target: { value: '70.01' } })
  expect(amountError(row)).toBe('Only $70.00 is left to refund on this payment.')
  expect(within(row).getByRole<HTMLButtonElement>('button', { name: 'Refund' }).disabled).toBe(true)
  fireEvent.change(within(row).getByLabelText('Amount ($)'), { target: { value: 'ten' } })
  expect(amountError(row)).toBe('Enter an amount in dollars, like 12.50.')
  // Not an alert: a screen reader would read it out on every keystroke.
  expect(within(row).queryByRole('alert')).toBeNull()
})

test('a refund asks twice, then requests the typed amount in cents and sends it', async () => {
  render(<PaymentsAdminPage api={api} auth={{ token: 't' }} skipApproval />)
  const row = refundRow()
  fireEvent.change(within(row).getByLabelText('Amount ($)'), { target: { value: '12.5' } })
  fireEvent.click(within(row).getByRole('button', { name: 'Refund $12.50' }))
  expect(calls.requestRefund).not.toHaveBeenCalled()
  fireEvent.click(within(row).getByRole('button', { name: 'Send $12.50 back via Stripe?' }))
  await waitFor(() => expect(calls.sendRefund).toHaveBeenCalledWith({ auth: { token: 't' }, refundId: 'r2' }))
  expect(calls.requestRefund).toHaveBeenCalledWith({ auth: { token: 't' }, checkoutId: 'c1', amountCents: 1250, reason: 'Refunded by an admin' })
})

test('blank refunds everything left', async () => {
  render(<PaymentsAdminPage api={api} skipApproval />)
  const row = refundRow()
  fireEvent.click(within(row).getByRole('button', { name: 'Refund $70.00' }))
  fireEvent.click(within(row).getByRole('button', { name: 'Send $70.00 back via Stripe?' }))
  // No auth given: none is sent.
  await waitFor(() => expect(calls.requestRefund).toHaveBeenCalledWith({ checkoutId: 'c1', amountCents: 7000, reason: 'Refunded by an admin' }))
})

test('the processor refusing a refund shows its reason by the row', async () => {
  calls.sendRefund.mockResolvedValueOnce({ status: 'failed', error: 'Charge already refunded.' })
  render(<PaymentsAdminPage api={api} skipApproval />)
  const row = refundRow()
  fireEvent.click(within(row).getByRole('button', { name: 'Refund $70.00' }))
  fireEvent.click(within(row).getByRole('button', { name: 'Send $70.00 back via Stripe?' }))
  await waitFor(() => expect(within(row).getByRole('alert').textContent).toBe('Charge already refunded.'))
})

test('a refund recorded but not sent clears the form, so it is finished in Refunds to do and not asked again', async () => {
  calls.sendRefund.mockRejectedValueOnce(new Error('Network down'))
  render(<PaymentsAdminPage api={api} skipApproval />)
  const row = refundRow()
  fireEvent.change(within(row).getByLabelText('Amount ($)'), { target: { value: '5' } })
  fireEvent.click(within(row).getByRole('button', { name: 'Refund $5.00' }))
  fireEvent.click(within(row).getByRole('button', { name: 'Send $5.00 back via Stripe?' }))
  await waitFor(() => expect(within(row).getByRole('alert').textContent).toBe('Network down'))
  expect(within(row).getByRole('status').textContent).toContain('Finish it in Refunds to do')
  expect(within(row).getByLabelText<HTMLInputElement>('Amount ($)').value).toBe('')
  expect(calls.requestRefund).toHaveBeenCalledTimes(1)
})

test('without skipApproval a requested refund is approved, not sent, and a new one waits', async () => {
  render(<PaymentsAdminPage api={api} />)
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
  await waitFor(() => expect(calls.approveRefund).toHaveBeenCalledWith({ refundId: 'r1' }))
  const row = refundRow()
  fireEvent.click(within(row).getByRole('button', { name: 'Refund $70.00' }))
  fireEvent.click(within(row).getByRole('button', { name: 'Ask to refund $70.00?' }))
  await waitFor(() => expect(within(row).getByRole('status').textContent).toContain('waiting for approval'))
  expect(calls.sendRefund).not.toHaveBeenCalled()
})

test('a charge with an unknown outcome can be retried or given up; errors stay by the issue', async () => {
  calls.retryCharge.mockRejectedValueOnce(new Error('This charge is paid; there is nothing to retry.'))
  render(<PaymentsAdminPage api={api} />)
  const row = rowOf(screen.getByText('Stripe didn’t answer three times.'))
  fireEvent.click(within(row).getByRole('button', { name: 'Try the charge again' }))
  fireEvent.click(within(row).getByRole('button', { name: 'Charge again?' }))
  await waitFor(() => expect(within(row).getByRole('alert').textContent).toBe('This charge is paid; there is nothing to retry.'))
  fireEvent.click(within(row).getByRole('button', { name: 'Give up' }))
  fireEvent.click(within(row).getByRole('button', { name: 'Give up on this charge?' }))
  await waitFor(() => expect(calls.giveUpCharge).toHaveBeenCalledWith({ checkoutId: 'c2' }))
  expect(within(row).queryByRole('alert')).toBeNull()
})

/** The app's question: asked only when a refund takes everything left. */
const relistQuestion = (c: CheckoutSummary, cents: number, left: number): RefundQuestion | null =>
  cents === left
    ? {
        key: 'relist',
        label: `List ${c.description} again?`,
        options: [
          { value: 'yes', label: 'Yes, list it again' },
          { value: 'no', label: 'No' },
        ],
      }
    : null

test('a full refund waits for the app’s question to be answered, with nothing chosen for the admin, and sends the answer', async () => {
  render(<PaymentsAdminPage api={api} skipApproval refundQuestion={relistQuestion} />)
  const row = refundRow()
  const group = within(row).getByRole('group', { name: 'List Weekend retreat again?' })
  const radios = within(group).getAllByRole<HTMLInputElement>('radio')
  expect(radios.map((r) => r.checked)).toEqual([false, false])
  expect(within(row).getByRole<HTMLButtonElement>('button', { name: 'Refund $70.00' }).disabled).toBe(true)
  expect(within(row).getByText('Answer the question above to refund.')).toBeTruthy()
  fireEvent.click(within(group).getByLabelText('No'))
  fireEvent.click(within(row).getByRole('button', { name: 'Refund $70.00' }))
  fireEvent.click(within(row).getByRole('button', { name: 'Send $70.00 back via Stripe? (No)' }))
  await waitFor(() => expect(calls.sendRefund).toHaveBeenCalled())
  expect(calls.requestRefund).toHaveBeenCalledWith({ checkoutId: 'c1', amountCents: 7000, reason: 'Refunded by an admin', hostData: { relist: 'no' } })
})

test('a partial refund asks nothing and sends no notes', async () => {
  render(<PaymentsAdminPage api={api} skipApproval refundQuestion={relistQuestion} />)
  const row = refundRow()
  fireEvent.change(within(row).getByLabelText('Amount ($)'), { target: { value: '20' } })
  expect(within(row).queryByRole('group')).toBeNull()
  fireEvent.click(within(row).getByRole('button', { name: 'Refund $20.00' }))
  fireEvent.click(within(row).getByRole('button', { name: 'Send $20.00 back via Stripe?' }))
  await waitFor(() => expect(calls.requestRefund).toHaveBeenCalledWith({ checkoutId: 'c1', amountCents: 2000, reason: 'Refunded by an admin' }))
})

test('an answer only counts for the question it was given to: a partial amount drops it, another key doesn’t reuse it', async () => {
  let key = 'relist'
  const question = (c: CheckoutSummary, cents: number, left: number) =>
    cents === left
      ? {
          key,
          label: 'Again?',
          options: [
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No' },
          ],
        }
      : null
  const { rerender } = render(<PaymentsAdminPage api={api} skipApproval refundQuestion={question} />)
  const row = refundRow()
  fireEvent.click(within(row).getByLabelText('Yes'))
  fireEvent.change(within(row).getByLabelText('Amount ($)'), { target: { value: '20' } })
  expect(within(row).queryByRole('group')).toBeNull()
  fireEvent.change(within(row).getByLabelText('Amount ($)'), { target: { value: '' } })
  expect(within(row).getByLabelText<HTMLInputElement>('Yes').checked).toBe(true)
  key = 'restock'
  rerender(<PaymentsAdminPage api={api} skipApproval refundQuestion={(c, cents, left) => question(c, cents, left)} />)
  expect(within(row).getByLabelText<HTMLInputElement>('Yes').checked).toBe(false)
  expect(within(row).getByRole<HTMLButtonElement>('button', { name: 'Refund $70.00' }).disabled).toBe(true)
})

test('without skipApproval the answer goes with the request, and the form clears', async () => {
  render(<PaymentsAdminPage api={api} refundQuestion={relistQuestion} />)
  const row = refundRow()
  fireEvent.click(within(row).getByLabelText('Yes, list it again'))
  fireEvent.click(within(row).getByRole('button', { name: 'Refund $70.00' }))
  fireEvent.click(within(row).getByRole('button', { name: 'Ask to refund $70.00? (Yes, list it again)' }))
  await waitFor(() => expect(calls.requestRefund).toHaveBeenCalledWith({ checkoutId: 'c1', amountCents: 7000, reason: 'Refunded by an admin', hostData: { relist: 'yes' } }))
  expect(calls.sendRefund).not.toHaveBeenCalled()
  expect(within(row).getByLabelText<HTMLInputElement>('Yes, list it again').checked).toBe(false)
})
