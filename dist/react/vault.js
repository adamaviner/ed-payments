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
import { errorMessage } from './errors.js';
import { useLatest, useOneAtATime } from './hooks.js';
import { Button, cn, ErrorNote } from './ui.js';
export const PAYPAL_VAULT_NAMESPACE = 'paypalVault';
/** PayPal's JS SDK for saving: Card Fields and the PayPal button, no Venmo or Pay Later. */
export function paypalVaultSdkUrl(clientId) {
    return `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&components=card-fields,buttons&disable-funding=venmo,paylater`;
}
const vaultSdk = () => window[PAYPAL_VAULT_NAMESPACE];
const loadVaultSdk = (clientId) => loadScript(paypalVaultSdkUrl(clientId), PAYPAL_VAULT_NAMESPACE, { 'data-namespace': PAYPAL_VAULT_NAMESPACE });
/** PayPal's own errors are codes (INVALID_NUMBER, UPDATE_VAULT_SETUP_TOKEN_CONTINGENCY, …), not words for a payer. */
const CARD_REFUSED = 'PayPal couldn’t check that card. Check the number, expiry date and security code, or use another card.';
/** Field styling inside PayPal's frames, close to the package's own inputs. */
const FIELD_STYLE = {
    input: { 'font-size': '14px', padding: '6px 8px' },
    '.invalid': { color: '#dc2626' },
};
/** The app's style over the defaults, selector by selector. */
const withFieldStyle = (style) => Object.fromEntries([...new Set([...Object.keys(FIELD_STYLE), ...Object.keys(style)])].map((k) => [k, { ...FIELD_STYLE[k], ...style[k] }]));
/**
 * Makes PayPal's Card Fields with `make` (which loads the SDK and returns null if it has none) and
 * renders the four fields into the boxes; again, closing the old ones, whenever `inputs` change. Compared
 * as JSON, so objects made fresh on every render don't render the fields again (which would clear
 * what the buyer typed); `make` gets them back from that JSON.
 */
function useCardFields(inputs, make) {
    const key = JSON.stringify(inputs);
    const name = useRef(null);
    const number = useRef(null);
    const expiry = useRef(null);
    const cvv = useRef(null);
    const fields = useRef(null);
    const [load, setLoad] = useState('loading');
    useSlow(load, setLoad);
    const latestMake = useLatest(make);
    useEffect(() => {
        let live = true;
        const rendered = [];
        latestMake.current(JSON.parse(key)).then(async (cf) => {
            if (!live)
                return;
            if (!cf || !cf.isEligible())
                return setLoad('failed');
            const parts = [
                [cf.NameField(), name.current],
                [cf.NumberField(), number.current],
                [cf.ExpiryField(), expiry.current],
                [cf.CVVField(), cvv.current],
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
    }, [key, latestMake]);
    const boxes = { name, cardNumber: number, expiry, cvv };
    return { boxes, fields, load };
}
// The frames' pages don't declare a color scheme, so on a dark page (color-scheme: dark) the browser
// would paint an opaque light backdrop behind them; matching their scheme keeps them see-through.
const FRAME_SCHEME = { colorScheme: 'light' };
/** The card form around PayPal's fields: loading and failure notes, the four boxes, the note, the error and the button. */
function CardForm(props) {
    const { load } = props;
    const { name, cardNumber, expiry, cvv } = props.boxes;
    const box = 'min-h-9 rounded-md border border-input';
    return (_jsxs("div", { className: cn('flex flex-col gap-2', props.className), children: [load !== 'ready' && load !== 'failed' && _jsx("p", { className: "text-sm text-muted-foreground", children: "Loading the card form\u2026" }), load === 'failed' && _jsx(ErrorNote, { error: "The card form didn\u2019t load. Reload the page, or use another way to pay." }), _jsxs("div", { className: cn('flex flex-col gap-2', load !== 'ready' && 'hidden'), children: [_jsx("div", { ref: name, className: box, style: FRAME_SCHEME }), _jsx("div", { ref: cardNumber, className: box, style: FRAME_SCHEME }), _jsxs("div", { className: "grid grid-cols-2 gap-2", children: [_jsx("div", { ref: expiry, className: box, style: FRAME_SCHEME }), _jsx("div", { ref: cvv, className: box, style: FRAME_SCHEME })] })] }), props.note && _jsx("p", { className: "text-xs text-muted-foreground", children: props.note }), _jsx(ErrorNote, { error: props.error }), _jsx(Button, { variant: "default", className: "h-9", disabled: props.disabled || load !== 'ready', onClick: props.onSubmit, children: props.label })] }));
}
/** PayPal's card fields (name, number, expiry, CVV) and one button that saves the card, then calls onSaved. */
export function PaypalCardFields({ clientId, createSetupToken, onSaved, submitLabel, disabled, note, style, className }) {
    // What the app's createSetupToken or onSaved threw (said as it is), in case PayPal reports it to onError instead of rejecting submit().
    const saveError = useRef(null);
    const { busy, run } = useOneAtATime();
    const [error, setError] = useState(null);
    const latest = useLatest({ createSetupToken, onSaved });
    const { boxes, fields, load } = useCardFields({ clientId, style: withFieldStyle(style ?? {}) }, async ({ clientId, style }) => {
        await loadVaultSdk(clientId);
        return (vaultSdk()?.CardFields({
            style,
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
        }) ?? null);
    });
    const submit = () => run(async () => {
        const cf = fields.current;
        if (!cf)
            return;
        setError(null);
        saveError.current = null;
        try {
            // PayPal calls createVaultSetupToken, checks the card (a 3-D Secure window if the bank wants
            // one), then onApprove, which runs onSaved; a problem anywhere rejects here.
            await cf.submit();
            if (saveError.current)
                setError(errorMessage(saveError.current, 'The card couldn’t be saved. Please try again.'));
        }
        catch (err) {
            // The app's words when it was the app; PayPal's codes mean nothing to a payer, so they go to the console.
            if (!saveError.current)
                console.warn('payments: PayPal card fields refused the card:', err);
            setError(saveError.current ? errorMessage(saveError.current, CARD_REFUSED) : CARD_REFUSED);
        }
    });
    return _jsx(CardForm, { boxes: boxes, load: load, note: note, error: error, label: busy ? 'Saving…' : submitLabel, disabled: !!disabled || busy, onSubmit: () => void submit(), className: className });
}
/** PayPal's button: the buyer logs in to PayPal and agrees to be charged later; then onSaved. */
export function PaypalSaveButton({ clientId, createSetupToken, onSaved, disabled, className }) {
    const box = useRef(null);
    const [load, setLoad] = useState('loading');
    const [error, setError] = useState(null);
    useSlow(load, setLoad);
    const latest = useLatest({ createSetupToken, onSaved });
    useEffect(() => {
        let live = true;
        let buttons = null;
        // What the app's createSetupToken threw: PayPal only reports it to onError, which would otherwise blame PayPal.
        let setupError = null;
        loadVaultSdk(clientId).then(() => {
            const sdk = vaultSdk();
            if (!live || !box.current)
                return;
            if (!sdk)
                return setLoad('failed');
            buttons = sdk.Buttons({
                fundingSource: sdk.FUNDING?.PAYPAL ?? 'paypal',
                style: { layout: 'horizontal', shape: 'rect', color: 'gold', label: 'paypal', tagline: 0 },
                createVaultSetupToken: async () => {
                    setError(null);
                    setupError = null;
                    try {
                        return await latest.current.createSetupToken();
                    }
                    catch (err) {
                        setupError = err;
                        throw err;
                    }
                },
                onApprove: async ({ vaultSetupToken }) => {
                    try {
                        await latest.current.onSaved(vaultSetupToken);
                    }
                    catch (err) {
                        setError(errorMessage(err, 'Your PayPal account couldn’t be saved. Please try again.'));
                    }
                },
                onCancel: () => setError(null),
                onError: (err) => {
                    if (!setupError)
                        console.warn('payments: PayPal button:', err);
                    setError(setupError ? errorMessage(setupError, PAYPAL_PROBLEM) : PAYPAL_PROBLEM);
                },
            });
            buttons.render(box.current).then(() => live && setLoad('ready'), () => live && setLoad('failed'));
        }, () => live && setLoad('failed'));
        return () => {
            live = false;
            void buttons?.close?.().catch(() => { });
        };
    }, [clientId, latest]);
    return (_jsxs("div", { className: cn('flex flex-col gap-2', disabled && 'pointer-events-none opacity-50', className), "aria-disabled": disabled || undefined, children: [load !== 'ready' && load !== 'failed' && _jsx("p", { className: "text-sm text-muted-foreground", children: "Loading PayPal\u2026" }), load === 'failed' && _jsx(ErrorNote, { error: "PayPal didn\u2019t load. Reload the page, or use a card." }), _jsx("div", { ref: box }), _jsx(ErrorNote, { error: error })] }));
}
const PAYPAL_PROBLEM = 'PayPal had a problem just now. Try again, or use a card.';
export const PAYPAL_CARD_PAY_NAMESPACE = 'paypalCardPay';
/** PayPal's JS SDK for paying with Card Fields (an order captured at once), under its own namespace beside the buttons' and the vault's. */
export function paypalCardPaySdkUrl(clientId) {
    return `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture&components=card-fields`;
}
/**
 * PayPal's card fields paying an order that also saves the card (vault with purchase), for a
 * schedule's first payment: the card stays in PayPal's frames, PayPal checks it (3-D Secure only when
 * the bank asks), the payment is captured, and the buyer goes to the return page. A declined card is
 * said under the fields, and the buyer can try another. Once the capture has started, anything but a
 * decline (paid, an error, no answer) goes to the return page, which asks the server how it stands:
 * a capture whose answer was lost may well have taken the money, and a payer told it failed would pay again.
 */
export function PaypalCardPayment({ payment, completeReturn, submitLabel, navigate, note, disabled, style, className }) {
    const capture = useAction(completeReturn);
    // null: no capture asked for yet; capturing: asked, no answer (yet).
    const outcome = useRef(null);
    const { busy, run } = useOneAtATime();
    const [error, setError] = useState(null);
    const latest = useLatest({ capture, navigate });
    const { orderId, clientId, returnUrl } = payment;
    const { boxes, fields, load } = useCardFields({ clientId, orderId, style: withFieldStyle(style ?? {}) }, async ({ clientId, orderId, style }) => {
        await loadScript(paypalCardPaySdkUrl(clientId), PAYPAL_CARD_PAY_NAMESPACE, { 'data-namespace': PAYPAL_CARD_PAY_NAMESPACE });
        const sdk = window[PAYPAL_CARD_PAY_NAMESPACE];
        return (sdk?.CardFields({
            style,
            createOrder: () => Promise.resolve(orderId),
            onApprove: async ({ orderID }) => {
                outcome.current = 'capturing';
                const r = await latest.current.capture({ processor: 'paypal', token: orderID });
                outcome.current = r?.declined ? 'declined' : 'paid';
            },
            onError: (err) => console.error('payments: PayPal card fields:', err),
        }) ?? null);
    });
    const submit = () => run(async () => {
        const cf = fields.current;
        if (!cf)
            return;
        setError(null);
        outcome.current = null;
        try {
            await cf.submit();
        }
        catch (err) {
            // Refused before any capture (a mistyped card, 3-D Secure failed): nothing was charged.
            if (outcome.current === null) {
                console.warn('payments: PayPal card fields refused the card:', err);
                return setError(CARD_REFUSED);
            }
        }
        if (outcome.current === 'declined')
            return setError('The card was declined. Try another card.');
        (latest.current.navigate ?? ((u) => window.location.assign(u)))(returnUrl);
    });
    return _jsx(CardForm, { boxes: boxes, load: load, note: note, error: error, label: busy ? 'Paying…' : submitLabel, disabled: !!disabled || busy, onSubmit: () => void submit(), className: className });
}
//# sourceMappingURL=vault.js.map