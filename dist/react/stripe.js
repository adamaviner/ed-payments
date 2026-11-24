import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
import { useEffect, useRef, useState } from 'react';
import { SAVED_METHOD_OPTIONS, SAVED_METHOD_TYPES, stripeMethodType } from '../core/savedMethods.js';
import { loadScript, STRIPE_JS, useSlow } from './embedded.js';
import { errorMessage } from './errors.js';
import { Button, cn, ErrorNote } from './ui.js';
const stripeJs = () => window.Stripe;
/** The method options for these types only, e.g. none for a card alone. */
const optionsFor = (types) => Object.fromEntries(Object.entries(SAVED_METHOD_OPTIONS).filter(([type]) => types.includes(type)));
/**
 * For saving a method of these kinds (all of them when empty), the same as the SetupIntent
 * payments.setupPaymentMethod makes for them: usage off_session, bank accounts verified at once.
 */
export function saveMethodElementsOptions(methods, appearance) {
    const types = methods.length ? methods.map(stripeMethodType) : [...SAVED_METHOD_TYPES];
    return { mode: 'setup', currency: 'usd', setupFutureUsage: 'off_session', paymentMethodTypes: types, paymentMethodOptions: optionsFor(types), appearance };
}
/** For paying amountCents on the page, the same as the PaymentIntent payments.retryOnSession makes: a card or a bank account. */
export function retryPaymentElementsOptions(amountCents, appearance) {
    const types = [...SAVED_METHOD_TYPES];
    return { mode: 'payment', currency: 'usd', amount: amountCents, paymentMethodTypes: types, paymentMethodOptions: optionsFor(types), appearance };
}
/** Card first, then the bank account (SAVED_METHOD_TYPES is in that order). */
const ELEMENT_OPTIONS = { paymentMethodOrder: [...SAVED_METHOD_TYPES] };
/**
 * Loads Stripe.js and mounts a Payment Element in `box` for these options. Changing the options mounts
 * it again; changing only the appearance restyles it in place, keeping what the payer typed.
 */
function usePaymentElement(publishableKey, options, appearance, onChange) {
    const box = useRef(null);
    const form = useRef(null);
    // Set as soon as they are made, so a new appearance reaches a form still loading.
    const elementsNow = useRef(null);
    const [load, setLoad] = useState('loading');
    useSlow(load, setLoad);
    // Strings, so objects made fresh on every render don't mount the element again.
    const optionsKey = JSON.stringify(options);
    const appearanceKey = JSON.stringify(appearance ?? {});
    const latest = useRef({ appearanceKey, onChange });
    useEffect(() => {
        latest.current = { appearanceKey, onChange };
    }, [appearanceKey, onChange]);
    useEffect(() => {
        elementsNow.current?.update({ appearance: JSON.parse(appearanceKey) });
    }, [appearanceKey]);
    useEffect(() => {
        let live = true;
        let element = null;
        const failed = (err) => {
            console.error('payments: Stripe’s payment form didn’t load:', err);
            if (live)
                setLoad('failed');
        };
        loadScript(STRIPE_JS).then(() => {
            const make = stripeJs();
            if (!live || !box.current)
                return;
            if (!make)
                return failed(new Error('Stripe.js loaded without Stripe.'));
            try {
                const stripe = make(publishableKey);
                const elements = stripe.elements({ ...JSON.parse(optionsKey), appearance: JSON.parse(latest.current.appearanceKey) });
                elementsNow.current = elements;
                const made = elements.create('payment', ELEMENT_OPTIONS);
                element = made;
                made.on('ready', () => {
                    if (!live)
                        return;
                    form.current = { stripe, elements };
                    setLoad('ready');
                });
                made.on('change', () => latest.current.onChange());
                made.on('loaderror', (e) => failed(e.error?.message ?? e));
                made.mount(box.current);
            }
            catch (err) {
                failed(err);
            }
        }, failed);
        return () => {
            live = false;
            form.current = null;
            elementsNow.current = null;
            element?.destroy();
        };
    }, [publishableKey, optionsKey]);
    return { box, form, load };
}
/** Loading and failure notes over the element, as PaypalCardFields has. */
function LoadNote({ load }) {
    if (load === 'failed')
        return _jsx(ErrorNote, { error: "The payment form didn\u2019t load. Reload the page, or use another way to pay." });
    if (load === 'ready')
        return null;
    return _jsx("p", { className: "text-sm text-muted-foreground", children: "Loading the payment form\u2026" });
}
/** Stripe's message for a problem it reports, else `fallback`. */
class Refused extends Error {
}
const refused = (error, fallback) => {
    throw new Refused(error?.message || fallback);
};
const methodIdOf = (si) => (typeof si?.payment_method === 'string' ? si.payment_method : (si?.payment_method?.id ?? null));
/** Where Stripe sends the payer back if a method needs a redirect (cards and instant bank verification don't). */
const returnTo = (returnUrl) => returnUrl ?? window.location.href;
/** Stripe's Payment Element (card or bank account) and one button that saves the method, then calls onSaved. */
export function StripeSaveMethod({ publishableKey, methods = [], createSetupIntent, onSaved, submitLabel, disabled, note, appearance, returnUrl, className }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    // A method Stripe saved whose onSaved threw: used again rather than saving another, until the fields change.
    const saved = useRef(null);
    const { box, form, load } = usePaymentElement(publishableKey, saveMethodElementsOptions(methods), appearance, () => (saved.current = null));
    const latest = useRef({ createSetupIntent, onSaved });
    useEffect(() => {
        latest.current = { createSetupIntent, onSaved };
    }, [createSetupIntent, onSaved]);
    /** Checks the fields, then the SetupIntent, then Stripe confirms it (a bank login or 3-D Secure if needed). */
    const saveMethod = async ({ stripe, elements }) => {
        const checked = await elements.submit();
        if (checked.error)
            refused(checked.error, 'Check the payment details.');
        const clientSecret = await latest.current.createSetupIntent();
        const { error: stripeError, setupIntent } = await stripe.confirmSetup({ elements, clientSecret, redirect: 'if_required', confirmParams: { return_url: returnTo(returnUrl) } });
        if (stripeError)
            refused(stripeError, 'Stripe couldn’t save it. Check the details and try again.');
        return methodIdOf(setupIntent) ?? refused(undefined, 'Stripe didn’t save the payment method. Please try again.');
    };
    const submit = async () => {
        if (!form.current || busy)
            return;
        setBusy(true);
        setError(null);
        try {
            saved.current ??= await saveMethod(form.current);
            await latest.current.onSaved(saved.current);
        }
        catch (err) {
            setError(err instanceof Refused ? err.message : errorMessage(err, 'The payment method couldn’t be saved. Please try again.'));
        }
        finally {
            setBusy(false);
        }
    };
    return (_jsxs("div", { className: cn('flex flex-col gap-2', className), children: [_jsx(LoadNote, { load: load }), _jsx("div", { ref: box }), note && _jsx("p", { className: "text-xs text-muted-foreground", children: note }), _jsx(ErrorNote, { error: error }), _jsx(Button, { variant: "default", className: "h-9", disabled: disabled || busy || load !== 'ready', onClick: () => void submit(), children: busy ? 'Saving…' : submitLabel })] }));
}
const outcomeOf = (pi) => (pi?.status === 'succeeded' || pi?.status === 'processing' ? pi.status : null);
/** Stripe's Payment Element and one button that pays a declined charge on the page (payments.retryOnSession). */
export function StripeRetryPayment({ publishableKey, amountCents, createPayment, onPaid, submitLabel, disabled, note, appearance, returnUrl, className }) {
    const [busy, setBusy] = useState(false);
    const [paid, setPaid] = useState(false);
    const [error, setError] = useState(null);
    const { box, form, load } = usePaymentElement(publishableKey, retryPaymentElementsOptions(amountCents), appearance, () => { });
    const latest = useRef({ createPayment, onPaid });
    useEffect(() => {
        latest.current = { createPayment, onPaid };
    }, [createPayment, onPaid]);
    const settle = (pi) => {
        const outcome = outcomeOf(pi) ?? refused(undefined, 'The payment didn’t go through. Please try again.');
        setPaid(true);
        latest.current.onPaid(outcome);
    };
    // Back from a redirect: Stripe added the PaymentIntent's client secret to the address.
    const askedBack = useRef(false);
    useEffect(() => {
        const secret = new URLSearchParams(window.location.search).get('payment_intent_client_secret');
        if (load !== 'ready' || !form.current || !secret || askedBack.current)
            return;
        askedBack.current = true;
        form.current.stripe.retrievePaymentIntent(secret).then(({ paymentIntent }) => {
            const outcome = outcomeOf(paymentIntent);
            if (!outcome)
                return setError('The payment didn’t go through. Please try again.');
            setPaid(true);
            latest.current.onPaid(outcome);
        }, () => setError('Stripe couldn’t say how the payment went. Reload the page to check.'));
    }, [load, form]);
    const pay = async ({ stripe, elements }) => {
        const checked = await elements.submit();
        if (checked.error)
            refused(checked.error, 'Check the payment details.');
        const clientSecret = await latest.current.createPayment();
        const { error: stripeError, paymentIntent } = await stripe.confirmPayment({ elements, clientSecret, redirect: 'if_required', confirmParams: { return_url: returnTo(returnUrl) } });
        if (stripeError)
            refused(stripeError, 'The payment didn’t go through. Please try again.');
        settle(paymentIntent);
    };
    const submit = async () => {
        if (!form.current || busy || paid)
            return;
        setBusy(true);
        setError(null);
        try {
            await pay(form.current);
        }
        catch (err) {
            setError(err instanceof Refused ? err.message : errorMessage(err, 'The payment couldn’t be started. Please try again.'));
        }
        finally {
            setBusy(false);
        }
    };
    return (_jsxs("div", { className: cn('flex flex-col gap-2', className), children: [_jsx(LoadNote, { load: load }), _jsx("div", { ref: box }), note && _jsx("p", { className: "text-xs text-muted-foreground", children: note }), _jsx(ErrorNote, { error: error }), _jsx(Button, { variant: "default", className: "h-9", disabled: disabled || busy || paid || load !== 'ready', onClick: () => void submit(), children: busy ? 'Paying…' : submitLabel })] }));
}
//# sourceMappingURL=stripe.js.map