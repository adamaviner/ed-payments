// Stripe's and PayPal's fields live in frames that can't see the page's CSS, so they only take literal
// colours. Apps used to copy their palette into a light and a dark set by hand, and the copies drifted
// from the real tokens. Instead this reads the app's own colour variables from the page when the fields
// appear, and again when the theme changes, and builds both processors' styles from them.
//
// A 1-pixel canvas turns whatever the browser computed (oklch(), color(srgb ...), hex, rgb) into plain
// rgb, which both processors take, the same way in every browser; colours outside sRGB are clipped,
// which is fine for a form. A value the canvas doesn't take, a missing variable or a page without a
// canvas falls back to Stripe's own light or dark theme, so the fields are never white on a dark page.
import { useCallback, useRef, useSyncExternalStore } from 'react'
import type { StripeAppearance } from './stripe.js'
import type { PaypalFieldStyle } from './vault.js'

/** The names of the app's CSS custom properties to read, e.g. `'--background'`. */
export interface PageColors {
  background: string
  text: string
  mutedText: string
  primary: string
  danger: string
  border: string
  /** Passed to Stripe as written (e.g. 0.625rem): a length, not a colour. */
  radius?: string
}

/** What to give the Stripe forms (`appearance`) and PayPal's card fields (`style`). */
export interface PageTheme {
  dark: boolean
  stripe: StripeAppearance
  paypal: PaypalFieldStyle
}

type Paint = {
  fillStyle: string | CanvasGradient | CanvasPattern
  clearRect(x: number, y: number, w: number, h: number): void
  fillRect(x: number, y: number, w: number, h: number): void
  getImageData(x: number, y: number, w: number, h: number): { data: ArrayLike<number> }
}

function painted(ctx: Paint, before: string, value: string): number[] {
  ctx.fillStyle = before
  ctx.fillStyle = value
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillRect(0, 0, 1, 1)
  return Array.from(ctx.getImageData(0, 0, 1, 1).data)
}

/**
 * The colour as rgb() or rgba(), or null when it isn't one: a canvas ignores a fill it can't parse and
 * keeps the previous one, so a real colour paints the same over a black and a white previous fill.
 */
function plain(ctx: Paint, value: string): string | null {
  if (!value) return null
  const a = painted(ctx, '#000', value)
  const b = painted(ctx, '#fff', value)
  if (a.join() !== b.join()) return null
  const [r, g, bl, alpha] = a
  return alpha === 255 ? `rgb(${r}, ${g}, ${bl})` : `rgba(${r}, ${g}, ${bl}, ${Math.round((alpha / 255) * 100) / 100})`
}

const isDarkRgb = (rgb: string) => {
  const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).map(Number)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128
}

/** Without colours to go by: the theme class on <html> (dark or light), else the system setting. */
function darkWithoutColours(): boolean {
  if (typeof document === 'undefined') return false
  const html = document.documentElement.classList
  if (html.contains('dark')) return true
  if (html.contains('light')) return false
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

function fallback(): PageTheme {
  const dark = darkWithoutColours()
  return dark ? { dark, stripe: { theme: 'night' }, paypal: { input: { color: '#fafafa', background: 'transparent' } } } : { dark, stripe: { theme: 'stripe' }, paypal: {} }
}

/** Reads the page's colours now. On the server, or when they can't be read, Stripe's own theme. */
export function pageTheme(vars: PageColors): PageTheme {
  if (typeof document === 'undefined') return fallback()
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as Paint | null
  if (!ctx) return fallback()
  const style = getComputedStyle(document.documentElement)
  const read = (name: string) => plain(ctx, style.getPropertyValue(name).trim())
  const background = read(vars.background)
  const text = read(vars.text)
  const mutedText = read(vars.mutedText)
  const primary = read(vars.primary)
  const danger = read(vars.danger)
  const border = read(vars.border)
  if (!background || !text || !mutedText || !primary || !danger || !border) return fallback()
  const dark = isDarkRgb(background)
  const radius = vars.radius ? style.getPropertyValue(vars.radius).trim() : ''
  const line = `1px solid ${border}`
  return {
    dark,
    stripe: {
      theme: dark ? 'night' : 'stripe',
      variables: { colorBackground: background, colorText: text, colorTextSecondary: mutedText, colorPrimary: primary, colorDanger: danger, ...(radius ? { borderRadius: radius } : {}) },
      rules: { '.Input': { border: line }, '.Tab': { border: line } },
    },
    paypal: { input: { color: text, background, border: line }, '.invalid': { color: danger } },
  }
}

/**
 * The page's theme for the payment fields, read again whenever the class, style or data-theme of <html>
 * or the system's dark setting changes. Undefined while rendering on the server, where there is no page;
 * the browser's first render fills it in before Stripe's frame is made.
 */
export function usePageTheme(vars: PageColors): PageTheme | undefined {
  const version = useRef(0)
  const cache = useRef<{ version: number; key: string; json: string; value: PageTheme } | null>(null)
  const key = JSON.stringify(vars)

  const subscribe = useCallback((changed: () => void) => {
    const bump = () => {
      version.current++
      changed()
    }
    const observer = new MutationObserver(bump)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
    const system = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null
    system?.addEventListener('change', bump)
    return () => {
      observer.disconnect()
      system?.removeEventListener('change', bump)
    }
  }, [])

  const snapshot = () => {
    const c = cache.current
    if (c && c.version === version.current && c.key === key) return c.value
    const value = pageTheme(JSON.parse(key) as PageColors)
    const json = JSON.stringify(value)
    // The same object while the colours are the same, so a form restyles only when they change.
    const kept = c && c.json === json ? c.value : value
    cache.current = { version: version.current, key, json, value: kept }
    return kept
  }

  return useSyncExternalStore(subscribe, snapshot, () => undefined)
}
