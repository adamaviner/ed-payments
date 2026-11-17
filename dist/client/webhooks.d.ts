import type { StripeEvent } from '../core/stripe.js';
import type { Payments, RunActionCtx } from './index.js';
/** What the app does with Stripe events the library doesn't handle (ed-market: its bid PaymentIntents). */
export type UnhandledStripeEvent = (ctx: RunActionCtx, event: StripeEvent) => Promise<void>;
export declare function handleStripeWebhook(p: Payments, ctx: RunActionCtx, request: Request, onUnhandled?: UnhandledStripeEvent): Promise<Response>;
export declare function handlePaypalWebhook(p: Payments, ctx: RunActionCtx, request: Request): Promise<Response>;
//# sourceMappingURL=webhooks.d.ts.map