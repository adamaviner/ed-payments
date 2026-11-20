// An admin's look through the PayPal account's history for one email: Transaction Search can't filter
// by email, so this walks the range in PayPal's 31-day windows and keeps what involves the address.
import { ConvexError } from 'convex/values';
import { paypalActivityUrl, searchActivity } from '../core/paypal.js';
import { ProcessorError } from '../core/types.js';
import { errorText } from './util.js';
const DAY = 24 * 60 * 60 * 1000;
/** PayPal refuses a window longer than 31 days. */
const WINDOW = 31 * DAY - 1000;
/** PayPal keeps three years (a day's margin so the first window isn't refused). */
const KEPT = 3 * 365 * DAY - DAY;
/** Windows asked at once: a three-year search is 36 of them. */
const AT_ONCE = 4;
/** 500 a page: 10,000 transactions in a month before it stops. */
const MAX_PAGES = 20;
/** [start, end) cut into PayPal-sized windows, oldest first. */
export function searchWindows(start, end) {
    const count = Math.max(0, Math.ceil((end - start) / WINDOW));
    return Array.from({ length: count }, (_, i) => ({ start: start + i * WINDOW, end: Math.min(end, start + (i + 1) * WINDOW) }));
}
async function searchWindow(p, ctx, w) {
    const pages = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
        const res = await p.withPaypal(ctx, (call) => searchActivity(call, { ...w, page }));
        pages.push(res.activity);
        if (page >= res.totalPages)
            break;
    }
    return pages.flat();
}
async function searchAll(p, ctx, windows) {
    const found = [];
    for (let i = 0; i < windows.length; i += AT_ONCE)
        found.push(...(await Promise.all(windows.slice(i, i + AT_ONCE).map((w) => searchWindow(p, ctx, w)))));
    return found.flat();
}
function refusal(err) {
    if (err instanceof ProcessorError && err.processor === 'paypal' && err.status === 403)
        throw new ConvexError('PayPal refused the search: switch on “Transaction search” for the PayPal REST app (it can take a few hours to apply).');
    throw new ConvexError(`PayPal’s search failed: ${errorText(err)}`);
}
/** Every transaction in the range whose other party is `email` (payments in, refunds and payments out), newest first. */
export async function paypalHistory(p, ctx, a) {
    const email = a.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+$/.test(email))
        throw new ConvexError('Enter an email address.');
    const now = Date.now();
    const start = Math.max(a.start, now - KEPT);
    const end = Math.min(a.end, now);
    if (!(start < end))
        throw new ConvexError('Pick a date range that ends after it starts, within the last three years.');
    const all = await searchAll(p, ctx, searchWindows(start, end)).catch(refusal);
    const apiBase = p.paypalKeys().apiBase;
    const transactions = all
        .filter((t) => t.email === email)
        .toSorted((x, y) => y.at - x.at)
        .map((t) => ({ ...t, url: paypalActivityUrl(apiBase, t.transactionId) }));
    return { start, end, transactions, scanned: all.length };
}
//# sourceMappingURL=paypalHistory.js.map