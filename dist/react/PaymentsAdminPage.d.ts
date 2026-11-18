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
    /**
     * A question to ask before refunding `amountCents` of a payment with `leftCents` left (e.g. only when
     * it refunds everything left), or null to ask nothing. The refund waits for an answer, and the answer
     * is kept on it as hostData[key]: in the ledger, and in on.refunded.
     */
    refundQuestion?: (checkout: CheckoutSummary, amountCents: number, leftCents: number) => RefundQuestion | null;
}
/** A question the app asks before a refund, e.g. whether to put the item back on sale. */
export interface RefundQuestion {
    /** The hostData key the answer is kept under, e.g. 'relist': non-empty printable ASCII, not starting with `$`. */
    key: string;
    /** The question, naming what it is about. */
    label: ReactNode;
    /** The answers. None is chosen until the admin picks one, so nothing is decided for them. */
    options: {
        value: string;
        label: string;
    }[];
}
export declare function PaymentsAdminPage({ api, auth, skipApproval, refLink, refundQuestion, pageSize }: PaymentsAdminPageProps): import("react").JSX.Element;
//# sourceMappingURL=PaymentsAdminPage.d.ts.map