// Moved from ed-market's src/lib/fees.test.ts (the generic half), with the rates passed in.
import { describe, expect, test } from 'vitest'
import {
  DEFAULT_FEE_RATES,
  LARGE_TRANSACTION_THRESHOLD_CENTS,
  NO_FEE,
  STRIPE_ACH_RATE,
  STRIPE_CARD_RATE,
  compareProcessingFees,
  estimateProcessingFee,
  feeRates,
  feeSchedule,
  grossUpForProcessingFee,
  isLargeTransaction,
  processingFeeFor,
  processingFeeFromAmounts,
  quote,
  type FeeSchedule,
} from './fees.js'

const card = STRIPE_CARD_RATE
const ach = STRIPE_ACH_RATE
const SCHEDULES: [string, FeeSchedule][] = [
  ['card', card],
  ['ach', ach],
  ['paypal nonprofit 1.99% + 49¢', { basisPoints: 199, fixedCents: 49, capCents: null }],
]
const NET_AMOUNTS = [
  0, 1, 2, 7, 29, 30, 31, 34, 35, 50, 99, 100, 101, 137, 345, 499, 500, 501, 999, 1000, 1499, 1500, 2500, 4999, 5000, 9999, 12_345, 49_999, 50_000, 50_001, 61_999, 62_000, 62_001, 62_500, 99_999,
  100_000, 250_000, 1_000_000,
]
const expectCents = (value: number) => expect(Number.isInteger(value) && value >= 0, `${value} should be whole non-negative cents`).toBe(true)

describe('rates', () => {
  test('the defaults are Stripe’s published US rates, for PayPal too, so prices don’t move until real rates are passed', () => {
    expect(card).toEqual({ basisPoints: 290, fixedCents: 30, capCents: null })
    expect(ach).toEqual({ basisPoints: 80, fixedCents: 0, capCents: 500 })
    expect(DEFAULT_FEE_RATES.paypal).toEqual({ card, paypal: card })
  })

  test('overrides replace one schedule and keep the rest; bad numbers are refused', () => {
    const paypalCard = { basisPoints: 199, fixedCents: 49, capCents: null }
    const rates = feeRates({ paypal: { card: paypalCard } })
    expect(feeSchedule(rates, 'paypal', 'card')).toEqual(paypalCard)
    expect(feeSchedule(rates, 'paypal', 'paypal')).toEqual(card)
    expect(feeSchedule(rates, 'stripe', 'ach')).toEqual(ach)
    expect(() => feeRates({ stripe: { card: { basisPoints: 2.9, fixedCents: 30, capCents: null } } })).toThrow(/Stripe card/)
    expect(() => feeRates({ stripe: { ach: { basisPoints: 80, fixedCents: -1, capCents: 500 } } })).toThrow(/Stripe ACH/)
  })

  test('a processor and method that don’t go together have no schedule', () => {
    expect(() => feeSchedule(DEFAULT_FEE_RATES, 'paypal', 'ach')).toThrow(/doesn’t take ach/)
    expect(() => feeSchedule(DEFAULT_FEE_RATES, 'stripe', 'paypal')).toThrow()
  })
})

describe('estimateProcessingFee', () => {
  test('nothing on a zero charge', () => {
    for (const [, s] of SCHEDULES) expect(estimateProcessingFee(0, s)).toBe(0)
  })

  test('card is 2.9% + 30¢, rounded up', () => {
    expect(estimateProcessingFee(1000, card)).toBe(59)
    expect(estimateProcessingFee(1001, card)).toBe(60)
    expect(estimateProcessingFee(10_000, card)).toBe(320)
  })

  test('ACH is 0.8% capped at $5', () => {
    expect(estimateProcessingFee(1000, ach)).toBe(8)
    expect(estimateProcessingFee(62_500, ach)).toBe(500)
    expect(estimateProcessingFee(1_000_000, ach)).toBe(500)
  })

  test('ACH is never dearer than a card; always whole cents', () => {
    for (const c of NET_AMOUNTS) {
      expect(estimateProcessingFee(c, ach)).toBeLessThanOrEqual(estimateProcessingFee(c, card))
      for (const [, s] of SCHEDULES) expectCents(estimateProcessingFee(c, s))
    }
  })

  test('no fee schedule (cash) never charges', () => {
    for (const c of NET_AMOUNTS) {
      expect(estimateProcessingFee(c, NO_FEE)).toBe(0)
      expect(grossUpForProcessingFee(c, NO_FEE)).toBe(c)
    }
  })

  test('refuses fractions and negatives', () => {
    expect(() => estimateProcessingFee(10.5, card)).toThrow(/whole number of cents/)
    expect(() => estimateProcessingFee(-1, card)).toThrow(/whole number of cents/)
    expect(() => estimateProcessingFee(Number.NaN, card)).toThrow(/whole number of cents/)
  })
})

describe('grossUpForProcessingFee', () => {
  test('nets out to the cent, and one cent less would not', () => {
    for (const [name, s] of SCHEDULES) {
      for (const net of NET_AMOUNTS) {
        const total = grossUpForProcessingFee(net, s)
        expect(total - estimateProcessingFee(total, s), `${name} ${net}`).toBe(net)
        if (net > 0) expect(total - 1 - estimateProcessingFee(total - 1, s)).toBeLessThan(net)
      }
    }
  })

  test('nets out across a dense sweep, including the ACH cap boundary', () => {
    for (const [, s] of SCHEDULES) {
      for (let net = 0; net <= 3000; net++) expect(grossUpForProcessingFee(net, s) - estimateProcessingFee(grossUpForProcessingFee(net, s), s)).toBe(net)
      for (let net = 61_000; net <= 63_000; net++) expect(grossUpForProcessingFee(net, s) - estimateProcessingFee(grossUpForProcessingFee(net, s), s)).toBe(net)
    }
  })

  test('the naive markup under-collects; the gross-up doesn’t', () => {
    const naive = 10_000 + estimateProcessingFee(10_000, card)
    expect(naive - estimateProcessingFee(naive, card)).toBe(9990)
    expect(grossUpForProcessingFee(10_000, card)).toBe(10_330)
  })

  test('never adds more than the ACH cap', () => {
    for (const net of NET_AMOUNTS) expect(grossUpForProcessingFee(net, ach) - net).toBeLessThanOrEqual(500)
  })

  test('refuses fractions and negatives', () => {
    expect(() => grossUpForProcessingFee(0.5, card)).toThrow(/whole number of cents/)
    expect(() => grossUpForProcessingFee(-100, ach)).toThrow(/whole number of cents/)
  })
})

describe('processingFeeFor and processingFeeFromAmounts', () => {
  test('covered: the net arrives whole; declined: the cut of the net; covering never costs less', () => {
    for (const [, s] of SCHEDULES) {
      for (const net of NET_AMOUNTS) {
        const covered = processingFeeFor(net, s, true)
        expect(net + covered - estimateProcessingFee(net + covered, s)).toBe(net)
        expect(processingFeeFor(net, s, false)).toBe(estimateProcessingFee(net, s))
        expect(covered).toBeGreaterThanOrEqual(processingFeeFor(net, s, false))
      }
    }
  })

  test('recovers the fee from what a sale stores', () => {
    expect(processingFeeFromAmounts({ totalChargedCents: 10_330 + 500, basePriceCents: 10_000, extraCents: 500, covered: true }, card)).toBe(330)
    expect(processingFeeFromAmounts({ totalChargedCents: 10_000, basePriceCents: 10_000, covered: false }, card)).toBe(320)
  })
})

describe('compareProcessingFees', () => {
  test('agrees with the single estimates and steers to ACH from the threshold', () => {
    for (const covered of [true, false]) {
      for (const net of NET_AMOUNTS) {
        const c = compareProcessingFees(net, covered, { card, ach })
        expect(c.cardFeeCents).toBe(processingFeeFor(net, card, covered))
        expect(c.achFeeCents).toBe(processingFeeFor(net, ach, covered))
        expect(c.achSavingsCents).toBe(c.cardFeeCents - c.achFeeCents)
        expect(c.steerToAch).toBe(net + (covered ? c.cardFeeCents : 0) >= LARGE_TRANSACTION_THRESHOLD_CENTS)
      }
    }
    expect(isLargeTransaction(LARGE_TRANSACTION_THRESHOLD_CENTS - 1)).toBe(false)
    expect(isLargeTransaction(LARGE_TRANSACTION_THRESHOLD_CENTS)).toBe(true)
    expect(isLargeTransaction(100, 100)).toBe(true)
  })

  test('steers on the total the buyer would pay by card, the covered fee included, not on the price alone', () => {
    expect(compareProcessingFees(49_000, true, { card, ach }).steerToAch).toBe(true)
    expect(compareProcessingFees(49_000, false, { card, ach }).steerToAch).toBe(false)
  })

  test('the $500 comparison behind the threshold', () => {
    const { cardFeeCents, achFeeCents } = compareProcessingFees(50_000, false, { card, ach })
    expect(cardFeeCents).toBe(1480)
    expect(achFeeCents).toBe(400)
  })
})

describe('quote', () => {
  const nonprofit: FeeSchedule = { basisPoints: 199, fixedCents: 49, capCents: null }
  const rates = feeRates({ paypal: { card: nonprofit, paypal: nonprofit } })

  test('a card goes to the cheaper processor for the amount, Stripe below the crossover and PayPal above it', () => {
    expect(quote({ amountCents: 1000, method: 'card', coverFee: false }, rates)).toEqual({ processor: 'stripe', method: 'card', amountCents: 1000, feeCents: 59, totalCents: 1000 })
    expect(quote({ amountCents: 10_000, method: 'card', coverFee: false }, rates)).toEqual({ processor: 'paypal', method: 'card', amountCents: 10_000, feeCents: 248, totalCents: 10_000 })
  })

  test('covering the fee adds the gross-up, at the processor whose gross-up is lower', () => {
    expect(quote({ amountCents: 10_000, method: 'card', coverFee: true }, rates)).toEqual({ processor: 'paypal', method: 'card', amountCents: 10_000, feeCents: 254, totalCents: 10_254 })
    expect(quote({ amountCents: 1000, method: 'card', coverFee: true }, rates)).toEqual({ processor: 'stripe', method: 'card', amountCents: 1000, feeCents: 61, totalCents: 1061 })
  })

  test('a bank account is Stripe’s and a PayPal account PayPal’s, whatever the amount', () => {
    expect(quote({ amountCents: 100_000, method: 'ach', coverFee: true }, rates)).toEqual({ processor: 'stripe', method: 'ach', amountCents: 100_000, feeCents: 500, totalCents: 100_500 })
    expect(quote({ amountCents: 500, method: 'paypal', coverFee: false }, rates)).toMatchObject({ processor: 'paypal', feeCents: 59 })
  })

  test('only the processors the app has take a card, and a tie goes to Stripe', () => {
    expect(quote({ amountCents: 10_000, method: 'card', coverFee: false }, rates, { cardProcessors: ['stripe'] })).toMatchObject({ processor: 'stripe', feeCents: 320 })
    expect(quote({ amountCents: 1000, method: 'card', coverFee: false }, rates, { cardProcessors: ['paypal'] })).toMatchObject({ processor: 'paypal', feeCents: 69 })
    expect(quote({ amountCents: 1000, method: 'card', coverFee: false }, DEFAULT_FEE_RATES).processor).toBe('stripe')
    expect(() => quote({ amountCents: 1000, method: 'card', coverFee: false }, rates, { cardProcessors: [] })).toThrow()
  })

  test('agrees with processingFeeFor at every amount', () => {
    for (const coverFee of [true, false]) {
      for (const net of NET_AMOUNTS) {
        const q = quote({ amountCents: net, method: 'card', coverFee }, rates)
        expect(q.feeCents).toBe(Math.min(processingFeeFor(net, rates.stripe.card, coverFee), processingFeeFor(net, rates.paypal.card, coverFee)))
        expect(q.totalCents).toBe(net + (coverFee ? q.feeCents : 0))
      }
    }
  })
})
