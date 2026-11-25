import type { DeclineKind } from './declines.js';
/** Default retry offsets, in days after the period's first failure; after the last one fails the schedule lapses. */
export declare const DEFAULT_RETRY_DAYS: readonly number[];
/** Default hour (UTC) charges are made: 15:00 UTC is 10 or 11 in the morning in New York. */
export declare const DEFAULT_CHARGE_HOUR_UTC = 15;
export interface ScheduleClock {
    anchorDay: number;
    hourUTC: number;
}
/** 'YYYY-MM' of a time, in UTC. */
export declare function periodOf(ms: number): string;
/** The period after (or before, with a negative step) a period. */
export declare function shiftPeriod(period: string, months: number): string;
/** When a period is charged. */
export declare function chargeTimeOf(period: string, c: ScheduleClock): number;
/** The first charge time at or after `ms`. */
export declare function firstChargeFrom(ms: number, c: ScheduleClock): number;
/** An anchor day for a schedule starting at `ms`: that day of the month, kept to 1-28. */
export declare function anchorDayOf(ms: number): number;
export declare function isAnchorDay(n: number): boolean;
/**
 * When to try a failed period again: `failures` refusals so far, the first at `firstFailedAt`.
 * Null when the retries are used up (the schedule lapses). Hard declines aren't retried at all.
 */
export declare function retryTime(o: {
    firstFailedAt: number;
    failures: number;
    kind: DeclineKind;
    retryDays: readonly number[];
    hourUTC: number;
}): number | null;
//# sourceMappingURL=schedule.d.ts.map