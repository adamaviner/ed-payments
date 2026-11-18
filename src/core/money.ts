// Integer cents in, integer cents out. PayPal speaks decimal dollar strings ("25.00"); these convert
// without going through floating point, so 0.29 never becomes 28 cents.

const isCents = (value: number) => Number.isInteger(value) && value >= 0

export function assertCents(label: string, value: number): void {
  if (!isCents(value)) throw new Error(`${label} must be a non-negative whole number of cents, got ${value}`)
}

/** 2500 → "25.00". */
export function centsToDecimal(cents: number): string {
  assertCents('amount', cents)
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
}

/** "25.00" / "25.5" / "25" → 2500 / 2550 / 2500; anything else → null. */
export function decimalToCents(value: string | undefined | null): number | null {
  if (typeof value !== 'string') return null
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim())
  if (!m) return null
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
}

/** $12.34, for messages. */
export function dollars(cents: number): string {
  return `$${centsToDecimal(Math.abs(Math.round(cents)))}`
}
