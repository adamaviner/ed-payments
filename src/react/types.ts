// The functions as the browser sees them: the references an app's codegen makes for the modules that
// re-export payments.adminApi() and payments.publicApi(), typed from the library's own, so an app
// passing `api.paymentsAdmin` gets its arguments and results checked.
import type { ApiFromModules, FunctionReturnType } from 'convex/server'
import type { Value } from 'convex/values'
import type { adminApi, publicApi } from '../client/api.js'

export type PaymentsAdminApi = ApiFromModules<{ paymentsAdmin: ReturnType<typeof adminApi> }>['paymentsAdmin']
export type PaymentsPublicApi = ApiFromModules<{ payments: ReturnType<typeof publicApi> }>['payments']

/** The app's `completeReturn` (from payments.publicApi()). */
export type CompleteReturnRef = PaymentsPublicApi['completeReturn']

/**
 * What the app's authorize.admin query gets as `auth` (ed-schedule: `{ token }`). Opaque to the library
 * (the server takes any value); a Convex value, so it can be sent. Apps on Convex auth leave it out.
 */
export type PaymentsAuth = Value

export type OpenRefund = FunctionReturnType<PaymentsAdminApi['openRefunds']>[number]
export type CheckoutSummary = FunctionReturnType<PaymentsAdminApi['refundable']>['page'][number]
export type PaymentIssue = FunctionReturnType<PaymentsAdminApi['issues']>['page'][number]
export type PaymentRef = CheckoutSummary['ref']
