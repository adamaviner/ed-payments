import { type ReactNode } from 'react';
import type { CheckoutSummary, PaymentRef, PaymentsAdminApi, PaymentsAuth } from './types.js';
export interface PaymentsAdminPageProps {
    /** The app's module that re-exports payments.adminApi(), e.g. `api.paymentsAdmin`. */
    api: PaymentsAdminApi;
    /** Passed to the app's authorize.admin query as it is (ed-schedule: `{ token }`); apps on Convex auth leave it out. */
    auth?: PaymentsAuth;
    /**
     * The same as the server's adminApi({ skipApproval }). False (the default, as there): a refund asked
     * for here waits for someone to approve it before it can be sent. True: it is sent at once.
     */
    skipApproval?: boolean;
    /** What a payment was for, in the app (a link to the order or bid); else its description is shown alone. */
    refLink?: (ref: PaymentRef, checkout: CheckoutSummary) => ReactNode;
    /** Payments and issues loaded at a time. Default 20. */
    pageSize?: number;
}
export declare function PaymentsAdminPage({ api, auth, skipApproval, refLink, pageSize }: PaymentsAdminPageProps): import("react").JSX.Element;
//# sourceMappingURL=PaymentsAdminPage.d.ts.map