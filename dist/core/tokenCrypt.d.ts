/** "iv.ciphertext", both base64. */
export declare function encryptToken(secret: string, token: string): Promise<string>;
/** The token, or null when it was sealed with another secret or isn't a sealed token. */
export declare function decryptToken(secret: string, stored: string): Promise<string | null>;
/** A short fingerprint of which PayPal account and environment a token belongs to (never the secret). */
export declare function accountFingerprint(apiBase: string, clientId: string): Promise<string>;
//# sourceMappingURL=tokenCrypt.d.ts.map