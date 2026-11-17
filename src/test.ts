/// <reference types="vite/client" />
// For apps' convex-test suites: `import paymentsTest from '@earthdance/payments/test'`, then
// `paymentsTest.register(t)` after `convexTest(schema, modules)`. Exported as TypeScript source (not
// built), because import.meta.glob only works when the app's Vite/Vitest compiles this file.
import type { TestConvex } from 'convex-test'
import { componentsGeneric, type GenericSchema, type SchemaDefinition } from 'convex/server'
import schema from './component/schema.js'
import type { ComponentApi } from './component/_generated/component.js'

const modules = import.meta.glob('./component/**/*.ts')

/**
 * Registers the component with a convex-test instance.
 * @param name - the name it is mounted under in the app's convex.config.ts (`payments` by default).
 */
export function register<Schema extends SchemaDefinition<GenericSchema, boolean>>(t: TestConvex<Schema>, name: string = 'payments') {
  t.registerComponent(name, schema, modules)
  return componentsGeneric()[name] as unknown as ComponentApi
}

export default { register, schema, modules }
