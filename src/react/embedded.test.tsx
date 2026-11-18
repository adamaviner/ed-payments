// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { forgetScripts, paypalSdkUrl, PaypalButtons, STRIPE_JS, StripeEmbeddedCheckout } from './embedded.js'
import type { CompleteReturnRef } from './types.js'

type Answer = { status: string; purpose: string; ref: { type: string; id: string }; declined?: true } | null
const completeReturn = vi.fn<(a: { processor: string; token: string }) => Promise<Answer>>()
vi.mock('convex/react', () => ({ useAction: () => completeReturn }))
const ref = 'payments:completeReturn' as unknown as CompleteReturnRef
const paid: Answer = { status: 'paid', purpose: 'order', ref: { type: 'offering', id: 'o1' } }

type Approve = (data: { orderID: string }, actions: { restart?: () => Promise<void> }) => Promise<void>
type ButtonsOptions = { createOrder: () => Promise<string>; onApprove: Approve; onError: (err: unknown) => void; style: Record<string, string | number> }
type Win = Window & { paypal?: unknown; Stripe?: unknown }

let buttons: ButtonsOptions[]
let closed: number
let stripeMounts: { key: string; secret: string; destroyed: boolean }[]
/** The script tags the components added, kept out of the document so happy-dom doesn't try to load them. */
let scripts: HTMLScriptElement[]

/** The script tag the component added for `src`, told it loaded (or failed). */
function finishScript(src: string, outcome: 'load' | 'error' = 'load') {
  const el = scripts.find((s) => s.src === src)
  if (!el) throw new Error(`no script ${src} (have ${scripts.map((x) => x.src).join(', ')})`)
  act(() => {
    el.dispatchEvent(new Event(outcome))
  })
}

beforeEach(() => {
  forgetScripts()
  scripts = []
  vi.spyOn(document.head, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
    if (node instanceof HTMLScriptElement) scripts.push(node)
    return node
  })
  buttons = []
  closed = 0
  stripeMounts = []
  const w = window as Win
  w.paypal = {
    Buttons: (o: ButtonsOptions) => {
      buttons.push(o)
      return { render: () => Promise.resolve(), close: () => Promise.resolve(void closed++) }
    },
  }
  w.Stripe = (key: string) => ({
    createEmbeddedCheckoutPage: async (o: { fetchClientSecret: () => Promise<string> }) => {
      const m = { key, secret: await o.fetchClientSecret(), destroyed: false }
      return {
        mount: () => stripeMounts.push(m),
        destroy: () => {
          m.destroyed = true
        },
      }
    },
  })
})
afterEach(() => {
  cleanup()
  completeReturn.mockReset()
  vi.restoreAllMocks()
  const w = window as Win
  delete w.paypal
  delete w.Stripe
  vi.useRealTimers()
})

const paypalPayment = { processor: 'paypal' as const, orderId: 'ORDER1', clientId: 'client-1', returnUrl: 'https://app.example.org/back?token=ORDER1' }

test('PayPal: loads the SDK for the app’s client id with card and PayPal only, pays the started order, and goes to the return page once captured', async () => {
  const navigate = vi.fn()
  completeReturn.mockResolvedValue(paid)
  render(<PaypalButtons payment={paypalPayment} completeReturn={ref} navigate={navigate} />)
  expect(paypalSdkUrl('client-1')).toBe('https://www.paypal.com/sdk/js?client-id=client-1&currency=USD&intent=capture&components=buttons&disable-funding=venmo,paylater')
  finishScript(paypalSdkUrl('client-1'))
  await waitFor(() => expect(buttons).toHaveLength(1))
  expect(await buttons[0].createOrder()).toBe('ORDER1')
  await act(() => buttons[0].onApprove({ orderID: 'ORDER1' }, {}))
  expect(completeReturn).toHaveBeenCalledWith({ processor: 'paypal', token: 'ORDER1' })
  expect(navigate).toHaveBeenCalledWith('https://app.example.org/back?token=ORDER1')
})

test('PayPal: a declined card is said and the buttons restarted, without leaving the page', async () => {
  const navigate = vi.fn()
  const restart = vi.fn(() => Promise.resolve())
  completeReturn.mockResolvedValue({ status: 'pending', purpose: 'order', ref: { type: 'offering', id: 'o1' }, declined: true })
  render(<PaypalButtons payment={paypalPayment} completeReturn={ref} navigate={navigate} />)
  finishScript(paypalSdkUrl('client-1'))
  await waitFor(() => expect(buttons).toHaveLength(1))
  await act(() => buttons[0].onApprove({ orderID: 'ORDER1' }, { restart }))
  expect(restart).toHaveBeenCalled()
  expect(navigate).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toMatch(/couldn’t take that payment/)
})

test('PayPal: if capturing fails, the buyer still goes to the return page, which asks again', async () => {
  const navigate = vi.fn()
  completeReturn.mockRejectedValue(new Error('network'))
  render(<PaypalButtons payment={paypalPayment} completeReturn={ref} navigate={navigate} />)
  finishScript(paypalSdkUrl('client-1'))
  await waitFor(() => expect(buttons).toHaveLength(1))
  await act(() => buttons[0].onApprove({ orderID: 'ORDER1' }, {}))
  expect(navigate).toHaveBeenCalledWith(paypalPayment.returnUrl)
})

test('PayPal: a script that doesn’t load offers the redirect', async () => {
  const onFallback = vi.fn()
  render(<PaypalButtons payment={{ ...paypalPayment, clientId: 'client-blocked' }} completeReturn={ref} onFallback={onFallback} />)
  finishScript(paypalSdkUrl('client-blocked'), 'error')
  fireEvent.click(await screen.findByRole('button', { name: 'Pay on PayPal’s site instead' }))
  expect(onFallback).toHaveBeenCalled()
})

test('PayPal: a slow script offers the redirect after a few seconds; the buttons are closed on unmount', async () => {
  vi.useFakeTimers()
  const { unmount } = render(<PaypalButtons payment={{ ...paypalPayment, clientId: 'client-slow' }} completeReturn={ref} onFallback={() => {}} />)
  expect(screen.queryByRole('button', { name: /instead/ })).toBeNull()
  act(() => {
    vi.advanceTimersByTime(8000)
  })
  expect(screen.getByRole('button', { name: 'Pay on PayPal’s site instead' })).toBeTruthy()
  vi.useRealTimers()
  finishScript(paypalSdkUrl('client-slow'))
  await waitFor(() => expect(buttons).toHaveLength(1))
  unmount()
  expect(closed).toBe(1)
})

test('Stripe: Stripe.js for the library’s API version mounts one embedded Checkout with the session’s secret, even under StrictMode', async () => {
  render(
    <StrictMode>
      <StripeEmbeddedCheckout payment={{ processor: 'stripe', clientSecret: 'cs_test_1_secret' }} publishableKey="pk_test_1" />
    </StrictMode>,
  )
  finishScript(STRIPE_JS)
  await waitFor(() => expect(stripeMounts.filter((m) => !m.destroyed)).toHaveLength(1))
  expect(stripeMounts.find((m) => !m.destroyed)).toMatchObject({ key: 'pk_test_1', secret: 'cs_test_1_secret' })
  expect(STRIPE_JS).toBe('https://js.stripe.com/endive/stripe.js')
})

test('Stripe: keys from different modes are said, not shown as a blank box; a failed Stripe.js offers the redirect', async () => {
  const { unmount } = render(<StripeEmbeddedCheckout payment={{ processor: 'stripe', clientSecret: 'cs_live_1_secret' }} publishableKey="pk_test_1" />)
  expect(screen.getByRole('alert').textContent).toMatch(/different modes/)
  unmount()
  const onFallback = vi.fn()
  render(<StripeEmbeddedCheckout payment={{ processor: 'stripe', clientSecret: 'cs_test_2_secret' }} publishableKey="pk_test_1" onFallback={onFallback} />)
  finishScript(STRIPE_JS, 'error')
  fireEvent.click(await screen.findByRole('button', { name: 'Pay on Stripe’s site instead' }))
  expect(onFallback).toHaveBeenCalled()
})
