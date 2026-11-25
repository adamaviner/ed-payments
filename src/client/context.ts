// Checks a value against a Convex validator at run time. convex/values has no such function (only
// the automatic checks of function arguments), and the context an app passes to start or
// chargeSaved is stored by the component as any: checking it here means a wrong context is refused
// when the checkout starts, not when the money has arrived and the callback can't accept it.
import type { GenericValidator } from 'convex/values'

/** Why `value` doesn't fit `validator` (with where), or null when it does. */
export function mismatch(validator: GenericValidator, value: unknown, path = 'context'): string | null {
  if (value === undefined) return validator.isOptional === 'optional' ? null : `${path} is missing`
  switch (validator.kind) {
    case 'any':
      return null
    case 'string':
      return typeof value === 'string' ? null : `${path} should be a string`
    // The table can't be read from an id here, but its shape can: Convex ids are lower-case letters and digits.
    case 'id':
      return typeof value === 'string' && CONVEX_ID.test(value) ? null : `${path} should be a document id`
    case 'float64':
      return typeof value === 'number' ? null : `${path} should be a number`
    case 'int64':
      return typeof value === 'bigint' ? null : `${path} should be a bigint`
    case 'boolean':
      return typeof value === 'boolean' ? null : `${path} should be true or false`
    case 'null':
      return value === null ? null : `${path} should be null`
    case 'bytes':
      return value instanceof ArrayBuffer ? null : `${path} should be bytes`
    case 'literal':
      return value === validator.value ? null : `${path} should be ${JSON.stringify(validator.value)}`
    case 'array':
      if (!Array.isArray(value)) return `${path} should be a list`
      for (let i = 0; i < value.length; i++) {
        const m = mismatch(validator.element, value[i], `${path}[${i}]`)
        if (m) return m
      }
      return null
    case 'record': {
      if (!isPlainObject(value)) return `${path} should be an object`
      for (const [k, x] of Object.entries(value)) {
        const m = mismatch(validator.key, k, `${path} key`) ?? mismatch(validator.value, x, `${path}.${k}`)
        if (m) return m
      }
      return null
    }
    case 'object': {
      if (!isPlainObject(value)) return `${path} should be an object`
      const fields: Record<string, GenericValidator> = validator.fields
      for (const [k, f] of Object.entries(fields)) {
        const m = mismatch(f, value[k], `${path}.${k}`)
        if (m) return m
      }
      const extra = Object.keys(value).find((k) => !(k in fields) && value[k] !== undefined)
      return extra ? `${path}.${extra} isn't expected` : null
    }
    case 'union': {
      const members: GenericValidator[] = validator.members
      return members.some((m) => mismatch(m, value, path) === null) ? null : `${path} matches none of the allowed shapes`
    }
    // Kinds that can't be stored in a checkout's context; Convex checks them anyway when the callback runs.
    case 'commitTs':
    case 'function':
      return null
  }
  // A kind of validator newer than this check: Convex still validates it when the callback is called.
  return null
}

const CONVEX_ID = /^[0-9a-z]{20,64}$/

const isPlainObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
