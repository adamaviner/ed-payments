import { type Method, type Processor } from './types.js';
export interface FeeSchedule {
    /** Percentage in hundredths of a percent: 290 = 2.9%. */
    basisPoints: number;
    fixedCents: number;
    /** null = uncapped. */
    capCents: number | null;
}
export interface FeeRates {
    stripe: {
        card: FeeSchedule;
        ach: FeeSchedule;
    };
    paypal: {
        card: FeeSchedule;
        paypal: FeeSchedule;
    };
}
export type FeeRatesInput = {
    stripe?: Partial<FeeRates['stripe']>;
    paypal?: Partial<FeeRates['paypal']>;
};
export declare const BASIS_POINTS_DENOMINATOR = 10000;
/** Stripe's standard US card rate: 2.9% + 30¢. */
export declare const STRIPE_CARD_RATE: FeeSchedule;
/** Stripe's US bank account (ACH) rate: 0.8%, capped at $5. */
export declare const STRIPE_ACH_RATE: FeeSchedule;
/** No processor (cash, a cheque). */
export declare const NO_FEE: FeeSchedule;
/** ed-market's numbers before the library: Stripe's rates, used for PayPal too until real PayPal rates are passed. */
export declare const DEFAULT_FEE_RATES: FeeRates;
/**
 * At or above this total, checkout steers the buyer toward ACH. $500 is where the saving stops being
 * noise: a card costs $14.80 in fees there, ACH $4.00.
 */
export declare const LARGE_TRANSACTION_THRESHOLD_CENTS = 50000;
/** The defaults with an app's overrides on top, checked. */
export declare function feeRates(overrides?: FeeRatesInput): FeeRates;
export declare function feeSchedule(rates: FeeRates, processor: Processor, method: Method): FeeSchedule;
/**
 * What the processor takes out of a charge of `chargedCents`. Rounded up to the cent, so a buyer is
 * never quoted less than the processor will deduct. A zero charge has no fee.
 */
export declare function estimateProcessingFee(chargedCents: number, schedule: FeeSchedule): number;
/**
 * The smallest total to charge so that, after the processor's cut, exactly `netCents` is left.
 * Solving total − (rate × total + fixed) = net gives total = ceil((net + fixed) × 10 000 / (10 000 − bp)).
 * The naive "add the fee on the net" under-collects, because the cut is taken on the grossed-up
 * total. A capped schedule never needs more than net + cap.
 */
export declare function grossUpForProcessingFee(netCents: number, schedule: FeeSchedule): number;
/**
 * The fee on a transaction meant to net `netCents`: when the buyer covers it, the gross-up added on
 * top; when they don't, the processor's cut of the net itself.
 */
export declare function processingFeeFor(netCents: number, schedule: FeeSchedule, covered: boolean): number;
/**
 * The fee of a recorded sale, from the amounts it stores: when the buyer covered it, whatever the
 * total carries above the price and any extra (a donation); otherwise the processor's cut of the total.
 */
export declare function processingFeeFromAmounts(a: {
    totalChargedCents: number;
    basePriceCents: number;
    extraCents?: number;
    covered: boolean;
}, schedule: FeeSchedule): number;
export declare const isLargeTransaction: (totalCents: number, thresholdCents?: number) => boolean;
export interface ProcessingFeeComparison {
    cardFeeCents: number;
    achFeeCents: number;
    /** How much paying by ACH saves. */
    achSavingsCents: number;
    /** Suggest ACH: the transaction is large. */
    steerToAch: boolean;
}
/** The card-versus-ACH fee difference to show at checkout, from the same function the buyer is quoted by. */
export declare function compareProcessingFees(netCents: number, covered: boolean, schedules: {
    card: FeeSchedule;
    ach: FeeSchedule;
}, thresholdCents?: number): ProcessingFeeComparison;
//# sourceMappingURL=fees.d.ts.map