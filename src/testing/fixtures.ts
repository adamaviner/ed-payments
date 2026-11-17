// The processors' payloads the tests run on (src/testing/fixtures). Each file says where it came from
// in `_source`: captured from Stripe test mode / PayPal sandbox, a processor's documented sample, or
// a real object with fields changed the way the processor documents. Helpers here clone a fixture and
// set the ids a test needs, so every test starts from a real shape.
import type { PaypalEvent, StripeEvent } from '../core/index.js'
import sCompleted from './fixtures/stripe/checkout.session.completed.json' with { type: 'json' }
import sCompletedAch from './fixtures/stripe/checkout.session.completed-ach.json' with { type: 'json' }
import sCompletedForeign from './fixtures/stripe/checkout.session.completed-foreign.json' with { type: 'json' }
import sAsyncOk from './fixtures/stripe/checkout.session.async_payment_succeeded.json' with { type: 'json' }
import sAsyncFail from './fixtures/stripe/checkout.session.async_payment_failed.json' with { type: 'json' }
import sExpired from './fixtures/stripe/checkout.session.expired.json' with { type: 'json' }
import sChargeRefunded from './fixtures/stripe/charge.refunded.json' with { type: 'json' }
import sRefundCreated from './fixtures/stripe/refund.created.json' with { type: 'json' }
import sRefundUpdated from './fixtures/stripe/refund.updated.json' with { type: 'json' }
import sRefundFailed from './fixtures/stripe/refund.failed.json' with { type: 'json' }
import sDisputeCreated from './fixtures/stripe/charge.dispute.created.json' with { type: 'json' }
import sDisputeClosed from './fixtures/stripe/charge.dispute.closed.json' with { type: 'json' }
import sPiSucceeded from './fixtures/stripe/payment_intent.succeeded.json' with { type: 'json' }
import sSessionOpen from './fixtures/stripe/session-open.json' with { type: 'json' }
import sSessionAchOpen from './fixtures/stripe/session-ach-open.json' with { type: 'json' }
import sSessionExpired from './fixtures/stripe/session-expired.json' with { type: 'json' }
import sSessionList from './fixtures/stripe/session-list.json' with { type: 'json' }
import sPaymentIntent from './fixtures/stripe/payment-intent.json' with { type: 'json' }
import sRefund from './fixtures/stripe/refund.json' with { type: 'json' }
import sErrorMissing from './fixtures/stripe/error-resource-missing.json' with { type: 'json' }
import sErrorExpire from './fixtures/stripe/error-expire-not-open.json' with { type: 'json' }
import pApproved from './fixtures/paypal/CHECKOUT.ORDER.APPROVED.json' with { type: 'json' }
import pCompleted from './fixtures/paypal/PAYMENT.CAPTURE.COMPLETED.json' with { type: 'json' }
import pCompletedForeign from './fixtures/paypal/PAYMENT.CAPTURE.COMPLETED-foreign.json' with { type: 'json' }
import pDeclined from './fixtures/paypal/PAYMENT.CAPTURE.DECLINED.json' with { type: 'json' }
import pPending from './fixtures/paypal/PAYMENT.CAPTURE.PENDING.json' with { type: 'json' }
import pRefunded from './fixtures/paypal/PAYMENT.CAPTURE.REFUNDED.json' with { type: 'json' }
import pReversed from './fixtures/paypal/PAYMENT.CAPTURE.REVERSED.json' with { type: 'json' }
import pDisputeCreated from './fixtures/paypal/CUSTOMER.DISPUTE.CREATED.json' with { type: 'json' }
import pDisputeResolved from './fixtures/paypal/CUSTOMER.DISPUTE.RESOLVED.json' with { type: 'json' }
import pOrderCreated from './fixtures/paypal/order-created.json' with { type: 'json' }
import pOrderUnapproved from './fixtures/paypal/order-unapproved.json' with { type: 'json' }
import pOrderApproved from './fixtures/paypal/order-approved.json' with { type: 'json' }
import pOrderCaptured from './fixtures/paypal/order-captured.json' with { type: 'json' }
import pErrorNotApproved from './fixtures/paypal/error-order-not-approved.json' with { type: 'json' }
import pErrorAlreadyCaptured from './fixtures/paypal/error-order-already-captured.json' with { type: 'json' }
import pSearchNotAuthorized from './fixtures/paypal/transaction-search-not-authorized.json' with { type: 'json' }
import pVerifyFailure from './fixtures/paypal/verify-failure.json' with { type: 'json' }

export const stripeEventFixtures = {
  'checkout.session.completed': sCompleted,
  'checkout.session.completed-ach': sCompletedAch,
  'checkout.session.completed-foreign': sCompletedForeign,
  'checkout.session.async_payment_succeeded': sAsyncOk,
  'checkout.session.async_payment_failed': sAsyncFail,
  'checkout.session.expired': sExpired,
  'charge.refunded': sChargeRefunded,
  'refund.created': sRefundCreated,
  'refund.updated': sRefundUpdated,
  'refund.failed': sRefundFailed,
  'charge.dispute.created': sDisputeCreated,
  'charge.dispute.closed': sDisputeClosed,
  'payment_intent.succeeded': sPiSucceeded,
}

export const stripeObjectFixtures = {
  sessionOpen: sSessionOpen,
  sessionAchOpen: sSessionAchOpen,
  sessionExpired: sSessionExpired,
  sessionList: sSessionList,
  paymentIntent: sPaymentIntent,
  refund: sRefund,
  errorResourceMissing: sErrorMissing,
  errorExpireNotOpen: sErrorExpire,
}

export const paypalEventFixtures = {
  'CHECKOUT.ORDER.APPROVED': pApproved,
  'PAYMENT.CAPTURE.COMPLETED': pCompleted,
  'PAYMENT.CAPTURE.COMPLETED-foreign': pCompletedForeign,
  'PAYMENT.CAPTURE.DECLINED': pDeclined,
  'PAYMENT.CAPTURE.PENDING': pPending,
  'PAYMENT.CAPTURE.REFUNDED': pRefunded,
  'PAYMENT.CAPTURE.REVERSED': pReversed,
  'CUSTOMER.DISPUTE.CREATED': pDisputeCreated,
  'CUSTOMER.DISPUTE.RESOLVED': pDisputeResolved,
}

export const paypalObjectFixtures = {
  orderCreated: pOrderCreated,
  orderUnapproved: pOrderUnapproved,
  orderApproved: pOrderApproved,
  orderCaptured: pOrderCaptured,
  errorOrderNotApproved: pErrorNotApproved,
  errorOrderAlreadyCaptured: pErrorAlreadyCaptured,
  transactionSearchNotAuthorized: pSearchNotAuthorized,
  verifyFailure: pVerifyFailure,
}

export type StripeEventFixture = keyof typeof stripeEventFixtures
export type PaypalEventFixture = keyof typeof paypalEventFixtures

/** A fixture without its `_source` note, as the processor sent it. */
export function fixture<T>(f: T): Omit<T, '_source'> {
  const { _source: _s, ...rest } = structuredClone(f) as T & { _source?: string }
  return rest
}

let seq = 0
const nextId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(++seq).toString(36)}`

/** A Stripe event from a fixture, with fields of its object replaced and a fresh event id unless given. */
export function stripeEvent(name: StripeEventFixture, object: Record<string, unknown> = {}, eventId?: string): StripeEvent {
  const e = fixture(stripeEventFixtures[name]) as unknown as StripeEvent
  Object.assign(e.data.object, object)
  e.id = eventId ?? nextId('evt_test_')
  return e
}

/** A PayPal webhook event from a fixture, with fields of its resource replaced and a fresh event id unless given. */
export function paypalEvent(name: PaypalEventFixture, resource: Record<string, unknown> = {}, eventId?: string): PaypalEvent {
  const e = fixture(paypalEventFixtures[name]) as unknown as PaypalEvent
  Object.assign(e.resource, resource)
  e.id = eventId ?? nextId('WH-TEST-')
  return e
}
