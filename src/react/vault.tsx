// Saving a card or PayPal account in PayPal's vault from the app's own page, to be charged later with
// nobody present (payments.setupPaypalMethod, then payments.savePaypalMethod). PayPal's Card Fields
// take the card in PayPal's own frames, so the number never reaches the app; PayPal checks it ($0
// authorization, 3-D Secure in a PayPal window only when the bank asks). PayPal's button opens
// PayPal, where the buyer agrees to be charged later. Both hand the approved setup token to onSaved.
//
// The SDK is loaded under its own namespace (window.paypalVault), so it never replaces the checkout
// buttons' SDK (window.paypal, loaded with intent=capture) on a page that shows both.
import { useEffect, useRef, useState } from 'react'
import { loadScript, useSlow, type Load } from './embedded.js'
import { useAction } from 'convex/react'
import type { EmbeddedPayment } from '../client/index.js'
import type { CompleteReturnRef } from './types.js'
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

const loadVaultSdk = (clientId: string) => loadScript(paypalVaultSdkUrl(clientId), { 'data-namespace': PAYPAL_VAULT_NAMESPACE })

const messageOf = (err: unknown) => (err instanceof Error ? err.message : typeof err === 'string' ? err : null)

/** Field styling inside PayPal's frames, close to the package's own inputs. */
const FIELD_STYLE = {
  input: { 'font-size': '14px', padding: '6px 8px' },
  '.invalid': { color: '#dc2626' },
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
  className?: string
}

/** PayPal's card fields (name, number, expiry, CVV) and one button that saves the card, then calls onSaved. */
export function PaypalCardFields({ clientId, createSetupToken, onSaved, submitLabel, disabled, note, className }: PaypalCardFieldsProps) {
  const nameBox = useRef<HTMLDivElement>(null)
  const numberBox = useRef<HTMLDivElement>(null)
  const expiryBox = useRef<HTMLDivElement>(null)
  const cvvBox = useRef<HTMLDivElement>(null)
  const fields = useRef<CardFieldsInstance | null>(null)
  // What onSaved threw, in case PayPal reports it to onError instead of rejecting submit().
  const saveError = useRef<unknown>(null)
  const [load, setLoad] = useState<Load>('loading')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useSlow(load, setLoad)
  const latest = useRef({ createSetupToken, onSaved })
  useEffect(() => {
    latest.current = { createSetupToken, onSaved }
  }, [createSetupToken, onSaved])

  useEffect(() => {
    let live = true
    const rendered: Rendered[] = []
    loadVaultSdk(clientId).then(
      async () => {
        const sdk = vaultSdk()
        if (!live) return
        if (!sdk) return setLoad('failed')
        const cf = sdk.CardFields({
          style: FIELD_STYLE,
          createVaultSetupToken: () => latest.current.createSetupToken(),
          onApprove: async ({ vaultSetupToken }) => {
            try {
              await latest.current.onSaved(vaultSetupToken)
            } catch (err) {
              saveError.current = err
              throw err
            }
          },
          onError: (err) => console.error('payments: PayPal card fields:', err),
        })
        if (!cf.isEligible()) return setLoad('failed')
        const parts: [Rendered, HTMLDivElement | null][] = [
          [cf.NameField(), nameBox.current],
          [cf.NumberField(), numberBox.current],
          [cf.ExpiryField(), expiryBox.current],
          [cf.CVVField(), cvvBox.current],
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
  }, [clientId])

  const submit = async () => {
    if (!fields.current || busy) return
    setBusy(true)
    setError(null)
    saveError.current = null
    try {
      // PayPal calls createVaultSetupToken, checks the card (a 3-D Secure window if the bank wants
      // one), then onApprove, which runs onSaved; a problem anywhere rejects here.
      await fields.current.submit()
      if (saveError.current) setError(messageOf(saveError.current) ?? 'The card couldn’t be saved. Please try again.')
    } catch (err) {
      setError(messageOf(saveError.current ?? err) ?? 'The card couldn’t be saved. Check the details and try again.')
    } finally {
      setBusy(false)
    }
  }

  const box = 'min-h-9 rounded-md border border-input'
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {load !== 'ready' && load !== 'failed' && <p className="text-sm text-muted-foreground">Loading the card form…</p>}
      {load === 'failed' && <ErrorNote error="The card form didn’t load. Reload the page, or use another way to pay." />}
      <div className={cn('flex flex-col gap-2', load !== 'ready' && 'hidden')}>
        <div ref={nameBox} className={box} />
        <div ref={numberBox} className={box} />
        <div className="grid grid-cols-2 gap-2">
          <div ref={expiryBox} className={box} />
          <div ref={cvvBox} className={box} />
        </div>
      </div>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      <ErrorNote error={error} />
      <Button variant="default" className="h-9" disabled={disabled || busy || load !== 'ready'} onClick={() => void submit()}>
        {busy ? 'Saving…' : submitLabel}
      </Button>
    </div>
  )
}

export interface PaypalSaveButtonProps {
  clientId: string
  /** Calls the app's action that runs payments.setupPaypalMethod with kind 'paypal' and returns setupTokenId. */
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
  const latest = useRef({ createSetupToken, onSaved })
  useEffect(() => {
    latest.current = { createSetupToken, onSaved }
  }, [createSetupToken, onSaved])

  useEffect(() => {
    let live = true
    let buttons: Rendered | null = null
    loadVaultSdk(clientId).then(
      () => {
        const sdk = vaultSdk()
        if (!live || !box.current) return
        if (!sdk) return setLoad('failed')
        buttons = sdk.Buttons({
          fundingSource: sdk.FUNDING?.PAYPAL ?? 'paypal',
          style: { layout: 'horizontal', shape: 'rect', color: 'gold', label: 'paypal', tagline: 0 },
          createVaultSetupToken: () => {
            setError(null)
            return latest.current.createSetupToken()
          },
          onApprove: async ({ vaultSetupToken }) => {
            try {
              await latest.current.onSaved(vaultSetupToken)
            } catch (err) {
              setError(messageOf(err) ?? 'Your PayPal account couldn’t be saved. Please try again.')
            }
          },
          onCancel: () => setError(null),
          onError: () => setError('PayPal had a problem just now. Try again, or use a card.'),
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
  }, [clientId])

  return (
    <div className={cn('flex flex-col gap-2', disabled && 'pointer-events-none opacity-50', className)} aria-disabled={disabled || undefined}>
      {load !== 'ready' && load !== 'failed' && <p className="text-sm text-muted-foreground">Loading PayPal…</p>}
      {load === 'failed' && <ErrorNote error="PayPal didn’t load. Reload the page, or use a card." />}
      <div ref={box} />
      <ErrorNote error={error} />
    </div>
  )
}

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
  /** Goes to the return page once paid. Default: a full page load. */
  navigate?: (url: string) => void
  /** Said under the fields, e.g. "Charged on the 21st of every month until you cancel." */
  note?: string
  disabled?: boolean
  className?: string
}

/**
 * PayPal's card fields paying an order that also saves the card (vault with purchase), for a
 * schedule's first payment: the card stays in PayPal's frames, PayPal checks it (3-D Secure only when
 * the bank asks), the payment is captured, and the buyer goes to the return page. A declined card is
 * said under the fields, and the buyer can try another.
 */
export function PaypalCardPayment({ payment, completeReturn, submitLabel, navigate, note, disabled, className }: PaypalCardPaymentProps) {
  const capture = useAction(completeReturn)
  const nameBox = useRef<HTMLDivElement>(null)
  const numberBox = useRef<HTMLDivElement>(null)
  const expiryBox = useRef<HTMLDivElement>(null)
  const cvvBox = useRef<HTMLDivElement>(null)
  const fields = useRef<CardFieldsInstance | null>(null)
  const outcome = useRef<'paid' | 'declined' | null>(null)
  const [load, setLoad] = useState<Load>('loading')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useSlow(load, setLoad)
  const latest = useRef({ capture })
  useEffect(() => {
    latest.current = { capture }
  }, [capture])
  const { orderId, clientId, returnUrl } = payment

  useEffect(() => {
    let live = true
    const rendered: Rendered[] = []
    loadScript(paypalCardPaySdkUrl(clientId), { 'data-namespace': PAYPAL_CARD_PAY_NAMESPACE }).then(
      async () => {
        const sdk = (window as unknown as Record<string, CardPaySdk | undefined>)[PAYPAL_CARD_PAY_NAMESPACE]
        if (!live) return
        if (!sdk) return setLoad('failed')
        const cf = sdk.CardFields({
          style: FIELD_STYLE,
          createOrder: () => Promise.resolve(orderId),
          onApprove: async ({ orderID }) => {
            const r = await latest.current.capture({ processor: 'paypal', token: orderID })
            outcome.current = r?.declined ? 'declined' : 'paid'
          },
          onError: (err) => console.error('payments: PayPal card fields:', err),
        })
        if (!cf.isEligible()) return setLoad('failed')
        const parts: [Rendered, HTMLDivElement | null][] = [
          [cf.NameField(), nameBox.current],
          [cf.NumberField(), numberBox.current],
          [cf.ExpiryField(), expiryBox.current],
          [cf.CVVField(), cvvBox.current],
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
  }, [clientId, orderId])

  const submit = async () => {
    if (!fields.current || busy) return
    setBusy(true)
    setError(null)
    outcome.current = null
    try {
      await fields.current.submit()
      if (outcome.current === 'paid') return (navigate ?? ((u: string) => window.location.assign(u)))(returnUrl)
      setError(outcome.current === 'declined' ? 'The card was declined. Try another card.' : 'The card couldn’t be charged. Check the details and try again.')
    } catch (err) {
      setError(messageOf(err) ?? 'The card couldn’t be charged. Check the details and try again.')
    } finally {
      setBusy(false)
    }
  }

  const box = 'min-h-9 rounded-md border border-input'
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {load !== 'ready' && load !== 'failed' && <p className="text-sm text-muted-foreground">Loading the card form…</p>}
      {load === 'failed' && <ErrorNote error="The card form didn’t load. Reload the page, or use another way to pay." />}
      <div className={cn('flex flex-col gap-2', load !== 'ready' && 'hidden')}>
        <div ref={nameBox} className={box} />
        <div ref={numberBox} className={box} />
        <div className="grid grid-cols-2 gap-2">
          <div ref={expiryBox} className={box} />
          <div ref={cvvBox} className={box} />
        </div>
      </div>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      <ErrorNote error={error} />
      <Button variant="default" className="h-9" disabled={disabled || busy || load !== 'ready'} onClick={() => void submit()}>
        {busy ? 'Paying…' : submitLabel}
      </Button>
    </div>
  )
}
