// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { SAVED_METHOD_OPTIONS, SAVED_METHOD_TYPES } from '../core/savedMethods.js'
import { forgetScripts, STRIPE_JS } from './embedded.js'
import {
  onPagePaymentElementsOptions,
  retryPaymentElementsOptions,
  saveMethodElementsOptions,
  StripeOnPagePayment,
  StripeRetryPayment,
  StripeSaveMethod,
  useStripeSetupReturn,
  type StripeAppearance,
} from './stripe.js'
import type { OnPagePayment } from '../client/index.js'

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
const confirmPayment =
  vi.fn<(o: { clientSecret: string; redirect: string; confirmParams: Record<string, unknown> }) => Promise<{ error?: StripeError; paymentIntent?: { id?: string; status: string } }>>()
const retrieveSetupIntent = vi.fn<(secret: string) => Promise<{ error?: StripeError; setupIntent?: { status: string; payment_method: string | null } }>>()

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

const stripeOnPage = (n: number): OnPagePayment => ({ processor: 'stripe', clientSecret: `pi_${n}_secret_x`, returnUrl: 'https://app.example.org/donate/thanks' })

test('on-page: the form shows for the amount with nothing started, the payer’s name and email not asked for again', async () => {
  const start = vi.fn(() => Promise.resolve(stripeOnPage(1)))
  render(<StripeOnPagePayment publishableKey="pk_test_1" amountCents={2_500} payer={{ name: 'Ada Lovelace', email: 'ada@example.org' }} start={start} submitLabel="Give $25" appearance={night} />)
  await ready('Give $25')
  expect(made).toHaveLength(1)
  expect(made[0].options).toEqual(onPagePaymentElementsOptions(2_500, false, night))
  expect(made[0].options).not.toHaveProperty('setupFutureUsage')
  expect(made[0].element).toEqual({ paymentMethodOrder: ['card', 'us_bank_account'], fields: { billingDetails: { name: 'never', email: 'never' } } })
  expect(start).not.toHaveBeenCalled()
  expect(confirmPayment).not.toHaveBeenCalled()
})

test('on-page: a schedule’s first payment saves the method; a new amount is shown in place, keeping what the payer typed', async () => {
  const props = { publishableKey: 'pk_test_1', start: () => Promise.resolve(stripeOnPage(1)), submitLabel: 'Give monthly' }
  const { rerender } = render(<StripeOnPagePayment {...props} amountCents={2_500} saveForLater />)
  await ready('Give monthly')
  expect(made[0].options).toEqual(onPagePaymentElementsOptions(2_500, true, {}))
  expect(made[0].options).toMatchObject({ mode: 'payment', amount: 2_500, setupFutureUsage: 'off_session', allowedPaymentMethodTypes: [...SAVED_METHOD_TYPES] })
  rerender(<StripeOnPagePayment {...props} amountCents={5_000} saveForLater />)
  expect(made).toHaveLength(1)
  expect(made[0].updates).toEqual([{ amount: 5_000 }])
})

test('on-page: the press checks the fields first; incomplete fields start nothing', async () => {
  const start = vi.fn(() => Promise.resolve(stripeOnPage(1)))
  render(<StripeOnPagePayment publishableKey="pk_test_1" amountCents={2_500} start={start} submitLabel="Give $25" />)
  const button = await ready('Give $25')
  fieldsError = { message: 'Your card number is incomplete.' }
  await press(button)
  expect(screen.getByRole('alert').textContent).toBe('Your card number is incomplete.')
  expect(calls).toEqual(['submit'])
  expect(start).not.toHaveBeenCalled()
})

test('on-page: a decline is said; the next press starts again and pays, then goes to the return page with the PaymentIntent', async () => {
  let n = 0
  const start = vi.fn(async () => {
    calls.push('start')
    return stripeOnPage(++n)
  })
  const navigate = vi.fn()
  confirmPayment.mockImplementationOnce(async (o) => {
    calls.push(`confirmPayment ${o.clientSecret}`)
    return { error: { message: 'Your card was declined.' } }
  })
  confirmPayment.mockImplementationOnce(async (o) => {
    calls.push(`confirmPayment ${o.clientSecret}`)
    return { paymentIntent: { id: 'pi_2', status: 'succeeded' } }
  })
  render(<StripeOnPagePayment publishableKey="pk_test_1" amountCents={2_500} payer={{ name: 'Ada Lovelace', email: 'ada@example.org' }} start={start} submitLabel="Give $25" navigate={navigate} />)
  const button = await ready('Give $25')
  await press(button)
  expect(screen.getByRole('alert').textContent).toBe('Your card was declined.')
  expect(navigate).not.toHaveBeenCalled()
  await press(button)
  expect(calls).toEqual(['submit', 'start', 'confirmPayment pi_1_secret_x', 'submit', 'start', 'confirmPayment pi_2_secret_x'])
  expect(confirmPayment.mock.calls[1][0]).toMatchObject({
    redirect: 'if_required',
    confirmParams: { return_url: 'https://app.example.org/donate/thanks', payment_method_data: { billing_details: { name: 'Ada Lovelace', email: 'ada@example.org' } } },
  })
  expect(navigate).toHaveBeenCalledWith('https://app.example.org/donate/thanks?payment_intent=pi_2')
  expect(screen.queryByRole('alert')).toBeNull()
  expect(button.hasAttribute('disabled')).toBe(true)
})

test('on-page: the app refusing to start is said in its words, and nothing is confirmed', async () => {
  const start = vi.fn().mockRejectedValueOnce(new Error('[CONVEX A(donations:start)] [Request ID: 1] Server Error\nUncaught Error: Give at least $5.\n  at x')).mockResolvedValue(stripeOnPage(1))
  render(<StripeOnPagePayment publishableKey="pk_test_1" amountCents={400} start={start} submitLabel="Give" navigate={() => {}} />)
  const button = await ready('Give')
  await press(button)
  expect(screen.getByRole('alert').textContent).toBe('Give at least $5.')
  expect(confirmPayment).not.toHaveBeenCalled()
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

test('setup return: without search, the address is read from window.location, after a hydrating render that matches the server’s', async () => {
  window.history.replaceState(null, '', '/item?setup_intent_client_secret=seti_1_secret_x')
  retrieveSetupIntent.mockResolvedValue({ setupIntent: { status: 'succeeded', payment_method: 'pm_9' } })
  const seen: string[] = []
  const { result } = renderHook(
    () => {
      const r = useStripeSetupReturn('pk_test_1')
      seen.push(r.state)
      return r
    },
    { hydrate: true },
  )
  expect(seen[0]).toBe('none')
  await finishScript()
  await waitFor(() => expect(result.current).toEqual({ state: 'saved', paymentMethodId: 'pm_9' }))
})

test('setup return: follows search as it changes, back to none once the app clears it', async () => {
  retrieveSetupIntent.mockResolvedValue({ setupIntent: { status: 'succeeded', payment_method: 'pm_9' } })
  const { result, rerender } = renderHook(({ search }) => useStripeSetupReturn('pk_test_1', search), { initialProps: { search: '?setup_intent_client_secret=seti_1_secret_x' } })
  await finishScript()
  await waitFor(() => expect(result.current.state).toBe('saved'))
  rerender({ search: '' })
  expect(result.current).toEqual({ state: 'none' })
})

test('setup return: not finished is failed, still confirming is processing; Stripe erring or not loading is unknown, not failed', async () => {
  const answerFor = async (answer: Awaited<ReturnType<typeof retrieveSetupIntent>> | 'no-script', secret: string) => {
    cleanup()
    forgetScripts()
    scripts.length = 0
    if (answer !== 'no-script') retrieveSetupIntent.mockResolvedValueOnce(answer)
    const { result } = renderHook(() => useStripeSetupReturn('pk_test_1', `?setup_intent_client_secret=${secret}`))
    await finishScript(answer === 'no-script' ? 'error' : 'load')
    await waitFor(() => expect(result.current.state).not.toBe('checking'))
    return result.current
  }
  expect(await answerFor({ setupIntent: { status: 'requires_payment_method', payment_method: null } }, 'a')).toEqual({ state: 'failed' })
  expect(await answerFor({ setupIntent: { status: 'processing', payment_method: 'pm_9' } }, 'b')).toEqual({ state: 'processing' })
  expect(await answerFor({ error: { message: 'No such setupintent' } }, 'c')).toEqual({ state: 'unknown' })
  expect(await answerFor('no-script', 'd')).toEqual({ state: 'unknown' })
})
