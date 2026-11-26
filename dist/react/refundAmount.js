// What staff type in a refund's amount box, checked in the browser before anything is asked of the
// server (which checks again, against refunds made since the page loaded).
import { decimalToCents, dollars } from '../core/money.js';
/**
 * Refunds that hold part of a payment on this page. The server counts requested, approved and sending
 * against what is left; the page also counts failed ones, which can still be sent again from Refunds
 * to do, so a failed refund isn't asked for a second time here and then both sent.
 */
const HOLDING = new Set(['requested', 'approved', 'sending', 'failed']);
/** What can still be refunded on a payment: paid, less refunded, less open refunds. Never below zero. */
export function refundableCents(checkout, openRefunds = []) {
    const held = openRefunds.filter((r) => r.checkoutId === checkout.id && HOLDING.has(r.status)).reduce((sum, r) => sum + r.amountCents, 0);
    return Math.max(0, (checkout.paidCents ?? 0) - checkout.refundedCents - held);
}
/**
 * The amount box's text as cents: blank means everything left; otherwise dollars with at most two
 * decimals ("12", "12.5", "$12.50"), more than zero and no more than what is left.
 */
export function parseRefundAmount(text, leftCents) {
    if (leftCents < 1)
        return { ok: false, error: 'Nothing is left to refund on this payment.' };
    // No commas: "12,50" could be twelve euros-style or twelve hundred, and a refund must not guess.
    const trimmed = text.trim().replace(/^\$\s*/, '');
    if (!trimmed)
        return { ok: true, cents: leftCents };
    const cents = decimalToCents(trimmed);
    if (cents === null)
        return { ok: false, error: 'Enter an amount in dollars, like 12.50.' };
    if (cents < 1)
        return { ok: false, error: 'A refund needs to be more than $0.00.' };
    if (cents > leftCents)
        return { ok: false, error: `Only ${dollars(leftCents)} is left to refund on this payment.` };
    return { ok: true, cents };
}
//# sourceMappingURL=refundAmount.js.map