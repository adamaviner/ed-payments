import { cronJobs } from 'convex/server'
import { internal } from './_generated/api.js'

const crons = cronJobs()
crons.interval('payments sweep', { minutes: 10 }, internal.paymentsWorker.sweep, {})
crons.daily('payments reconcile', { hourUTC: 9, minuteUTC: 0 }, internal.paymentsWorker.reconcile, {})
crons.daily('payments cleanup', { hourUTC: 9, minuteUTC: 30 }, internal.paymentsWorker.cleanup, {})

export default crons
