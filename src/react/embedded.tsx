// The payment itself on the app's own page, instead of sending the buyer to PayPal's or Stripe's:
// PayPal's buttons (its JS SDK) and Stripe's embedded Checkout (Stripe.js). Both pay a checkout the
// app started with `payments.start(ctx, { ..., ui: 'embedded' })`, whose `embedded` is passed here,
// and both end on the app's return page, as a redirect would. The processors' scripts are loaded from
// their own sites, as both require. If a script doesn't load (an ad blocker, a bad connection), the
// buyer is offered `onFallback`: the app starts the same payment as a redirect.
import { useAction } from 'convex/react'
import { useEffect, useRef, useState } from 'react'
import type { EmbeddedPayment } from '../client/index.js'
import type { CompleteReturnRef } from './types.js'
import { Button, cn, ErrorNote } from './ui.js'

type PaypalPayment = Extract<EmbeddedPayment, { processor: 'paypal' }>
type StripePayment = Extract<EmbeddedPayment, { processor: 'stripe' }>

/** Stripe.js for the API version the library calls (2026-10-28.endive); Stripe versions its script by name. */
export const STRIPE_JS = 'https://js.stripe.com/endive/stripe.js'
/** How long a processor's script may take before the buyer is offered the redirect. */
const SLOW_MS = 8000

/** PayPal's JS SDK for one REST app: buttons only, card and PayPal, no Venmo or Pay Later. */
export function paypalSdkUrl(clientId: string): string {
  return `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture&components=buttons&disable-funding=venmo,paylater`
}

const loading = new Map<string, Promise<void>>()

/** @internal For tests: forget every script loaded so far. */
export function forgetScripts() {
  loading.clear()
}

/**
 * Loads a script once per address (every mount shares it); resolves once it has run. A failed load is
 * forgotten, so a later mount tries again.
 */
export function loadScript(src: string): Promise<void> {
  const known = loading.get(src)
  if (known) return known
  const p = new Promise<void>((resolve, reject) => {
    const el = document.createElement('script')
    el.src = src
    el.async = true
    el.addEventListener('load', () => resolve())
    el.addEventListener('error', () => {
      loading.delete(src)
      el.remove()
      reject(new Error(`Couldn’t load ${new URL(src).host}.`))
    })
    document.head.appendChild(el)
  })
  loading.set(src, p)
  return p
}

// The few parts of the processors' browser objects used here.
interface PaypalButtons {
  render(el: HTMLElement): Promise<void>
  close?(): Promise<void>
}
interface PaypalSdk {
  Buttons(o: {
    style: Record<string, string | number>
    createOrder: () => Promise<string>
    onApprove: (data: { orderID: string }, actions: { restart?: () => Promise<void> }) => Promise<void>
    onCancel: () => void
    onError: (err: unknown) => void
  }): PaypalButtons
}
interface StripeEmbeddedPage {
  mount(el: HTMLElement): void
  destroy?(): void
}
interface StripeJs {
  createEmbeddedCheckoutPage(o: { fetchClientSecret: () => Promise<string> }): Promise<StripeEmbeddedPage>
}
type Globals = { paypal?: PaypalSdk; Stripe?: (publishableKey: string) => StripeJs }
const globals = () => window as unknown as Globals

type Load = 'loading' | 'slow' | 'ready' | 'failed'

/** "Having trouble?" with the redirect, shown when the script is slow or failed. */
function Fallback({ load, site, onFallback }: { load: Load; site: string; onFallback?: () => void }) {
  if (!onFallback || (load !== 'slow' && load !== 'failed')) return null
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      {load === 'failed' ? `The payment form didn’t load.` : 'Having trouble?'}
      <Button variant="outline" onClick={onFallback}>
        Pay on {site} instead
      </Button>
    </p>
  )
}

/** Marks the load slow after SLOW_MS unless it settled first. */
function useSlow(load: Load, setLoad: (l: Load) => void) {
  useEffect(() => {
    if (load !== 'loading') return undefined
    const t = setTimeout(() => setLoad('slow'), SLOW_MS)
    return () => clearTimeout(t)
  }, [load, setLoad])
}

export interface PaypalButtonsProps {
  payment: PaypalPayment
  /** The app's `completeReturn` (from payments.publicApi()): captures the payment when the buyer approves. */
  completeReturn: CompleteReturnRef
  /** Starts the same payment as a redirect and sends the buyer there; offered if PayPal's script doesn't load. */
  onFallback?: () => void
  /** Goes to the return page once paid. Default: a full page load (the app's return page asks again). */
  navigate?: (url: string) => void
  className?: string
}

/**
 * PayPal's buttons for an embedded PayPal checkout: the PayPal button and "Debit or Credit Card"
 * (which opens PayPal's card form in the page). On approval the payment is captured at once; if
 * PayPal declines the card, the buyer is told and the buttons let them choose again. Then the buyer
 * goes to the return page with PayPal's token, which shows the outcome as after a redirect.
 */
export function PaypalButtons({ payment, completeReturn, onFallback, navigate, className }: PaypalButtonsProps) {
  const capture = useAction(completeReturn)
  const box = useRef<HTMLDivElement>(null)
  const [load, setLoad] = useState<Load>('loading')
  const [note, setNote] = useState<string | null>(null)
  useSlow(load, setLoad)
  // The latest callbacks, so the buttons (rendered once per order) never call stale ones.
  const latest = useRef({ capture, navigate })
  useEffect(() => {
    latest.current = { capture, navigate }
  }, [capture, navigate])

  const { orderId, clientId, returnUrl } = payment
  useEffect(() => {
    let live = true
    let buttons: PaypalButtons | null = null
    const go = (url: string) => (latest.current.navigate ?? ((u: string) => window.location.assign(u)))(url)
    loadScript(paypalSdkUrl(clientId)).then(
      () => {
        const sdk = globals().paypal
        if (!live || !box.current) return
        if (!sdk) return setLoad('failed')
        buttons = sdk.Buttons({
          style: { layout: 'vertical', shape: 'rect', color: 'gold', label: 'paypal' },
          createOrder: () => Promise.resolve(orderId),
          onApprove: async (data, actions) => {
            setNote(null)
            let declined = false
            try {
              declined = !!(await latest.current.capture({ processor: 'paypal', token: data.orderID }))?.declined
            } catch {
              // The return page asks again and says how it stands.
            }
            if (declined && actions.restart) {
              setNote('PayPal couldn’t take that payment. Try another card or way to pay.')
              return await actions.restart()
            }
            go(returnUrl)
          },
          onCancel: () => setNote(null),
          onError: () => setNote('PayPal had a problem just now. Try again, or choose another way to pay.'),
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
  }, [orderId, clientId, returnUrl])

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {load !== 'ready' && load !== 'failed' && <p className="text-sm text-muted-foreground">Loading PayPal…</p>}
      <div ref={box} />
      <ErrorNote error={note} />
      <Fallback load={load} site="PayPal’s site" onFallback={onFallback} />
    </div>
  )
}

export interface StripeEmbeddedCheckoutProps {
  payment: StripePayment
  /** The app's Stripe publishable key (pk_test_… / pk_live_…), the same account as its secret key. */
  publishableKey: string
  /** Starts the same payment as a redirect and sends the buyer there; offered if Stripe.js doesn't load. */
  onFallback?: () => void
  className?: string
}

/**
 * Stripe's embedded Checkout for an embedded Stripe checkout (a card or a bank account, whichever the
 * checkout was started for). Stripe sends the buyer to the return page when they have paid.
 */
export function StripeEmbeddedCheckout({ payment, publishableKey, onFallback, className }: StripeEmbeddedCheckoutProps) {
  const box = useRef<HTMLDivElement>(null)
  const [load, setLoad] = useState<Load>('loading')
  useSlow(load, setLoad)
  // A test key with a live session (or the other way round) can't work; say so instead of a blank box.
  const mismatch = publishableKey.startsWith('pk_live_') !== payment.clientSecret.startsWith('cs_live_')

  const { clientSecret } = payment
  useEffect(() => {
    if (mismatch) return undefined
    let live = true
    let page: StripeEmbeddedPage | null = null
    loadScript(STRIPE_JS)
      .then(async () => {
        const make = globals().Stripe
        if (!make) throw new Error('Stripe.js loaded without Stripe.')
        // Stripe allows one embedded Checkout per page: one made after this unmounted is destroyed at once.
        const made = await make(publishableKey).createEmbeddedCheckoutPage({ fetchClientSecret: () => Promise.resolve(clientSecret) })
        if (!live || !box.current) return made.destroy?.()
        page = made
        made.mount(box.current)
        setLoad('ready')
      })
      .catch(() => live && setLoad('failed'))
    return () => {
      live = false
      page?.destroy?.()
    }
  }, [clientSecret, publishableKey, mismatch])

  if (mismatch) return <ErrorNote error="This payment can’t be shown: the app’s Stripe keys are from different modes (test and live)." className={className} />
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {load !== 'ready' && load !== 'failed' && <p className="text-sm text-muted-foreground">Loading the payment form…</p>}
      <div ref={box} />
      <Fallback load={load} site="Stripe’s site" onFallback={onFallback} />
    </div>
  )
}
