// Stripe's Payment Element on the app's own page: saving a card or bank account to charge later
// (StripeSaveMethod, the Stripe counterpart of PaypalCardFields) and paying an on-session retry after
// a declined charge (StripeRetryPayment). The form shows at once in Stripe's deferred-intent mode,
// with no SetupIntent or PaymentIntent yet. The intent is asked for (createSetupIntent / createPayment:
// the app's actions around payments.setupPaymentMethod / payments.retryOnSession) only when the payer
// presses the button and Stripe finds the fields complete: both are rate-limited, so merely opening
// forms must never use up a payer's tries.
//
// The Elements options come from the same constants as the server's intents (core/savedMethods.ts),
// because Stripe refuses to confirm an intent whose method types or options differ from the form's.
import { useEffect, useRef, useState } from 'react'
import { SAVED_METHOD_OPTIONS, SAVED_METHOD_TYPES, stripeMethodType, type SavedMethodType } from '../core/savedMethods.js'
import type { SavedMethodKind } from '../core/types.js'
import { loadScript, STRIPE_JS, useSlow, type Load } from './embedded.js'
import { errorMessage } from './errors.js'
import { Button, cn, ErrorNote } from './ui.js'

/**
 * Stripe's Appearance API (https://docs.stripe.com/elements/appearance-api): a theme ('stripe',
 * 'night', 'flat'), variables and rules. Stripe's frames can't see the page's CSS or its theme, so
 * colors are literal; pass the dark ones when the page is dark.
 */
export interface StripeAppearance {
  theme?: 'stripe' | 'night' | 'flat'
  variables?: Record<string, string>
  rules?: Record<string, Record<string, string>>
  labels?: 'above' | 'floating'
}

/** The Elements options for a deferred intent (https://docs.stripe.com/payments/accept-a-payment-deferred). */
export interface StripeElementsOptions {
  mode: 'setup' | 'payment'
  currency: 'usd'
  amount?: number
  setupFutureUsage?: 'off_session'
  paymentMethodTypes: SavedMethodType[]
  paymentMethodOptions: Partial<typeof SAVED_METHOD_OPTIONS>
  appearance?: StripeAppearance
}

// The parts of Stripe.js used here (https://docs.stripe.com/js).
interface StripeError {
  message?: string
}
interface PaymentElement {
  mount(el: HTMLElement): void
  destroy(): void
  on(event: 'ready' | 'change' | 'loaderror', handler: (e: { error?: StripeError }) => void): void
}
interface Elements {
  create(type: 'payment', o: { paymentMethodOrder: string[] }): PaymentElement
  submit(): Promise<{ error?: StripeError }>
  update(o: { appearance?: StripeAppearance }): void
}
interface Confirm {
  elements: Elements
  clientSecret: string
  redirect: 'if_required'
  confirmParams: { return_url: string }
}
type SetupIntent = { status: string; payment_method: string | { id: string } | null }
type PaymentIntent = { status: string }
interface StripeJs {
  elements(o: StripeElementsOptions): Elements
  confirmSetup(o: Confirm): Promise<{ error?: StripeError; setupIntent?: SetupIntent }>
  confirmPayment(o: Confirm): Promise<{ error?: StripeError; paymentIntent?: PaymentIntent }>
  retrievePaymentIntent(clientSecret: string): Promise<{ error?: StripeError; paymentIntent?: PaymentIntent }>
}
const stripeJs = () => (window as unknown as { Stripe?: (publishableKey: string) => StripeJs }).Stripe

/** The method options for these types only, e.g. none for a card alone. */
const optionsFor = (types: readonly SavedMethodType[]) =>
  Object.fromEntries(Object.entries(SAVED_METHOD_OPTIONS).filter(([type]) => (types as readonly string[]).includes(type))) as Partial<typeof SAVED_METHOD_OPTIONS>

/**
 * For saving a method of these kinds (all of them when empty), the same as the SetupIntent
 * payments.setupPaymentMethod makes for them: usage off_session, bank accounts verified at once.
 */
export function saveMethodElementsOptions(methods: readonly SavedMethodKind[], appearance?: StripeAppearance): StripeElementsOptions {
  const types = methods.length ? methods.map(stripeMethodType) : [...SAVED_METHOD_TYPES]
  return { mode: 'setup', currency: 'usd', setupFutureUsage: 'off_session', paymentMethodTypes: types, paymentMethodOptions: optionsFor(types), appearance }
}

/** For paying amountCents on the page, the same as the PaymentIntent payments.retryOnSession makes: a card or a bank account. */
export function retryPaymentElementsOptions(amountCents: number, appearance?: StripeAppearance): StripeElementsOptions {
  const types = [...SAVED_METHOD_TYPES]
  return { mode: 'payment', currency: 'usd', amount: amountCents, paymentMethodTypes: types, paymentMethodOptions: optionsFor(types), appearance }
}

/** Card first, then the bank account (SAVED_METHOD_TYPES is in that order). */
const ELEMENT_OPTIONS = { paymentMethodOrder: [...SAVED_METHOD_TYPES] }

type Form = { stripe: StripeJs; elements: Elements }

/**
 * Loads Stripe.js and mounts a Payment Element in `box` for these options. Changing the options mounts
 * it again; changing only the appearance restyles it in place, keeping what the payer typed.
 */
function usePaymentElement(publishableKey: string, options: Omit<StripeElementsOptions, 'appearance'>, appearance: StripeAppearance | undefined, onChange: () => void) {
  const box = useRef<HTMLDivElement>(null)
  const form = useRef<Form | null>(null)
  // Set as soon as they are made, so a new appearance reaches a form still loading.
  const elementsNow = useRef<Elements | null>(null)
  const [load, setLoad] = useState<Load>('loading')
  useSlow(load, setLoad)
  // Strings, so objects made fresh on every render don't mount the element again.
  const optionsKey = JSON.stringify(options)
  const appearanceKey = JSON.stringify(appearance ?? {})
  const latest = useRef({ appearanceKey, onChange })
  useEffect(() => {
    latest.current = { appearanceKey, onChange }
  }, [appearanceKey, onChange])

  useEffect(() => {
    elementsNow.current?.update({ appearance: JSON.parse(appearanceKey) as StripeAppearance })
  }, [appearanceKey])

  useEffect(() => {
    let live = true
    let element: PaymentElement | null = null
    const failed = (err: unknown) => {
      console.error('payments: Stripe’s payment form didn’t load:', err)
      if (live) setLoad('failed')
    }
    loadScript(STRIPE_JS).then(() => {
      const make = stripeJs()
      if (!live || !box.current) return
      if (!make) return failed(new Error('Stripe.js loaded without Stripe.'))
      try {
        const stripe = make(publishableKey)
        const elements = stripe.elements({ ...(JSON.parse(optionsKey) as StripeElementsOptions), appearance: JSON.parse(latest.current.appearanceKey) as StripeAppearance })
        elementsNow.current = elements
        const made = elements.create('payment', ELEMENT_OPTIONS)
        element = made
        made.on('ready', () => {
          if (!live) return
          form.current = { stripe, elements }
          setLoad('ready')
        })
        made.on('change', () => latest.current.onChange())
        made.on('loaderror', (e) => failed(e.error?.message ?? e))
        made.mount(box.current)
      } catch (err) {
        failed(err)
      }
    }, failed)
    return () => {
      live = false
      form.current = null
      elementsNow.current = null
      element?.destroy()
    }
  }, [publishableKey, optionsKey])

  return { box, form, load }
}

/** Loading and failure notes over the element, as PaypalCardFields has. */
function LoadNote({ load }: { load: Load }) {
  if (load === 'failed') return <ErrorNote error="The payment form didn’t load. Reload the page, or use another way to pay." />
  if (load === 'ready') return null
  return <p className="text-sm text-muted-foreground">Loading the payment form…</p>
}

/** Stripe's message for a problem it reports, else `fallback`. */
class Refused extends Error {}
const refused = (error: StripeError | undefined, fallback: string): never => {
  throw new Refused(error?.message || fallback)
}

const methodIdOf = (si: SetupIntent | undefined) => (typeof si?.payment_method === 'string' ? si.payment_method : (si?.payment_method?.id ?? null))

/** Where Stripe sends the payer back if a method needs a redirect (cards and instant bank verification don't). */
const returnTo = (returnUrl: string | undefined) => returnUrl ?? window.location.href

export interface StripeSaveMethodProps {
  /** The app's Stripe publishable key (pk_test_… / pk_live_…), the same account as its secret key. */
  publishableKey: string
  /**
   * What the payer may save, as passed to payments.setupPaymentMethod: ['card', 'ach'] (the default),
   * or ['ach'] when cards go to PayPal. Must be what the SetupIntent is made for.
   */
  methods?: readonly SavedMethodKind[]
  /**
   * Calls the app's action that runs payments.setupPaymentMethod (with the same `methods`) and returns
   * its clientSecret. Called only when the payer presses the button and the fields are complete.
   */
  createSetupIntent: () => Promise<string>
  /**
   * Stripe saved the method: call the app's action that uses it (e.g. placing the bid, which checks
   * the method with payments.verifyMethodOwner). A throw is shown under the form; pressing the button
   * again calls onSaved again with the same method, unless the payer changed the fields.
   */
  onSaved: (paymentMethodId: string) => Promise<void>
  /** The button's words, e.g. "Place bid". */
  submitLabel: string
  disabled?: boolean
  /** Said under the form, e.g. "You're only charged if you win." */
  note?: string
  /** Stripe's Appearance API; a new one restyles the form in place (e.g. the page switching to dark). */
  appearance?: StripeAppearance
  /** Where Stripe sends the payer back should a method need a redirect. Default: this page. */
  returnUrl?: string
  className?: string
}

/** Stripe's Payment Element (card or bank account) and one button that saves the method, then calls onSaved. */
export function StripeSaveMethod({ publishableKey, methods = [], createSetupIntent, onSaved, submitLabel, disabled, note, appearance, returnUrl, className }: StripeSaveMethodProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A method Stripe saved whose onSaved threw: used again rather than saving another, until the fields change.
  const saved = useRef<string | null>(null)
  const { box, form, load } = usePaymentElement(publishableKey, saveMethodElementsOptions(methods), appearance, () => (saved.current = null))
  const latest = useRef({ createSetupIntent, onSaved })
  useEffect(() => {
    latest.current = { createSetupIntent, onSaved }
  }, [createSetupIntent, onSaved])

  /** Checks the fields, then the SetupIntent, then Stripe confirms it (a bank login or 3-D Secure if needed). */
  const saveMethod = async ({ stripe, elements }: Form) => {
    const checked = await elements.submit()
    if (checked.error) refused(checked.error, 'Check the payment details.')
    const clientSecret = await latest.current.createSetupIntent()
    const { error: stripeError, setupIntent } = await stripe.confirmSetup({ elements, clientSecret, redirect: 'if_required', confirmParams: { return_url: returnTo(returnUrl) } })
    if (stripeError) refused(stripeError, 'Stripe couldn’t save it. Check the details and try again.')
    return methodIdOf(setupIntent) ?? refused(undefined, 'Stripe didn’t save the payment method. Please try again.')
  }

  const submit = async () => {
    if (!form.current || busy) return
    setBusy(true)
    setError(null)
    try {
      saved.current ??= await saveMethod(form.current)
      await latest.current.onSaved(saved.current)
    } catch (err) {
      setError(err instanceof Refused ? err.message : errorMessage(err, 'The payment method couldn’t be saved. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <LoadNote load={load} />
      <div ref={box} />
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      <ErrorNote error={error} />
      <Button variant="default" className="h-9" disabled={disabled || busy || load !== 'ready'} onClick={() => void submit()}>
        {busy ? 'Saving…' : submitLabel}
      </Button>
    </div>
  )
}

/** How a payment ended: paid, or a bank payment on its way (it takes a few business days to clear). */
export type RetryPaymentOutcome = 'succeeded' | 'processing'

const outcomeOf = (pi: PaymentIntent | undefined): RetryPaymentOutcome | null => (pi?.status === 'succeeded' || pi?.status === 'processing' ? pi.status : null)

export interface StripeRetryPaymentProps {
  /** The app's Stripe publishable key, the same account as its secret key. */
  publishableKey: string
  /** What the payment is for: the declined charge's amount, which payments.retryOnSession charges. */
  amountCents: number
  /**
   * Calls the app's action that runs payments.retryOnSession and returns its clientSecret (the same
   * PaymentIntent again while it waits). Called only when the buyer presses the button and the fields are complete.
   */
  createPayment: () => Promise<string>
  /** Stripe took the payment ('succeeded') or a bank payment is on its way ('processing'); the library's callbacks record it. */
  onPaid: (outcome: RetryPaymentOutcome) => void
  /** The button's words, e.g. "Pay $120.00". */
  submitLabel: string
  disabled?: boolean
  note?: string
  /** Stripe's Appearance API; a new one restyles the form in place. */
  appearance?: StripeAppearance
  /**
   * Where Stripe sends the buyer back should a method need a redirect. Default: this page, where the
   * component (mounted again) reads Stripe's payment_intent_client_secret and reports the outcome.
   */
  returnUrl?: string
  className?: string
}

/** Stripe's Payment Element and one button that pays a declined charge on the page (payments.retryOnSession). */
export function StripeRetryPayment({ publishableKey, amountCents, createPayment, onPaid, submitLabel, disabled, note, appearance, returnUrl, className }: StripeRetryPaymentProps) {
  const [busy, setBusy] = useState(false)
  const [paid, setPaid] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { box, form, load } = usePaymentElement(publishableKey, retryPaymentElementsOptions(amountCents), appearance, () => {})
  const latest = useRef({ createPayment, onPaid })
  useEffect(() => {
    latest.current = { createPayment, onPaid }
  }, [createPayment, onPaid])

  const settle = (pi: PaymentIntent | undefined) => {
    const outcome = outcomeOf(pi) ?? refused(undefined, 'The payment didn’t go through. Please try again.')
    setPaid(true)
    latest.current.onPaid(outcome)
  }

  // Back from a redirect: Stripe added the PaymentIntent's client secret to the address.
  const askedBack = useRef(false)
  useEffect(() => {
    const secret = new URLSearchParams(window.location.search).get('payment_intent_client_secret')
    if (load !== 'ready' || !form.current || !secret || askedBack.current) return
    askedBack.current = true
    form.current.stripe.retrievePaymentIntent(secret).then(
      ({ paymentIntent }) => {
        const outcome = outcomeOf(paymentIntent)
        if (!outcome) return setError('The payment didn’t go through. Please try again.')
        setPaid(true)
        latest.current.onPaid(outcome)
      },
      () => setError('Stripe couldn’t say how the payment went. Reload the page to check.'),
    )
  }, [load, form])

  const pay = async ({ stripe, elements }: Form) => {
    const checked = await elements.submit()
    if (checked.error) refused(checked.error, 'Check the payment details.')
    const clientSecret = await latest.current.createPayment()
    const { error: stripeError, paymentIntent } = await stripe.confirmPayment({ elements, clientSecret, redirect: 'if_required', confirmParams: { return_url: returnTo(returnUrl) } })
    if (stripeError) refused(stripeError, 'The payment didn’t go through. Please try again.')
    settle(paymentIntent)
  }

  const submit = async () => {
    if (!form.current || busy || paid) return
    setBusy(true)
    setError(null)
    try {
      await pay(form.current)
    } catch (err) {
      setError(err instanceof Refused ? err.message : errorMessage(err, 'The payment couldn’t be started. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <LoadNote load={load} />
      <div ref={box} />
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      <ErrorNote error={error} />
      <Button variant="default" className="h-9" disabled={disabled || busy || paid || load !== 'ready'} onClick={() => void submit()}>
        {busy ? 'Paying…' : submitLabel}
      </Button>
    </div>
  )
}
