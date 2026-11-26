// The payment step of an app's own form, whole: the method tabs the app allows (card, bank account, PayPal), the card
// fields of the processor the library's quote gives for the amount (swapped at the price line), PayPal's own button,
// the fallback to the processor's page when a script won't load, and the checkout the last press started, passed as
// `replaces` to the next. Nothing is started before a press on any tab: the app's start (around payments.startOnPage)
// runs at the press, and a press after a decline goes on the same chain of presses, which the library pays once.
//
// The app gives the words (each tab's label, button and note, a hint such as what a bank account saves) and the look
// (classNames over the library's defaults, the processors' frames styled from usePageTheme).
import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react'
import { useAction } from 'convex/react'
import { feeRates, quote, type FeeRatesInput } from '../core/fees.js'
import type { Method, Processor } from '../core/types.js'
import type { OnPagePayment as OnPage, StartedOnPage, StartedRedirect } from '../client/index.js'
import { loadScript, paypalSdkUrl, useReportLoad, useSlow, type Load } from './embedded.js'
import { errorMessage } from './errors.js'
import { useLatest, useOneAtATime } from './hooks.js'
import { StripeOnPagePayment, StripeRetryPayment, WRONG_PROCESSOR, type Payer, type RetryPaymentOutcome, type StripeAppearance } from './stripe.js'
import type { CompleteReturnRef } from './types.js'
import { Button, cn, ErrorNote } from './ui.js'
import { PaypalOnPagePayment, type PaypalFieldStyle } from './vault.js'

/** One tab: its method and the app's words for it. */
export interface OnPagePaymentTab {
  method: Method
  label: ReactNode
  /** The button's words, e.g. "Give $25". PayPal's tab has PayPal's own button, so its label is unused there. */
  submitLabel: string
  /** Said under the fields, e.g. "Charged every month until you cancel." */
  note?: string
  /** Shown in the tab under its label, e.g. "Save $0.53 with bank". */
  hint?: ReactNode
}

/** What the app's start is told at a press: the tab, the processor the page shows (the quote's for a card), and the checkout the last press started. */
export interface OnPageStartArgs {
  method: Method
  processor: Processor
  replaces?: string
}

/** What the app's retry start returns: payments.retryOnSession's answer for Stripe, payments.retryWithPaypal's for PayPal. */
export type RetryStarted = { checkoutId: string; clientSecret: string } | { checkoutId: string; embedded: { processor: 'paypal'; orderId: string; clientId: string; returnUrl: string } }

/** Classes added to the library's own (a class passed in is added, not swapped for a conflicting one). */
export interface OnPagePaymentClassNames {
  root?: string
  tabList?: string
  tab?: string
  selectedTab?: string
  hint?: string
  panel?: string
  fallback?: string
}

interface Shared {
  /** The tabs the app allows, in order. A tab whose processor has no key here isn't shown. */
  tabs: readonly OnPagePaymentTab[]
  /** The app's Stripe publishable key; without it there is no bank tab and cards go to PayPal. */
  stripePublishableKey?: string
  /** The PayPal REST app's client id; without it there is no PayPal tab and cards go to Stripe. */
  paypalClientId?: string
  /** The app's `completeReturn` (from payments.publicApi()): captures a PayPal payment. */
  completeReturn: CompleteReturnRef
  /** The tab shown, when the app keeps it (else the first allowed, then the payer's choice). */
  method?: Method
  onMethodChange?: (method: Method) => void
  /** Goes to the app's return page once paid. Default: a full page load. */
  navigate?: (url: string) => void
  /** Goes to the processor's own page (the fallback). Default: a full page load. */
  leave?: (url: string) => void
  disabled?: boolean
  /** Stripe's Appearance API (usePageTheme's stripe). */
  appearance?: StripeAppearance
  /** PayPal's card fields (usePageTheme's paypal). */
  paypalStyle?: PaypalFieldStyle
  /** PayPal's button style (https://developer.paypal.com/sdk/js/reference/#style), over a gold rectangle. */
  paypalButtonStyle?: Record<string, string | number>
  classNames?: OnPagePaymentClassNames
}

/** A new payment: payments.startOnPage at the press. */
export interface NewOnPagePaymentProps extends Shared {
  retry?: undefined
  /** What is paid for, before a fee the payer covers; the fields show the quote's total. */
  amountCents: number
  coverFee?: boolean
  /** The fee rates given to definePayments (its `fees`), so the page quotes as the server does. */
  fees?: FeeRatesInput
  /** A schedule's first payment: the method is saved for the next ones. Switching keeps a typed Stripe card. */
  saveForLater?: boolean
  /** The payer's name and email from the app's form, not asked again. */
  payer?: Payer
  /**
   * The app's action around payments.startOnPage, priced on the server with payments.quote for this method (the
   * processor must be the one given). Called only at a press, with the checkout the last press started as replaces.
   */
  start: (a: OnPageStartArgs) => Promise<StartedOnPage>
  /** The same payment as a redirect (payments.start), offered when a processor's script won't load or is slow. */
  startRedirect?: (a: OnPageStartArgs) => Promise<StartedRedirect>
}

/** Paying a declined off-session charge on the page (a bid's retry): the amount is the checkout's. */
export interface RetryOnPagePaymentProps extends Shared {
  retry: {
    amountCents: number
    /** card: payments.retryOnSession (Stripe's form takes a card or a bank account); paypal: payments.retryWithPaypal. Called at a press. */
    start: (a: { method: Method }) => Promise<RetryStarted>
    /** Stripe took it, or a bank payment is on its way. PayPal goes to the order's return page instead. */
    onPaid: (outcome: RetryPaymentOutcome) => void
    /** Where Stripe sends the payer back should a method need a redirect (default: this page). */
    returnUrl?: string
  }
}

export type OnPagePaymentProps = NewOnPagePaymentProps | RetryOnPagePaymentProps

/** Said when a PayPal payment was declined; the button stays, and its next press starts again. */
export const PAYPAL_DECLINED_NOTE = 'PayPal couldn’t take that payment. Try again, or choose another way to pay.'

const SITE: Record<Processor, string> = { stripe: 'Stripe’s', paypal: 'PayPal’s' }

const go = (to: ((url: string) => void) | undefined, url: string) => (to ?? ((u: string) => window.location.assign(u)))(url)

/** The tabs this page can show: a processor needs its key, and a retry's card tab is Stripe's form, bank accounts included. */
function allowedTabs(p: OnPagePaymentProps): OnPagePaymentTab[] {
  const stripe = !!p.stripePublishableKey
  const paypal = !!p.paypalClientId
  return p.tabs.filter((t) => {
    if (t.method === 'paypal') return paypal
    if (t.method === 'ach') return stripe && !p.retry
    return stripe || (paypal && !p.retry)
  })
}

/** The card processor for the amount, as payments.quote gives it; an amount that isn't one yet keeps the last answer. */
function useCardProcessor(p: OnPagePaymentProps): Processor {
  const cardProcessors = (['stripe', 'paypal'] as const).filter((x) => (x === 'stripe' ? p.stripePublishableKey : p.paypalClientId))
  let now: Processor | null = null
  if (!p.retry && cardProcessors.length && Number.isInteger(p.amountCents) && p.amountCents > 0) {
    try {
      now = quote({ amountCents: p.amountCents, method: 'card', coverFee: !!p.coverFee }, feeRates(p.fees), { cardProcessors }).processor
    } catch {
      now = null
    }
  }
  const [last, setLast] = useState<Processor>(now ?? cardProcessors[0] ?? 'stripe')
  if (now && now !== last) setLast(now)
  return p.retry ? 'stripe' : (now ?? last)
}

/** What the payer is charged with this method: the quote's total. */
function totalFor(p: NewOnPagePaymentProps, method: Method, processor: Processor): number {
  try {
    return quote({ amountCents: p.amountCents, method, coverFee: !!p.coverFee }, feeRates(p.fees), { cardProcessors: [processor] }).totalCents
  } catch {
    return p.amountCents
  }
}

const TAB = 'flex flex-1 flex-col items-center gap-0.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50'

/**
 * The payment step of the app's own form: tabs for the methods it allows, each started only at its press. A card goes
 * to the processor the quote gives for the amount (its fields swap at the price line, clearing a half-typed card),
 * a bank account to Stripe, PayPal to PayPal's own button. A decline is said, and the next press passes the checkout
 * the last one started as `replaces`. If a script won't load, the payer is offered the processor's page (startRedirect).
 */
export function OnPagePayment(props: OnPagePaymentProps) {
  const { classNames: c = {}, onMethodChange } = props
  const tabs = allowedTabs(props)
  const [chosen, setChosen] = useState<Method | undefined>(props.method)
  const wanted = props.method ?? chosen
  const tab = tabs.find((t) => t.method === wanted) ?? tabs[0]
  const cardProcessor = useCardProcessor(props)
  const lastRef = useRef<string | undefined>(undefined)
  const [load, setLoad] = useState<Load>('loading')
  if (!tab) return null
  const method = tab.method
  const processor: Processor = method === 'card' ? cardProcessor : method === 'ach' ? 'stripe' : 'paypal'
  const choose = (m: Method) => {
    setChosen(m)
    onMethodChange?.(m)
  }

  return (
    <div className={cn('flex flex-col gap-3', c.root)}>
      {tabs.length > 1 && (
        <div role="tablist" className={cn('flex gap-1 rounded-lg bg-muted p-1', c.tabList)}>
          {tabs.map((t) => {
            const selected = t.method === method
            return (
              <button
                key={t.method}
                type="button"
                role="tab"
                aria-selected={selected}
                disabled={props.disabled}
                className={cn(TAB, selected ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground', c.tab, selected && c.selectedTab)}
                onClick={() => choose(t.method)}
              >
                <span>{t.label}</span>
                {t.hint && <span className={cn('text-xs font-normal text-muted-foreground', c.hint)}>{t.hint}</span>}
              </button>
            )
          })}
        </div>
      )}
      <div role={tabs.length > 1 ? 'tabpanel' : undefined} className={c.panel}>
        {props.retry ? <RetryPanel p={props} tab={tab} onLoad={setLoad} /> : <NewPanel p={props} tab={tab} processor={processor} lastRef={lastRef} onLoad={setLoad} />}
      </div>
      {!props.retry && props.startRedirect && (load === 'slow' || load === 'failed') && (
        <Fallback p={props} method={method} processor={processor} lastRef={lastRef} load={load} className={c.fallback} />
      )}
    </div>
  )
}

function NewPanel({
  p,
  tab,
  processor,
  lastRef,
  onLoad,
}: {
  p: NewOnPagePaymentProps
  tab: OnPagePaymentTab
  processor: Processor
  lastRef: RefObject<string | undefined>
  onLoad: (l: Load) => void
}) {
  const latest = useLatest(p.start)
  const { method } = tab
  const start = async (): Promise<OnPage> => {
    const started = await latest.current({ method, processor, replaces: lastRef.current })
    lastRef.current = started.checkoutId
    return started.onPage
  }
  if (method === 'paypal' && p.paypalClientId) {
    const order = async () => {
      const onPage = await start()
      if (onPage.processor !== 'paypal' || onPage.clientId !== p.paypalClientId) throw new Error(WRONG_PROCESSOR)
      return onPage
    }
    return <PaypalStartButton key="paypal-button" clientId={p.paypalClientId} order={order} {...buttonProps(p, tab)} onLoad={onLoad} />
  }
  if (processor === 'paypal' && p.paypalClientId) {
    return (
      <PaypalOnPagePayment
        key="paypal-card"
        clientId={p.paypalClientId}
        start={start}
        completeReturn={p.completeReturn}
        submitLabel={tab.submitLabel}
        note={tab.note}
        navigate={p.navigate}
        disabled={p.disabled}
        style={p.paypalStyle}
        onLoad={onLoad}
      />
    )
  }
  if (!p.stripePublishableKey) return null
  return (
    <StripeOnPagePayment
      key="stripe"
      publishableKey={p.stripePublishableKey}
      amountCents={totalFor(p, method, 'stripe')}
      methods={[method === 'ach' ? 'ach' : 'card']}
      saveForLater={p.saveForLater}
      payer={p.payer}
      start={start}
      submitLabel={tab.submitLabel}
      note={tab.note}
      navigate={p.navigate}
      disabled={p.disabled}
      appearance={p.appearance}
      onLoad={onLoad}
    />
  )
}

function RetryPanel({ p, tab, onLoad }: { p: RetryOnPagePaymentProps; tab: OnPagePaymentTab; onLoad: (l: Load) => void }) {
  const latest = useLatest(p.retry.start)
  if (tab.method === 'paypal' && p.paypalClientId) {
    const clientId = p.paypalClientId
    const order = async () => {
      const started = await latest.current({ method: 'paypal' })
      if (!('embedded' in started) || started.embedded.clientId !== clientId) throw new Error(WRONG_PROCESSOR)
      return started.embedded
    }
    return <PaypalStartButton key="paypal-button" clientId={clientId} order={order} {...buttonProps(p, tab)} onLoad={onLoad} />
  }
  if (!p.stripePublishableKey) return null
  const createPayment = async () => {
    const started = await latest.current({ method: tab.method })
    if (!('clientSecret' in started)) throw new Error(WRONG_PROCESSOR)
    return started.clientSecret
  }
  return (
    <StripeRetryPayment
      key="stripe"
      publishableKey={p.stripePublishableKey}
      amountCents={p.retry.amountCents}
      createPayment={createPayment}
      onPaid={p.retry.onPaid}
      submitLabel={tab.submitLabel}
      note={tab.note}
      disabled={p.disabled}
      appearance={p.appearance}
      returnUrl={p.retry.returnUrl}
      onLoad={onLoad}
    />
  )
}

const buttonProps = (p: OnPagePaymentProps, tab: OnPagePaymentTab) => ({ completeReturn: p.completeReturn, navigate: p.navigate, disabled: p.disabled, style: p.paypalButtonStyle, note: tab.note })

function Fallback({
  p,
  method,
  processor,
  lastRef,
  load,
  className,
}: {
  p: NewOnPagePaymentProps
  method: Method
  processor: Processor
  lastRef: RefObject<string | undefined>
  load: Load
  className?: string
}) {
  const { busy, run } = useOneAtATime()
  const [error, setError] = useState<string | null>(null)
  const redirect = () =>
    run(async () => {
      if (!p.startRedirect) return
      setError(null)
      try {
        const started = await p.startRedirect({ method, processor, replaces: lastRef.current })
        lastRef.current = started.checkoutId
        go(p.leave, started.redirectUrl)
      } catch (err) {
        setError(errorMessage(err, 'The payment couldn’t be started. Please try again.'))
      }
    })
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        {load === 'failed' ? 'The payment form didn’t load.' : 'Having trouble?'}
        <Button variant="outline" disabled={busy || p.disabled} onClick={() => void redirect()}>
          Pay on {SITE[processor]} site instead
        </Button>
      </p>
      <ErrorNote error={error} />
    </div>
  )
}

// The parts of PayPal's SDK the button uses (JS SDK v5, the buttons component).
interface PaypalButtonSdk {
  FUNDING?: { PAYPAL?: string }
  Buttons(o: {
    fundingSource?: string
    style: Record<string, string | number>
    createOrder: () => Promise<string>
    onApprove: (data: { orderID: string }) => Promise<void>
    onCancel: () => void
    onError: (err: unknown) => void
  }): { render(el: HTMLElement): Promise<void>; close?(): Promise<void> }
}

/**
 * PayPal's own button, whose order is made at its press (`order`, the app's start). On approval the payment is captured;
 * a decline is said and the button stays, its next press starting again. Anything else goes to the order's return page,
 * which asks the server how it stands, as PaypalButtons does.
 */
function PaypalStartButton(a: {
  clientId: string
  order: () => Promise<{ orderId: string; returnUrl: string }>
  completeReturn: CompleteReturnRef
  navigate?: (url: string) => void
  disabled?: boolean
  style?: Record<string, string | number>
  note?: string
  onLoad: (load: Load) => void
}) {
  const capture = useAction(a.completeReturn)
  const box = useRef<HTMLDivElement>(null)
  const [load, setLoad] = useState<Load>('loading')
  useSlow(load, setLoad)
  useReportLoad(load, a.onLoad)
  const [error, setError] = useState<string | null>(null)
  // Once paid (or gone to the return page to find out), no press may start another payment.
  const done = useRef(false)
  const paying = useRef<{ orderId: string; returnUrl: string } | null>(null)
  const latest = useLatest({ capture, order: a.order, navigate: a.navigate, disabled: a.disabled })
  const styleKey = JSON.stringify(a.style ?? {})
  const { clientId } = a

  useEffect(() => {
    let live = true
    let rendered: ReturnType<PaypalButtonSdk['Buttons']> | null = null
    loadScript(paypalSdkUrl(clientId), 'paypal').then(
      () => {
        const sdk = (window as unknown as { paypal?: PaypalButtonSdk }).paypal
        if (!live || !box.current) return
        if (!sdk) return setLoad('failed')
        rendered = sdk.Buttons({
          fundingSource: sdk.FUNDING?.PAYPAL ?? 'paypal',
          style: { layout: 'vertical', shape: 'rect', color: 'gold', label: 'paypal', ...(JSON.parse(styleKey) as Record<string, string | number>) },
          createOrder: async () => {
            if (done.current || latest.current.disabled) throw new Error('This payment can’t be started now.')
            setError(null)
            try {
              paying.current = await latest.current.order()
              return paying.current.orderId
            } catch (err) {
              if (live) setError(errorMessage(err, 'The payment couldn’t be started. Please try again.'))
              throw err
            }
          },
          onApprove: async ({ orderID }) => {
            const order = paying.current
            let r: { status: string; declined?: true } | null = null
            try {
              r = await latest.current.capture({ processor: 'paypal', token: orderID })
            } catch {
              // The return page asks again and says how it stands.
            }
            if (r?.declined || r?.status === 'failed') {
              if (live) setError(PAYPAL_DECLINED_NOTE)
              return
            }
            done.current = true
            if (order) go(latest.current.navigate, order.returnUrl)
          },
          onCancel: () => setError(null),
          onError: (err) => {
            console.error('payments: PayPal’s button:', err)
            if (live) setError((said) => said ?? 'PayPal had a problem just now. Try again, or choose another way to pay.')
          },
        })
        rendered.render(box.current).then(
          () => live && setLoad('ready'),
          () => live && setLoad('failed'),
        )
      },
      () => live && setLoad('failed'),
    )
    return () => {
      live = false
      void rendered?.close?.().catch(() => {})
    }
  }, [clientId, styleKey, latest])

  return (
    <div className={cn('flex flex-col gap-2', a.disabled && 'pointer-events-none opacity-50')}>
      {load !== 'ready' && load !== 'failed' && <p className="text-sm text-muted-foreground">Loading PayPal…</p>}
      {load === 'failed' && <ErrorNote error="PayPal didn’t load. Reload the page, or use another way to pay." />}
      <div ref={box} />
      {a.note && <p className="text-xs text-muted-foreground">{a.note}</p>}
      <ErrorNote error={error} />
    </div>
  )
}
