import type { Scheduler } from 'convex/server';
import { type Payer, type Ref } from '../core/types.js';
import type { Checkout, Payments, RunActionCtx } from './index.js';
import type { SavedMethod } from './saved.js';
/**
 * The owner as PayPal's merchant_customer_id: `<app>.<type>.<id>`, or the app and a hash of that when
 * it is too long or has characters PayPal refuses (1–64 of [0-9a-zA-Z-_.^*$@#]).
 */
export declare function paypalOwnerTag(app: string, owner: Ref): Promise<string>;
/** PayPal-Request-Id allows 108 characters; longer charge keys are hashed (the same key, the same id). */
export declare function chargeRequestId(chargeKey: string): Promise<string>;
export declare function setupPaypalMethod(p: Payments, ctx: RunActionCtx, a: {
    owner: Ref;
    payer: Payer;
    kind: 'card' | 'paypal';
    description?: string;
}): Promise<{
    setupTokenId: string;
    clientId: string;
}>;
/**
 * Saves the method a setup token was approved with, for `owner`. The setup token must carry this
 * owner's tag (it came from the browser, and anyone could send someone else's). A card whose $0
 * check failed is deleted from PayPal's vault again and refused.
 */
export declare function savePaypalMethod(p: Payments, ctx: RunActionCtx, a: {
    owner: Ref;
    setupTokenId: string;
    payerEmail?: string;
}): Promise<SavedMethod>;
/** The owner's PayPal methods, newest first, from the library's own record (PayPal's list lags). */
export declare function paypalMethods(p: Payments, ctx: RunActionCtx, owner: Ref): Promise<SavedMethod[]>;
/** A PayPal method id, checked to be this owner's; throws otherwise. */
export declare function verifyPaypalOwner(p: Payments, ctx: RunActionCtx, owner: Ref, paymentMethodId: string): Promise<SavedMethod & {
    customerId: string;
}>;
export declare function removePaypalMethod(p: Payments, ctx: RunActionCtx, paymentMethodId: string): Promise<void>;
/**
 * Charges an off-session checkout on a PayPal method (saved.ts's chargeNow hands it over). Every try
 * uses the same PayPal-Request-Id, so PayPal makes one order however many times it is asked; a try
 * with no answer is asked again after a minute, two..., then left to a person.
 */
export declare function chargePaypalNow(p: Payments, ctx: RunActionCtx & {
    scheduler: Scheduler;
}, c: Checkout, note: (error: string, retry: boolean, orderId?: string) => Promise<void>): Promise<void>;
/**
 * A person gives up on a PayPal charge whose outcome was unknown. An order PayPal made for it is
 * looked at first: captured means paid (settled instead). Without an order id nothing more can be
 * asked here; a capture that turns up later is caught by the nightly comparison.
 */
export declare function giveUpPaypalCharge(p: Payments, ctx: RunActionCtx, c: Checkout, who: string): Promise<{
    status: string;
}>;
//# sourceMappingURL=paypalVault.d.ts.map