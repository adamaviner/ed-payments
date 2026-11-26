// Processing-fee math, moved from ed-market's src/lib/fees.ts (the generic half). Every amount is an
// integer number of cents; percentages are applied to integer cents and rounded explicitly, so no
// float ever reaches a stored value. The rates are configuration: each processor and method has its
// own schedule, and the defaults are Stripe's published US rates for every one of them, so an app's
// prices don't change until it passes the real numbers (PayPal's nonprofit rates, say).
import { assertCents } from './money.js'
import { isMethodFor, type Method, type Processor } from './types.js'

export interface FeeSchedule {
  /** Percentage in hundredths of a percent: 290 = 2.9%. */
  basisPoints: number
  fixedCents: number
  /** null = uncapped. */
  capCents: number | null
}

export interface FeeRates {
  stripe: { card: FeeSchedule; ach: FeeSchedule }
  paypal: { card: FeeSchedule; paypal: FeeSchedule }
}

export type FeeRatesInput = { stripe?: Partial<FeeRates['stripe']>; paypal?: Partial<FeeRates['paypal']> }

export const BASIS_POINTS_DENOMINATOR = 10_000

/** Stripe's standard US card rate: 2.9% + 30¢. */
export const STRIPE_CARD_RATE: FeeSchedule = { basisPoints: 290, fixedCents: 30, capCents: null }
/** Stripe's US bank account (ACH) rate: 0.8%, capped at $5. */
export const STRIPE_ACH_RATE: FeeSchedule = { basisPoints: 80, fixedCents: 0, capCents: 500 }
/** No processor (cash, a cheque). */
export const NO_FEE: FeeSchedule = { basisPoints: 0, fixedCents: 0, capCents: 0 }

/** ed-market's numbers before the library: Stripe's rates, used for PayPal too until real PayPal rates are passed. */
export const DEFAULT_FEE_RATES: FeeRates = {
  stripe: { card: STRIPE_CARD_RATE, ach: STRIPE_ACH_RATE },
  paypal: { card: STRIPE_CARD_RATE, paypal: STRIPE_CARD_RATE },
}

/**
 * At or above this total, checkout steers the buyer toward ACH. $500 is where the saving stops being
 * noise: a card costs $14.80 in fees there, ACH $4.00.
 */
export const LARGE_TRANSACTION_THRESHOLD_CENTS = 50_000

function checkSchedule(where: string, s: FeeSchedule): FeeSchedule {
  const ok = Number.isInteger(s.basisPoints) && s.basisPoints >= 0 && s.basisPoints < BASIS_POINTS_DENOMINATOR && Number.isInteger(s.fixedCents) && s.fixedCents >= 0
  if (!ok || (s.capCents !== null && !(Number.isInteger(s.capCents) && s.capCents >= 0))) throw new Error(`The fee rate for ${where} isn’t valid.`)
  return s
}

/** The defaults with an app's overrides on top, checked. */
export function feeRates(overrides: FeeRatesInput = {}): FeeRates {
  const stripe = { ...DEFAULT_FEE_RATES.stripe, ...overrides.stripe }
  const paypal = { ...DEFAULT_FEE_RATES.paypal, ...overrides.paypal }
  return {
    stripe: { card: checkSchedule('Stripe card', stripe.card), ach: checkSchedule('Stripe ACH', stripe.ach) },
    paypal: { card: checkSchedule('PayPal card', paypal.card), paypal: checkSchedule('PayPal', paypal.paypal) },
  }
}

export function feeSchedule(rates: FeeRates, processor: Processor, method: Method): FeeSchedule {
  if (!isMethodFor(processor, method)) throw new Error(`${processor} doesn’t take ${method} payments.`)
  return processor === 'stripe' ? rates.stripe[method as 'card' | 'ach'] : rates.paypal[method as 'card' | 'paypal']
}

/**
 * What the processor takes out of a charge of `chargedCents`. Rounded up to the cent, so a buyer is
 * never quoted less than the processor will deduct. A zero charge has no fee.
 */
export function estimateProcessingFee(chargedCents: number, schedule: FeeSchedule): number {
  assertCents('chargedCents', chargedCents)
  if (chargedCents === 0) return 0
  const fee = Math.ceil((chargedCents * schedule.basisPoints) / BASIS_POINTS_DENOMINATOR) + schedule.fixedCents
  return schedule.capCents === null ? fee : Math.min(fee, schedule.capCents)
}

/**
 * The smallest total to charge so that, after the processor's cut, exactly `netCents` is left.
 * Solving total − (rate × total + fixed) = net gives total = ceil((net + fixed) × 10 000 / (10 000 − bp)).
 * The naive "add the fee on the net" under-collects, because the cut is taken on the grossed-up
 * total. A capped schedule never needs more than net + cap.
 */
export function grossUpForProcessingFee(netCents: number, schedule: FeeSchedule): number {
  assertCents('netCents', netCents)
  if (netCents === 0) return 0
  const uncapped = Math.ceil(((netCents + schedule.fixedCents) * BASIS_POINTS_DENOMINATOR) / (BASIS_POINTS_DENOMINATOR - schedule.basisPoints))
  return schedule.capCents === null ? uncapped : Math.min(uncapped, netCents + schedule.capCents)
}

/**
 * The fee on a transaction meant to net `netCents`: when the buyer covers it, the gross-up added on
 * top; when they don't, the processor's cut of the net itself.
 */
export function processingFeeFor(netCents: number, schedule: FeeSchedule, covered: boolean): number {
  return covered ? grossUpForProcessingFee(netCents, schedule) - netCents : estimateProcessingFee(netCents, schedule)
}

/**
 * The fee of a recorded sale, from the amounts it stores: when the buyer covered it, whatever the
 * total carries above the price and any extra (a donation); otherwise the processor's cut of the total.
 */
export function processingFeeFromAmounts(a: { totalChargedCents: number; basePriceCents: number; extraCents?: number; covered: boolean }, schedule: FeeSchedule): number {
  return a.covered ? a.totalChargedCents - a.basePriceCents - (a.extraCents ?? 0) : estimateProcessingFee(a.totalChargedCents, schedule)
}

export const isLargeTransaction = (totalCents: number, thresholdCents: number = LARGE_TRANSACTION_THRESHOLD_CENTS) => totalCents >= thresholdCents

export interface ProcessingFeeComparison {
  cardFeeCents: number
  achFeeCents: number
  /** How much paying by ACH saves. */
  achSavingsCents: number
  /** Suggest ACH: the total paid by card (the fee included when the buyer covers it) is large. */
  steerToAch: boolean
}

/** The card-versus-ACH fee difference to show at checkout, from the same function the buyer is quoted by. */
export function compareProcessingFees(netCents: number, covered: boolean, schedules: { card: FeeSchedule; ach: FeeSchedule }, thresholdCents?: number): ProcessingFeeComparison {
  const cardFeeCents = processingFeeFor(netCents, schedules.card, covered)
  const achFeeCents = processingFeeFor(netCents, schedules.ach, covered)
  const cardTotalCents = covered ? netCents + cardFeeCents : netCents
  return { cardFeeCents, achFeeCents, achSavingsCents: Math.max(0, cardFeeCents - achFeeCents), steerToAch: isLargeTransaction(cardTotalCents, thresholdCents) }
}

export interface QuoteArgs {
  /** What the thing costs, before any fee the payer covers. */
  amountCents: number
  method: Method
  /** The payer adds the fee, so that amountCents is left after the processor's cut. */
  coverFee: boolean
}

export interface Quote {
  /** Who takes it: the cheaper for a card (of those the app has), Stripe for a bank account, PayPal for a PayPal account. */
  processor: Processor
  method: Method
  amountCents: number
  /** The processor's fee on this payment: the gross-up when the payer covers it, else its cut of amountCents. */
  feeCents: number
  /** What the payer is charged: amountCents, plus feeCents when they cover it. */
  totalCents: number
}

/**
 * What a payment costs and who takes it, from the app's fee rates: the same answer on the server (price before start)
 * and on the page (which card fields to show, the price line). A card goes to the processor whose fee is lower for this
 * amount (its gross-up when the payer covers the fee), Stripe on a tie, among `cardProcessors` (default both; e.g. only
 * Stripe when the app has no PayPal keys).
 */
export function quote(a: QuoteArgs, rates: FeeRates, o: { cardProcessors?: readonly Processor[] } = {}): Quote {
  assertCents('amountCents', a.amountCents)
  const fee = (processor: Processor) => processingFeeFor(a.amountCents, feeSchedule(rates, processor, a.method), a.coverFee)
  let processor: Processor
  if (a.method === 'card') {
    const allowed = (['stripe', 'paypal'] as const).filter((x) => !o.cardProcessors || o.cardProcessors.includes(x))
    if (allowed.length === 0) throw new Error('No processor here takes cards.')
    processor = allowed.reduce((best, x) => (fee(x) < fee(best) ? x : best))
  } else processor = a.method === 'ach' ? 'stripe' : 'paypal'
  const feeCents = fee(processor)
  return { processor, method: a.method, amountCents: a.amountCents, feeCents, totalCents: a.amountCents + (a.coverFee ? feeCents : 0) }
}

/** What a card charge of this amount costs at each processor, and the cheaper one. */
export interface CardProcessorChoice {
  processor: Processor
  feeCents: Record<Processor, number>
}

/**
 * Which processor a card for a charge of `amountCents` should go to: the one whose fee (from the app's
 * rates) is lower, Stripe on a tie. With a percentage plus a fixed fee each, one is cheaper below a
 * crossover and the other above it (2.9% + 30¢ against 1.99% + 49¢ cross near $21).
 */
export function cheaperCardProcessor(amountCents: number, rates: FeeRates): CardProcessorChoice {
  assertCents('amountCents', amountCents)
  const feeCents = { stripe: estimateProcessingFee(amountCents, rates.stripe.card), paypal: estimateProcessingFee(amountCents, rates.paypal.card) }
  return { processor: feeCents.paypal < feeCents.stripe ? 'paypal' : 'stripe', feeCents }
}
