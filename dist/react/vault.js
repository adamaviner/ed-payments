import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Saving a card or PayPal account in PayPal's vault from the app's own page, to be charged later with
// nobody present (payments.setupPaypalMethod, then payments.savePaypalMethod). PayPal's Card Fields
// take the card in PayPal's own frames, so the number never reaches the app; PayPal checks it ($0
// authorization, 3-D Secure in a PayPal window only when the bank asks). PayPal's button opens
// PayPal, where the buyer agrees to be charged later. Both hand the approved setup token to onSaved.
//
// The SDK is loaded under its own namespace (window.paypalVault), so it never replaces the checkout
// buttons' SDK (window.paypal, loaded with intent=capture) on a page that shows both.
import { useEffect, useRef, useState } from 'react';
import { loadScript, useSlow } from './embedded.js';
import { useAction } from 'convex/react';
import { Button, cn, ErrorNote } from './ui.js';
export const PAYPAL_VAULT_NAMESPACE = 'paypalVault';
/** PayPal's JS SDK for saving: Card Fields and the PayPal button, no Venmo or Pay Later. */
export function paypalVaultSdkUrl(clientId) {
    return `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&components=card-fields,buttons&disable-funding=venmo,paylater`;
}
const vaultSdk = () => window[PAYPAL_VAULT_NAMESPACE];
const loadVaultSdk = (clientId) => loadScript(paypalVaultSdkUrl(clientId), { 'data-namespace': PAYPAL_VAULT_NAMESPACE });
const messageOf = (err) => (err instanceof Error ? err.message : typeof err === 'string' ? err : null);
/** PayPal's own errors are codes (INVALID_NUMBER, UPDATE_VAULT_SETUP_TOKEN_CONTINGENCY, …), not words for a payer. */
const CARD_REFUSED = 'PayPal couldn’t check that card. Check the number, expiry date and security code, or use another card.';
/** Field styling inside PayPal's frames, close to the package's own inputs. */
const FIELD_STYLE = {
    input: { 'font-size': '14px', padding: '6px 8px' },
    '.invalid': { color: '#dc2626' },
};
/** The app's style over the defaults, selector by selector. */
const withFieldStyle = (style) => Object.fromEntries([...new Set([...Object.keys(FIELD_STYLE), ...Object.keys(style)])].map((k) => [k, { ...FIELD_STYLE[k], ...style[k] }]));
/** PayPal's card fields (name, number, expiry, CVV) and one button that saves the card, then calls onSaved. */
export function PaypalCardFields({ clientId, createSetupToken, onSaved, submitLabel, disabled, note, style, className }) {
    const nameBox = useRef(null);
    const numberBox = useRef(null);
    const expiryBox = useRef(null);
    const cvvBox = useRef(null);
    const fields = useRef(null);
    // What the app's createSetupToken or onSaved threw (said as it is), in case PayPal reports it to onError instead of rejecting submit().
    const saveError = useRef(null);
    const [load, setLoad] = useState('loading');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    useSlow(load, setLoad);
    const latest = useRef({ createSetupToken, onSaved });
    useEffect(() => {
        latest.current = { createSetupToken, onSaved };
    }, [createSetupToken, onSaved]);
    // A string, so a style object made fresh on every render doesn't render the fields again.
    const styleKey = JSON.stringify(withFieldStyle(style ?? {}));
    useEffect(() => {
        let live = true;
        const rendered = [];
        loadVaultSdk(clientId).then(async () => {
            const sdk = vaultSdk();
            if (!live)
                return;
            if (!sdk)
                return setLoad('failed');
            const cf = sdk.CardFields({
                style: JSON.parse(styleKey),
                createVaultSetupToken: async () => {
                    try {
                        return await latest.current.createSetupToken();
                    }
                    catch (err) {
                        saveError.current = err;
                        throw err;
                    }
                },
                onApprove: async ({ vaultSetupToken }) => {
                    try {
                        await latest.current.onSaved(vaultSetupToken);
                    }
                    catch (err) {
                        saveError.current = err;
                        throw err;
                    }
                },
                onError: (err) => console.error('payments: PayPal card fields:', err),
            });
            if (!cf.isEligible())
                return setLoad('failed');
            const parts = [
                [cf.NameField(), nameBox.current],
                [cf.NumberField(), numberBox.current],
                [cf.ExpiryField(), expiryBox.current],
                [cf.CVVField(), cvvBox.current],
            ];
            try {
                for (const [f, el] of parts) {
                    if (!el)
                        return;
                    rendered.push(f);
                    await f.render(el);
                }
                if (!live)
                    return;
                fields.current = cf;
                setLoad('ready');
            }
            catch {
                if (live)
                    setLoad('failed');
            }
        }, () => live && setLoad('failed'));
        return () => {
            live = false;
            fields.current = null;
            for (const f of rendered)
                void f.close?.().catch(() => { });
        };
    }, [clientId, styleKey]);
    const submit = async () => {
        if (!fields.current || busy)
            return;
        setBusy(true);
        setError(null);
        saveError.current = null;
        try {
            // PayPal calls createVaultSetupToken, checks the card (a 3-D Secure window if the bank wants
            // one), then onApprove, which runs onSaved; a problem anywhere rejects here.
            await fields.current.submit();
            if (saveError.current)
                setError(messageOf(saveError.current) ?? 'The card couldn’t be saved. Please try again.');
        }
        catch (err) {
            // The app's words when it was the app; PayPal's codes mean nothing to a payer, so they go to the console.
            if (!saveError.current)
                console.warn('payments: PayPal card fields refused the card:', err);
            setError(saveError.current ? (messageOf(saveError.current) ?? CARD_REFUSED) : CARD_REFUSED);
        }
        finally {
            setBusy(false);
        }
    };
    const box = 'min-h-9 rounded-md border border-input';
    // The frames' pages don't declare a color scheme, so on a dark page (color-scheme: dark) the browser
    // would paint an opaque light backdrop behind them; matching their scheme keeps them see-through.
    const frameScheme = { colorScheme: 'light' };
    return (_jsxs("div", { className: cn('flex flex-col gap-2', className), children: [load !== 'ready' && load !== 'failed' && _jsx("p", { className: "text-sm text-muted-foreground", children: "Loading the card form\u2026" }), load === 'failed' && _jsx(ErrorNote, { error: "The card form didn\u2019t load. Reload the page, or use another way to pay." }), _jsxs("div", { className: cn('flex flex-col gap-2', load !== 'ready' && 'hidden'), children: [_jsx("div", { ref: nameBox, className: box, style: frameScheme }), _jsx("div", { ref: numberBox, className: box, style: frameScheme }), _jsxs("div", { className: "grid grid-cols-2 gap-2", children: [_jsx("div", { ref: expiryBox, className: box, style: frameScheme }), _jsx("div", { ref: cvvBox, className: box, style: frameScheme })] })] }), note && _jsx("p", { className: "text-xs text-muted-foreground", children: note }), _jsx(ErrorNote, { error: error }), _jsx(Button, { variant: "default", className: "h-9", disabled: disabled || busy || load !== 'ready', onClick: () => void submit(), children: busy ? 'Saving…' : submitLabel })] }));
}
/** PayPal's button: the buyer logs in to PayPal and agrees to be charged later; then onSaved. */
export function PaypalSaveButton({ clientId, createSetupToken, onSaved, disabled, className }) {
    const box = useRef(null);
    const [load, setLoad] = useState('loading');
    const [error, setError] = useState(null);
    useSlow(load, setLoad);
    const latest = useRef({ createSetupToken, onSaved });
    useEffect(() => {
        latest.current = { createSetupToken, onSaved };
    }, [createSetupToken, onSaved]);
    useEffect(() => {
        let live = true;
        let buttons = null;
        loadVaultSdk(clientId).then(() => {
            const sdk = vaultSdk();
            if (!live || !box.current)
                return;
            if (!sdk)
                return setLoad('failed');
            buttons = sdk.Buttons({
                fundingSource: sdk.FUNDING?.PAYPAL ?? 'paypal',
                style: { layout: 'horizontal', shape: 'rect', color: 'gold', label: 'paypal', tagline: 0 },
                createVaultSetupToken: () => {
                    setError(null);
                    return latest.current.createSetupToken();
                },
                onApprove: async ({ vaultSetupToken }) => {
                    try {
                        await latest.current.onSaved(vaultSetupToken);
                    }
                    catch (err) {
                        setError(messageOf(err) ?? 'Your PayPal account couldn’t be saved. Please try again.');
                    }
                },
                onCancel: () => setError(null),
                onError: () => setError('PayPal had a problem just now. Try again, or use a card.'),
            });
            buttons.render(box.current).then(() => live && setLoad('ready'), () => live && setLoad('failed'));
        }, () => live && setLoad('failed'));
        return () => {
            live = false;
            void buttons?.close?.().catch(() => { });
        };
    }, [clientId]);
    return (_jsxs("div", { className: cn('flex flex-col gap-2', disabled && 'pointer-events-none opacity-50', className), "aria-disabled": disabled || undefined, children: [load !== 'ready' && load !== 'failed' && _jsx("p", { className: "text-sm text-muted-foreground", children: "Loading PayPal\u2026" }), load === 'failed' && _jsx(ErrorNote, { error: "PayPal didn\u2019t load. Reload the page, or use a card." }), _jsx("div", { ref: box }), _jsx(ErrorNote, { error: error })] }));
}
export const PAYPAL_CARD_PAY_NAMESPACE = 'paypalCardPay';
/** PayPal's JS SDK for paying with Card Fields (an order captured at once), under its own namespace beside the buttons' and the vault's. */
export function paypalCardPaySdkUrl(clientId) {
    return `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture&components=card-fields`;
}
/**
 * PayPal's card fields paying an order that also saves the card (vault with purchase), for a
 * schedule's first payment: the card stays in PayPal's frames, PayPal checks it (3-D Secure only when
 * the bank asks), the payment is captured, and the buyer goes to the return page. A declined card is
 * said under the fields, and the buyer can try another.
 */
export function PaypalCardPayment({ payment, completeReturn, submitLabel, navigate, note, disabled, className }) {
    const capture = useAction(completeReturn);
    const nameBox = useRef(null);
    const numberBox = useRef(null);
    const expiryBox = useRef(null);
    const cvvBox = useRef(null);
    const fields = useRef(null);
    const outcome = useRef(null);
    const [load, setLoad] = useState('loading');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    useSlow(load, setLoad);
    const latest = useRef({ capture });
    useEffect(() => {
        latest.current = { capture };
    }, [capture]);
    const { orderId, clientId, returnUrl } = payment;
    useEffect(() => {
        let live = true;
        const rendered = [];
        loadScript(paypalCardPaySdkUrl(clientId), { 'data-namespace': PAYPAL_CARD_PAY_NAMESPACE }).then(async () => {
            const sdk = window[PAYPAL_CARD_PAY_NAMESPACE];
            if (!live)
                return;
            if (!sdk)
                return setLoad('failed');
            const cf = sdk.CardFields({
                style: FIELD_STYLE,
                createOrder: () => Promise.resolve(orderId),
                onApprove: async ({ orderID }) => {
                    const r = await latest.current.capture({ processor: 'paypal', token: orderID });
                    outcome.current = r?.declined ? 'declined' : 'paid';
                },
                onError: (err) => console.error('payments: PayPal card fields:', err),
            });
            if (!cf.isEligible())
                return setLoad('failed');
            const parts = [
                [cf.NameField(), nameBox.current],
                [cf.NumberField(), numberBox.current],
                [cf.ExpiryField(), expiryBox.current],
                [cf.CVVField(), cvvBox.current],
            ];
            try {
                for (const [f, el] of parts) {
                    if (!el)
                        return;
                    rendered.push(f);
                    await f.render(el);
                }
                if (!live)
                    return;
                fields.current = cf;
                setLoad('ready');
            }
            catch {
                if (live)
                    setLoad('failed');
            }
        }, () => live && setLoad('failed'));
        return () => {
            live = false;
            fields.current = null;
            for (const f of rendered)
                void f.close?.().catch(() => { });
        };
    }, [clientId, orderId]);
    const submit = async () => {
        if (!fields.current || busy)
            return;
        setBusy(true);
        setError(null);
        outcome.current = null;
        try {
            await fields.current.submit();
            if (outcome.current === 'paid')
                return (navigate ?? ((u) => window.location.assign(u)))(returnUrl);
            setError(outcome.current === 'declined' ? 'The card was declined. Try another card.' : 'The card couldn’t be charged. Check the details and try again.');
        }
        catch (err) {
            setError(messageOf(err) ?? 'The card couldn’t be charged. Check the details and try again.');
        }
        finally {
            setBusy(false);
        }
    };
    const box = 'min-h-9 rounded-md border border-input';
    return (_jsxs("div", { className: cn('flex flex-col gap-2', className), children: [load !== 'ready' && load !== 'failed' && _jsx("p", { className: "text-sm text-muted-foreground", children: "Loading the card form\u2026" }), load === 'failed' && _jsx(ErrorNote, { error: "The card form didn\u2019t load. Reload the page, or use another way to pay." }), _jsxs("div", { className: cn('flex flex-col gap-2', load !== 'ready' && 'hidden'), children: [_jsx("div", { ref: nameBox, className: box }), _jsx("div", { ref: numberBox, className: box }), _jsxs("div", { className: "grid grid-cols-2 gap-2", children: [_jsx("div", { ref: expiryBox, className: box }), _jsx("div", { ref: cvvBox, className: box })] })] }), note && _jsx("p", { className: "text-xs text-muted-foreground", children: note }), _jsx(ErrorNote, { error: error }), _jsx(Button, { variant: "default", className: "h-9", disabled: disabled || busy || load !== 'ready', onClick: () => void submit(), children: busy ? 'Paying…' : submitLabel })] }));
}
//# sourceMappingURL=vault.js.map