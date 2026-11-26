// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { forgetScripts } from './embedded.js'
import type { CompleteReturnRef } from './types.js'
import { PAYPAL_CARD_PAY_NAMESPACE, PaypalCardPayment, paypalCardPaySdkUrl, PaypalOnPagePayment } from './vault.js'
import type { OnPagePayment } from '../client/index.js'

type Options = { createOrder: () => Promise<string>; onApprove: (d: { orderID: string }) => Promise<void>; style?: Record<string, Record<string, string>> }
const capture = vi.fn<(a: unknown) => Promise<{ status: string; declined?: true; reordered?: true } | null>>()
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

async function loaded(label = 'Give monthly') {
  const el = await waitFor(() => {
    const s = scripts.find((x) => x.src === paypalCardPaySdkUrl('client-1'))
    if (!s) throw new Error('not yet')
    return s
  })
  expect(el.getAttribute('data-namespace')).toBe(PAYPAL_CARD_PAY_NAMESPACE)
  act(() => void el.dispatchEvent(new Event('load')))
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: label }).disabled).toBe(false))
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

const paypalOnPage = (orderId: string): OnPagePayment => ({ processor: 'paypal', orderId, clientId: 'client-1', returnUrl: `https://app.example.org/donate/thanks?token=${orderId}`, only: 'card' })
const completeReturn = 'completeReturn' as unknown as CompleteReturnRef

test('on-page: the card fields show with nothing started; the press starts the order, captures it and goes to its return page', async () => {
  capture.mockResolvedValue({ status: 'paid' })
  const start = vi.fn(() => Promise.resolve(paypalOnPage('ORDER1')))
  const navigate = vi.fn()
  render(<PaypalOnPagePayment clientId="client-1" start={start} completeReturn={completeReturn} submitLabel="Give $25" navigate={navigate} />)
  await loaded('Give $25')
  expect(start).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Give $25' }))
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('https://app.example.org/donate/thanks?token=ORDER1'))
  expect(start).toHaveBeenCalledTimes(1)
  expect(capture).toHaveBeenCalledWith({ processor: 'paypal', token: 'ORDER1' })
})

test('on-page: a decline is said; the next press starts again and pays the order that start returns', async () => {
  capture.mockResolvedValueOnce({ status: 'pending', declined: true }).mockResolvedValueOnce({ status: 'paid' })
  const start = vi.fn().mockResolvedValueOnce(paypalOnPage('ORDER1')).mockResolvedValueOnce(paypalOnPage('ORDER2'))
  const navigate = vi.fn()
  render(<PaypalOnPagePayment clientId="client-1" start={start} completeReturn={completeReturn} submitLabel="Give $25" navigate={navigate} />)
  await loaded('Give $25')
  fireEvent.click(screen.getByRole('button', { name: 'Give $25' }))
  expect(await screen.findByText('The card was declined. Try another card.')).toBeTruthy()
  expect(navigate).not.toHaveBeenCalled()
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Give $25' }).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Give $25' }))
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('https://app.example.org/donate/thanks?token=ORDER2'))
  expect(start).toHaveBeenCalledTimes(2)
  expect(capture).toHaveBeenLastCalledWith({ processor: 'paypal', token: 'ORDER2' })
  expect(screen.queryByRole('alert')).toBeNull()
})

test('on-page: an order PayPal won’t take again (re-ordered under the same checkout) is a decline; the next press pays the new order start returns', async () => {
  capture.mockResolvedValueOnce({ status: 'pending', declined: true, reordered: true }).mockResolvedValueOnce({ status: 'paid' })
  const start = vi.fn().mockResolvedValueOnce(paypalOnPage('ORDER1')).mockResolvedValueOnce(paypalOnPage('ORDER1B'))
  const navigate = vi.fn()
  render(<PaypalOnPagePayment clientId="client-1" start={start} completeReturn={completeReturn} submitLabel="Give $25" navigate={navigate} />)
  await loaded('Give $25')
  fireEvent.click(screen.getByRole('button', { name: 'Give $25' }))
  expect(await screen.findByText('The card was declined. Try another card.')).toBeTruthy()
  expect(navigate).not.toHaveBeenCalled()
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Give $25' }).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Give $25' }))
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('https://app.example.org/donate/thanks?token=ORDER1B'))
  expect(capture.mock.calls).toEqual([[{ processor: 'paypal', token: 'ORDER1' }], [{ processor: 'paypal', token: 'ORDER1B' }]])
})

test('on-page: a card PayPal declined at the capture (the checkout failed) is said under the fields; the next press starts again', async () => {
  capture.mockResolvedValueOnce({ status: 'failed' }).mockResolvedValueOnce({ status: 'paid' })
  const start = vi.fn().mockResolvedValueOnce(paypalOnPage('ORDER1')).mockResolvedValueOnce(paypalOnPage('ORDER2'))
  const navigate = vi.fn()
  render(<PaypalOnPagePayment clientId="client-1" start={start} completeReturn={completeReturn} submitLabel="Give $25" navigate={navigate} />)
  await loaded('Give $25')
  fireEvent.click(screen.getByRole('button', { name: 'Give $25' }))
  expect(await screen.findByText('The card was declined. Try another card.')).toBeTruthy()
  expect(navigate).not.toHaveBeenCalled()
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Give $25' }).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Give $25' }))
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('https://app.example.org/donate/thanks?token=ORDER2'))
})

test('on-page: the app refusing to start is said in its words, and nothing is captured', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const start = vi.fn(() => Promise.reject(new Error('Give at least $5.')))
  render(<PaypalOnPagePayment clientId="client-1" start={start} completeReturn={completeReturn} submitLabel="Give $25" navigate={vi.fn()} />)
  await loaded('Give $25')
  fireEvent.click(screen.getByRole('button', { name: 'Give $25' }))
  expect((await screen.findByRole('alert')).textContent).toBe('Give at least $5.')
  expect(capture).not.toHaveBeenCalled()
})

test('on-page: a new style draws the fields again in it', async () => {
  const props = { clientId: 'client-1', start: () => Promise.resolve(paypalOnPage('ORDER1')), completeReturn, submitLabel: 'Give $25' }
  const { rerender } = render(<PaypalOnPagePayment {...props} style={{ input: { color: '#111111' } }} />)
  await loaded('Give $25')
  rerender(<PaypalOnPagePayment {...props} style={{ input: { color: '#111111' } }} />)
  expect(options).toHaveLength(1)
  rerender(<PaypalOnPagePayment {...props} style={{ input: { color: '#fafafa' } }} />)
  await waitFor(() => expect(options).toHaveLength(2))
  expect(options[1].style?.input).toMatchObject({ color: '#fafafa' })
})

test('on-page: once paid the button stays off, so a second press can’t start and pay again', async () => {
  capture.mockResolvedValue({ status: 'paid' })
  const start = vi.fn(() => Promise.resolve(paypalOnPage('ORDER1')))
  const navigate = vi.fn()
  render(<PaypalOnPagePayment clientId="client-1" start={start} completeReturn={completeReturn} submitLabel="Give $25" navigate={navigate} />)
  await loaded('Give $25')
  const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Give $25' })
  fireEvent.click(button)
  await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1))
  expect(button.disabled).toBe(true)
  fireEvent.click(button)
  await act(() => new Promise((r) => setTimeout(r, 10)))
  expect(start).toHaveBeenCalledTimes(1)
})

test('on-page: the app refusing to start is said even when PayPal reports it to onError and submit resolves', async () => {
  submitImpl = async (o) => {
    await o.createOrder().catch(() => {})
  }
  render(<PaypalOnPagePayment clientId="client-1" start={() => Promise.reject(new Error('Give at least $5.'))} completeReturn={completeReturn} submitLabel="Give $25" navigate={vi.fn()} />)
  await loaded('Give $25')
  fireEvent.click(screen.getByRole('button', { name: 'Give $25' }))
  expect((await screen.findByRole('alert')).textContent).toBe('Give at least $5.')
})

test('on-page: an order for another PayPal app (sandbox against live) is refused before PayPal sees it', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  render(
    <PaypalOnPagePayment
      clientId="client-1"
      start={() => Promise.resolve({ ...paypalOnPage('ORDER1'), clientId: 'client-live' })}
      completeReturn={completeReturn}
      submitLabel="Give $25"
      navigate={vi.fn()}
    />,
  )
  await loaded('Give $25')
  fireEvent.click(screen.getByRole('button', { name: 'Give $25' }))
  expect((await screen.findByRole('alert')).textContent).toMatch(/can’t be paid here/)
  expect(capture).not.toHaveBeenCalled()
})
