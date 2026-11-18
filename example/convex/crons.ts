import { cronJobs } from 'convex/server'
import { payments } from './payments.js'

// Sweep every 10 minutes; the nightly comparison, the issues digest and the cleanup.
const crons = cronJobs()
payments.registerCrons(crons)

export default crons
