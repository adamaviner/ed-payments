import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
// The payment itself on the app's own page, instead of sending the buyer to PayPal's or Stripe's:
// PayPal's buttons (its JS SDK) and Stripe's embedded Checkout (Stripe.js). Both pay a checkout the
// app started with `payments.start(ctx, { ..., ui: 'embedded' })`, whose `embedded` is passed here,
// and both end on the app's return page, as a redirect would. The processors' scripts are loaded from
// their own sites, as both require. If a script doesn't load (an ad blocker, a bad connection), the
// buyer is offered `onFallback`: the app starts the same payment as a redirect.
import { useAction } from 'convex/react';
import { useEffect, useRef, useState } from 'react';
import { useLatest } from './hooks.js';
import { Button, cn, ErrorNote } from './ui.js';
/** Stripe.js for the API version the library calls (2026-10-28.endive); Stripe versions its script by name. */
export const STRIPE_JS = 'https://js.stripe.com/endive/stripe.js';
/** How long a processor's script may take before the buyer is offered the redirect. */
const SLOW_MS = 8000;
/**
 * How long a script or Stripe's embedded Checkout may take before it is given up as failed, so one
 * that never answers can't hold up the next (a reload isn't needed to try again).
 */
export const GIVE_UP_MS = 30_000;
/** PayPal's JS SDK for one REST app: buttons only, card and PayPal, no Venmo or Pay Later. */
export function paypalSdkUrl(clientId) {
    return `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture&components=buttons&disable-funding=venmo,paylater`;
}
const loading = new Map();
/** @internal For tests: forget every script loaded so far, and the embedded Checkout. */
export function forgetScripts() {
    loading.clear();
    lastStripePage = Promise.resolve(null);
}
/**
 * Loads a script once per address (every mount shares it); resolves once it has run and set `global`
 * on window. A failed load, one with no answer after GIVE_UP_MS, or one that ran without setting
 * `global` (a blocker that stubs the script out) is forgotten, so a later mount tries again.
 */
export function loadScript(src, global, attributes = {}) {
    const known = loading.get(src);
    if (known)
        return known;
    const p = new Promise((resolve, reject) => {
        const el = document.createElement('script');
        for (const [name, value] of Object.entries(attributes))
            el.setAttribute(name, value);
        const fail = (why = `Couldn’t load ${new URL(src).host}.`) => {
            clearTimeout(timer);
            if (loading.get(src) === p)
                loading.delete(src);
            el.remove();
            reject(new Error(why));
        };
        const timer = setTimeout(fail, GIVE_UP_MS);
        el.src = src;
        el.async = true;
        el.addEventListener('load', () => {
            if (!(global in window))
                return fail(`${new URL(src).host} loaded without ${global}.`);
            clearTimeout(timer);
            resolve();
        });
        el.addEventListener('error', () => fail());
        document.head.appendChild(el);
    });
    loading.set(src, p);
    return p;
}
const globals = () => window;
/** The page's embedded Checkout, made or being made (null: none). */
let lastStripePage = Promise.resolve(null);
const destroyed = new WeakSet();
/** Destroys an embedded Checkout once; Stripe may throw for a second destroy. */
function destroyPage(page) {
    if (!page || destroyed.has(page))
        return;
    destroyed.add(page);
    try {
        page.destroy?.();
    }
    catch {
        // Already gone.
    }
}
/** "Having trouble?" with the redirect, shown when the script is slow or failed. */
function Fallback({ load, site, onFallback }) {
    if (!onFallback || (load !== 'slow' && load !== 'failed'))
        return null;
    return (_jsxs("p", { className: "flex flex-wrap items-center gap-2 text-sm text-muted-foreground", children: [load === 'failed' ? `The payment form didn’t load.` : 'Having trouble?', _jsxs(Button, { variant: "outline", onClick: onFallback, children: ["Pay on ", site, " instead"] })] }));
}
/** Marks the load slow after SLOW_MS unless it settled first. */
export function useSlow(load, setLoad) {
    useEffect(() => {
        if (load !== 'loading')
            return undefined;
        const t = setTimeout(() => setLoad('slow'), SLOW_MS);
        return () => clearTimeout(t);
    }, [load, setLoad]);
}
/**
 * PayPal's buttons for an embedded PayPal checkout: the PayPal button and "Debit or Credit Card"
 * (which opens PayPal's card form in the page). On approval the payment is captured at once; if
 * PayPal declines the card, the buyer is told and the buttons let them choose again. Then the buyer
 * goes to the return page with PayPal's token, which shows the outcome as after a redirect.
 */
export function PaypalButtons({ payment, completeReturn, onFallback, navigate, className }) {
    const capture = useAction(completeReturn);
    const box = useRef(null);
    const [load, setLoad] = useState('loading');
    const [note, setNote] = useState(null);
    useSlow(load, setLoad);
    const latest = useLatest({ capture, navigate });
    const { orderId, clientId, returnUrl, only } = payment;
    useEffect(() => {
        let live = true;
        let buttons = null;
        const go = (url) => (latest.current.navigate ?? ((u) => window.location.assign(u)))(url);
        loadScript(paypalSdkUrl(clientId), 'paypal').then(() => {
            const sdk = globals().paypal;
            if (!live || !box.current)
                return;
            if (!sdk)
                return setLoad('failed');
            buttons = sdk.Buttons({
                // An order that saves a PayPal account for a schedule names its payment_source: only PayPal's own button can pay it.
                ...(only === 'paypal' ? { fundingSource: sdk.FUNDING?.PAYPAL ?? 'paypal' } : {}),
                style: { layout: 'vertical', shape: 'rect', color: 'gold', label: 'paypal' },
                createOrder: () => Promise.resolve(orderId),
                onApprove: async (data, actions) => {
                    setNote(null);
                    let declined = false;
                    try {
                        declined = !!(await latest.current.capture({ processor: 'paypal', token: data.orderID }))?.declined;
                    }
                    catch {
                        // The return page asks again and says how it stands.
                    }
                    if (declined && actions.restart) {
                        setNote('PayPal couldn’t take that payment. Try another card or way to pay.');
                        return await actions.restart();
                    }
                    go(returnUrl);
                },
                onCancel: () => setNote(null),
                onError: () => setNote('PayPal had a problem just now. Try again, or choose another way to pay.'),
            });
            buttons.render(box.current).then(() => live && setLoad('ready'), () => live && setLoad('failed'));
        }, () => live && setLoad('failed'));
        return () => {
            live = false;
            void buttons?.close?.().catch(() => { });
        };
    }, [orderId, clientId, returnUrl, only, latest]);
    return (_jsxs("div", { className: cn('flex flex-col gap-3', className), children: [load !== 'ready' && load !== 'failed' && _jsx("p", { className: "text-sm text-muted-foreground", children: "Loading PayPal\u2026" }), _jsx("div", { ref: box }), _jsx(ErrorNote, { error: note }), _jsx(Fallback, { load: load, site: "PayPal\u2019s site", onFallback: onFallback })] }));
}
/**
 * Stripe's embedded Checkout for an embedded Stripe checkout (a card or a bank account, whichever the
 * checkout was started for). Stripe sends the buyer to the return page when they have paid.
 */
export function StripeEmbeddedCheckout({ payment, publishableKey, onFallback, className }) {
    const box = useRef(null);
    const [load, setLoad] = useState('loading');
    useSlow(load, setLoad);
    // A test key with a live session (or the other way round) can't work; say so instead of a blank box.
    const mismatch = publishableKey.startsWith('pk_live_') !== payment.clientSecret.startsWith('cs_live_');
    const { clientSecret } = payment;
    useEffect(() => {
        if (mismatch)
            return undefined;
        let live = true;
        // Stripe allows one embedded Checkout per page and refuses a second while one exists, so each
        // waits for the one before it to be made and destroys it first (StrictMode mounts twice at once).
        const making = lastStripePage.then(async (before) => {
            destroyPage(before);
            await loadScript(STRIPE_JS, 'Stripe');
            const make = globals().Stripe;
            if (!make)
                throw new Error('Stripe.js loaded without Stripe.');
            if (!live)
                return null;
            return await make(publishableKey).createEmbeddedCheckoutPage({ fetchClientSecret: () => Promise.resolve(clientSecret) });
        });
        // Given up after GIVE_UP_MS, so a Stripe.js that never answers doesn't hold up the next one; a
        // page that turns up after that is destroyed at once, leaving the page free for another.
        const made = new Promise((resolve, reject) => {
            let gaveUp = false;
            const timer = setTimeout(() => {
                gaveUp = true;
                reject(new Error(`Stripe’s embedded Checkout didn’t answer in ${GIVE_UP_MS / 1000} seconds.`));
            }, GIVE_UP_MS);
            making.then((page) => {
                clearTimeout(timer);
                if (gaveUp)
                    destroyPage(page);
                else
                    resolve(page);
            }, (err) => {
                clearTimeout(timer);
                reject(err);
            });
        });
        lastStripePage = made.catch(() => null);
        made.then((page) => {
            if (!page)
                return;
            if (!live || !box.current)
                return destroyPage(page);
            page.mount(box.current);
            setLoad('ready');
        }, (err) => {
            console.error('payments: Stripe’s embedded Checkout didn’t load:', err);
            if (live)
                setLoad('failed');
        });
        return () => {
            live = false;
            void made.then(destroyPage, () => { });
        };
    }, [clientSecret, publishableKey, mismatch]);
    if (mismatch)
        return _jsx(ErrorNote, { error: "This payment can\u2019t be shown: the app\u2019s Stripe keys are from different modes (test and live).", className: className });
    return (_jsxs("div", { className: cn('flex flex-col gap-3', className), children: [load !== 'ready' && load !== 'failed' && _jsx("p", { className: "text-sm text-muted-foreground", children: "Loading the payment form\u2026" }), _jsx("div", { ref: box }), _jsx(Fallback, { load: load, site: "Stripe\u2019s site", onFallback: onFallback })] }));
}
//# sourceMappingURL=embedded.js.map