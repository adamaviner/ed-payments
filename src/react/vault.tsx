// Saving a card or PayPal account in PayPal's vault from the app's own page, to be charged later with
// nobody present (payments.setupPaypalMethod, then payments.savePaypalMethod). PayPal's Card Fields
// take the card in PayPal's own frames, so the number never reaches the app; PayPal checks it ($0
// authorization, 3-D Secure in a PayPal window only when the bank asks). PayPal's button opens
// PayPal, where the buyer agrees to be charged later. Both hand the approved setup token to onSaved.
//
// The SDK is loaded under its own namespace (window.paypalVault), so it never replaces the checkout
// buttons' SDK (window.paypal, loaded with intent=capture) on a page that shows both.
import { type RefObject, useEffect, useRef, useState } from 'react'
import { loadScript, useSlow, type Load } from './embedded.js'
import { useAction } from 'convex/react'
import type { EmbeddedPayment, OnPagePayment } from '../client/index.js'
import { errorMessage } from './errors.js'
import { useLatest, useOneAtATime } from './hooks.js'
import type { CompleteReturnRef } from './types.js'
import { WRONG_PROCESSOR } from './stripe.js'
import { Button, cn, ErrorNote } from './ui.js'

export const PAYPAL_VAULT_NAMESPACE = 'paypalVault'

/** PayPal's JS SDK for saving: Card Fields and the PayPal button, no Venmo or Pay Later. */
export function paypalVaultSdkUrl(clientId: string): string {
  return `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&components=card-fields,buttons&disable-funding=venmo,paylater`
}

// The parts of PayPal's SDK used here (JS SDK v5, "save payment methods without purchase").
interface Rendered {
  render(el: HTMLElement): Promise<void>
  close?(): Promise<void>
}
interface CardPaySdk {
  CardFields(o: { createOrder: () => Promise<string>; onApprove: (data: { orderID: string }) => Promise<void>; onError: (err: unknown) => void; style?: Record<string, unknown> }): CardFieldsInstance
}
interface CardFieldsInstance {
  isEligible(): boolean
  NameField(o?: Record<string, unknown>): Rendered
  NumberField(o?: Record<string, unknown>): Rendered
  ExpiryField(o?: Record<string, unknown>): Rendered
  CVVField(o?: Record<string, unknown>): Rendered
  submit(): Promise<void>
}
interface VaultSdk {
  CardFields(o: {
    createVaultSetupToken: () => Promise<string>
    onApprove: (data: { vaultSetupToken: string }) => Promise<void>
    onError: (err: unknown) => void
    style?: Record<string, unknown>
  }): CardFieldsInstance
  Buttons(o: {
    fundingSource?: string
    style: Record<string, string | number>
    createVaultSetupToken: () => Promise<string>
    onApprove: (data: { vaultSetupToken: string }) => Promise<void>
    onCancel: () => void
    onError: (err: unknown) => void
  }): Rendered
  FUNDING?: { PAYPAL?: string }
}
const vaultSdk = () => (window as unknown as Record<string, VaultSdk | undefined>)[PAYPAL_VAULT_NAMESPACE]

const loadVaultSdk = (clientId: string) => loadScript(paypalVaultSdkUrl(clientId), PAYPAL_VAULT_NAMESPACE, { 'data-namespace': PAYPAL_VAULT_NAMESPACE })

/** PayPal's own errors are codes (INVALID_NUMBER, UPDATE_VAULT_SETUP_TOKEN_CONTINGENCY, …), not words for a payer. */
const CARD_REFUSED = 'PayPal couldn’t check that card. Check the number, expiry date and security code, or use another card.'

/**
 * Styling inside PayPal's frames: a selector ('input', '.invalid', ':focus', …) to CSS properties, in
 * PayPal's Card Fields style format. The frames can't see the page's CSS or its theme, so colors are literal.
 */
export type PaypalFieldStyle = Record<string, Record<string, string>>

/** Field styling inside PayPal's frames, close to the package's own inputs. */
const FIELD_STYLE: PaypalFieldStyle = {
  input: { 'font-size': '14px', padding: '6px 8px' },
  '.invalid': { color: '#dc2626' },
}

/** The app's style over the defaults, selector by selector. */
const withFieldStyle = (style: PaypalFieldStyle): PaypalFieldStyle =>
  Object.fromEntries([...new Set([...Object.keys(FIELD_STYLE), ...Object.keys(style)])].map((k) => [k, { ...FIELD_STYLE[k], ...style[k] }]))

/** The four boxes PayPal renders its fields into. */
interface Boxes {
  name: RefObject<HTMLDivElement | null>
  cardNumber: RefObject<HTMLDivElement | null>
  expiry: RefObject<HTMLDivElement | null>
  cvv: RefObject<HTMLDivElement | null>
}

/**
 * Makes PayPal's Card Fields with `make` (which loads the SDK and returns null if it has none) and
 * renders the four fields into the boxes; again, closing the old ones, whenever `inputs` change. Compared
 * as JSON, so objects made fresh on every render don't render the fields again (which would clear
 * what the buyer typed); `make` gets them back from that JSON.
 */
function useCardFields<K>(inputs: K, make: (inputs: K) => Promise<CardFieldsInstance | null>) {
  const key = JSON.stringify(inputs)
  const name = useRef<HTMLDivElement>(null)
  const number = useRef<HTMLDivElement>(null)
  const expiry = useRef<HTMLDivElement>(null)
  const cvv = useRef<HTMLDivElement>(null)
  const fields = useRef<CardFieldsInstance | null>(null)
  const [load, setLoad] = useState<Load>('loading')
  useSlow(load, setLoad)
  const latestMake = useLatest(make)

  useEffect(() => {
    let live = true
    const rendered: Rendered[] = []
    latestMake.current(JSON.parse(key) as K).then(
      async (cf) => {
        if (!live) return
        if (!cf || !cf.isEligible()) return setLoad('failed')
        const parts: [Rendered, HTMLDivElement | null][] = [
          [cf.NameField(), name.current],
          [cf.NumberField(), number.current],
          [cf.ExpiryField(), expiry.current],
          [cf.CVVField(), cvv.current],
        ]
        try {
          for (const [f, el] of parts) {
            if (!el) return
            rendered.push(f)
            await f.render(el)
          }
          if (!live) return
          fields.current = cf
          setLoad('ready')
        } catch {
          if (live) setLoad('failed')
        }
      },
      () => live && setLoad('failed'),
    )
    return () => {
      live = false
      fields.current = null
      for (const f of rendered) void f.close?.().catch(() => {})
    }
  }, [key, latestMake])

  const boxes: Boxes = { name, cardNumber: number, expiry, cvv }
  return { boxes, fields, load }
}

// The frames' pages don't declare a color scheme, so on a dark page (color-scheme: dark) the browser
// would paint an opaque light backdrop behind them; matching their scheme keeps them see-through.
const FRAME_SCHEME = { colorScheme: 'light' } as const

/** The card form around PayPal's fields: loading and failure notes, the four boxes, the note, the error and the button. */
function CardForm(props: { boxes: Boxes; load: Load; note?: string; error: string | null; label: string; disabled: boolean; onSubmit: () => void; className?: string }) {
  const { load } = props
  const { name, cardNumber, expiry, cvv } = props.boxes
  const box = 'min-h-9 rounded-md border border-input'
  return (
    <div className={cn('flex flex-col gap-2', props.className)}>
      {load !== 'ready' && load !== 'failed' && <p className="text-sm text-muted-foreground">Loading the card form…</p>}
      {load === 'failed' && <ErrorNote error="The card form didn’t load. Reload the page, or use another way to pay." />}
      <div className={cn('flex flex-col gap-2', load !== 'ready' && 'hidden')}>
        <div ref={name} className={box} style={FRAME_SCHEME} />
        <div ref={cardNumber} className={box} style={FRAME_SCHEME} />
        <div className="grid grid-cols-2 gap-2">
          <div ref={expiry} className={box} style={FRAME_SCHEME} />
          <div ref={cvv} className={box} style={FRAME_SCHEME} />
        </div>
      </div>
      {props.note && <p className="text-xs text-muted-foreground">{props.note}</p>}
      <ErrorNote error={props.error} />
      <Button variant="default" className="h-9" disabled={props.disabled || load !== 'ready'} onClick={props.onSubmit}>
        {props.label}
      </Button>
    </div>
  )
}

export interface PaypalCardFieldsProps {
  /** The REST app's client id (payments.setupPaypalMethod returns it; public, and it says sandbox or live). */
  clientId: string
  /** Calls the app's action that runs payments.setupPaypalMethod with kind 'card' and returns setupTokenId. */
  createSetupToken: () => Promise<string>
  /**
   * The card was checked and PayPal approved the setup token: call the app's action that runs
   * payments.savePaypalMethod (and whatever the save was for, e.g. placing the bid). A throw is shown
   * under the fields, and the buyer can try again.
   */
  onSaved: (setupTokenId: string) => Promise<void>
  /** The button's words, e.g. "Place bid". */
  submitLabel: string
  disabled?: boolean
  /** Said under the fields, e.g. "You're only charged if you win." */
  note?: string
  /**
   * Colors and fonts inside PayPal's frames, merged over the defaults; pass the dark theme's colors when
   * the page is dark (e.g. `{ input: { color: '#fafafa', background: 'transparent' } }`). Changing it renders
   * the fields again, so what the buyer typed is cleared.
   */
  style?: PaypalFieldStyle
  className?: string
}

/** PayPal's card fields (name, number, expiry, CVV) and one button that saves the card, then calls onSaved. */
export function PaypalCardFields({ clientId, createSetupToken, onSaved, submitLabel, disabled, note, style, className }: PaypalCardFieldsProps) {
  // What the app's createSetupToken or onSaved threw (said as it is), in case PayPal reports it to onError instead of rejecting submit().
  const saveError = useRef<unknown>(null)
  const { busy, run } = useOneAtATime()
  const [error, setError] = useState<string | null>(null)
  const latest = useLatest({ createSetupToken, onSaved })
  const { boxes, fields, load } = useCardFields({ clientId, style: withFieldStyle(style ?? {}) }, async ({ clientId, style }) => {
    await loadVaultSdk(clientId)
    return (
      vaultSdk()?.CardFields({
        style,
        createVaultSetupToken: async () => {
          try {
            return await latest.current.createSetupToken()
          } catch (err) {
            saveError.current = err
            throw err
          }
        },
        onApprove: async ({ vaultSetupToken }) => {
          try {
            await latest.current.onSaved(vaultSetupToken)
          } catch (err) {
            saveError.current = err
            throw err
          }
        },
        onError: (err) => console.error('payments: PayPal card fields:', err),
      }) ?? null
    )
  })

  const submit = () =>
    run(async () => {
      const cf = fields.current
      if (!cf) return
      setError(null)
      saveError.current = null
      try {
        // PayPal calls createVaultSetupToken, checks the card (a 3-D Secure window if the bank wants
        // one), then onApprove, which runs onSaved; a problem anywhere rejects here.
        await cf.submit()
        if (saveError.current) setError(errorMessage(saveError.current, 'The card couldn’t be saved. Please try again.'))
      } catch (err) {
        // The app's words when it was the app; PayPal's codes mean nothing to a payer, so they go to the console.
        if (!saveError.current) console.warn('payments: PayPal card fields refused the card:', err)
        setError(saveError.current ? errorMessage(saveError.current, CARD_REFUSED) : CARD_REFUSED)
      }
    })

  return <CardForm boxes={boxes} load={load} note={note} error={error} label={busy ? 'Saving…' : submitLabel} disabled={!!disabled || busy} onSubmit={() => void submit()} className={className} />
}

export interface PaypalSaveButtonProps {
  clientId: string
  /** Calls the app's action that runs payments.setupPaypalMethod with kind 'paypal' and returns setupTokenId. A throw is shown. */
  createSetupToken: () => Promise<string>
  /** The buyer agreed on PayPal's page: save it (payments.savePaypalMethod) and carry on. A throw is shown. */
  onSaved: (setupTokenId: string) => Promise<void>
  disabled?: boolean
  className?: string
}

/** PayPal's button: the buyer logs in to PayPal and agrees to be charged later; then onSaved. */
export function PaypalSaveButton({ clientId, createSetupToken, onSaved, disabled, className }: PaypalSaveButtonProps) {
  const box = useRef<HTMLDivElement>(null)
  const [load, setLoad] = useState<Load>('loading')
  const [error, setError] = useState<string | null>(null)
  useSlow(load, setLoad)
  const latest = useLatest({ createSetupToken, onSaved })

  useEffect(() => {
    let live = true
    let buttons: Rendered | null = null
    // What the app's createSetupToken threw: PayPal only reports it to onError, which would otherwise blame PayPal.
    let setupError: unknown = null
    loadVaultSdk(clientId).then(
      () => {
        const sdk = vaultSdk()
        if (!live || !box.current) return
        if (!sdk) return setLoad('failed')
        buttons = sdk.Buttons({
          fundingSource: sdk.FUNDING?.PAYPAL ?? 'paypal',
          style: { layout: 'horizontal', shape: 'rect', color: 'gold', label: 'paypal', tagline: 0 },
          createVaultSetupToken: async () => {
            setError(null)
            setupError = null
            try {
              return await latest.current.createSetupToken()
            } catch (err) {
              setupError = err
              throw err
            }
          },
          onApprove: async ({ vaultSetupToken }) => {
            try {
              await latest.current.onSaved(vaultSetupToken)
            } catch (err) {
              setError(errorMessage(err, 'Your PayPal account couldn’t be saved. Please try again.'))
            }
          },
          onCancel: () => setError(null),
          onError: (err) => {
            if (!setupError) console.warn('payments: PayPal button:', err)
            setError(setupError ? errorMessage(setupError, PAYPAL_PROBLEM) : PAYPAL_PROBLEM)
          },
        })
        buttons.render(box.current).then(
          () => live && setLoad('ready'),
          () => live && setLoad('failed'),
        )
      },
      () => live && setLoad('failed'),
    )
    return () => {
      live = false
      void buttons?.close?.().catch(() => {})
    }
  }, [clientId, latest])

  return (
    <div className={cn('flex flex-col gap-2', disabled && 'pointer-events-none opacity-50', className)} aria-disabled={disabled || undefined}>
      {load !== 'ready' && load !== 'failed' && <p className="text-sm text-muted-foreground">Loading PayPal…</p>}
      {load === 'failed' && <ErrorNote error="PayPal didn’t load. Reload the page, or use a card." />}
      <div ref={box} />
      <ErrorNote error={error} />
    </div>
  )
}

const PAYPAL_PROBLEM = 'PayPal had a problem just now. Try again, or use a card.'

export const PAYPAL_CARD_PAY_NAMESPACE = 'paypalCardPay'

/** PayPal's JS SDK for paying with Card Fields (an order captured at once), under its own namespace beside the buttons' and the vault's. */
export function paypalCardPaySdkUrl(clientId: string): string {
  return `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture&components=card-fields`
}

export interface PaypalCardPaymentProps {
  /** An embedded PayPal checkout with `only: 'card'` (payments.startScheduleCheckout with processor paypal, method card). */
  payment: Extract<EmbeddedPayment, { processor: 'paypal' }>
  /** The app's `completeReturn` (from payments.publicApi()): captures the payment, which saves the card for the schedule. */
  completeReturn: CompleteReturnRef
  /** The button's words, e.g. "Give $25 monthly". */
  submitLabel: string
  /** Goes to the return page once paid, or once it is unknown whether it was. Default: a full page load. */
  navigate?: (url: string) => void
  /** Said under the fields, e.g. "Charged on the 21st of every month until you cancel." */
  note?: string
  disabled?: boolean
  /** Colors and fonts inside PayPal's frames, merged over the defaults, as for PaypalCardFields. */
  style?: PaypalFieldStyle
  className?: string
}

/** What the app's start returned: the order to pay and the return page to go to. */
type CardOrder = { orderId: string; returnUrl: string }

/**
 * Card Fields paying an order and capturing it with the app's completeReturn: `order` gives the order when the
 * payer presses (PayPal calls createOrder then). A refusal before any capture, the app's start throwing, or a
 * decline is said under the fields and the payer can press again; anything else after the capture has started
 * goes to the return page, which asks the server how it stands.
 */
function useCardPayment(a: {
  clientId: string
  orderKey?: string
  order: () => Promise<CardOrder>
  completeReturn: CompleteReturnRef
  navigate?: (url: string) => void
  style?: PaypalFieldStyle
  /** A capture that failed the checkout is said as a decline and the payer stays, as the next press starts afresh (on-page only). */
  failedIsDecline?: boolean
}) {
  const capture = useAction(a.completeReturn)
  // null: no capture asked for yet; capturing: asked, no answer (yet).
  const outcome = useRef<'capturing' | 'paid' | 'declined' | null>(null)
  // What the app's start threw (said as it is), as PayPal only reports it as a failed submit.
  const startError = useRef<unknown>(null)
  // The order the press paid, for its return page.
  const paying = useRef<CardOrder | null>(null)
  // A ref as well as state: once paid (or gone to the return page to find out), no press may start another payment.
  const doneRef = useRef(false)
  const [done, setDone] = useState(false)
  const { busy, run } = useOneAtATime()
  const [error, setError] = useState<string | null>(null)
  const latest = useLatest({ capture, navigate: a.navigate, order: a.order })
  const { boxes, fields, load } = useCardFields({ clientId: a.clientId, orderKey: a.orderKey, style: withFieldStyle(a.style ?? {}) }, async ({ clientId, style }) => {
    await loadScript(paypalCardPaySdkUrl(clientId), PAYPAL_CARD_PAY_NAMESPACE, { 'data-namespace': PAYPAL_CARD_PAY_NAMESPACE })
    const sdk = (window as unknown as Record<string, CardPaySdk | undefined>)[PAYPAL_CARD_PAY_NAMESPACE]
    return (
      sdk?.CardFields({
        style,
        createOrder: async () => {
          try {
            paying.current = await latest.current.order()
            return paying.current.orderId
          } catch (err) {
            startError.current = err
            throw err
          }
        },
        onApprove: async ({ orderID }) => {
          outcome.current = 'capturing'
          const r = await latest.current.capture({ processor: 'paypal', token: orderID })
          outcome.current = r?.declined || (a.failedIsDecline && r?.status === 'failed') ? 'declined' : 'paid'
        },
        onError: (err) => console.error('payments: PayPal card fields:', err),
      }) ?? null
    )
  })

  const submit = () =>
    run(async () => {
      const cf = fields.current
      if (!cf || doneRef.current) return
      setError(null)
      outcome.current = null
      startError.current = null
      paying.current = null
      try {
        await cf.submit()
      } catch (err) {
        // Refused before any capture (a mistyped card, 3-D Secure failed, the app's start refused): nothing was charged.
        if (outcome.current === null) {
          if (startError.current) return setError(errorMessage(startError.current, 'The payment couldn’t be started. Please try again.'))
          console.warn('payments: PayPal card fields refused the card:', err)
          return setError(CARD_REFUSED)
        }
      }
      if (outcome.current === 'declined') return setError('The card was declined. Try another card.')
      // Set by createOrder and onApprove during submit, which TypeScript can't see from here. PayPal may report a
      // failed createOrder to onError and resolve submit, so no capture yet means nothing was paid.
      const order = paying.current as CardOrder | null
      if (outcome.current === null || !order) {
        return setError(startError.current ? errorMessage(startError.current, 'The payment couldn’t be started. Please try again.') : CARD_REFUSED)
      }
      doneRef.current = true
      setDone(true)
      ;(latest.current.navigate ?? ((u: string) => window.location.assign(u)))(order.returnUrl)
    })

  return { boxes, load, error, busy: busy || done, submit }
}

/**
 * PayPal's card fields paying an order that also saves the card (vault with purchase), for a
 * schedule's first payment: the card stays in PayPal's frames, PayPal checks it (3-D Secure only when
 * the bank asks), the payment is captured, and the buyer goes to the return page. A declined card is
 * said under the fields, and the buyer can try another. Once the capture has started, anything but a
 * decline (paid, an error, no answer) goes to the return page, which asks the server how it stands:
 * a capture whose answer was lost may well have taken the money, and a payer told it failed would pay again.
 */
export function PaypalCardPayment({ payment, completeReturn, submitLabel, navigate, note, disabled, style, className }: PaypalCardPaymentProps) {
  const { orderId, clientId, returnUrl } = payment
  const { boxes, load, error, busy, submit } = useCardPayment({ clientId, orderKey: orderId, order: () => Promise.resolve({ orderId, returnUrl }), completeReturn, navigate, style })
  return <CardForm boxes={boxes} load={load} note={note} error={error} label={busy ? 'Paying…' : submitLabel} disabled={!!disabled || busy} onSubmit={() => void submit()} className={className} />
}

export interface PaypalOnPagePaymentProps {
  /** The REST app's client id (public; it says sandbox or live), so the fields show before anything is started. */
  clientId: string
  /**
   * Calls the app's action that prices the payment and runs payments.start (or startScheduleCheckout) with ui 'onPage',
   * processor paypal and method card, returning its onPage. Called only when the payer presses the button; after a
   * decline the next press calls it again, and the app passes the checkoutId its last call returned as `replaces`.
   */
  start: () => Promise<OnPagePayment>
  /** The app's `completeReturn` (from payments.publicApi()): captures the payment (saving the card on a schedule's first payment). */
  completeReturn: CompleteReturnRef
  /** The button's words, e.g. "Give $25". */
  submitLabel: string
  /** Goes to the order's return page once paid, or once it is unknown whether it was. Default: a full page load. */
  navigate?: (url: string) => void
  note?: string
  disabled?: boolean
  /** Colors and fonts inside PayPal's frames (usePageTheme's paypal), merged over the defaults; a new one draws the fields again, clearing them. */
  style?: PaypalFieldStyle
  className?: string
}

/**
 * PayPal's card fields for a new payment on the app's own page: nothing is made at PayPal until the press, when the
 * app's start makes the order, PayPal checks the card and the payment is captured, as PaypalCardPayment does. A
 * declined card is said under the fields, whether PayPal let the checkout take another order (declined, reordered)
 * or the checkout failed (PayPal answers a declined card with a COMPLETED order that takes no other card); either
 * way the next press calls start again.
 */
export function PaypalOnPagePayment({ clientId, start, completeReturn, submitLabel, navigate, note, disabled, style, className }: PaypalOnPagePaymentProps) {
  const order = async (): Promise<CardOrder> => {
    const onPage = await start()
    if (onPage.processor !== 'paypal' || onPage.clientId !== clientId) throw new Error(WRONG_PROCESSOR)
    return { orderId: onPage.orderId, returnUrl: onPage.returnUrl }
  }
  const { boxes, load, error, busy, submit } = useCardPayment({ clientId, order, completeReturn, navigate, style, failedIsDecline: true })
  return <CardForm boxes={boxes} load={load} note={note} error={error} label={busy ? 'Paying…' : submitLabel} disabled={!!disabled || busy} onSubmit={() => void submit()} className={className} />
}
