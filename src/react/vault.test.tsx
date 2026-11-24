// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { forgetScripts } from './embedded.js'
import { PAYPAL_VAULT_NAMESPACE, PaypalCardFields, PaypalSaveButton, paypalVaultSdkUrl } from './vault.js'

type Approve = (data: { vaultSetupToken: string }) => Promise<void>
type CardFieldsOptions = { createVaultSetupToken: () => Promise<string>; onApprove: Approve; onError: (err: unknown) => void; style?: Record<string, Record<string, string>> }
type ButtonsOptions = CardFieldsOptions & { fundingSource?: string; onCancel: () => void }

let cardFields: CardFieldsOptions[]
let buttons: ButtonsOptions[]
let eligible: boolean
let rendered: number
/** What submit() does: by default what PayPal does, a setup token, then onApprove. */
let submitImpl: ((o: CardFieldsOptions) => Promise<void>) | null
let scripts: HTMLScriptElement[]

async function finishScript(src: string, outcome: 'load' | 'error' = 'load') {
  const el = await waitFor(() => {
    const found = scripts.find((s) => s.src === src)
    if (!found) throw new Error(`no script ${src}`)
    return found
  })
  act(() => {
    el.dispatchEvent(new Event(outcome))
  })
  return el
}

beforeEach(() => {
  forgetScripts()
  scripts = []
  vi.spyOn(document.head, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
    if (node instanceof HTMLScriptElement) scripts.push(node)
    return node
  })
  cardFields = []
  buttons = []
  eligible = true
  rendered = 0
  submitImpl = null
  const field = () => ({ render: () => Promise.resolve(void rendered++), close: () => Promise.resolve() })
  ;(window as unknown as Record<string, unknown>)[PAYPAL_VAULT_NAMESPACE] = {
    FUNDING: { PAYPAL: 'paypal' },
    CardFields: (o: CardFieldsOptions) => {
      cardFields.push(o)
      return {
        isEligible: () => eligible,
        NameField: field,
        NumberField: field,
        ExpiryField: field,
        CVVField: field,
        submit: async () => {
          if (submitImpl) return await submitImpl(o)
          const token = await o.createVaultSetupToken()
          await o.onApprove({ vaultSetupToken: token })
        },
      }
    },
    Buttons: (o: ButtonsOptions) => {
      buttons.push(o)
      return { render: () => Promise.resolve(), close: () => Promise.resolve() }
    },
  }
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  delete (window as unknown as Record<string, unknown>)[PAYPAL_VAULT_NAMESPACE]
})

test('the SDK is loaded for saving under its own namespace, so the checkout buttons’ SDK is left alone', async () => {
  render(<PaypalCardFields clientId="client-1" createSetupToken={() => Promise.resolve('S1')} onSaved={() => Promise.resolve()} submitLabel="Place bid" />)
  expect(paypalVaultSdkUrl('client-1')).toBe('https://www.paypal.com/sdk/js?client-id=client-1&currency=USD&components=card-fields,buttons&disable-funding=venmo,paylater')
  const el = await finishScript(paypalVaultSdkUrl('client-1'))
  expect(el.getAttribute('data-namespace')).toBe(PAYPAL_VAULT_NAMESPACE)
})

test('card fields: the app’s style goes into PayPal’s frames over the defaults, and a new one renders the fields again', async () => {
  const props = { clientId: 'client-1', createSetupToken: () => Promise.resolve('S1'), onSaved: () => Promise.resolve(), submitLabel: 'Place bid' }
  const { rerender } = render(<PaypalCardFields {...props} style={{ input: { color: '#fafafa' } }} />)
  await finishScript(paypalVaultSdkUrl('client-1'))
  await waitFor(() => expect(cardFields).toHaveLength(1))
  expect(cardFields[0].style).toEqual({ input: { 'font-size': '14px', padding: '6px 8px', color: '#fafafa' }, '.invalid': { color: '#dc2626' } })

  rerender(<PaypalCardFields {...props} style={{ input: { color: '#fafafa' } }} />)
  rerender(<PaypalCardFields {...props} style={{ input: { color: '#0a0a0a' } }} />)
  await waitFor(() => expect(cardFields).toHaveLength(2))
  expect(cardFields[1].style?.input.color).toBe('#0a0a0a')
})

test('card fields: the four fields render, and the button gets a setup token, has PayPal check the card, then calls onSaved with it', async () => {
  const createSetupToken = vi.fn(() => Promise.resolve('SETUP1'))
  const onSaved = vi.fn(() => Promise.resolve())
  render(<PaypalCardFields clientId="client-1" createSetupToken={createSetupToken} onSaved={onSaved} submitLabel="Place bid" note="Only charged if you win." />)
  await finishScript(paypalVaultSdkUrl('client-1'))
  const button = await screen.findByRole('button', { name: 'Place bid' })
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false))
  expect(rendered).toBe(4)
  await act(async () => {
    fireEvent.click(button)
  })
  expect(createSetupToken).toHaveBeenCalledTimes(1)
  expect(onSaved).toHaveBeenCalledWith('SETUP1')
  expect(screen.getByText('Only charged if you win.')).toBeTruthy()
})

test('card fields: a card PayPal won’t save, or the app refusing it, is said under the fields and can be tried again', async () => {
  const onSaved = vi.fn(() => Promise.reject(new Error('That card couldn’t be verified. Please check the details, or use another card.')))
  render(<PaypalCardFields clientId="client-1" createSetupToken={() => Promise.resolve('S1')} onSaved={onSaved} submitLabel="Place bid" />)
  await finishScript(paypalVaultSdkUrl('client-1'))
  const button = await screen.findByRole('button', { name: 'Place bid' })
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false))
  await act(async () => {
    fireEvent.click(button)
  })
  expect(screen.getByRole('alert').textContent).toMatch(/couldn’t be verified/)
  submitImpl = () => Promise.reject(new Error('INVALID_NUMBER'))
  await act(async () => {
    fireEvent.click(button)
  })
  expect(screen.getByRole('alert').textContent).toBe('INVALID_NUMBER')
})

test('card fields: not eligible (card fields off on the account) or the script failing says so and leaves the button off', async () => {
  eligible = false
  render(<PaypalCardFields clientId="client-1" createSetupToken={() => Promise.resolve('S1')} onSaved={() => Promise.resolve()} submitLabel="Place bid" />)
  await finishScript(paypalVaultSdkUrl('client-1'))
  expect((await screen.findByRole('alert')).textContent).toMatch(/didn’t load/)
  expect(screen.getByRole('button', { name: 'Place bid' }).hasAttribute('disabled')).toBe(true)
})

test('PayPal button: only the PayPal funding source; approving saves with the setup token; a refused save is said', async () => {
  const onSaved = vi.fn<(id: string) => Promise<void>>(() => Promise.resolve())
  render(<PaypalSaveButton clientId="client-1" createSetupToken={() => Promise.resolve('SETUP2')} onSaved={onSaved} />)
  await finishScript(paypalVaultSdkUrl('client-1'))
  await waitFor(() => expect(buttons).toHaveLength(1))
  expect(buttons[0].fundingSource).toBe('paypal')
  expect(await buttons[0].createVaultSetupToken()).toBe('SETUP2')
  await act(() => buttons[0].onApprove({ vaultSetupToken: 'SETUP2' }))
  expect(onSaved).toHaveBeenCalledWith('SETUP2')
  onSaved.mockRejectedValueOnce(new Error('Too many tries just now.'))
  await act(() => buttons[0].onApprove({ vaultSetupToken: 'SETUP2' }))
  expect(screen.getByRole('alert').textContent).toBe('Too many tries just now.')
})
