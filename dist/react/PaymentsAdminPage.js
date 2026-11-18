import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// Admin → Payments: refunds waiting on someone, paid payments to refund in full or in part, and the
// issues the library found (differences from the processors, disputes, failed callbacks, charges whose
// outcome is unknown). Over the app's payments.adminApi() functions; every action waits for the server
// and the lists follow from the queries, so no amount on the page is ever a guess.
import { useAction, useMutation, usePaginatedQuery, useQuery } from 'convex/react';
import { useId, useState } from 'react';
import { centsToDecimal, dollars } from '../core/money.js';
import { parseRefundAmount, refundableCents } from './refundAmount.js';
import { Button, ConfirmButton, ErrorNote, Field, Hint, Input, Note, Rows, Section } from './ui.js';
import { useSaver } from './useSaver.js';
export function PaymentsAdminPage({ api, auth, skipApproval = false, refLink, refundQuestion, pageSize = 20 }) {
    // Left out rather than sent as undefined, so an app on Convex auth sends no `auth` at all.
    const args = auth === undefined ? {} : { auth };
    const shared = { api, args, skipApproval, refLink, refundQuestion };
    const refunds = useQuery(api.openRefunds, args);
    return (_jsxs("div", { className: "flex flex-col gap-8", children: [_jsx(OpenRefunds, { shared: shared, refunds: refunds }), _jsx(Refundable, { shared: shared, refunds: refunds, pageSize: pageSize }), _jsx(Issues, { shared: shared, pageSize: pageSize })] }));
}
const PROCESSORS = { stripe: 'Stripe', paypal: 'PayPal' };
const METHODS = { card: 'card', ach: 'bank transfer', paypal: 'PayPal' };
const processorName = (p) => (p ? (PROCESSORS[p] ?? p) : 'the processor');
const STATUS = {
    requested: 'Waiting for approval',
    approved: 'Approved, not sent yet',
    sending: 'Sending',
    failed: 'Failed',
    sent: 'Sent',
    manual: 'Refunded elsewhere',
    dismissed: 'Not refunded',
};
const ISSUES = {
    missing_here: 'At the processor, not here',
    missing_there: 'Here, not at the processor',
    amount_differs: 'Amounts differ',
    status_differs: 'Status differs',
    dispute: 'Dispute',
    callback_failed: 'The app couldn’t record it',
    charge_unknown: 'Charge with an unknown outcome',
};
/** The app's notes on a refund, as "key: value" pairs. */
const notesText = (hostData) => hostData
    ? Object.entries(hostData)
        .map(([k, val]) => `${k}: ${val}`)
        .join(' · ')
    : '';
const when = (ms) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
function Muted({ children }) {
    return _jsx("span", { className: "block text-xs text-muted-foreground", children: children });
}
/** Who paid, for what, and how. */
function Payment({ checkout, refLink }) {
    const link = refLink?.(checkout.ref, checkout) ?? null;
    return (_jsxs("div", { className: "min-w-56 flex-1", children: [_jsx("span", { className: "block", children: link ?? checkout.description }), link !== null && _jsx(Muted, { children: checkout.description }), _jsxs(Muted, { children: [checkout.payer.name ? `${checkout.payer.name} · ${checkout.payer.email}` : checkout.payer.email, " \u00B7 ", when(checkout.createdAt)] }), _jsxs(Muted, { children: [processorName(checkout.processor), ` ${METHODS[checkout.method] ?? checkout.method}`, checkout.paymentRef && _jsxs("span", { className: "font-mono break-all", children: [" ", checkout.paymentRef] })] })] }));
}
/** Sends a refund and turns the processor saying no into an error to show by the row. */
async function send(sendRefund, args, refundId) {
    const result = await sendRefund({ ...args, refundId });
    if (result?.status === 'failed')
        throw new Error(result.error ?? 'The processor refused the refund.');
}
// ── Refunds to do ─────────────────────────────────────────────────────────────────────────────────
function OpenRefunds({ shared, refunds }) {
    return (_jsx(Section, { title: "Refunds to do", hint: "Money owed back: payments that arrived for something that couldn\u2019t be sold, and refunds asked for below.", children: refunds === undefined ? (_jsx(Hint, { children: "Loading\u2026" })) : refunds.length === 0 ? (_jsx(Hint, { children: "Nothing to refund right now." })) : (_jsx(Rows, { children: refunds.map((r) => (_jsx(RefundRow, { shared: shared, refund: r }, r.id))) })) }));
}
function RefundRow({ shared, refund }) {
    const { api, args, skipApproval, refLink } = shared;
    const approveRefund = useMutation(api.approveRefund);
    const sendRefund = useAction(api.sendRefund);
    const markRefundedManually = useMutation(api.markRefundedManually);
    const dismissRefund = useMutation(api.dismissRefund);
    const { error, run, busy } = useSaver();
    const [closing, setClosing] = useState(null);
    const [note, setNote] = useState('');
    const noteId = useId();
    const c = refund.checkout;
    const processor = processorName(c?.processor);
    const needsApproval = refund.status === 'requested' && !skipApproval;
    const close = async () => {
        const ok = await run(() => closing === 'manual' ? markRefundedManually({ ...args, refundId: refund.id, note: note.trim() || undefined }) : dismissRefund({ ...args, refundId: refund.id, note: note.trim() || undefined }));
        if (ok)
            setClosing(null);
    };
    return (_jsxs("li", { className: "flex flex-col gap-2 px-3 py-2 text-sm", children: [_jsxs("div", { className: "flex flex-wrap items-start gap-3", children: [c ? _jsx(Payment, { checkout: c, refLink: refLink }) : _jsx("div", { className: "min-w-56 flex-1", children: "A payment that is no longer here" }), _jsxs("div", { className: "w-40", children: [_jsx("span", { className: "block font-medium", children: dollars(refund.amountCents) }), c && c.paidCents !== null && _jsxs(Muted, { children: ["of ", dollars(c.paidCents), " paid"] })] }), _jsxs("div", { className: "min-w-48 flex-1", children: [_jsx("span", { className: "block", children: refund.reason }), _jsxs(Muted, { children: [STATUS[refund.status], refund.origin === 'needed' && ' · the app couldn’t make the sale', refund.requestedBy && ` · asked by ${refund.requestedBy}`, refund.approvedBy && ` · approved by ${refund.approvedBy}`, " \u00B7 ", when(refund.createdAt)] }), refund.hostData && _jsx(Muted, { children: notesText(refund.hostData) }), refund.error && _jsx("span", { className: "block text-xs text-destructive", children: refund.error })] })] }), refund.status === 'sending' ? (_jsxs(Hint, { children: ["Waiting for ", processor, "\u2019s answer. It is asked again automatically."] })) : closing ? (_jsxs("div", { className: "flex flex-wrap items-end gap-2", children: [closing === 'manual' && _jsxs(Hint, { className: "basis-full", children: ["Only when it was already refunded outside this page, e.g. in ", processor, "\u2019s dashboard. Nothing is sent."] }), _jsx(Field, { label: closing === 'manual' ? 'How it was refunded (optional)' : 'Why not (optional)', htmlFor: noteId, className: "min-w-64 flex-1", children: _jsx(Input, { id: noteId, value: note, onChange: (e) => setNote(e.target.value), disabled: busy }) }), _jsx(Button, { variant: "default", disabled: busy, onClick: () => void close(), children: closing === 'manual' ? 'Mark refunded' : 'Don’t refund' }), _jsx(Button, { variant: "ghost", disabled: busy, onClick: () => setClosing(null), children: "Cancel" })] })) : (_jsxs("div", { className: "flex flex-wrap gap-2", children: [needsApproval ? (_jsx(Button, { variant: "default", disabled: busy, onClick: () => void run(() => approveRefund({ ...args, refundId: refund.id })), children: "Approve" })) : (_jsx(ConfirmButton, { disabled: busy, confirmLabel: `Send ${dollars(refund.amountCents)} back via ${processor}?`, onConfirm: () => run(() => send(sendRefund, args, refund.id)), children: refund.status === 'failed' ? 'Try again' : `Refund via ${processor}` })), _jsx(Button, { variant: "ghost", disabled: busy, onClick: () => {
                            setNote('');
                            setClosing('manual');
                        }, children: "Refunded elsewhere" }), _jsx(Button, { variant: "ghost", disabled: busy, onClick: () => {
                            setNote('');
                            setClosing('dismiss');
                        }, children: "Don\u2019t refund" })] })), _jsx(ErrorNote, { error: error })] }));
}
// ── Refund a payment ──────────────────────────────────────────────────────────────────────────────
function Refundable({ shared, refunds, pageSize }) {
    const { results, status, loadMore } = usePaginatedQuery(shared.api.refundable, shared.args, { initialNumItems: pageSize });
    return (_jsxs(Section, { title: "Refund a payment", hint: "Paid payments with something left to refund, newest first. Leave the amount blank to refund everything left.", children: [status === 'LoadingFirstPage' ? (_jsx(Hint, { children: "Loading\u2026" })) : results.length === 0 ? (_jsx(Hint, { children: "No paid payments to refund." })) : (_jsx(Rows, { children: results.map((c) => (_jsx(CheckoutRow, { shared: shared, checkout: c, refunds: refunds }, c.id))) })), status === 'CanLoadMore' && (_jsx(Button, { className: "self-start", onClick: () => loadMore(pageSize), children: "Show more" }))] }));
}
function CheckoutRow({ shared, checkout, refunds }) {
    const { api, args, skipApproval, refLink, refundQuestion } = shared;
    const requestRefund = useMutation(api.requestRefund);
    const sendRefund = useAction(api.sendRefund);
    const { error, run, busy } = useSaver();
    const [amount, setAmount] = useState('');
    const [reason, setReason] = useState('');
    const [asked, setAsked] = useState(null);
    const [answer, setAnswer] = useState(null);
    const amountId = useId();
    const questionName = useId();
    const reasonId = useId();
    const amountErrorId = useId();
    const questionHintId = useId();
    // Until the open refunds load, what they hold is unknown, so nothing can be refunded yet.
    const left = refunds ? refundableCents(checkout, refunds) : 0;
    const parsed = parseRefundAmount(amount, left);
    const processor = processorName(checkout.processor);
    const question = parsed.ok ? (refundQuestion?.(checkout, parsed.cents, left) ?? null) : null;
    // An answer only counts for the question it was given to: changing the amount can change the question.
    const answered = question && answer?.key === question.key && question.options.some((o) => o.value === answer.value) ? answer.value : null;
    const hostData = question && answered !== null ? { [question.key]: answered } : undefined;
    const answerLabel = question?.options.find((o) => o.value === answered)?.label;
    // Two steps, and the form clears as soon as the refund is recorded: if sending then fails, the refund
    // is already in Refunds to do, and a form still filled in would invite a second refund of the same money.
    const refund = async (cents) => {
        setAsked(null);
        let refundId = null;
        const recorded = await run(async () => {
            refundId = await requestRefund({ ...args, checkoutId: checkout.id, amountCents: cents, reason: reason.trim() || 'Refunded by an admin', ...(hostData ? { hostData } : {}) });
        });
        if (!recorded || refundId === null)
            return;
        setAmount('');
        setReason('');
        setAnswer(null);
        if (!skipApproval)
            return setAsked('Asked for. It is in Refunds to do, waiting for approval.');
        const id = refundId;
        const sent = await run(() => send(sendRefund, args, id));
        if (!sent)
            setAsked('The refund is recorded but wasn’t sent. Finish it in Refunds to do.');
    };
    return (_jsxs("li", { className: "flex flex-col gap-2 px-3 py-2 text-sm", children: [_jsxs("div", { className: "flex flex-wrap items-end gap-3", children: [_jsx(Payment, { checkout: checkout, refLink: refLink }), _jsxs("div", { className: "w-36", children: [_jsxs("span", { className: "block", children: [dollars(checkout.paidCents ?? 0), " paid"] }), checkout.refundedCents > 0 && _jsxs(Muted, { children: [dollars(checkout.refundedCents), " refunded"] }), refunds && _jsxs(Muted, { children: [dollars(left), " left"] })] }), _jsx(Field, { label: "Amount ($)", htmlFor: amountId, children: _jsx(Input, { id: amountId, className: "w-28", inputMode: "decimal", placeholder: left > 0 ? centsToDecimal(left) : '', value: amount, disabled: busy || left < 1, "aria-invalid": amount.trim() !== '' && !parsed.ok, "aria-describedby": amountErrorId, onChange: (e) => setAmount(e.target.value) }) }), _jsx(Field, { label: "Reason", htmlFor: reasonId, className: "min-w-48 flex-1", children: _jsx(Input, { id: reasonId, value: reason, disabled: busy || left < 1, placeholder: "Refunded by an admin", onChange: (e) => setReason(e.target.value) }) }), question && (_jsxs("fieldset", { className: "flex basis-full flex-wrap items-center gap-x-4 gap-y-1", disabled: busy, children: [_jsx("legend", { className: "mb-1 basis-full", children: question.label }), question.options.map((o) => (_jsxs("label", { className: "flex items-center gap-1.5", children: [_jsx("input", { type: "radio", name: questionName, value: o.value, checked: answered === o.value, onChange: () => setAnswer({ key: question.key, value: o.value }) }), o.label] }, o.value)))] })), parsed.ok && (!question || answered !== null) ? (_jsxs(ConfirmButton, { disabled: busy, confirmLabel: `${skipApproval ? `Send ${dollars(parsed.cents)} back via ${processor}?` : `Ask to refund ${dollars(parsed.cents)}?`}${answerLabel ? ` (${answerLabel})` : ''}`, onConfirm: () => refund(parsed.cents), children: ["Refund ", dollars(parsed.cents)] })) : (_jsx(Button, { disabled: true, "aria-describedby": question ? questionHintId : undefined, children: parsed.ok ? `Refund ${dollars(parsed.cents)}` : 'Refund' }))] }), question && answered === null && _jsx(Hint, { id: questionHintId, children: "Answer the question above to refund." }), _jsx("p", { id: amountErrorId, className: "text-sm text-destructive empty:hidden", children: !parsed.ok && amount.trim() !== '' ? parsed.error : '' }), asked && _jsx(Note, { children: asked }), _jsx(ErrorNote, { error: error })] }));
}
// ── Issues ────────────────────────────────────────────────────────────────────────────────────────
function Issues({ shared, pageSize }) {
    const { results, status, loadMore } = usePaginatedQuery(shared.api.issues, shared.args, { initialNumItems: pageSize });
    return (_jsxs(Section, { title: "Payment issues", hint: "Disputes, charges whose outcome is unknown, and differences the nightly check with Stripe and PayPal found. Most resolve themselves once the difference goes away.", children: [status === 'LoadingFirstPage' ? (_jsx(Hint, { children: "Loading\u2026" })) : results.length === 0 ? (_jsx(Hint, { children: "No open issues." })) : (_jsx(Rows, { children: results.map((i) => (_jsx(IssueRow, { shared: shared, issue: i }, i.id))) })), status === 'CanLoadMore' && (_jsx(Button, { className: "self-start", onClick: () => loadMore(pageSize), children: "Show more" }))] }));
}
function IssueRow({ shared, issue }) {
    const { api, args } = shared;
    const resolveIssue = useMutation(api.resolveIssue);
    const retryCharge = useMutation(api.retryCharge);
    const giveUpCharge = useAction(api.giveUpCharge);
    const { error, run, busy } = useSaver();
    const [outcome, setOutcome] = useState(null);
    const checkoutId = issue.kind === 'charge_unknown' ? issue.checkoutId : null;
    return (_jsxs("li", { className: "flex flex-col gap-2 px-3 py-2 text-sm", children: [_jsxs("div", { children: [_jsx("span", { className: "block font-medium", children: ISSUES[issue.kind] }), _jsx("span", { className: "block", children: issue.detail }), _jsxs(Muted, { children: [processorName(issue.processor), issue.paymentRef && _jsxs("span", { className: "font-mono break-all", children: [" ", issue.paymentRef] }), " \u00B7 ", when(issue.openedAt)] })] }), _jsxs("div", { className: "flex flex-wrap gap-2", children: [checkoutId && (_jsxs(_Fragment, { children: [_jsx(ConfirmButton, { disabled: busy, confirmLabel: "Charge again?", onConfirm: () => run(async () => {
                                    setOutcome(null);
                                    await retryCharge({ ...args, checkoutId });
                                    setOutcome('Trying the charge again.');
                                }), children: "Try the charge again" }), _jsx(ConfirmButton, { disabled: busy, confirmLabel: "Give up on this charge?", onConfirm: () => run(async () => {
                                    setOutcome(null);
                                    const r = await giveUpCharge({ ...args, checkoutId });
                                    setOutcome(r.status === 'failed' ? 'Given up: the charge is failed and the app was told.' : `Stripe had this charge as ${r.status}; recorded that instead.`);
                                }), children: "Give up" })] })), _jsx(Button, { disabled: busy, onClick: () => void run(() => resolveIssue({ ...args, issueId: issue.id })), children: "Mark resolved" })] }), checkoutId && _jsx(Hint, { children: "Both are safe if the first try went through: Stripe is asked first, and a charge it has as paid is recorded as paid." }), outcome && _jsx(Note, { children: outcome }), _jsx(ErrorNote, { error: error })] }));
}
//# sourceMappingURL=PaymentsAdminPage.js.map