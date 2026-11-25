import type { Processor } from '../core/types.js';
import type { CompleteReturnRef, PaymentRef } from './types.js';
/**
 * checking: asking the library. paid: the app recorded the sale. processing: a bank payment on its way
 * (days). refund_needed: the money arrived but the app couldn't make the sale, so it will be refunded.
 * failed: the processor said no. cancelled: nothing has been paid, at least not yet: the buyer turned
 * back (PayPal sends its token to the cancel page too), it expired, or (rarely, a card on the app's own
 * page) the processor is still finishing it; the callbacks tell the app if it pays later.
 * error: no token in the address, a token that isn't one of this app's payments, or the call failed
 * (`retry` asks again; the library allows a few calls per token, so a retry after a refusal for too
 * many tries is refused again for a while).
 */
export type CheckoutReturn = {
    state: 'checking';
} | {
    state: 'paid' | 'processing' | 'refund_needed' | 'failed' | 'cancelled';
    purpose: string;
    ref: PaymentRef;
} | {
    state: 'error';
    reason: 'no_token' | 'not_found' | 'request_failed';
    error?: unknown;
};
export type CheckoutReturnState = CheckoutReturn['state'];
/**
 * The payment the address came back with: Stripe's session_id (a hosted Checkout) or payment_intent
 * (a Payment Element, such as StripeRetryPayment's, after a redirect), or PayPal's token. Null: none.
 * Check it before loading anything for the page's form, and show the return instead: a form that
 * refuses a payment already paid would otherwise show that refusal to a payer who just paid.
 */
export declare function checkoutReturnToken(search: string | URLSearchParams): {
    processor: Processor;
    token: string;
} | null;
/**
 * Asks the app's `completeReturn` (from payments.publicApi()) once how this payment stands, settling
 * it with the processor if its webhook hasn't arrived. `token` null or empty: the address had none.
 */
export declare function useCheckoutReturn(completeReturn: CompleteReturnRef, { processor, token }: {
    processor: Processor;
    token: string | null | undefined;
}): CheckoutReturn & {
    retry: () => void;
};
//# sourceMappingURL=useCheckoutReturn.d.ts.map