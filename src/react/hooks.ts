import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A ref that always holds the latest value, for callbacks handed to a processor's SDK once (buttons
 * rendered once per order, fields once per style), so they never call a stale prop.
 */
export function useLatest<T>(value: T) {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  })
  return ref
}

/**
 * Runs one submit at a time. The check is on a ref, not on `busy`: two clicks in the same tick both
 * see the old state, and a second submit could pay or save twice (useSaver does the same).
 */
export function useOneAtATime() {
  const running = useRef(false)
  const [busy, setBusy] = useState(false)
  const run = useCallback(async (fn: () => Promise<void>) => {
    if (running.current) return
    running.current = true
    setBusy(true)
    try {
      await fn()
    } finally {
      running.current = false
      setBusy(false)
    }
  }, [])
  return { busy, run }
}
