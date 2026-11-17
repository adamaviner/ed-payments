// Admin → Payments: refunds waiting on someone, paid payments to refund in full or in part, and the
// issues the library found (differences from the processors, disputes, failed callbacks, charges whose
// outcome is unknown). Over the app's payments.adminApi() functions; every action waits for the server
// and the lists follow from the queries, so no amount on the page is ever a guess.
import { useAction, useMutation, usePaginatedQuery, useQuery } from 'convex/react'
import { type ReactNode, useId, useState } from 'react'
import { dollars } from '../core/money.js'
import { parseRefundAmount, refundableCents } from './refundAmount.js'
import type { CheckoutSummary, OpenRefund, PaymentIssue, PaymentRef, PaymentsAdminApi, PaymentsAuth } from './types.js'
import { Button, ConfirmButton, ErrorNote, Field, Input, Note, Rows, Section } from './ui.js'
import { useSaver } from './useSaver.js'

export interface PaymentsAdminPageProps {
  /** The app's module that re-exports payments.adminApi(), e.g. `api.paymentsAdmin`. */
  api: PaymentsAdminApi
  /** Passed to the app's authorize.admin query as it is (ed-schedule: `{ token }`); apps on Convex auth leave it out. */
  auth?: PaymentsAuth
  /**
   * The same as the server's adminApi({ skipApproval }). False (the default, as there): a refund asked
   * for here waits for someone to approve it before it can be sent. True: it is sent at once.
   */
  skipApproval?: boolean
  /** What a payment was for, in the app (a link to the order or bid); else its description is shown alone. */
  refLink?: (ref: PaymentRef, checkout: CheckoutSummary) => ReactNode
  /** Payments and issues loaded at a time. Default 20. */
  pageSize?: number
}

/** The props every row needs. */
interface Shared {
  api: PaymentsAdminApi
  args: { auth?: PaymentsAuth }
  skipApproval: boolean
  refLink?: PaymentsAdminPageProps['refLink']
}

export function PaymentsAdminPage({ api, auth, skipApproval = false, refLink, pageSize = 20 }: PaymentsAdminPageProps) {
  // Left out rather than sent as undefined, so an app on Convex auth sends no `auth` at all.
  const args = auth === undefined ? {} : { auth }
  const shared: Shared = { api, args, skipApproval, refLink }
  const refunds = useQuery(api.openRefunds, args)
  return (
    <div className="flex flex-col gap-8">
      <OpenRefunds shared={shared} refunds={refunds} />
      <Refundable shared={shared} refunds={refunds} pageSize={pageSize} />
      <Issues shared={shared} pageSize={pageSize} />
    </div>
  )
}

const PROCESSORS: Record<string, string> = { stripe: 'Stripe', paypal: 'PayPal' }
const METHODS: Record<string, string> = { card: 'card', ach: 'bank transfer', paypal: 'PayPal' }
const processorName = (p: string | null | undefined) => (p ? (PROCESSORS[p] ?? p) : 'the processor')

const STATUS: Record<OpenRefund['status'], string> = {
  requested: 'Waiting for approval',
  approved: 'Approved, not sent yet',
  sending: 'Sending',
  failed: 'Failed',
  sent: 'Sent',
  manual: 'Refunded elsewhere',
  dismissed: 'Not refunded',
}

const ISSUES: Record<PaymentIssue['kind'], string> = {
  missing_here: 'At the processor, not here',
  missing_there: 'Here, not at the processor',
  amount_differs: 'Amounts differ',
  status_differs: 'Status differs',
  dispute: 'Dispute',
  callback_failed: 'The app couldn’t record it',
  charge_unknown: 'Charge with an unknown outcome',
}

const when = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function Muted({ children }: { children: ReactNode }) {
  return <span className="block text-xs text-muted-foreground">{children}</span>
}

/** Who paid, for what, and how. */
function Payment({ checkout, refLink }: { checkout: CheckoutSummary; refLink: Shared['refLink'] }) {
  const link = refLink?.(checkout.ref, checkout) ?? null
  return (
    <div className="min-w-56 flex-1">
      <span className="block">{link ?? checkout.description}</span>
      {link !== null && <Muted>{checkout.description}</Muted>}
      <Muted>
        {checkout.payer.name ? `${checkout.payer.name} · ${checkout.payer.email}` : checkout.payer.email} · {when(checkout.createdAt)}
      </Muted>
      <Muted>
        {processorName(checkout.processor)}
        {` ${METHODS[checkout.method] ?? checkout.method}`}
        {checkout.paymentRef && <span className="font-mono break-all"> {checkout.paymentRef}</span>}
      </Muted>
    </div>
  )
}

/** Sends a refund and turns the processor saying no into an error to show by the row. */
async function send(sendRefund: (a: { auth?: PaymentsAuth; refundId: string }) => Promise<{ status: string; error: string | null } | null>, args: Shared['args'], refundId: string) {
  const result = await sendRefund({ ...args, refundId })
  if (result?.status === 'failed') throw new Error(result.error ?? 'The processor refused the refund.')
}

// ── Refunds to do ─────────────────────────────────────────────────────────────────────────────────

function OpenRefunds({ shared, refunds }: { shared: Shared; refunds: OpenRefund[] | undefined }) {
  return (
    <Section title="Refunds to do" hint="Money owed back: payments that arrived for something that couldn’t be sold, and refunds asked for below.">
      {refunds === undefined ? (
        <Note>Loading…</Note>
      ) : refunds.length === 0 ? (
        <Note>Nothing to refund right now.</Note>
      ) : (
        <Rows>
          {refunds.map((r) => (
            <RefundRow key={r.id} shared={shared} refund={r} />
          ))}
        </Rows>
      )}
    </Section>
  )
}

function RefundRow({ shared, refund }: { shared: Shared; refund: OpenRefund }) {
  const { api, args, skipApproval, refLink } = shared
  const approveRefund = useMutation(api.approveRefund)
  const sendRefund = useAction(api.sendRefund)
  const markRefundedManually = useMutation(api.markRefundedManually)
  const dismissRefund = useMutation(api.dismissRefund)
  const { error, run, busy } = useSaver()
  const [closing, setClosing] = useState<'manual' | 'dismiss' | null>(null)
  const [note, setNote] = useState('')
  const noteId = useId()
  const c = refund.checkout
  const processor = processorName(c?.processor)
  const needsApproval = refund.status === 'requested' && !skipApproval
  const close = async () => {
    const ok = await run(() =>
      closing === 'manual' ? markRefundedManually({ ...args, refundId: refund.id, note: note.trim() || undefined }) : dismissRefund({ ...args, refundId: refund.id, note: note.trim() || undefined }),
    )
    if (ok) setClosing(null)
  }

  return (
    <li className="flex flex-col gap-2 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-start gap-3">
        {c ? <Payment checkout={c} refLink={refLink} /> : <div className="min-w-56 flex-1">A payment that is no longer here</div>}
        <div className="w-40">
          <span className="block font-medium">{dollars(refund.amountCents)}</span>
          {c && c.paidCents !== null && <Muted>of {dollars(c.paidCents)} paid</Muted>}
        </div>
        <div className="min-w-48 flex-1">
          <span className="block">{refund.reason}</span>
          <Muted>
            {STATUS[refund.status]}
            {refund.origin === 'needed' && ' · the app couldn’t make the sale'}
            {refund.requestedBy && ` · asked by ${refund.requestedBy}`}
            {refund.approvedBy && ` · approved by ${refund.approvedBy}`} · {when(refund.createdAt)}
          </Muted>
          {refund.error && <span className="block text-xs text-destructive">{refund.error}</span>}
        </div>
      </div>
      {refund.status === 'sending' ? (
        <Note>Waiting for {processor}’s answer. It is asked again automatically.</Note>
      ) : closing ? (
        <div className="flex flex-wrap items-end gap-2">
          <Field label={closing === 'manual' ? 'How it was refunded (optional)' : 'Why not (optional)'} htmlFor={noteId} className="min-w-64 flex-1">
            <Input id={noteId} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
          </Field>
          <Button variant="default" disabled={busy} onClick={() => void close()}>
            {closing === 'manual' ? 'Mark refunded' : 'Don’t refund'}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setClosing(null)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {needsApproval ? (
            <Button variant="default" disabled={busy} onClick={() => void run(() => approveRefund({ ...args, refundId: refund.id }))}>
              Approve
            </Button>
          ) : (
            <ConfirmButton disabled={busy} confirmLabel={`Send ${dollars(refund.amountCents)} back via ${processor}?`} onConfirm={() => run(() => send(sendRefund, args, refund.id))}>
              {refund.status === 'failed' ? 'Try again' : `Refund via ${processor}`}
            </ConfirmButton>
          )}
          <Button
            variant="ghost"
            disabled={busy}
            title={`Only when it was already refunded outside this page, e.g. in ${processor}’s dashboard. Nothing is sent.`}
            onClick={() => {
              setNote('')
              setClosing('manual')
            }}
          >
            Refunded elsewhere
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setNote('')
              setClosing('dismiss')
            }}
          >
            Don’t refund
          </Button>
        </div>
      )}
      <ErrorNote error={error} />
    </li>
  )
}

// ── Refund a payment ──────────────────────────────────────────────────────────────────────────────

function Refundable({ shared, refunds, pageSize }: { shared: Shared; refunds: OpenRefund[] | undefined; pageSize: number }) {
  const { results, status, loadMore } = usePaginatedQuery(shared.api.refundable, shared.args, { initialNumItems: pageSize })
  return (
    <Section title="Refund a payment" hint="Paid payments with something left to refund, newest first. Leave the amount blank to refund everything left.">
      {status === 'LoadingFirstPage' ? (
        <Note>Loading…</Note>
      ) : results.length === 0 ? (
        <Note>No paid payments to refund.</Note>
      ) : (
        <Rows>
          {results.map((c) => (
            <CheckoutRow key={c.id} shared={shared} checkout={c} refunds={refunds} />
          ))}
        </Rows>
      )}
      {status === 'CanLoadMore' && (
        <Button className="self-start" onClick={() => loadMore(pageSize)}>
          Show more
        </Button>
      )}
    </Section>
  )
}

function CheckoutRow({ shared, checkout, refunds }: { shared: Shared; checkout: CheckoutSummary; refunds: OpenRefund[] | undefined }) {
  const { api, args, skipApproval, refLink } = shared
  const requestRefund = useMutation(api.requestRefund)
  const sendRefund = useAction(api.sendRefund)
  const { error, run, busy } = useSaver()
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [asked, setAsked] = useState(false)
  const amountId = useId()
  const reasonId = useId()
  // Until the open refunds load, what they hold is unknown, so nothing can be refunded yet.
  const left = refunds ? refundableCents(checkout, refunds) : 0
  const parsed = parseRefundAmount(amount, left)
  const processor = processorName(checkout.processor)

  const refund = async (cents: number) => {
    setAsked(false)
    const ok = await run(async () => {
      const refundId = await requestRefund({ ...args, checkoutId: checkout.id, amountCents: cents, reason: reason.trim() || 'Refunded by an admin' })
      if (skipApproval) await send(sendRefund, args, refundId)
    })
    if (!ok) return
    setAmount('')
    setReason('')
    setAsked(!skipApproval)
  }

  return (
    <li className="flex flex-col gap-2 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-end gap-3">
        <Payment checkout={checkout} refLink={refLink} />
        <div className="w-36">
          <span className="block">{dollars(checkout.paidCents ?? 0)} paid</span>
          {checkout.refundedCents > 0 && <Muted>{dollars(checkout.refundedCents)} refunded</Muted>}
          {refunds && <Muted>{dollars(left)} left</Muted>}
        </div>
        <Field label="Amount ($)" htmlFor={amountId}>
          <Input
            id={amountId}
            className="w-28"
            inputMode="decimal"
            placeholder={left > 0 ? (left / 100).toFixed(2) : ''}
            value={amount}
            disabled={busy || left < 1}
            aria-invalid={amount.trim() !== '' && !parsed.ok}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Reason" htmlFor={reasonId} className="min-w-48 flex-1">
          <Input id={reasonId} value={reason} disabled={busy || left < 1} placeholder="Refunded by an admin" onChange={(e) => setReason(e.target.value)} />
        </Field>
        {parsed.ok ? (
          <ConfirmButton
            disabled={busy}
            confirmLabel={skipApproval ? `Send ${dollars(parsed.cents)} back via ${processor}?` : `Ask to refund ${dollars(parsed.cents)}?`}
            onConfirm={() => refund(parsed.cents)}
          >
            Refund {dollars(parsed.cents)}
          </ConfirmButton>
        ) : (
          <Button disabled>Refund</Button>
        )}
      </div>
      {/* Only once something is typed: an untouched row with nothing left says so in its "left" column. */}
      {!parsed.ok && amount.trim() !== '' && <ErrorNote error={parsed.error} />}
      {asked && <Note>Asked for. It is in Refunds to do, waiting for approval.</Note>}
      <ErrorNote error={error} />
    </li>
  )
}

// ── Issues ────────────────────────────────────────────────────────────────────────────────────────

function Issues({ shared, pageSize }: { shared: Shared; pageSize: number }) {
  const { results, status, loadMore } = usePaginatedQuery(shared.api.issues, shared.args, { initialNumItems: pageSize })
  return (
    <Section
      title="Payment issues"
      hint="Disputes, charges whose outcome is unknown, and differences the nightly check with Stripe and PayPal found. Most resolve themselves once the difference goes away."
    >
      {status === 'LoadingFirstPage' ? (
        <Note>Loading…</Note>
      ) : results.length === 0 ? (
        <Note>No open issues.</Note>
      ) : (
        <Rows>
          {results.map((i) => (
            <IssueRow key={i.id} shared={shared} issue={i} />
          ))}
        </Rows>
      )}
      {status === 'CanLoadMore' && (
        <Button className="self-start" onClick={() => loadMore(pageSize)}>
          Show more
        </Button>
      )}
    </Section>
  )
}

function IssueRow({ shared, issue }: { shared: Shared; issue: PaymentIssue }) {
  const { api, args } = shared
  const resolveIssue = useMutation(api.resolveIssue)
  const retryCharge = useMutation(api.retryCharge)
  const giveUpCharge = useAction(api.giveUpCharge)
  const { error, run, busy } = useSaver()
  const [outcome, setOutcome] = useState<string | null>(null)
  const checkoutId = issue.kind === 'charge_unknown' ? issue.checkoutId : null

  return (
    <li className="flex flex-col gap-2 px-3 py-2 text-sm">
      <div>
        <span className="block font-medium">{ISSUES[issue.kind]}</span>
        <span className="block">{issue.detail}</span>
        <Muted>
          {processorName(issue.processor)}
          {issue.paymentRef && <span className="font-mono break-all"> {issue.paymentRef}</span>} · {when(issue.openedAt)}
        </Muted>
      </div>
      <div className="flex flex-wrap gap-2">
        {checkoutId && (
          <>
            <ConfirmButton
              disabled={busy}
              confirmLabel="Charge again?"
              title="Safe if the first try went through: the library looks for it at Stripe before charging again."
              onConfirm={() =>
                run(async () => {
                  setOutcome(null)
                  await retryCharge({ ...args, checkoutId })
                  setOutcome('Trying the charge again.')
                })
              }
            >
              Try the charge again
            </ConfirmButton>
            <ConfirmButton
              disabled={busy}
              confirmLabel="Give up on this charge?"
              title="Stripe is asked first: a charge it has as paid is recorded as paid instead."
              onConfirm={() =>
                run(async () => {
                  setOutcome(null)
                  const r = await giveUpCharge({ ...args, checkoutId })
                  setOutcome(r.status === 'failed' ? 'Given up: the charge is failed and the app was told.' : `Stripe had this charge as ${r.status}; recorded that instead.`)
                })
              }
            >
              Give up
            </ConfirmButton>
          </>
        )}
        <Button disabled={busy} onClick={() => void run(() => resolveIssue({ ...args, issueId: issue.id }))}>
          Mark resolved
        </Button>
      </div>
      {outcome && <Note>{outcome}</Note>}
      <ErrorNote error={error} />
    </li>
  )
}
