// Integer cents in, integer cents out. PayPal speaks decimal dollar strings ("25.00"); these convert
// without going through floating point, so 0.29 never becomes 28 cents.
const isCents = (value) => Number.isInteger(value) && value >= 0;
export function assertCents(label, value) {
    if (!isCents(value))
        throw new Error(`${label} must be a non-negative whole number of cents, got ${value}`);
}
/** 2500 → "25.00". */
export function centsToDecimal(cents) {
    assertCents('amount', cents);
    return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}
/** "25.00" / "25.5" / "25" → 2500 / 2550 / 2500; anything else → null. */
export function decimalToCents(value) {
    if (typeof value !== 'string')
        return null;
    const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
    if (!m)
        return null;
    return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}
/** $12.34, for messages. */
export function dollars(cents) {
    return `$${centsToDecimal(Math.abs(Math.round(cents)))}`;
}
//# sourceMappingURL=money.js.map