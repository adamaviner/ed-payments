// Stripe's Payment Element on the app's own page: saving a card or bank account to charge later
// (StripeSaveMethod, the Stripe counterpart of PaypalCardFields) and paying an on-session retry after
// a declined charge (StripeRetryPayment). The form shows at once in Stripe's deferred-intent mode,
// with no SetupIntent or PaymentIntent yet. The intent is asked for (createSetupIntent / createPayment:
// the app's actions around payments.setupPaymentMethod / payments.retryOnSession) only when the payer
// presses the button and Stripe finds the fields complete: both are rate-limited, so merely opening
// forms must never use up a payer's tries.
//
// Coming back from a redirect is not these forms' job: the page Stripe returns to checks the address
// first (checkoutReturnToken with useCheckoutReturn for a payment, useStripeSetupReturn for a saved
// method) and shows the outcome instead of the form. A form that read the return itself would only
// see it if the page could still show the form, which a page for an already paid payment can't.
//
// The Elements options come from the same constants as the server's intents (core/savedMethods.ts),
// because Stripe refuses to confirm an intent whose method types or options differ from the form's.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { SAVED_METHOD_OPTIONS, SAVED_METHOD_TYPES, stripeMethodType, type SavedMethodType } from '../core/savedMethods.js'
import type { SavedMethodKind } from '../core/types.js'
import { loadScript, STRIPE_JS, useSlow, type Load } from './embedded.js'
import { errorMessage } from './errors.js'
import { useLatest, useOneAtATime } from './hooks.js'
import { Button, cn, ErrorNote } from './ui.js'
import type { OnPagePayment } from '../client/index.js'

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
  allowedPaymentMethodTypes: SavedMethodType[]
  paymentMethodOptions: Partial<typeof SAVED_METHOD_OPTIONS>
  appearance?: StripeAppearance
}

// The parts of Stripe.js used here (https://docs.stripe.com/js).
interface StripeError {
  message?: string
}
/** The Payment Element's own options: the order of the tabs, and the billing details it doesn't ask for. */
interface ElementOptions {
  paymentMethodOrder: string[]
  fields?: { billingDetails: { name: 'never'; email: 'never' } }
}
interface PaymentElement {
  mount(el: HTMLElement): void
  destroy(): void
  on(event: 'ready' | 'change' | 'loaderror', handler: (e: { error?: StripeError }) => void): void
}
interface Elements {
  create(type: 'payment', o: ElementOptions): PaymentElement
  submit(): Promise<{ error?: StripeError }>
  update(o: { appearance?: StripeAppearance; amount?: number }): void
}
interface Confirm {
  elements: Elements
  clientSecret: string
  redirect: 'if_required'
  confirmParams: { return_url: string; payment_method_data?: { billing_details: Payer } }
}
type SetupIntent = { status: string; payment_method: string | { id: string } | null }
type PaymentIntent = { id?: string; status: string }
interface StripeJs {
  elements(o: StripeElementsOptions): Elements
  confirmSetup(o: Confirm): Promise<{ error?: StripeError; setupIntent?: SetupIntent }>
  confirmPayment(o: Confirm): Promise<{ error?: StripeError; paymentIntent?: PaymentIntent }>
  retrieveSetupIntent(clientSecret: string): Promise<{ error?: StripeError; setupIntent?: SetupIntent }>
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
  return { mode: 'setup', currency: 'usd', setupFutureUsage: 'off_session', allowedPaymentMethodTypes: types, paymentMethodOptions: optionsFor(types), appearance }
}

/** For paying amountCents on the page, the same as the PaymentIntent payments.retryOnSession makes: a card or a bank account. */
export function retryPaymentElementsOptions(amountCents: number, appearance?: StripeAppearance): StripeElementsOptions {
  const types = [...SAVED_METHOD_TYPES]
  return { mode: 'payment', currency: 'usd', amount: amountCents, allowedPaymentMethodTypes: types, paymentMethodOptions: optionsFor(types), appearance }
}

/**
 * For a new payment of amountCents made at the press (payments.start or startScheduleCheckout with ui 'onPage'): the
 * same as the PaymentIntent the library makes for it, a card or a bank account, saved for later on a schedule's first payment.
 */
export function onPagePaymentElementsOptions(amountCents: number, o: { saveForLater?: boolean; methods?: readonly SavedMethodKind[] } = {}, appearance?: StripeAppearance): StripeElementsOptions {
  const types = o.methods?.length ? o.methods.map(stripeMethodType) : [...SAVED_METHOD_TYPES]
  const options: StripeElementsOptions = { mode: 'payment', currency: 'usd', amount: amountCents, allowedPaymentMethodTypes: types, paymentMethodOptions: optionsFor(types), appearance }
  return o.saveForLater ? { ...options, setupFutureUsage: 'off_session' } : options
}

/** Card first, then the bank account (SAVED_METHOD_TYPES is in that order). */
const ELEMENT_OPTIONS: ElementOptions = { paymentMethodOrder: [...SAVED_METHOD_TYPES] }

type Form = { stripe: StripeJs; elements: Elements }

/**
 * Loads Stripe.js and mounts a Payment Element in `box` for these options. Changing the options mounts
 * it again; changing only the appearance or the amount updates it in place, keeping what the payer typed. A
 * payment form waits for an amount Stripe takes (a whole number of cents above zero) before it mounts, and an amount
 * that isn't one later leaves the form at the last one; `amountOk` says whether the current one is.
 */
function usePaymentElement(
  publishableKey: string,
  { amount, ...options }: Omit<StripeElementsOptions, 'appearance'>,
  appearance: StripeAppearance | undefined,
  onChange: () => void,
  element: ElementOptions = ELEMENT_OPTIONS,
) {
  const box = useRef<HTMLDivElement>(null)
  const form = useRef<Form | null>(null)
  // Set as soon as they are made, so a new appearance reaches a form still loading.
  const elementsNow = useRef<Elements | null>(null)
  const [load, setLoad] = useState<Load>('loading')
  useSlow(load, setLoad)
  // Strings, so objects made fresh on every render don't mount the element again.
  const optionsKey = JSON.stringify(options)
  const elementKey = JSON.stringify(element)
  const appearanceKey = JSON.stringify(appearance ?? {})
  const amountOk = amount === undefined || (Number.isInteger(amount) && amount > 0)
  const [lastAmount, setLastAmount] = useState(amount)
  if (amountOk && amount !== lastAmount) setLastAmount(amount)
  // Once there has been an amount, the form stays mounted through a moment without one (a field being retyped).
  const [mountable, setMountable] = useState(amountOk)
  if (amountOk && !mountable) setMountable(true)
  const latest = useLatest({ appearanceKey, lastAmount, onChange })

  useEffect(() => {
    elementsNow.current?.update({ appearance: JSON.parse(appearanceKey) as StripeAppearance })
  }, [appearanceKey])

  useEffect(() => {
    if (amount !== undefined && amountOk) elementsNow.current?.update({ amount })
  }, [amount, amountOk])

  useEffect(() => {
    if (!mountable) return undefined
    let live = true
    let element: PaymentElement | null = null
    const failed = (err: unknown) => {
      console.error('payments: Stripe’s payment form didn’t load:', err)
      if (live) setLoad('failed')
    }
    loadScript(STRIPE_JS, 'Stripe').then(() => {
      const make = stripeJs()
      if (!live || !box.current) return
      if (!make) return failed(new Error('Stripe.js loaded without Stripe.'))
      try {
        const stripe = make(publishableKey)
        const { lastAmount: amountNow, appearanceKey: appearanceNow } = latest.current
        const elements = stripe.elements({
          ...(JSON.parse(optionsKey) as StripeElementsOptions),
          ...(amountNow === undefined ? {} : { amount: amountNow }),
          appearance: JSON.parse(appearanceNow) as StripeAppearance,
        })
        elementsNow.current = elements
        const made = elements.create('payment', JSON.parse(elementKey) as ElementOptions)
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
  }, [publishableKey, optionsKey, elementKey, latest, mountable])

  return { box, form, load, amountOk }
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
  /**
   * Where Stripe sends the payer back should a method need a redirect (default: this page), with
   * ?setup_intent_client_secret= added. That page shows the outcome with useStripeSetupReturn.
   */
  returnUrl?: string
  className?: string
}

/** Stripe's Payment Element (card or bank account) and one button that saves the method, then calls onSaved. */
export function StripeSaveMethod({ publishableKey, methods = [], createSetupIntent, onSaved, submitLabel, disabled, note, appearance, returnUrl, className }: StripeSaveMethodProps) {
  const { busy, run } = useOneAtATime()
  const [error, setError] = useState<string | null>(null)
  // A method Stripe saved whose onSaved threw: used again rather than saving another, until the fields change.
  const saved = useRef<string | null>(null)
  const { box, form, load } = usePaymentElement(publishableKey, saveMethodElementsOptions(methods), appearance, () => (saved.current = null))
  const latest = useLatest({ createSetupIntent, onSaved })

  /** Checks the fields, then the SetupIntent, then Stripe confirms it (a bank login or 3-D Secure if needed). */
  const saveMethod = async ({ stripe, elements }: Form) => {
    const checked = await elements.submit()
    if (checked.error) refused(checked.error, 'Check the payment details.')
    const clientSecret = await latest.current.createSetupIntent()
    const { error: stripeError, setupIntent } = await stripe.confirmSetup({ elements, clientSecret, redirect: 'if_required', confirmParams: { return_url: returnTo(returnUrl) } })
    if (stripeError) refused(stripeError, 'Stripe couldn’t save it. Check the details and try again.')
    return methodIdOf(setupIntent) ?? refused(undefined, 'Stripe didn’t save the payment method. Please try again.')
  }

  const submit = () =>
    run(async () => {
      const f = form.current
      if (!f) return
      setError(null)
      try {
        saved.current ??= await saveMethod(f)
        await latest.current.onSaved(saved.current)
      } catch (err) {
        setError(err instanceof Refused ? err.message : errorMessage(err, 'The payment method couldn’t be saved. Please try again.'))
      }
    })

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
   * Where Stripe sends the buyer back should a method need a redirect (default: this page), with
   * ?payment_intent= added. That page shows the outcome with checkoutReturnToken and useCheckoutReturn,
   * not this form, which doesn't read the address.
   */
  returnUrl?: string
  className?: string
}

/** Stripe's Payment Element and one button that pays a declined charge on the page (payments.retryOnSession). */
export function StripeRetryPayment({ publishableKey, amountCents, createPayment, onPaid, submitLabel, disabled, note, appearance, returnUrl, className }: StripeRetryPaymentProps) {
  const { busy, run } = useOneAtATime()
  // A ref as well as state: a second press in the same tick must not pay again.
  const paidRef = useRef(false)
  const [paid, setPaid] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { box, form, load } = usePaymentElement(publishableKey, retryPaymentElementsOptions(amountCents), appearance, () => {})
  const latest = useLatest({ createPayment, onPaid })

  const settle = (pi: PaymentIntent | undefined) => {
    const outcome = outcomeOf(pi) ?? refused(undefined, 'The payment didn’t go through. Please try again.')
    paidRef.current = true
    setPaid(true)
    latest.current.onPaid(outcome)
  }

  const pay = async ({ stripe, elements }: Form) => {
    const checked = await elements.submit()
    if (checked.error) refused(checked.error, 'Check the payment details.')
    const clientSecret = await latest.current.createPayment()
    const { error: stripeError, paymentIntent } = await stripe.confirmPayment({ elements, clientSecret, redirect: 'if_required', confirmParams: { return_url: returnTo(returnUrl) } })
    if (stripeError) refused(stripeError, 'The payment didn’t go through. Please try again.')
    settle(paymentIntent)
  }

  const submit = () =>
    run(async () => {
      const f = form.current
      if (!f || paidRef.current) return
      setError(null)
      try {
        await pay(f)
      } catch (err) {
        setError(err instanceof Refused ? err.message : errorMessage(err, 'The payment couldn’t be started. Please try again.'))
      }
    })

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

/** Who is paying, as the app's own form already asked. */
export interface Payer {
  name: string
  email: string
}

/** Stripe's return address with the PaymentIntent added, as Stripe adds it after a redirect, so one return page serves both. */
const withPaymentIntent = (returnUrl: string, pi: PaymentIntent | undefined) => {
  if (!pi?.id) return returnUrl
  const url = new URL(returnUrl, window.location.href)
  url.searchParams.set('payment_intent', pi.id)
  return url.toString()
}

export interface StripeOnPagePaymentProps {
  /** The app's Stripe publishable key, the same account as its secret key. */
  publishableKey: string
  /** What the payment will be, as the app's server will price it; a new amount is shown in place, keeping what the payer typed. */
  amountCents: number
  /**
   * What the payer may pay with, as start passes it (['card'] or ['ach'] when the app's own tabs choose; both by
   * default). Must be what the PaymentIntent is made for.
   */
  methods?: readonly SavedMethodKind[]
  /**
   * A schedule's first payment (payments.startScheduleCheckout): the method is saved for the next ones, and Stripe says
   * so under the fields. Must match what start makes; changing it mounts the form again.
   */
  saveForLater?: boolean
  /**
   * The payer's name and email from the app's own form: Stripe's fields don't ask for them again, and they go on the
   * payment method when it is confirmed. Without it Stripe asks for what a method needs (a bank account's name and email).
   */
  payer?: Payer
  /**
   * Calls the app's action that prices the payment and runs payments.start (or startScheduleCheckout) with ui 'onPage',
   * returning its onPage. Called only when the payer presses the button and Stripe finds the fields complete; after a
   * decline the next press calls it again, and the app passes the checkoutId its last call returned as `replaces`.
   */
  start: () => Promise<OnPagePayment>
  /** The button's words, e.g. "Give $25". */
  submitLabel: string
  /**
   * Goes to the return page (onPage.returnUrl with ?payment_intent= added, as Stripe adds it after a redirect) once Stripe
   * took the payment or a bank payment is on its way. Default: a full page load. The page shows the outcome with
   * checkoutReturnToken and useCheckoutReturn.
   */
  navigate?: (url: string) => void
  disabled?: boolean
  note?: string
  /** Stripe's Appearance API (usePageTheme's stripe); a new one restyles the form in place. */
  appearance?: StripeAppearance
  className?: string
}

/** Said when the app's start made the payment for the other processor's fields (the app's choice changed under the form). */
export const WRONG_PROCESSOR = 'This payment can’t be paid here. Reload the page and try again.'

const PAYER_FIELDS: ElementOptions = { ...ELEMENT_OPTIONS, fields: { billingDetails: { name: 'never', email: 'never' } } }

/**
 * Stripe's Payment Element for a new payment on the app's own page, with one button. Nothing is made at Stripe until
 * the press: then the fields are checked, the app's start makes the PaymentIntent, and Stripe confirms it here (a
 * card's security check on the page). A decline is said under the fields, and the next press starts again.
 */
export function StripeOnPagePayment({ publishableKey, amountCents, methods, saveForLater, payer, start, submitLabel, navigate, disabled, note, appearance, className }: StripeOnPagePaymentProps) {
  const { busy, run } = useOneAtATime()
  const paidRef = useRef(false)
  const [paid, setPaid] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { box, form, load, amountOk } = usePaymentElement(
    publishableKey,
    onPagePaymentElementsOptions(amountCents, { saveForLater, methods }),
    appearance,
    () => {},
    payer ? PAYER_FIELDS : ELEMENT_OPTIONS,
  )
  const latest = useLatest({ start, payer, navigate })

  const pay = async ({ stripe, elements }: Form) => {
    const checked = await elements.submit()
    if (checked.error) refused(checked.error, 'Check the payment details.')
    const onPage = await latest.current.start()
    if (onPage.processor !== 'stripe') throw new Error(WRONG_PROCESSOR)
    const { payer: billing } = latest.current
    const { error: stripeError, paymentIntent } = await stripe.confirmPayment({
      elements,
      clientSecret: onPage.clientSecret,
      redirect: 'if_required',
      confirmParams: { return_url: onPage.returnUrl, ...(billing ? { payment_method_data: { billing_details: { name: billing.name, email: billing.email } } } : {}) },
    })
    if (stripeError) refused(stripeError, 'The payment didn’t go through. Please try again.')
    if (!outcomeOf(paymentIntent)) refused(undefined, 'The payment didn’t go through. Please try again.')
    paidRef.current = true
    setPaid(true)
    ;(latest.current.navigate ?? ((u: string) => window.location.assign(u)))(withPaymentIntent(onPage.returnUrl, paymentIntent))
  }

  const submit = () =>
    run(async () => {
      const f = form.current
      if (!f || paidRef.current || !amountOk) return
      setError(null)
      try {
        await pay(f)
      } catch (err) {
        setError(err instanceof Refused ? err.message : errorMessage(err, 'The payment couldn’t be started. Please try again.'))
      }
    })

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <LoadNote load={load} />
      <div ref={box} />
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      <ErrorNote error={error} />
      <Button variant="default" className="h-9" disabled={disabled || busy || paid || !amountOk || load !== 'ready'} onClick={() => void submit()}>
        {busy ? 'Paying…' : submitLabel}
      </Button>
    </div>
  )
}

/**
 * How a save that needed a redirect ended. none: the address isn't a return from one. saved: Stripe
 * saved the method (savedMethods lists it from now on). processing: Stripe is still confirming it (some
 * bank accounts). failed: it wasn't saved. unknown: Stripe couldn't say, so the method may be saved:
 * don't invite the payer to save another before checking.
 */
export type StripeSetupReturn = { state: 'none' } | { state: 'checking' } | { state: 'saved'; paymentMethodId: string } | { state: 'processing' } | { state: 'failed' } | { state: 'unknown' }

const subscribeToHistory = (changed: () => void) => {
  window.addEventListener('popstate', changed)
  return () => window.removeEventListener('popstate', changed)
}

const setupSecretIn = (search: string) => new URLSearchParams(search).get('setup_intent_client_secret')

const setupAnswer = (si: SetupIntent | undefined): StripeSetupReturn => {
  const paymentMethodId = methodIdOf(si)
  if (si?.status === 'succeeded' && paymentMethodId) return { state: 'saved', paymentMethodId }
  if (si?.status === 'processing') return { state: 'processing' }
  return si ? { state: 'failed' } : { state: 'unknown' }
}

/**
 * For the page Stripe sends a payer back to when saving a method with StripeSaveMethod needed a
 * redirect (rare: cards and instantly verified bank accounts finish on the page). Asks Stripe how the
 * SetupIntent in the address ended. Whatever the app's onSaved was going to do with the method (place a
 * bid, say) didn't happen, since the page that would have done it is gone: say so, and let the payer
 * finish with the saved method, which the app's own savedMethods call now offers.
 *
 * Pass `search` from the app's router (e.g. Next's useSearchParams().toString()); it is followed as it
 * changes. Without it the address is read from window.location (none on the server, so a server
 * render and the first client render agree), again on back and forward.
 */
export function useStripeSetupReturn(publishableKey: string, search?: string): StripeSetupReturn {
  const addressSearch = useSyncExternalStore(
    subscribeToHistory,
    () => window.location.search,
    () => '',
  )
  const secret = setupSecretIn(search ?? addressSearch)
  const [answered, setAnswered] = useState<{ secret: string; answer: StripeSetupReturn } | null>(null)
  useEffect(() => {
    if (!secret) return undefined
    let live = true
    const settle = (answer: StripeSetupReturn) => live && setAnswered({ secret, answer })
    const ask = async () => {
      await loadScript(STRIPE_JS, 'Stripe')
      const make = stripeJs()
      if (!make) return settle({ state: 'unknown' })
      const { error, setupIntent } = await make(publishableKey).retrieveSetupIntent(secret)
      settle(error ? { state: 'unknown' } : setupAnswer(setupIntent))
    }
    ask().catch(() => settle({ state: 'unknown' }))
    return () => {
      live = false
    }
  }, [secret, publishableKey])
  if (!secret) return { state: 'none' }
  return answered?.secret === secret ? answered.answer : { state: 'checking' }
}
