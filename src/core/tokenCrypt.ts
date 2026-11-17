// Encrypts the cached PayPal access token before the component stores it, so a copy of the database
// alone can't call PayPal as the organisation. The key comes from the PayPal client secret, which the
// component never sees; a different secret (a new app, live instead of sandbox) can't open it, and
// the client simply fetches a fresh token.
const encoder = new TextEncoder()

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function key(secret: string): Promise<CryptoKey> {
  if (!secret) throw new Error('No secret was given to encrypt the PayPal token with.')
  const raw = await crypto.subtle.digest('SHA-256', encoder.encode(`earthdance payments token:${secret}`))
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

/** "iv.ciphertext", both base64. */
export async function encryptToken(secret: string, token: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(secret), encoder.encode(token))
  return `${toBase64(iv)}.${toBase64(new Uint8Array(sealed))}`
}

/** The token, or null when it was sealed with another secret or isn't a sealed token. */
export async function decryptToken(secret: string, stored: string): Promise<string | null> {
  const [iv, data] = stored.split('.')
  if (!iv || !data) return null
  try {
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, await key(secret), fromBase64(data)))
  } catch {
    return null
  }
}

/** A short fingerprint of which PayPal account and environment a token belongs to (never the secret). */
export async function accountFingerprint(apiBase: string, clientId: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(`${apiBase}|${clientId}`)))
  return toBase64(digest.slice(0, 12))
}
