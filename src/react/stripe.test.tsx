// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { SAVED_METHOD_OPTIONS, SAVED_METHOD_TYPES } from '../core/savedMethods.js'
import { forgetScripts, STRIPE_JS } from './embedded.js'
import { retryPaymentElementsOptions, saveMethodElementsOptions, StripeRetryPayment, StripeSaveMethod, useStripeSetupReturn, type StripeAppearance } from './stripe.js'

type StripeError = { message: string }
type Made = { key: string; options: Record<string, unknown>; element: Record<string, unknown> | null; updates: unknown[]; handlers: Record<string, (e: unknown) => void>; destroyed: boolean }
type Win = Window & { Stripe?: unknown }

let made: Made[]
let scripts: HTMLScriptElement[]
/** Every call the fake Stripe and the app's callbacks got, in order. */
let calls: string[]
let fieldsError: StripeError | undefined
const confirmSetup =
  vi.fn<(o: { clientSecret: string; redirect: string; confirmParams: { return_url: string } }) => Promise<{ error?: StripeError; setupIntent?: { status: string; payment_method: string } }>>()
const confirmPayment = vi.fn<(o: { clientSecret: string; redirect: string }) => Promise<{ error?: StripeError; paymentIntent?: { status: string } }>>()
const retrieveSetupIntent = vi.fn<(secret: string) => Promise<{ setupIntent?: { status: string; payment_method: string | null } }>>()

async function finishScript(outcome: 'load' | 'error' = 'load') {
  const el = await waitFor(() => {
    const found = scripts.find((s) => s.src === STRIPE_JS)
    if (!found) throw new Error('no Stripe.js script')
    return found
  })
  act(() => {
    el.dispatchEvent(new Event(outcome))
  })
}

/** Stripe.js loaded and the Payment Element ready: the button is on. */
async function ready(name: string) {
  await finishScript()
  const button = await screen.findByRole('button', { name })
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false))
  return button
}

const press = (button: HTMLElement) =>
  act(async () => {
    fireEvent.click(button)
  })

beforeEach(() => {
  forgetScripts()
  scripts = []
  vi.spyOn(document.head, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
    if (node instanceof HTMLScriptElement) scripts.push(node)
    return node
  })
  made = []
  calls = []
  fieldsError = undefined
  confirmSetup.mockReset().mockImplementation(async (o) => {
    calls.push(`confirmSetup ${o.clientSecret}`)
    return { setupIntent: { status: 'succeeded', payment_method: 'pm_1' } }
  })
  confirmPayment.mockReset().mockImplementation(async (o) => {
    calls.push(`confirmPayment ${o.clientSecret}`)
    return { paymentIntent: { status: 'succeeded' } }
  })
  retrieveSetupIntent.mockReset()
  ;(window as Win).Stripe = (key: string) => ({
    elements: (options: Record<string, unknown>) => {
      const m: Made = { key, options, element: null, updates: [], handlers: {}, destroyed: false }
      made.push(m)
      return {
        create: (_type: string, o: Record<string, unknown>) => {
          m.element = o
          return {
            on: (event: string, handler: (e: unknown) => void) => {
              m.handlers[event] = handler
            },
            mount: () => setTimeout(() => act(() => m.handlers.ready?.({}))),
            destroy: () => {
              m.destroyed = true
            },
          }
        },
        submit: async () => {
          calls.push('submit')
          return { error: fieldsError }
        },
        update: (o: unknown) => m.updates.push(o),
      }
    },
    confirmSetup,
    confirmPayment,
    retrieveSetupIntent,
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  delete (window as Win).Stripe
  window.history.replaceState(null, '', '/')
})

const night: StripeAppearance = { theme: 'night', variables: { colorText: '#fafafa' } }

test('the form’s options are the ones the library’s intents are made with', () => {
  expect(saveMethodElementsOptions(['card', 'ach'])).toEqual({
    mode: 'setup',
    currency: 'usd',
    setupFutureUsage: 'off_session',
    allowedPaymentMethodTypes: [...SAVED_METHOD_TYPES],
    paymentMethodOptions: SAVED_METHOD_OPTIONS,
  })
  expect(saveMethodElementsOptions([])).toEqual(saveMethodElementsOptions(['card', 'ach']))
  expect(saveMethodElementsOptions(['ach'])).toMatchObject({ allowedPaymentMethodTypes: ['us_bank_account'], paymentMethodOptions: SAVED_METHOD_OPTIONS })
  expect(saveMethodElementsOptions(['card'])).toMatchObject({ allowedPaymentMethodTypes: ['card'], paymentMethodOptions: {} })
  expect(retryPaymentElementsOptions(12_000, night)).toEqual({
    mode: 'payment',
    currency: 'usd',
    amount: 12_000,
    allowedPaymentMethodTypes: [...SAVED_METHOD_TYPES],
    paymentMethodOptions: SAVED_METHOD_OPTIONS,
    appearance: night,
  })
})

test('saving: the form shows with no SetupIntent, card first, in the deferred-intent options and the app’s appearance', async () => {
  const createSetupIntent = vi.fn(() => Promise.resolve('seti_1_secret_x'))
  render(<StripeSaveMethod publishableKey="pk_test_1" methods={['card', 'ach']} createSetupIntent={createSetupIntent} onSaved={() => Promise.resolve()} submitLabel="Place bid" appearance={night} />)
  await ready('Place bid')
  expect(made).toHaveLength(1)
  expect(made[0].key).toBe('pk_test_1')
  expect(made[0].options).toEqual({ ...saveMethodElementsOptions(['card', 'ach']), appearance: night })
  expect(made[0].element).toEqual({ paymentMethodOrder: ['card', 'us_bank_account'] })
  expect(createSetupIntent).not.toHaveBeenCalled()
  expect(confirmSetup).not.toHaveBeenCalled()
})

test('saving: fields Stripe finds incomplete are said, and no SetupIntent is made', async () => {
  const createSetupIntent = vi.fn(() => Promise.resolve('seti_1_secret_x'))
  const onSaved = vi.fn(() => Promise.resolve())
  render(<StripeSaveMethod publishableKey="pk_test_1" createSetupIntent={createSetupIntent} onSaved={onSaved} submitLabel="Place bid" />)
  const button = await ready('Place bid')
  fieldsError = { message: 'Your card number is incomplete.' }
  await press(button)
  expect(screen.getByRole('alert').textContent).toBe('Your card number is incomplete.')
  expect(calls).toEqual(['submit'])
  expect(createSetupIntent).not.toHaveBeenCalled()
  expect(onSaved).not.toHaveBeenCalled()
})

test('saving: the button checks the fields, then gets the SetupIntent, has Stripe confirm it, then calls onSaved with the method', async () => {
  const createSetupIntent = vi.fn(async () => {
    calls.push('createSetupIntent')
    return 'seti_1_secret_x'
  })
  const onSaved = vi.fn(async (id: string) => void calls.push(`onSaved ${id}`))
  render(<StripeSaveMethod publishableKey="pk_test_1" createSetupIntent={createSetupIntent} onSaved={onSaved} submitLabel="Place bid" note="Only charged if you win." />)
  await press(await ready('Place bid'))
  expect(calls).toEqual(['submit', 'createSetupIntent', 'confirmSetup seti_1_secret_x', 'onSaved pm_1'])
  expect(confirmSetup.mock.calls[0][0]).toMatchObject({ redirect: 'if_required', confirmParams: { return_url: window.location.href } })
  expect(screen.getByText('Only charged if you win.')).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
})

test('saving: Stripe refusing the method is said; the payer can try again', async () => {
  const createSetupIntent = vi.fn(() => Promise.resolve('seti_1_secret_x'))
  const onSaved = vi.fn(() => Promise.resolve())
  confirmSetup.mockResolvedValueOnce({ error: { message: 'Your card was declined.' } })
  render(<StripeSaveMethod publishableKey="pk_test_1" createSetupIntent={createSetupIntent} onSaved={onSaved} submitLabel="Place bid" />)
  const button = await ready('Place bid')
  await press(button)
  expect(screen.getByRole('alert').textContent).toBe('Your card was declined.')
  expect(onSaved).not.toHaveBeenCalled()
  await press(button)
  expect(createSetupIntent).toHaveBeenCalledTimes(2)
  expect(onSaved).toHaveBeenCalledWith('pm_1')
})

test('saving: the app refusing (onSaved throws) is said; again uses the same method, until the payer changes the fields', async () => {
  const createSetupIntent = vi.fn(() => Promise.resolve('seti_1_secret_x'))
  const onSaved = vi.fn<(id: string) => Promise<void>>().mockRejectedValueOnce(new Error('Your bid must be at least $50.00')).mockResolvedValue()
  render(<StripeSaveMethod publishableKey="pk_test_1" createSetupIntent={createSetupIntent} onSaved={onSaved} submitLabel="Place bid" />)
  const button = await ready('Place bid')
  await press(button)
  expect(screen.getByRole('alert').textContent).toBe('Your bid must be at least $50.00')
  await press(button)
  expect(createSetupIntent).toHaveBeenCalledTimes(1)
  expect(onSaved).toHaveBeenNthCalledWith(2, 'pm_1')

  act(() => made[0].handlers.change?.({}))
  await press(button)
  expect(createSetupIntent).toHaveBeenCalledTimes(2)
})

test('saving: a new appearance restyles the form in place; new methods mount it again', async () => {
  const props = { publishableKey: 'pk_test_1', createSetupIntent: () => Promise.resolve('s'), onSaved: () => Promise.resolve(), submitLabel: 'Place bid' }
  const { rerender } = render(<StripeSaveMethod {...props} methods={['card', 'ach']} appearance={{ theme: 'stripe' }} />)
  await ready('Place bid')
  rerender(<StripeSaveMethod {...props} methods={['card', 'ach']} appearance={{ theme: 'stripe' }} />)
  rerender(<StripeSaveMethod {...props} methods={['card', 'ach']} appearance={night} />)
  expect(made).toHaveLength(1)
  expect(made[0].updates).toEqual([{ appearance: night }])

  rerender(<StripeSaveMethod {...props} methods={['ach']} appearance={night} />)
  await waitFor(() => expect(made).toHaveLength(2))
  expect(made[0].destroyed).toBe(true)
  expect(made[1].options).toMatchObject({ allowedPaymentMethodTypes: ['us_bank_account'], appearance: night })
})

test('saving: Stripe.js not loading says so and leaves the button off', async () => {
  render(<StripeSaveMethod publishableKey="pk_test_1" createSetupIntent={() => Promise.resolve('s')} onSaved={() => Promise.resolve()} submitLabel="Place bid" />)
  await finishScript('error')
  expect((await screen.findByRole('alert')).textContent).toMatch(/didn’t load/)
  expect(screen.getByRole('button', { name: 'Place bid' }).hasAttribute('disabled')).toBe(true)
})

test('retry: the form shows for the amount with no PaymentIntent; Pay checks the fields, gets it, confirms, and reports paid', async () => {
  const createPayment = vi.fn(async () => {
    calls.push('createPayment')
    return 'pi_1_secret_x'
  })
  const onPaid = vi.fn()
  render(<StripeRetryPayment publishableKey="pk_test_1" amountCents={12_000} createPayment={createPayment} onPaid={onPaid} submitLabel="Pay $120.00" />)
  const button = await ready('Pay $120.00')
  expect(made[0].options).toEqual(retryPaymentElementsOptions(12_000, {}))
  expect(createPayment).not.toHaveBeenCalled()

  fieldsError = { message: 'Your card number is incomplete.' }
  await press(button)
  expect(createPayment).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toBe('Your card number is incomplete.')

  fieldsError = undefined
  await press(button)
  expect(calls).toEqual(['submit', 'submit', 'createPayment', 'confirmPayment pi_1_secret_x'])
  expect(onPaid).toHaveBeenCalledWith('succeeded')
  expect(button.hasAttribute('disabled')).toBe(true)
})

test('retry: a bank payment on its way is reported as processing; a decline is said and can be tried again', async () => {
  const onPaid = vi.fn()
  confirmPayment.mockResolvedValueOnce({ error: { message: 'Your card was declined.' } }).mockResolvedValueOnce({ paymentIntent: { status: 'processing' } })
  render(<StripeRetryPayment publishableKey="pk_test_1" amountCents={500} createPayment={() => Promise.resolve('pi_1_secret_x')} onPaid={onPaid} submitLabel="Pay" />)
  const button = await ready('Pay')
  await press(button)
  expect(screen.getByRole('alert').textContent).toBe('Your card was declined.')
  await press(button)
  expect(onPaid).toHaveBeenCalledWith('processing')
})

test('retry: the form leaves a redirect’s return to the page (checkoutReturnToken), reporting nothing itself', async () => {
  window.history.replaceState(null, '', '/pay?payment_intent=pi_1&payment_intent_client_secret=pi_1_secret_x&redirect_status=succeeded')
  const onPaid = vi.fn()
  render(<StripeRetryPayment publishableKey="pk_test_1" amountCents={500} createPayment={() => Promise.resolve('pi_1_secret_x')} onPaid={onPaid} submitLabel="Pay" />)
  await ready('Pay')
  expect(onPaid).not.toHaveBeenCalled()
})

test('setup return: not back from a redirect is none, and loads nothing', () => {
  const { result } = renderHook(() => useStripeSetupReturn('pk_test_1', '?foo=1'))
  expect(result.current).toEqual({ state: 'none' })
  expect(scripts).toHaveLength(0)
})

test('setup return: the SetupIntent in the address is asked about; saved gives its method', async () => {
  retrieveSetupIntent.mockResolvedValue({ setupIntent: { status: 'succeeded', payment_method: 'pm_9' } })
  const { result } = renderHook(() => useStripeSetupReturn('pk_test_1', '?setup_intent=seti_1&setup_intent_client_secret=seti_1_secret_x&redirect_status=succeeded'))
  expect(result.current).toEqual({ state: 'checking' })
  await finishScript()
  await waitFor(() => expect(result.current).toEqual({ state: 'saved', paymentMethodId: 'pm_9' }))
  expect(retrieveSetupIntent).toHaveBeenCalledWith('seti_1_secret_x')
})

test('setup return: a SetupIntent Stripe didn’t finish, or Stripe.js not loading, is failed', async () => {
  retrieveSetupIntent.mockResolvedValue({ setupIntent: { status: 'requires_payment_method', payment_method: null } })
  const refused = renderHook(() => useStripeSetupReturn('pk_test_1', '?setup_intent_client_secret=seti_1_secret_x'))
  await finishScript()
  await waitFor(() => expect(refused.result.current).toMatchObject({ state: 'failed', error: expect.stringMatching(/wasn’t saved/) }))

  cleanup()
  forgetScripts()
  scripts.length = 0
  const unloaded = renderHook(() => useStripeSetupReturn('pk_test_1', '?setup_intent_client_secret=seti_2_secret_x'))
  await finishScript('error')
  await waitFor(() => expect(unloaded.result.current).toMatchObject({ state: 'failed', error: expect.stringMatching(/couldn’t say/) }))
})
