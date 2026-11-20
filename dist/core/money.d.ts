export declare function assertCents(label: string, value: number): void;
/** 2500 → "25.00". */
export declare function centsToDecimal(cents: number): string;
/** "25.00" / "25.5" / "25" → 2500 / 2550 / 2500; anything else → null. */
export declare function decimalToCents(value: string | undefined | null): number | null;
/** $12.34, for messages. */
export declare function dollars(cents: number): string;
//# sourceMappingURL=money.d.ts.map