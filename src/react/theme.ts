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
  const html = document.documentElement.classList
  if (html.contains('dark')) return true
  if (html.contains('light')) return false
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

const fallback = (dark: boolean): PageTheme =>
  dark ? { dark, stripe: { theme: 'night' }, paypal: { input: { color: '#fafafa', background: 'transparent' } } } : { dark, stripe: { theme: 'stripe' }, paypal: {} }

/**
 * Painted first: a browser that hides canvas pixels from fingerprinting (Firefox's resistFingerprinting,
 * some extensions) reads back blank or made-up pixels, which would turn every token into the same colour.
 */
const PROBE = '#123456'
const PROBE_RGB = 'rgb(18, 52, 86)'

/** The variables as the page has them now, and the class / system hint for when they can't be used. */
interface Raw {
  values: Record<string, string>
  darkHint: boolean
}

function rawOf(vars: PageColors): Raw {
  const style = getComputedStyle(document.documentElement)
  return { values: Object.fromEntries(Object.entries(vars).map(([k, name]) => [k, style.getPropertyValue(name).trim()])), darkHint: darkWithoutColours() }
}

function themeOf({ values, darkHint }: Raw): PageTheme {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as Paint | null
  if (!ctx || plain(ctx, PROBE) !== PROBE_RGB) return fallback(darkHint)
  const read = (k: keyof PageColors) => plain(ctx, values[k] ?? '')
  const background = read('background')
  const text = read('text')
  const mutedText = read('mutedText')
  const primary = read('primary')
  const danger = read('danger')
  const border = read('border')
  if (!background || !text || !mutedText || !primary || !danger || !border) return fallback(darkHint)
  // A see-through background says nothing about what is behind it.
  const dark = background.startsWith('rgb(') ? isDarkRgb(background) : darkHint
  const radius = values.radius ?? ''
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

/** Reads the page's colours now. On the server, or when they can't be read, Stripe's own theme. */
export function pageTheme(vars: PageColors): PageTheme {
  return typeof document === 'undefined' ? fallback(false) : themeOf(rawOf(vars))
}

/**
 * The page's theme for the payment fields. Looked at again whenever the class, style or data-theme of
 * <html>, the stylesheets in <head> (a code-split route's CSS arriving, a dev server's injected styles)
 * or the system's dark setting change; painted again only when the variables or the hint differ, since
 * some libraries change <html> while scrolling. Undefined while rendering on the server, where there is
 * no page; the browser's first render fills it in before Stripe's frame is made.
 */
export function usePageTheme(vars: PageColors): PageTheme | undefined {
  const version = useRef(0)
  const cache = useRef<{ version: number; key: string; raw: string; value: PageTheme } | null>(null)
  const key = JSON.stringify(vars)

  const subscribe = useCallback((changed: () => void) => {
    const bump = () => {
      version.current++
      changed()
    }
    const links = new Set<HTMLLinkElement>()
    const page = new MutationObserver(bump)
    page.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
    const head = new MutationObserver((records) => {
      for (const r of records)
        for (const node of r.addedNodes)
          if (node instanceof HTMLLinkElement) {
            links.add(node)
            node.addEventListener('load', bump)
          }
      bump()
    })
    head.observe(document.head, { childList: true, subtree: true, characterData: true })
    const system = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null
    system?.addEventListener('change', bump)
    // Anything that changed between the first render and now (a layout effect setting the theme class)
    // had no observer yet; React reads the snapshot again after subscribing, so make it look.
    version.current++
    return () => {
      page.disconnect()
      head.disconnect()
      for (const link of links) link.removeEventListener('load', bump)
      system?.removeEventListener('change', bump)
    }
  }, [])

  const snapshot = () => {
    const c = cache.current
    if (c && c.version === version.current && c.key === key) return c.value
    const raw = rawOf(JSON.parse(key) as PageColors)
    const rawKey = JSON.stringify(raw)
    const value = c && c.key === key && c.raw === rawKey ? c.value : themeOf(raw)
    cache.current = { version: version.current, key, raw: rawKey, value }
    return value
  }

  return useSyncExternalStore(subscribe, snapshot, () => undefined)
}
