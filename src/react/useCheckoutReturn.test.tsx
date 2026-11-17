// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import type { CompleteReturnRef } from './types.js'
import { useCheckoutReturn } from './useCheckoutReturn.js'

type Answer = { status: string; purpose: string; ref: { type: string; id: string } } | null
const completeReturn = vi.fn<(a: { processor: string; token: string }) => Promise<Answer>>()

vi.mock('convex/react', () => ({ useAction: () => completeReturn }))

const ref = 'payments:completeReturn' as unknown as CompleteReturnRef
const paid: Answer = { status: 'paid', purpose: 'order', ref: { type: 'order', id: 'o1' } }

afterEach(() => {
  cleanup()
  completeReturn.mockReset()
})

/** A promise the test settles when it wants, so a call can be in flight across renders. */
function later<T>() {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

test('asks once under StrictMode, whose effects run twice', async () => {
  completeReturn.mockResolvedValue(paid)
  const { result } = renderHook(() => useCheckoutReturn(ref, { processor: 'stripe', token: 'cs_strict' }), { wrapper: StrictMode })
  expect(result.current.state).toBe('checking')
  await waitFor(() => expect(result.current.state).toBe('paid'))
  expect(completeReturn).toHaveBeenCalledTimes(1)
  expect(completeReturn).toHaveBeenCalledWith({ processor: 'stripe', token: 'cs_strict' })
  expect(result.current).toMatchObject({ purpose: 'order', ref: { type: 'order', id: 'o1' } })
})

test('two mounts of the same return while the call is in flight share it', async () => {
  const call = later<Answer>()
  completeReturn.mockReturnValue(call.promise)
  const a = renderHook(() => useCheckoutReturn(ref, { processor: 'paypal', token: 'PP-1' }))
  const b = renderHook(() => useCheckoutReturn(ref, { processor: 'paypal', token: 'PP-1' }))
  await act(async () => call.resolve({ ...paid, status: 'processing' }))
  expect(a.result.current.state).toBe('processing')
  expect(b.result.current.state).toBe('processing')
  expect(completeReturn).toHaveBeenCalledTimes(1)
})

test('re-rendering after the answer does not ask again', async () => {
  completeReturn.mockResolvedValue(paid)
  const { result, rerender } = renderHook(() => useCheckoutReturn(ref, { processor: 'stripe', token: 'cs_rerender' }))
  await waitFor(() => expect(result.current.state).toBe('paid'))
  rerender()
  rerender()
  expect(completeReturn).toHaveBeenCalledTimes(1)
})

test('no token in the address: an error, and nothing is asked', () => {
  const { result } = renderHook(() => useCheckoutReturn(ref, { processor: 'stripe', token: null }))
  expect(result.current).toMatchObject({ state: 'error', reason: 'no_token' })
  expect(completeReturn).not.toHaveBeenCalled()
})

test('maps every checkout status to a state', async () => {
  const cases: [string | null, string][] = [
    ['refund_needed', 'refund_needed'],
    ['failed', 'failed'],
    ['abandoned', 'cancelled'],
    ['pending', 'cancelled'],
    [null, 'error'],
  ]
  for (const [status, state] of cases) {
    completeReturn.mockResolvedValueOnce(status ? { ...paid, status } : null)
    const { result } = renderHook(() => useCheckoutReturn(ref, { processor: 'stripe', token: `cs_${status}` }))
    await waitFor(() => expect(result.current.state).toBe(state))
  }
  expect(completeReturn).toHaveBeenCalledTimes(cases.length)
})

test('a failed call is an error that retry asks again', async () => {
  completeReturn.mockRejectedValueOnce(new Error('Too many tries')).mockResolvedValueOnce(paid)
  const { result } = renderHook(() => useCheckoutReturn(ref, { processor: 'stripe', token: 'cs_retry' }))
  await waitFor(() => expect(result.current).toMatchObject({ state: 'error', reason: 'request_failed' }))
  act(() => result.current.retry())
  expect(result.current.state).toBe('checking')
  await waitFor(() => expect(result.current.state).toBe('paid'))
  expect(completeReturn).toHaveBeenCalledTimes(2)
})
