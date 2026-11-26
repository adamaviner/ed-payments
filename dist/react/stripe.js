import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { SAVED_METHOD_OPTIONS, SAVED_METHOD_TYPES, stripeMethodType } from '../core/savedMethods.js';
import { loadScript, STRIPE_JS, useSlow } from './embedded.js';
import { errorMessage } from './errors.js';
import { useLatest, useOneAtATime } from './hooks.js';
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
    return { mode: 'setup', currency: 'usd', setupFutureUsage: 'off_session', allowedPaymentMethodTypes: types, paymentMethodOptions: optionsFor(types), appearance };
}
/** For paying amountCents on the page, the same as the PaymentIntent payments.retryOnSession makes: a card or a bank account. */
export function retryPaymentElementsOptions(amountCents, appearance) {
    const types = [...SAVED_METHOD_TYPES];
    return { mode: 'payment', currency: 'usd', amount: amountCents, allowedPaymentMethodTypes: types, paymentMethodOptions: optionsFor(types), appearance };
}
/**
 * For a new payment of amountCents made at the press (payments.start or startScheduleCheckout with ui 'onPage'): the
 * same as the PaymentIntent the library makes for it, a card or a bank account, saved for later on a schedule's first payment.
 */
export function onPagePaymentElementsOptions(amountCents, o = {}, appearance) {
    const types = o.methods?.length ? o.methods.map(stripeMethodType) : [...SAVED_METHOD_TYPES];
    const options = { mode: 'payment', currency: 'usd', amount: amountCents, allowedPaymentMethodTypes: types, paymentMethodOptions: optionsFor(types), appearance };
    return o.saveForLater ? { ...options, setupFutureUsage: 'off_session' } : options;
}
/** Card first, then the bank account (SAVED_METHOD_TYPES is in that order). */
const ELEMENT_OPTIONS = { paymentMethodOrder: [...SAVED_METHOD_TYPES] };
/**
 * Loads Stripe.js and mounts a Payment Element in `box` for these options. Changing the options mounts
 * it again; changing only the appearance or the amount updates it in place, keeping what the payer typed, as does
 * changing the methods or setupFutureUsage when `inPlace` (a new payment's form, whose intent isn't made yet): held
 * while `hold` (a press under way, so the form stays what the intent is made for), mounted again if Stripe.js refuses
 * it, and `updated()` waits for one Stripe is still applying. A
 * payment form waits for an amount Stripe takes (a whole number of cents above zero) before it mounts, and an amount
 * that isn't one later leaves the form at the last one; `amountOk` says whether the current one is.
 */
function usePaymentElement(publishableKey, { amount, ...options }, appearance, onChange, element = ELEMENT_OPTIONS, inPlace = false, hold = false) {
    const box = useRef(null);
    const form = useRef(null);
    // Set as soon as they are made, so a new appearance reaches a form still loading.
    const elementsNow = useRef(null);
    const [load, setLoad] = useState('loading');
    useSlow(load, setLoad);
    // Strings, so objects made fresh on every render don't mount the element again.
    const { setupFutureUsage, allowedPaymentMethodTypes, paymentMethodOptions, ...fixed } = options;
    const changing = { setupFutureUsage: setupFutureUsage ?? null, allowedPaymentMethodTypes, paymentMethodOptions };
    // A change Stripe.js refused to make in place is part of the key, so the form is made again with it.
    const [refusedChange, setRefusedChange] = useState(null);
    const optionsKey = JSON.stringify({ mount: inPlace ? fixed : options, refusedChange });
    const changingKey = JSON.stringify(inPlace ? changing : null);
    const elementKey = JSON.stringify(element);
    const appearanceKey = JSON.stringify(appearance ?? {});
    const amountOk = amount === undefined || (Number.isInteger(amount) && amount > 0);
    const [lastAmount, setLastAmount] = useState(amount);
    if (amountOk && amount !== lastAmount)
        setLastAmount(amount);
    // Once there has been an amount, the form stays mounted through a moment without one (a field being retyped).
    const [mountable, setMountable] = useState(amountOk);
    if (amountOk && !mountable)
        setMountable(true);
    const latest = useLatest({ appearanceKey, lastAmount, onChange, changing });
    // The settings a form was mounted with or last updated to, so the update effect leaves a new form alone.
    const shown = useRef(null);
    const updating = useRef(null);
    useEffect(() => {
        void elementsNow.current?.update({ appearance: JSON.parse(appearanceKey) });
    }, [appearanceKey]);
    useEffect(() => {
        if (amount !== undefined && amountOk)
            void elementsNow.current?.update({ amount });
    }, [amount, amountOk]);
    useEffect(() => {
        const elements = elementsNow.current;
        if (hold || !elements || changingKey === 'null' || shown.current === null || shown.current === changingKey)
            return;
        shown.current = changingKey;
        const refused = (err) => {
            console.error('payments: Stripe’s payment form couldn’t change in place, so it is made again:', err);
            if (elementsNow.current === elements)
                setRefusedChange(changingKey);
        };
        try {
            updating.current = Promise.resolve(elements.update(JSON.parse(changingKey))).catch(refused);
        }
        catch (err) {
            refused(err);
        }
    }, [changingKey, hold]);
    useEffect(() => {
        if (!mountable)
            return undefined;
        let live = true;
        let element = null;
        const failed = (err) => {
            console.error('payments: Stripe’s payment form didn’t load:', err);
            if (live)
                setLoad('failed');
        };
        loadScript(STRIPE_JS, 'Stripe').then(() => {
            const make = stripeJs();
            if (!live || !box.current)
                return;
            if (!make)
                return failed(new Error('Stripe.js loaded without Stripe.'));
            try {
                const stripe = make(publishableKey);
                const { lastAmount: amountNow, appearanceKey: appearanceNow, changing: changingNow } = latest.current;
                const { setupFutureUsage: saveNow, ...typesNow } = changingNow;
                const elements = stripe.elements({
                    ...JSON.parse(optionsKey).mount,
                    ...(inPlace ? { ...typesNow, ...(saveNow ? { setupFutureUsage: saveNow } : {}) } : {}),
                    ...(amountNow === undefined ? {} : { amount: amountNow }),
                    appearance: JSON.parse(appearanceNow),
                });
                elementsNow.current = elements;
                if (inPlace)
                    shown.current = JSON.stringify(changingNow);
                const made = elements.create('payment', JSON.parse(elementKey));
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
    }, [publishableKey, optionsKey, elementKey, latest, mountable, inPlace]);
    const updated = () => updating.current;
    return { box, form, load, amountOk, updated };
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
    const { busy, run } = useOneAtATime();
    const [error, setError] = useState(null);
    // A method Stripe saved whose onSaved threw: used again rather than saving another, until the fields change.
    const saved = useRef(null);
    const { box, form, load } = usePaymentElement(publishableKey, saveMethodElementsOptions(methods), appearance, () => (saved.current = null));
    const latest = useLatest({ createSetupIntent, onSaved });
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
    const submit = () => run(async () => {
        const f = form.current;
        if (!f)
            return;
        setError(null);
        try {
            saved.current ??= await saveMethod(f);
            await latest.current.onSaved(saved.current);
        }
        catch (err) {
            setError(err instanceof Refused ? err.message : errorMessage(err, 'The payment method couldn’t be saved. Please try again.'));
        }
    });
    return (_jsxs("div", { className: cn('flex flex-col gap-2', className), children: [_jsx(LoadNote, { load: load }), _jsx("div", { ref: box }), note && _jsx("p", { className: "text-xs text-muted-foreground", children: note }), _jsx(ErrorNote, { error: error }), _jsx(Button, { variant: "default", className: "h-9", disabled: disabled || busy || load !== 'ready', onClick: () => void submit(), children: busy ? 'Saving…' : submitLabel })] }));
}
const outcomeOf = (pi) => (pi?.status === 'succeeded' || pi?.status === 'processing' ? pi.status : null);
/** Stripe's Payment Element and one button that pays a declined charge on the page (payments.retryOnSession). */
export function StripeRetryPayment({ publishableKey, amountCents, createPayment, onPaid, submitLabel, disabled, note, appearance, returnUrl, className }) {
    const { busy, run } = useOneAtATime();
    // A ref as well as state: a second press in the same tick must not pay again.
    const paidRef = useRef(false);
    const [paid, setPaid] = useState(false);
    const [error, setError] = useState(null);
    const { box, form, load } = usePaymentElement(publishableKey, retryPaymentElementsOptions(amountCents), appearance, () => { });
    const latest = useLatest({ createPayment, onPaid });
    const settle = (pi) => {
        const outcome = outcomeOf(pi) ?? refused(undefined, 'The payment didn’t go through. Please try again.');
        paidRef.current = true;
        setPaid(true);
        latest.current.onPaid(outcome);
    };
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
    const submit = () => run(async () => {
        const f = form.current;
        if (!f || paidRef.current)
            return;
        setError(null);
        try {
            await pay(f);
        }
        catch (err) {
            setError(err instanceof Refused ? err.message : errorMessage(err, 'The payment couldn’t be started. Please try again.'));
        }
    });
    return (_jsxs("div", { className: cn('flex flex-col gap-2', className), children: [_jsx(LoadNote, { load: load }), _jsx("div", { ref: box }), note && _jsx("p", { className: "text-xs text-muted-foreground", children: note }), _jsx(ErrorNote, { error: error }), _jsx(Button, { variant: "default", className: "h-9", disabled: disabled || busy || paid || load !== 'ready', onClick: () => void submit(), children: busy ? 'Paying…' : submitLabel })] }));
}
/** Stripe's return address with the PaymentIntent added, as Stripe adds it after a redirect, so one return page serves both. */
const withPaymentIntent = (returnUrl, pi) => {
    if (!pi?.id)
        return returnUrl;
    const url = new URL(returnUrl, window.location.href);
    url.searchParams.set('payment_intent', pi.id);
    return url.toString();
};
/** Said when the app's start made the payment for the other processor's fields (the app's choice changed under the form). */
export const WRONG_PROCESSOR = 'This payment can’t be paid here. Reload the page and try again.';
const PAYER_FIELDS = { ...ELEMENT_OPTIONS, fields: { billingDetails: { name: 'never', email: 'never' } } };
/**
 * Stripe's Payment Element for a new payment on the app's own page, with one button. Nothing is made at Stripe until
 * the press: then the fields are checked, the app's start makes the PaymentIntent, and Stripe confirms it here (a
 * card's security check on the page). A decline is said under the fields, and the next press starts again.
 */
export function StripeOnPagePayment({ publishableKey, amountCents, methods, saveForLater, payer, start, submitLabel, navigate, disabled, note, appearance, className }) {
    const { busy, run } = useOneAtATime();
    const paidRef = useRef(false);
    const [paid, setPaid] = useState(false);
    const [error, setError] = useState(null);
    const { box, form, load, amountOk, updated } = usePaymentElement(publishableKey, onPagePaymentElementsOptions(amountCents, { saveForLater, methods }), appearance, () => { }, payer ? PAYER_FIELDS : ELEMENT_OPTIONS, true, busy);
    const latest = useLatest({ start, payer, navigate });
    const pay = async ({ stripe, elements }) => {
        await updated();
        const checked = await elements.submit();
        if (checked.error)
            refused(checked.error, 'Check the payment details.');
        const onPage = await latest.current.start();
        if (onPage.processor !== 'stripe')
            throw new Error(WRONG_PROCESSOR);
        const { payer: billing } = latest.current;
        const { error: stripeError, paymentIntent } = await stripe.confirmPayment({
            elements,
            clientSecret: onPage.clientSecret,
            redirect: 'if_required',
            confirmParams: { return_url: onPage.returnUrl, ...(billing ? { payment_method_data: { billing_details: { name: billing.name, email: billing.email } } } : {}) },
        });
        if (stripeError)
            refused(stripeError, 'The payment didn’t go through. Please try again.');
        if (!outcomeOf(paymentIntent))
            refused(undefined, 'The payment didn’t go through. Please try again.');
        paidRef.current = true;
        setPaid(true);
        (latest.current.navigate ?? ((u) => window.location.assign(u)))(withPaymentIntent(onPage.returnUrl, paymentIntent));
    };
    const submit = () => run(async () => {
        const f = form.current;
        if (!f || paidRef.current || !amountOk)
            return;
        setError(null);
        try {
            await pay(f);
        }
        catch (err) {
            setError(err instanceof Refused ? err.message : errorMessage(err, 'The payment couldn’t be started. Please try again.'));
        }
    });
    return (_jsxs("div", { className: cn('flex flex-col gap-2', className), children: [_jsx(LoadNote, { load: load }), _jsx("div", { ref: box }), note && _jsx("p", { className: "text-xs text-muted-foreground", children: note }), _jsx(ErrorNote, { error: error }), _jsx(Button, { variant: "default", className: "h-9", disabled: disabled || busy || paid || !amountOk || load !== 'ready', onClick: () => void submit(), children: busy ? 'Paying…' : submitLabel })] }));
}
const subscribeToHistory = (changed) => {
    window.addEventListener('popstate', changed);
    return () => window.removeEventListener('popstate', changed);
};
const setupSecretIn = (search) => new URLSearchParams(search).get('setup_intent_client_secret');
const setupAnswer = (si) => {
    const paymentMethodId = methodIdOf(si);
    if (si?.status === 'succeeded' && paymentMethodId)
        return { state: 'saved', paymentMethodId };
    if (si?.status === 'processing')
        return { state: 'processing' };
    return si ? { state: 'failed' } : { state: 'unknown' };
};
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
export function useStripeSetupReturn(publishableKey, search) {
    const addressSearch = useSyncExternalStore(subscribeToHistory, () => window.location.search, () => '');
    const secret = setupSecretIn(search ?? addressSearch);
    const [answered, setAnswered] = useState(null);
    useEffect(() => {
        if (!secret)
            return undefined;
        let live = true;
        const settle = (answer) => live && setAnswered({ secret, answer });
        const ask = async () => {
            await loadScript(STRIPE_JS, 'Stripe');
            const make = stripeJs();
            if (!make)
                return settle({ state: 'unknown' });
            const { error, setupIntent } = await make(publishableKey).retrieveSetupIntent(secret);
            settle(error ? { state: 'unknown' } : setupAnswer(setupIntent));
        };
        ask().catch(() => settle({ state: 'unknown' }));
        return () => {
            live = false;
        };
    }, [secret, publishableKey]);
    if (!secret)
        return { state: 'none' };
    return answered?.secret === secret ? answered.answer : { state: 'checking' };
}
//# sourceMappingURL=stripe.js.map