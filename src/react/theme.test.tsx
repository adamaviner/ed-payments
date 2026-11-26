// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { pageTheme, usePageTheme, type PageColors } from './theme.js'

const VARS: PageColors = { background: '--background', text: '--foreground', mutedText: '--muted-foreground', primary: '--primary', danger: '--destructive', border: '--border' }

// What a browser's canvas paints for each colour the tests use; anything else is not a colour, so the
// canvas keeps its previous fill, as browsers do.
const PAINT: Record<string, [number, number, number, number]> = {
  '#000': [0, 0, 0, 255],
  '#fff': [255, 255, 255, 255],
  '#123456': [18, 52, 86, 255],
  'oklch(1 0 0)': [255, 255, 255, 255],
  'oklch(0.145 0 0)': [10, 10, 10, 255],
  'oklch(0.556 0 0)': [115, 115, 115, 255],
  'oklch(0.205 0 0)': [23, 23, 23, 255],
  'oklch(0.577 0.245 27.3)': [220, 38, 38, 255],
  'oklch(0.922 0 0)': [229, 229, 229, 255],
  'oklch(0.985 0 0)': [250, 250, 250, 255],
  'oklch(0.708 0 0)': [163, 163, 163, 255],
  'oklch(0.704 0.191 22.2)': [248, 113, 113, 255],
  'oklch(1 0 0 / 10%)': [255, 255, 255, 26],
}
const LIGHT = {
  '--background': 'oklch(1 0 0)',
  '--foreground': 'oklch(0.145 0 0)',
  '--muted-foreground': 'oklch(0.556 0 0)',
  '--primary': 'oklch(0.205 0 0)',
  '--destructive': 'oklch(0.577 0.245 27.3)',
  '--border': 'oklch(0.922 0 0)',
}
const DARK = {
  '--background': 'oklch(0.145 0 0)',
  '--foreground': 'oklch(0.985 0 0)',
  '--muted-foreground': 'oklch(0.708 0 0)',
  '--primary': 'oklch(0.922 0 0)',
  '--destructive': 'oklch(0.704 0.191 22.2)',
  '--border': 'oklch(1 0 0 / 10%)',
}

let canvas: boolean
let hidesPixels: boolean
let contexts: ReturnType<typeof vi.spyOn>
let systemDark: boolean
let systemListeners: (() => void)[]

function fakeCanvas() {
  let fill = '#000'
  let painted: [number, number, number, number] = [0, 0, 0, 0]
  return {
    get fillStyle() {
      return fill
    },
    set fillStyle(v: string) {
      if (PAINT[v]) fill = v
    },
    clearRect: () => {
      painted = [0, 0, 0, 0]
    },
    fillRect: () => {
      painted = PAINT[fill]
    },
    getImageData: () => ({ data: Uint8ClampedArray.from(hidesPixels ? [255, 255, 255, 255] : painted) }),
  }
}

function paint(colors: Record<string, string>) {
  for (const [name, value] of Object.entries(colors)) document.documentElement.style.setProperty(name, value)
}

beforeEach(() => {
  canvas = true
  hidesPixels = false
  systemDark = false
  systemListeners = []
  contexts = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => (canvas ? fakeCanvas() : null)) as unknown as HTMLCanvasElement['getContext'])
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query === '(prefers-color-scheme: dark)' && systemDark,
        addEventListener: (_: string, l: () => void) => systemListeners.push(l),
        removeEventListener: (_: string, l: () => void) => (systemListeners = systemListeners.filter((x) => x !== l)),
      }) as unknown as MediaQueryList,
  )
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  document.documentElement.removeAttribute('style')
  document.documentElement.className = ''
})

test('a light page: its colours as plain rgb in Stripe’s light theme and PayPal’s field style', () => {
  paint(LIGHT)
  expect(pageTheme(VARS)).toEqual({
    dark: false,
    stripe: {
      theme: 'stripe',
      variables: { colorBackground: 'rgb(255, 255, 255)', colorText: 'rgb(10, 10, 10)', colorTextSecondary: 'rgb(115, 115, 115)', colorPrimary: 'rgb(23, 23, 23)', colorDanger: 'rgb(220, 38, 38)' },
      rules: { '.Input': { border: '1px solid rgb(229, 229, 229)' }, '.Tab': { border: '1px solid rgb(229, 229, 229)' } },
    },
    paypal: { input: { color: 'rgb(10, 10, 10)', background: 'rgb(255, 255, 255)', border: '1px solid rgb(229, 229, 229)' }, '.invalid': { color: 'rgb(220, 38, 38)' } },
  })
})

test('a dark page is told by its background, whatever its class; a translucent colour keeps its alpha', () => {
  paint(DARK)
  const theme = pageTheme(VARS)
  expect(theme.dark).toBe(true)
  expect(theme.stripe.theme).toBe('night')
  expect(theme.stripe.variables?.colorBackground).toBe('rgb(10, 10, 10)')
  expect(theme.stripe.rules?.['.Input']).toEqual({ border: '1px solid rgba(255, 255, 255, 0.1)' })
  expect(theme.paypal.input).toEqual({ color: 'rgb(250, 250, 250)', background: 'rgb(10, 10, 10)', border: '1px solid rgba(255, 255, 255, 0.1)' })
})

test('the radius is passed as written when the app names one', () => {
  paint({ ...LIGHT, '--radius': ' 0.625rem' })
  expect(pageTheme({ ...VARS, radius: '--radius' }).stripe.variables?.borderRadius).toBe('0.625rem')
})

test('colours it can’t read fall back to Stripe’s own theme, dark from the class or else the system setting', () => {
  paint({ ...LIGHT, '--primary': 'not a colour' })
  expect(pageTheme(VARS)).toEqual({ dark: false, stripe: { theme: 'stripe' }, paypal: {} })

  document.documentElement.className = 'dark'
  expect(pageTheme(VARS)).toEqual({ dark: true, stripe: { theme: 'night' }, paypal: { input: { color: '#fafafa', background: 'transparent' } } })

  document.documentElement.className = ''
  document.documentElement.style.removeProperty('--primary')
  systemDark = true
  expect(pageTheme(VARS).stripe).toEqual({ theme: 'night' })
})

test('no canvas (or no page) falls back the same way', () => {
  paint(DARK)
  canvas = false
  document.documentElement.className = 'dark'
  expect(pageTheme(VARS).stripe).toEqual({ theme: 'night' })
})

test('the hook follows the theme class on <html> and the system setting, and keeps one object while nothing changes', async () => {
  paint(LIGHT)
  const { result, rerender } = renderHook(() => usePageTheme(VARS))
  const first = result.current
  expect(first?.stripe.theme).toBe('stripe')
  rerender()
  expect(result.current).toBe(first)

  await act(async () => {
    paint(DARK)
    document.documentElement.className = 'dark'
    await Promise.resolve()
  })
  expect(result.current?.stripe.theme).toBe('night')

  await act(async () => {
    document.documentElement.className = ''
    paint(LIGHT)
    document.documentElement.style.setProperty('--primary', 'unknown')
    systemDark = true
    for (const l of systemListeners) l()
  })
  expect(result.current?.stripe).toEqual({ theme: 'night' })
})

test('on the server there is no page: the hook gives nothing, for the browser to fill in', () => {
  function Probe() {
    return usePageTheme(VARS) === undefined ? 'none' : 'theme'
  }
  expect(renderToString(<Probe />)).toBe('none')
})

test('a canvas that hides its pixels from fingerprinting is not believed', () => {
  paint(LIGHT)
  hidesPixels = true
  document.documentElement.className = 'dark'
  expect(pageTheme(VARS)).toEqual({ dark: true, stripe: { theme: 'night' }, paypal: { input: { color: '#fafafa', background: 'transparent' } } })
})

test('a see-through background is light or dark by the class, not by its colour', () => {
  paint({ ...LIGHT, '--background': 'oklch(1 0 0 / 10%)' })
  document.documentElement.className = 'light'
  expect(pageTheme(VARS).stripe.theme).toBe('stripe')
  document.documentElement.className = 'dark'
  expect(pageTheme(VARS).stripe.theme).toBe('night')
})

test('the hook sees a theme set before it subscribed, such as in a layout effect', async () => {
  paint(LIGHT)
  const { result } = renderHook(() => {
    const theme = usePageTheme(VARS)
    useLayoutEffect(() => {
      paint(DARK)
      document.documentElement.className = 'dark'
    }, [])
    return theme
  })
  await waitFor(() => expect(result.current?.stripe.theme).toBe('night'))
})

test('the hook reads a stylesheet arriving in <head>, and again when a linked one loads', async () => {
  let sheet: Record<string, string> = {}
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({ getPropertyValue: (name: string) => sheet[name] ?? '' }) as unknown as CSSStyleDeclaration)
  const { result } = renderHook(() => usePageTheme(VARS))
  expect(result.current?.stripe).toEqual({ theme: 'stripe' })

  sheet = LIGHT
  const link = document.createElement('link')
  await act(async () => {
    document.head.appendChild(link)
  })
  await waitFor(() => expect(result.current?.stripe.variables?.colorBackground).toBe('rgb(255, 255, 255)'))

  sheet = DARK
  act(() => void link.dispatchEvent(new Event('load')))
  expect(result.current?.stripe.theme).toBe('night')
  link.remove()
})

test('a change to <html> that leaves the colours alone keeps the same object and paints nothing', async () => {
  paint(LIGHT)
  const { result } = renderHook(() => usePageTheme(VARS))
  await waitFor(() => expect(result.current?.stripe.theme).toBe('stripe'))
  const first = result.current
  const paints = contexts.mock.calls.length
  await act(async () => {
    document.documentElement.classList.add('scrolling')
    await Promise.resolve()
  })
  expect(result.current).toBe(first)
  expect(contexts.mock.calls.length).toBe(paints)
})
