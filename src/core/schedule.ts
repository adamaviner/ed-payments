// The calendar of a monthly schedule, in UTC: each period is a month ('YYYY-MM'), charged on the
// schedule's anchor day (1-28, so every month has one) at a set hour. Failed charges are retried a
// few days after the first failure; one refused for insufficient funds is moved to the 1st or 15th
// (common paydays) when one comes soon after, to recover more of what a smart retry would.
import type { DeclineKind } from './declines.js'

const DAY = 24 * 60 * 60 * 1000

/** Default retry offsets, in days after the period's first failure; after the last one fails the schedule lapses. */
export const DEFAULT_RETRY_DAYS: readonly number[] = [3, 5, 7]
/** Default hour (UTC) charges are made: 15:00 UTC is 10 or 11 in the morning in New York. */
export const DEFAULT_CHARGE_HOUR_UTC = 15
/** How far a retry for insufficient funds may be moved to reach the 1st or 15th of a month. */
const PAYDAY_SLACK_DAYS = 4

export interface ScheduleClock {
  anchorDay: number
  hourUTC: number
}

/** 'YYYY-MM' of a time, in UTC. */
export function periodOf(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** The period after (or before, with a negative step) a period. */
export function shiftPeriod(period: string, months: number): string {
  const [y, m] = period.split('-').map(Number)
  return periodOf(Date.UTC(y, m - 1 + months, 1))
}

/** When a period is charged. */
export function chargeTimeOf(period: string, c: ScheduleClock): number {
  const [y, m] = period.split('-').map(Number)
  return Date.UTC(y, m - 1, c.anchorDay, c.hourUTC)
}

/** The first charge time at or after `ms`. */
export function firstChargeFrom(ms: number, c: ScheduleClock): number {
  const here = chargeTimeOf(periodOf(ms), c)
  return here >= ms ? here : chargeTimeOf(shiftPeriod(periodOf(ms), 1), c)
}

/** An anchor day for a schedule starting at `ms`: that day of the month, kept to 1-28. */
export function anchorDayOf(ms: number): number {
  return Math.min(new Date(ms).getUTCDate(), 28)
}

export function isAnchorDay(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 28
}

/**
 * When to try a failed period again: `failures` refusals so far, the first at `firstFailedAt`.
 * Null when the retries are used up (the schedule lapses). Hard declines aren't retried at all.
 */
export function retryTime(o: { firstFailedAt: number; failures: number; kind: DeclineKind; retryDays: readonly number[]; hourUTC: number }): number | null {
  if (o.kind === 'hard') return null
  const offset = o.retryDays[o.failures - 1]
  if (offset === undefined) return null
  const at = o.firstFailedAt + offset * DAY
  if (o.kind !== 'insufficient_funds') return at
  // The next 1st or 15th at the charge hour, if it is close enough to wait for.
  for (let d = 0; d <= PAYDAY_SLACK_DAYS; d++) {
    const day = new Date(at + d * DAY)
    const date = day.getUTCDate()
    if (date === 1 || date === 15) {
      const payday = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), date, o.hourUTC)
      if (payday >= at) return payday
    }
  }
  return at
}
