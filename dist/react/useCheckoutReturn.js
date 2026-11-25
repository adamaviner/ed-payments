// The page a buyer comes back to from Stripe or PayPal. The app reads the processor's token from its
// URL (Stripe's session_id or payment_intent, PayPal's token) however its router does, and words each
// state itself; the hook only asks the library once how the payment stands.
import { useAction } from 'convex/react';
import { useCallback, useEffect, useRef, useState } from 'react';
// Keyed by every checkout status, so a new one fails the typecheck here rather than showing an error to a buyer.
const STATES = {
    paid: 'paid',
    processing: 'processing',
    refund_needed: 'refund_needed',
    failed: 'failed',
    abandoned: 'cancelled',
    // Back at the app without having finished at the processor.
    pending: 'cancelled',
    created: 'cancelled',
};
function settledFrom(answer) {
    if (!answer)
        return { state: 'error', reason: 'not_found' };
    const state = STATES[answer.status];
    return state ? { state, purpose: answer.purpose, ref: answer.ref } : { state: 'error', reason: 'request_failed', error: new Error(`Unknown checkout status ${answer.status}.`) };
}
/**
 * The payment the address came back with: Stripe's session_id (a hosted Checkout) or payment_intent
 * (a Payment Element, such as StripeRetryPayment's, after a redirect), or PayPal's token. Null: none.
 * Check it before loading anything for the page's form, and show the return instead: a form that
 * refuses a payment already paid would otherwise show that refusal to a payer who just paid.
 */
export function checkoutReturnToken(search) {
    const params = typeof search === 'string' ? new URLSearchParams(search) : search;
    const stripe = params.get('session_id') || params.get('payment_intent');
    if (stripe)
        return { processor: 'stripe', token: stripe };
    const paypal = params.get('token');
    return paypal ? { processor: 'paypal', token: paypal } : null;
}
/**
 * Calls in flight, by processor and token, shared by every mount: React StrictMode runs effects twice
 * and a page may mount twice, and each call counts against the token's rate limit. Dropped once
 * answered, so a later visit asks again, as a reload would; the library is safe to ask again.
 */
const inFlight = new Map();
/**
 * Asks the app's `completeReturn` (from payments.publicApi()) once how this payment stands, settling
 * it with the processor if its webhook hasn't arrived. `token` null or empty: the address had none.
 */
export function useCheckoutReturn(completeReturn, { processor, token }) {
    const run = useAction(completeReturn);
    const key = token ? `${processor}:${token}` : null;
    const [attempt, setAttempt] = useState(0);
    const [done, setDone] = useState(null);
    // What this mount has asked, so an effect run again for another reason (a new `run`) doesn't ask twice.
    const asked = useRef(null);
    useEffect(() => {
        if (!key || !token)
            return undefined;
        const id = `${key}#${attempt}`;
        let call = inFlight.get(key);
        if (!call) {
            if (asked.current === id)
                return undefined;
            call = run({ processor, token });
            inFlight.set(key, call);
            const mine = call;
            const drop = () => {
                if (inFlight.get(key) === mine)
                    inFlight.delete(key);
            };
            mine.then(drop, drop);
        }
        asked.current = id;
        let live = true;
        call.then((answer) => live && setDone({ key, attempt, result: settledFrom(answer) }), (error) => live && setDone({ key, attempt, result: { state: 'error', reason: 'request_failed', error } }));
        return () => {
            live = false;
        };
    }, [key, token, processor, attempt, run]);
    const retry = useCallback(() => setAttempt((n) => n + 1), []);
    if (!key)
        return { state: 'error', reason: 'no_token', retry };
    if (!done || done.key !== key || done.attempt !== attempt)
        return { state: 'checking', retry };
    return { ...done.result, retry };
}
//# sourceMappingURL=useCheckoutReturn.js.map