// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { forgetScripts } from './embedded.js'
import type { CompleteReturnRef } from './types.js'
import { PAYPAL_CARD_PAY_NAMESPACE, PaypalCardPayment, paypalCardPaySdkUrl } from './vault.js'

type Options = { createOrder: () => Promise<string>; onApprove: (d: { orderID: string }) => Promise<void>; style?: Record<string, Record<string, string>> }
const capture = vi.fn<(a: unknown) => Promise<{ status: string; declined?: true } | null>>()
vi.mock('convex/react', () => ({ useAction: () => capture }))

let scripts: HTMLScriptElement[]
let options: Options[]
let submitImpl: ((o: Options) => Promise<void>) | null
beforeEach(() => {
  forgetScripts()
  scripts = []
  options = []
  submitImpl = null
  capture.mockReset()
  vi.spyOn(document.head, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
    if (node instanceof HTMLScriptElement) scripts.push(node)
    return node
  })
  const field = () => ({ render: () => Promise.resolve(), close: () => Promise.resolve() })
  ;(window as unknown as Record<string, unknown>)[PAYPAL_CARD_PAY_NAMESPACE] = {
    CardFields: (o: Options) => {
      options.push(o)
      return {
        isEligible: () => true,
        NameField: field,
        NumberField: field,
        ExpiryField: field,
        CVVField: field,
        submit: async () => (submitImpl ? await submitImpl(o) : await o.onApprove({ orderID: await o.createOrder() })),
      }
    },
  }
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  delete (window as unknown as Record<string, unknown>)[PAYPAL_CARD_PAY_NAMESPACE]
})

const payment = { processor: 'paypal' as const, orderId: 'ORDER1', clientId: 'client-1', returnUrl: 'https://app.example.org/thanks?token=ORDER1', only: 'card' as const }

async function loaded() {
  const el = await waitFor(() => {
    const s = scripts.find((x) => x.src === paypalCardPaySdkUrl('client-1'))
    if (!s) throw new Error('not yet')
    return s
  })
  expect(el.getAttribute('data-namespace')).toBe(PAYPAL_CARD_PAY_NAMESPACE)
  act(() => void el.dispatchEvent(new Event('load')))
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Give monthly' }).disabled).toBe(false))
}

test('pays the order with the card fields, captures it, then goes to the return page', async () => {
  capture.mockResolvedValue({ status: 'paid' })
  const navigate = vi.fn()
  render(<PaypalCardPayment payment={payment} completeReturn={'completeReturn' as unknown as CompleteReturnRef} submitLabel="Give monthly" navigate={navigate} />)
  await loaded()
  fireEvent.click(screen.getByRole('button', { name: 'Give monthly' }))
  await waitFor(() => expect(navigate).toHaveBeenCalledWith(payment.returnUrl))
  expect(capture).toHaveBeenCalledWith({ processor: 'paypal', token: 'ORDER1' })
})

test('a declined card is said under the fields and the buyer stays to try another', async () => {
  capture.mockResolvedValue({ status: 'pending', declined: true })
  const navigate = vi.fn()
  render(<PaypalCardPayment payment={payment} completeReturn={'completeReturn' as unknown as CompleteReturnRef} submitLabel="Give monthly" navigate={navigate} />)
  await loaded()
  fireEvent.click(screen.getByRole('button', { name: 'Give monthly' }))
  expect(await screen.findByText('The card was declined. Try another card.')).toBeTruthy()
  expect(navigate).not.toHaveBeenCalled()
})

test('a capture that throws (the answer lost on the way back) goes to the return page, which asks the server how it stands', async () => {
  capture.mockRejectedValue(new Error('[CONVEX A(payments:completeReturn)] [Request ID: 1] Server Error'))
  const navigate = vi.fn()
  render(<PaypalCardPayment payment={payment} completeReturn={'completeReturn' as unknown as CompleteReturnRef} submitLabel="Give monthly" navigate={navigate} />)
  await loaded()
  fireEvent.click(screen.getByRole('button', { name: 'Give monthly' }))
  await waitFor(() => expect(navigate).toHaveBeenCalledWith(payment.returnUrl))
  expect(screen.queryByRole('alert')).toBeNull()
})

test('a submit that ends with no outcome after the capture started goes to the return page too', async () => {
  capture.mockImplementation(() => new Promise(() => {}))
  const navigate = vi.fn()
  submitImpl = async (o) => {
    void o.onApprove({ orderID: await o.createOrder() })
  }
  render(<PaypalCardPayment payment={payment} completeReturn={'completeReturn' as unknown as CompleteReturnRef} submitLabel="Give monthly" navigate={navigate} />)
  await loaded()
  fireEvent.click(screen.getByRole('button', { name: 'Give monthly' }))
  await waitFor(() => expect(navigate).toHaveBeenCalledWith(payment.returnUrl))
})

test('PayPal refusing the card before any capture is said under the fields in plain words, and nothing is charged', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  submitImpl = () => Promise.reject(new Error('INVALID_NUMBER'))
  const navigate = vi.fn()
  render(<PaypalCardPayment payment={payment} completeReturn={'completeReturn' as unknown as CompleteReturnRef} submitLabel="Give monthly" navigate={navigate} />)
  await loaded()
  fireEvent.click(screen.getByRole('button', { name: 'Give monthly' }))
  expect((await screen.findByRole('alert')).textContent).toMatch(/^PayPal couldn’t check that card/)
  expect(capture).not.toHaveBeenCalled()
  expect(navigate).not.toHaveBeenCalled()
})

test('the fields sit on the page’s scheme and take the app’s style over the defaults', async () => {
  render(<PaypalCardPayment payment={payment} completeReturn={'completeReturn' as unknown as CompleteReturnRef} submitLabel="Give monthly" style={{ input: { color: '#fafafa' } }} />)
  await loaded()
  expect(options[0].style).toEqual({ input: { 'font-size': '14px', padding: '6px 8px', color: '#fafafa' }, '.invalid': { color: '#dc2626' } })
  expect(document.querySelectorAll('[style*="color-scheme"]')).toHaveLength(4)
})
