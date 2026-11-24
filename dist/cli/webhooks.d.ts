import { type PaypalKeys } from '../core/paypal.js';
import type { Fetch } from '../core/types.js';
export interface WebhookResult {
    action: 'created' | 'updated' | 'unchanged' | 'removed' | 'absent' | 'would create' | 'would update';
    id: string | null;
    /** Said to the person running it: what to set where, or what to check. */
    notes: string[];
}
export interface Run {
    url: string;
    fetch: Fetch;
    /** Events the app needs beyond the library's own. */
    extraEvents?: readonly string[];
    remove?: boolean;
    dryRun?: boolean;
    /** Required to touch a live account. */
    live?: boolean;
}
export declare function stripeWebhook(secretKey: string, r: Run): Promise<WebhookResult>;
export declare function paypalWebhook(keys: Pick<PaypalKeys, 'clientId' | 'clientSecret' | 'apiBase'>, r: Run): Promise<WebhookResult>;
//# sourceMappingURL=webhooks.d.ts.map