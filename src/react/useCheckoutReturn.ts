// The page a buyer comes back to from Stripe or PayPal. The app reads the processor's token from its
// URL (Stripe's session_id or payment_intent, PayPal's token) however its router does, and words each
// state itself; the hook only asks the library once how the payment stands.
import { useAction } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Processor } from '../core/types.js'
import type { CompleteReturnRef, PaymentRef } from './types.js'

/**
 * checking: asking the library. paid: the app recorded the sale. processing: a bank payment on its way
 * (days). refund_needed: the money arrived but the app couldn't make the sale, so it will be refunded.
 * failed: the processor said no. cancelled: nothing was paid (the buyer turned back, or it expired).
 * error: no token in the address, a token that isn't one of this app's payments, or the call failed
 * (`retry` asks again).
 */
export type CheckoutReturn =
  | { state: 'checking' }
  | { state: 'paid' | 'processing' | 'refund_needed' | 'failed' | 'cancelled'; purpose: string; ref: PaymentRef }
  | { state: 'error'; reason: 'no_token' | 'not_found' | 'request_failed'; error?: unknown }

export type CheckoutReturnState = CheckoutReturn['state']

type Answer = FunctionReturnType<CompleteReturnRef>
type Settled = Exclude<CheckoutReturn, { state: 'checking' }>

const STATES: Record<string, Exclude<CheckoutReturnState, 'checking' | 'error'> | undefined> = {
  paid: 'paid',
  processing: 'processing',
  refund_needed: 'refund_needed',
  failed: 'failed',
  abandoned: 'cancelled',
  // Back at the app without having finished at the processor (PayPal sends its token to the cancel page too).
  pending: 'cancelled',
  created: 'cancelled',
}

function settledFrom(answer: Answer): Settled {
  if (!answer) return { state: 'error', reason: 'not_found' }
  const state = STATES[answer.status]
  return state ? { state, purpose: answer.purpose, ref: answer.ref } : { state: 'error', reason: 'request_failed', error: new Error(`Unknown checkout status ${answer.status}.`) }
}

/**
 * Calls in flight, by processor and token, shared by every mount: React StrictMode runs effects twice
 * and a page may mount twice, and each call counts against the token's rate limit. Dropped once
 * answered, so a later visit asks again, as a reload would; the library is safe to ask again.
 */
const inFlight = new Map<string, Promise<Answer>>()

/**
 * Asks the app's `completeReturn` (from payments.publicApi()) once how this payment stands, settling
 * it with the processor if its webhook hasn't arrived. `token` null or empty: the address had none.
 */
export function useCheckoutReturn(completeReturn: CompleteReturnRef, { processor, token }: { processor: Processor; token: string | null | undefined }): CheckoutReturn & { retry: () => void } {
  const run = useAction(completeReturn)
  const key = token ? `${processor}:${token}` : null
  const [attempt, setAttempt] = useState(0)
  const [done, setDone] = useState<{ key: string; attempt: number; result: Settled } | null>(null)
  // What this mount has asked, so an effect run again for another reason (a new `run`) doesn't ask twice.
  const asked = useRef<string | null>(null)

  useEffect(() => {
    if (!key || !token) return undefined
    const id = `${key}#${attempt}`
    let call = inFlight.get(key)
    if (!call) {
      if (asked.current === id) return undefined
      call = run({ processor, token })
      inFlight.set(key, call)
      const mine = call
      const drop = () => {
        if (inFlight.get(key) === mine) inFlight.delete(key)
      }
      mine.then(drop, drop)
    }
    asked.current = id
    let live = true
    call.then(
      (answer) => live && setDone({ key, attempt, result: settledFrom(answer) }),
      (error: unknown) => live && setDone({ key, attempt, result: { state: 'error', reason: 'request_failed', error } }),
    )
    return () => {
      live = false
    }
  }, [key, token, processor, attempt, run])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  if (!key) return { state: 'error', reason: 'no_token', retry }
  if (!done || done.key !== key || done.attempt !== attempt) return { state: 'checking', retry }
  return { ...done.result, retry }
}
