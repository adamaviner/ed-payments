// The shape check behind the contract tests (src/testing/contract.test.ts) and the sandbox suites:
// where one processor object differs in shape from another. Shared so the fakes are checked against
// the fixtures, and the fixtures against what the processors answer today, the same way.

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }

const kind = (x: unknown) => (x === null ? 'null' : Array.isArray(x) ? 'a list' : typeof x)

/**
 * Where `fake` differs in shape from `real`: fields `real` lacks, fields of another type, and null where
 * `real` has a value (a fake that answers null where the processor fills the field in would hide the
 * code path that reads it). `fake` may leave fields out. Every element of a list is checked, each
 * against the element of `real`'s list it is closest to (lists mix kinds: a card and a bank account).
 * A field that is an id in one and the object in the other is an expandable field, not a difference.
 * `nullable` names paths (as reported, list indexes as [n]) where the processor sends null too, in
 * another state than the one captured.
 */
export function drift(fake: unknown, real: unknown, o: { nullable?: readonly string[] } = {}, path = ''): string[] {
  if (fake === undefined || real === undefined) return []
  if (fake === null || real === null) {
    if (fake === null && real !== null && !o.nullable?.includes(path.replace(/\[\d+\]/g, '[n]'))) return [`${path}: null where the processor sends ${kind(real)}`]
    return []
  }
  if (Array.isArray(fake) || Array.isArray(real)) {
    if (!Array.isArray(fake) || !Array.isArray(real)) return [`${path}: ${kind(fake)} where the processor sends ${kind(real)}`]
    if (!real.length) return []
    return fake.flatMap((item: unknown, i) => real.map((r: unknown) => drift(item, r, o, `${path}[${i}]`)).reduce((best, next) => (next.length < best.length ? next : best)))
  }
  if (typeof fake !== typeof real) {
    if ((typeof fake === 'string' && typeof real === 'object') || (typeof fake === 'object' && typeof real === 'string')) return []
    return [`${path}: ${kind(fake)} where the processor sends ${kind(real)}`]
  }
  if (typeof fake !== 'object') return []
  const f = fake as Record<string, Json>
  const r = real as Record<string, Json>
  // Metadata is the app's own key-value bag, not the processor's shape.
  return Object.keys(f).flatMap((k) => (k === 'metadata' || k === '_source' ? [] : k in r ? drift(f[k], r[k], o, `${path}.${k}`) : [`${path}.${k}: not in the processor’s object`]))
}

/**
 * How a live answer's fields differ from its fixture's: `+path` a field the processor sends now that the
 * fixture lacks, `-path` one the fixture has that the answer doesn't. For the sandbox suites, so a
 * fixture that has gone stale is seen (and captured again). Metadata, the app's own, is left out; each
 * element of a list is compared with the fixture's element it is closest to. `ignore` names paths
 * whose fields depend on the data rather than the request (what PayPal knows about a card's BIN, say).
 */
export function keyDiff(live: unknown, saved: unknown, o: { ignore?: readonly string[] } = {}, path = ''): string[] {
  const ignored = (p: string) => !!o.ignore?.includes(p.replace(/\[\d+\]/g, '[n]'))
  if (ignored(path)) return []
  if (Array.isArray(live) && Array.isArray(saved)) {
    if (!saved.length) return []
    return live.flatMap((item: unknown, i) => saved.map((s: unknown) => keyDiff(item, s, o, `${path}[${i}]`)).reduce((best, next) => (next.length < best.length ? next : best)))
  }
  if (!live || !saved || typeof live !== 'object' || typeof saved !== 'object' || Array.isArray(live) || Array.isArray(saved)) return []
  const l = live as Record<string, unknown>
  const s = saved as Record<string, unknown>
  const keys = [...new Set([...Object.keys(l), ...Object.keys(s)])].filter((k) => k !== 'metadata' && k !== '_source')
  return keys.flatMap((k) => (ignored(`${path}.${k}`) ? [] : !(k in s) ? [`+${path}.${k}`] : !(k in l) ? [`-${path}.${k}`] : keyDiff(l[k], s[k], o, `${path}.${k}`)))
}
