/// <reference types="vite/client" />
// For apps' convex-test suites. Exported as TypeScript source (not built), because import.meta.glob
// only works when the app's Vite/Vitest compiles this file.
//
//   const t = convexTest(schema, modules)
//   const { stripe, paypal } = registerPayments(t)   // the component, and fake processors behind fetch
//   ...
//   await t.fetch('/stripe/webhook', await stripe.pay(sessionId))
import type { TestConvex } from 'convex-test'
import { componentsGeneric, type GenericSchema, type SchemaDefinition } from 'convex/server'
import { vi } from 'vitest'
import schema from './component/schema.js'
import type { ComponentApi } from './component/_generated/component.js'
import { fakePaypal, type FakePaypal, type FakePaypalOptions } from './testing/fakePaypal.js'
import { fakeStripe, type FakeStripe } from './testing/fakeStripe.js'

export { fakeStripe, FAKE_STRIPE_WEBHOOK_SECRET, type FakeStripe, type FakeStripeOptions, type FakeMethodBehaviour } from './testing/fakeStripe.js'
export { fakePaypal, type FakePaypal, type FakePaypalOptions } from './testing/fakePaypal.js'
export { fixture, paypalEvent, paypalEventFixtures, paypalObjectFixtures, stripeEvent, stripeEventFixtures, stripeObjectFixtures } from './testing/fixtures.js'

const modules = import.meta.glob('./component/**/*.ts')

/**
 * Registers the component with a convex-test instance.
 * @param name - the name it is mounted under in the app's convex.config.ts (`payments` by default).
 */
export function register<Schema extends SchemaDefinition<GenericSchema, boolean>>(t: TestConvex<Schema>, name: string = 'payments') {
  t.registerComponent(name, schema, modules)
  return componentsGeneric()[name] as unknown as ComponentApi
}

/**
 * Registers the component and puts fake Stripe and PayPal behind the global fetch (vi.stubGlobal;
 * undone by vi.unstubAllGlobals, or vitest's unstubGlobals option). Calls to other addresses go to
 * `fallback` (default: the real fetch). The app's keys must be test ones: the fake Stripe signs
 * webhooks with FAKE_STRIPE_WEBHOOK_SECRET, which the app's STRIPE_WEBHOOK_SECRET must be in tests.
 */
export function registerPayments<Schema extends SchemaDefinition<GenericSchema, boolean>>(
  t: TestConvex<Schema>,
  o: { name?: string; paypal?: Omit<FakePaypalOptions, 'fallback'>; fallback?: (input: string, init?: RequestInit) => Promise<Response> } = {},
): { component: ComponentApi; stripe: FakeStripe; paypal: FakePaypal } {
  const component = register(t, o.name)
  const real = globalThis.fetch
  const fallback = o.fallback ?? ((input: string, init?: RequestInit) => real(input, init))
  const paypal = fakePaypal({ ...o.paypal, fallback })
  const stripe = fakeStripe({ fallback: paypal.fetch })
  vi.stubGlobal('fetch', stripe.fetch)
  return { component, stripe, paypal }
}

export default { register, registerPayments, schema, modules }
