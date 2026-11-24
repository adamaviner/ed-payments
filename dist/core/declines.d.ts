import type { Processor } from './types.js';
/**
 * hard: trying the same method again won't work (lost, stolen, expired, closed, revoked); the payer
 * has to give another. insufficient_funds: may work once money arrives. soft: anything else.
 */
export type DeclineKind = 'hard' | 'soft' | 'insufficient_funds';
/** What a processor said about a refused charge: Stripe's code, decline_code and advice_code, or PayPal's issue. */
export interface DeclineInfo {
    processor: Processor;
    code?: string | null;
    declineCode?: string | null;
    adviceCode?: string | null;
}
export declare function declineKind(d: DeclineInfo): DeclineKind;
/** The most telling code of a refusal, for the record: Stripe's decline_code unless it is the generic one, else its code; PayPal's issue. */
export declare function declineCodeOf(d: DeclineInfo): string | undefined;
/** The code the library records when a schedule's saved method is gone (removed by the payer, or never saved). */
export declare const METHOD_REMOVED = "METHOD_REMOVED";
//# sourceMappingURL=declines.d.ts.map