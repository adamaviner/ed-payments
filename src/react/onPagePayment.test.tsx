// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { OnPagePayment as OnPage, StartedOnPage } from '../client/index.js'
import { forgetScripts, paypalSdkUrl, STRIPE_JS } from './embedded.js'
import { OnPagePayment, type OnPagePaymentTab, type OnPageStartArgs, type RetryStarted } from './onPagePayment.js'
import type { CompleteReturnRef } from './types.js'
import { PAYPAL_CARD_PAY_NAMESPACE, paypalCardPaySdkUrl } from './vault.js'

const capture = vi.fn<(a: unknown) => Promise<{ status: string; declined?: true; reordered?: true } | null>>()
vi.mock('convex/react', () => ({ useAction: () => capture }))

type StripeError = { message: string }
type Made = { options: Record<string, unknown>; updates: unknown[]; handlers: Record<string, (e: unknown) => void>; destroyed: boolean }
type ButtonOptions = {
  fundingSource?: string
  createOrder: () => Promise<string>
  onApprove: (d: { orderID: string }, actions: { restart?: () => Promise<void> }) => Promise<void>
  onCancel: () => void
  onError: (err: unknown) => void
}
type CardOptions = { createOrder: () => Promise<string>; onApprove: (d: { orderID: string }) => Promise<void> }

let scripts: HTMLScriptElement[]
let made: Made[]
let buttons: ButtonOptions[]
let cardFields: CardOptions[]
let calls: string[]
const confirmPayment = vi.fn<(o: { clientSecret: string }) => Promise<{ error?: StripeError; paymentIntent?: { id?: string; status: string } }>>()
const completeReturn = 'completeReturn' as unknown as CompleteReturnRef
const win = () => window as unknown as Record<string, unknown>

beforeEach(() => {
  forgetScripts()
  scripts = []
  made = []
  buttons = []
  cardFields = []
  calls = []
  capture.mockReset()
  vi.spyOn(document.head, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
    if (node instanceof HTMLScriptElement) scripts.push(node)
    return node
  })
  confirmPayment.mockReset().mockImplementation(async (o) => {
    calls.push(`confirmPayment ${o.clientSecret}`)
    return { paymentIntent: { id: 'pi_1', status: 'succeeded' } }
  })
  win().Stripe = () => ({
    elements: (options: Record<string, unknown>) => {
      const m: Made = { options, updates: [], handlers: {}, destroyed: false }
      made.push(m)
      return {
        create: () => ({
          on: (event: string, handler: (e: unknown) => void) => {
            m.handlers[event] = handler
          },
          mount: () => setTimeout(() => act(() => m.handlers.ready?.({}))),
          destroy: () => {
            m.destroyed = true
          },
        }),
        submit: async () => {
          calls.push('submit')
          return {}
        },
        update: (o: unknown) => void m.updates.push(o),
      }
    },
    confirmPayment,
  })
  win().paypal = {
    FUNDING: { PAYPAL: 'paypal' },
    Buttons: (o: ButtonOptions) => {
      buttons.push(o)
      return { render: () => Promise.resolve(), close: () => Promise.resolve() }
    },
  }
  const field = () => ({ render: () => Promise.resolve(), close: () => Promise.resolve() })
  win()[PAYPAL_CARD_PAY_NAMESPACE] = {
    CardFields: (o: CardOptions) => {
      cardFields.push(o)
      return { isEligible: () => true, NameField: field, NumberField: field, ExpiryField: field, CVVField: field, submit: async () => await o.onApprove({ orderID: await o.createOrder() }) }
    },
  }
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  delete win().Stripe
  delete win().paypal
  delete win()[PAYPAL_CARD_PAY_NAMESPACE]
})

async function finish(src: string, outcome: 'load' | 'error' = 'load') {
  const el = await waitFor(() => {
    const found = scripts.find((s) => s.src === src)
    if (!found) throw new Error(`no script ${src}`)
    return found
  })
  act(() => void el.dispatchEvent(new Event(outcome)))
}

async function enabled(name: string) {
  const button = await screen.findByRole('button', { name })
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false))
  return button
}

const press = (button: HTMLElement) =>
  act(async () => {
    fireEvent.click(button)
  })

const TABS: OnPagePaymentTab[] = [
  { method: 'card', label: 'Card', submitLabel: 'Give $25' },
  { method: 'ach', label: 'Bank', submitLabel: 'Give $25 by bank', hint: 'Save $0.53 with bank' },
  { method: 'paypal', label: 'PayPal', submitLabel: 'Give $25 with PayPal' },
]
/** PayPal's card rate cheaper than Stripe's above about $21 (1.99% + 49¢ against 2.9% + 30¢). */
const FEES = { paypal: { card: { basisPoints: 199, fixedCents: 49, capCents: null } } }
const stripeStarted = (n: number): StartedOnPage => ({
  checkoutId: `co_${n}`,
  reused: false,
  onPage: { processor: 'stripe', clientSecret: `pi_${n}_secret_x`, returnUrl: 'https://app.example.org/thanks' },
})
const paypalOnPage = (orderId: string): OnPage => ({ processor: 'paypal', orderId, clientId: 'client-1', returnUrl: `https://app.example.org/thanks?token=${orderId}` })
const paypalStarted = (n: number): StartedOnPage => ({ checkoutId: `co_${n}`, reused: false, onPage: paypalOnPage(`ORDER${n}`) })

const props = (start: (a: OnPageStartArgs) => Promise<StartedOnPage>) => ({
  stripePublishableKey: 'pk_test_1',
  paypalClientId: 'client-1',
  completeReturn,
  fees: FEES,
  start,
})

test('picker: only the tabs the app allows show, in its words, and only for processors it has keys for', () => {
  const start = vi.fn<(a: OnPageStartArgs) => Promise<StartedOnPage>>()
  const { rerender } = render(<OnPagePayment {...props(start)} amountCents={2_500} tabs={[TABS[0], TABS[2]]} />)
  expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Card', 'PayPal'])
  rerender(<OnPagePayment {...props(start)} paypalClientId={undefined} amountCents={2_500} tabs={TABS} />)
  expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Card', 'BankSave $0.53 with bank'])
  expect(screen.getByRole('tab', { name: /Card/ }).getAttribute('aria-selected')).toBe('true')
})

test('picker: the card fields are the quoted processor’s, swapped at the price line, which clears a half-typed card', async () => {
  const start = vi.fn<(a: OnPageStartArgs) => Promise<StartedOnPage>>()
  const { rerender } = render(<OnPagePayment {...props(start)} amountCents={1_000} tabs={TABS} />)
  await finish(STRIPE_JS)
  await enabled('Give $25')
  expect(made).toHaveLength(1)
  expect(made[0].options).toMatchObject({ amount: 1_000, allowedPaymentMethodTypes: ['card'] })
  rerender(<OnPagePayment {...props(start)} amountCents={5_000} tabs={TABS} />)
  await finish(paypalCardPaySdkUrl('client-1'))
  await waitFor(() => expect(cardFields).toHaveLength(1))
  expect(made[0].destroyed).toBe(true)
  rerender(<OnPagePayment {...props(start)} amountCents={1_200} tabs={TABS} />)
  await waitFor(() => expect(made).toHaveLength(2))
  expect(made[1].options).toMatchObject({ amount: 1_200 })
  rerender(<OnPagePayment {...props(start)} amountCents={1_200} coverFee tabs={TABS} />)
  expect(made[1].updates).toContainEqual({ amount: 1_267 })
  expect(start).not.toHaveBeenCalled()
})

test('picker: an amount being retyped (none for a moment) keeps the card fields shown, so a half-typed card stays', async () => {
  const start = vi.fn<(a: OnPageStartArgs) => Promise<StartedOnPage>>()
  const { rerender } = render(<OnPagePayment {...props(start)} amountCents={5_000} tabs={TABS} />)
  await finish(paypalCardPaySdkUrl('client-1'))
  await waitFor(() => expect(cardFields).toHaveLength(1))
  rerender(<OnPagePayment {...props(start)} amountCents={0} tabs={TABS} />)
  rerender(<OnPagePayment {...props(start)} amountCents={5_500} tabs={TABS} />)
  await act(async () => {})
  expect(cardFields).toHaveLength(1)
  expect(scripts.some((s) => s.src === STRIPE_JS)).toBe(false)
})

test('picker: the bank tab keeps Stripe’s form, changed in place to a bank account at the bank’s total', async () => {
  const start = vi.fn<(a: OnPageStartArgs) => Promise<StartedOnPage>>()
  render(<OnPagePayment {...props(start)} amountCents={1_000} coverFee tabs={TABS} />)
  await finish(STRIPE_JS)
  await enabled('Give $25')
  fireEvent.click(screen.getByRole('tab', { name: /Bank/ }))
  await enabled('Give $25 by bank')
  expect(made).toHaveLength(1)
  expect(made[0].updates).toContainEqual(expect.objectContaining({ allowedPaymentMethodTypes: ['us_bank_account'] }))
  expect(made[0].updates).toContainEqual({ amount: 1_009 })
})

test('picker: nothing is started before a press, the PayPal button included; its press starts the PayPal payment', async () => {
  const start = vi.fn((a: OnPageStartArgs) => {
    calls.push(`start ${a.method} ${a.processor} ${a.replaces ?? '-'}`)
    return Promise.resolve(paypalStarted(1))
  })
  const onMethodChange = vi.fn()
  render(<OnPagePayment {...props(start)} amountCents={2_500} tabs={TABS} saveForLater onMethodChange={onMethodChange} />)
  fireEvent.click(screen.getByRole('tab', { name: 'PayPal' }))
  expect(onMethodChange).toHaveBeenCalledWith('paypal')
  await finish(paypalSdkUrl('client-1'))
  await waitFor(() => expect(buttons).toHaveLength(1))
  expect(buttons[0].fundingSource).toBe('paypal')
  expect(start).not.toHaveBeenCalled()
  await act(async () => expect(await buttons[0].createOrder()).toBe('ORDER1'))
  expect(calls).toEqual(['start paypal paypal -'])
})

test('picker: a decline is said, and the next press passes the checkout the last one started as replaces', async () => {
  let n = 0
  const start = vi.fn((a: OnPageStartArgs) => {
    calls.push(`start ${a.method} ${a.processor} ${a.replaces ?? '-'}`)
    return Promise.resolve(stripeStarted(++n))
  })
  confirmPayment.mockImplementationOnce(async (o) => {
    calls.push(`confirmPayment ${o.clientSecret}`)
    return { error: { message: 'Your card was declined.' } }
  })
  const navigate = vi.fn()
  render(<OnPagePayment {...props(start)} amountCents={1_000} tabs={TABS} navigate={navigate} />)
  await finish(STRIPE_JS)
  const button = await enabled('Give $25')
  await press(button)
  expect(screen.getByRole('alert').textContent).toBe('Your card was declined.')
  await press(button)
  expect(calls).toEqual(['submit', 'start card stripe -', 'confirmPayment pi_1_secret_x', 'submit', 'start card stripe co_1', 'confirmPayment pi_2_secret_x'])
  expect(navigate).toHaveBeenCalledWith('https://app.example.org/thanks?payment_intent=pi_1')
})

test('picker: a PayPal decline (declined and reordered) is said; the next press starts again with replaces', async () => {
  let n = 0
  const start = vi.fn((a: OnPageStartArgs) => {
    calls.push(`start ${a.method} ${a.processor} ${a.replaces ?? '-'}`)
    return Promise.resolve(paypalStarted(++n))
  })
  capture.mockResolvedValueOnce({ status: 'pending', declined: true, reordered: true }).mockResolvedValueOnce({ status: 'paid' })
  const navigate = vi.fn()
  render(<OnPagePayment {...props(start)} amountCents={2_500} tabs={TABS} method="paypal" navigate={navigate} />)
  await finish(paypalSdkUrl('client-1'))
  await waitFor(() => expect(buttons).toHaveLength(1))
  await act(async () => buttons[0].onApprove({ orderID: await buttons[0].createOrder() }, {}))
  expect(screen.getByRole('alert').textContent).toBe('PayPal couldn’t take that payment. Try again, or choose another way to pay.')
  expect(navigate).not.toHaveBeenCalled()
  await act(async () => buttons[0].onApprove({ orderID: await buttons[0].createOrder() }, {}))
  expect(calls).toEqual(['start paypal paypal -', 'start paypal paypal co_1'])
  expect(capture).toHaveBeenLastCalledWith({ processor: 'paypal', token: 'ORDER2' })
  expect(navigate).toHaveBeenCalledWith('https://app.example.org/thanks?token=ORDER2')
  expect(screen.queryByRole('alert')).toBeNull()
})

test('picker: the app refusing to start the PayPal payment is said in its words', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const start = vi.fn(() => Promise.reject(new Error('Too many tries. Wait a minute.')))
  render(<OnPagePayment {...props(start)} amountCents={2_500} tabs={TABS} method="paypal" />)
  await finish(paypalSdkUrl('client-1'))
  await waitFor(() => expect(buttons).toHaveLength(1))
  await act(async () => {
    await buttons[0].createOrder().catch((err: unknown) => buttons[0].onError(err))
  })
  expect(screen.getByRole('alert').textContent).toBe('Too many tries. Wait a minute.')
})

test('picker: a script that won’t load offers the processor’s page; its press starts a redirect and goes there', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const start = vi.fn<(a: OnPageStartArgs) => Promise<StartedOnPage>>()
  const startRedirect = vi.fn((a: OnPageStartArgs) => {
    calls.push(`redirect ${a.method} ${a.processor} ${a.replaces ?? '-'}`)
    return Promise.resolve({ checkoutId: 'co_9', redirectUrl: 'https://checkout.stripe.com/c/pay/cs_1' })
  })
  const leave = vi.fn()
  render(<OnPagePayment {...props(start)} amountCents={1_000} tabs={TABS} startRedirect={startRedirect} leave={leave} />)
  await finish(STRIPE_JS, 'error')
  const fallback = await screen.findByRole('button', { name: 'Pay on Stripe’s site instead' })
  expect(startRedirect).not.toHaveBeenCalled()
  await press(fallback)
  expect(calls).toEqual(['redirect card stripe -'])
  expect(leave).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_1')
  expect(start).not.toHaveBeenCalled()
})

test('picker: retry mode pays the checkout’s amount with Stripe’s form or PayPal’s button, each started at its press', async () => {
  const retryStart = vi.fn(async (a: { method: string }): Promise<RetryStarted> => {
    calls.push(`retry ${a.method}`)
    return a.method === 'paypal'
      ? { checkoutId: 'co_3', embedded: { processor: 'paypal', orderId: 'ORDER3', clientId: 'client-1', returnUrl: 'https://app.example.org/thanks?token=ORDER3' } }
      : { checkoutId: 'co_2', clientSecret: 'pi_2_secret_x' }
  })
  const onPaid = vi.fn()
  const navigate = vi.fn()
  capture.mockResolvedValue({ status: 'paid' })
  render(
    <OnPagePayment
      stripePublishableKey="pk_test_1"
      paypalClientId="client-1"
      completeReturn={completeReturn}
      navigate={navigate}
      tabs={[
        { method: 'card', label: 'Card or bank', submitLabel: 'Pay $120' },
        { method: 'ach', label: 'Bank', submitLabel: 'Pay $120 by bank' },
        { method: 'paypal', label: 'PayPal', submitLabel: 'Pay $120' },
      ]}
      retry={{ amountCents: 12_000, start: retryStart, onPaid }}
    />,
  )
  expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Card or bank', 'PayPal'])
  await finish(STRIPE_JS)
  const button = await enabled('Pay $120')
  expect(made[0].options).toMatchObject({ amount: 12_000, allowedPaymentMethodTypes: ['card', 'us_bank_account'] })
  expect(retryStart).not.toHaveBeenCalled()
  await press(button)
  expect(onPaid).toHaveBeenCalledWith('succeeded')
  cleanup()
  onPaid.mockReset()
  render(
    <OnPagePayment
      paypalClientId="client-1"
      completeReturn={completeReturn}
      navigate={navigate}
      method="paypal"
      tabs={[{ method: 'paypal', label: 'PayPal', submitLabel: 'Pay $120' }]}
      retry={{ amountCents: 12_000, start: retryStart, onPaid }}
    />,
  )
  await finish(paypalSdkUrl('client-1'))
  await waitFor(() => expect(buttons).toHaveLength(1))
  await act(async () => buttons[0].onApprove({ orderID: await buttons[0].createOrder() }, {}))
  expect(calls).toEqual(['submit', 'retry card', 'confirmPayment pi_2_secret_x', 'retry paypal'])
  expect(navigate).toHaveBeenCalledWith('https://app.example.org/thanks?token=ORDER3')
})
