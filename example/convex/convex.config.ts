import { defineApp } from 'convex/server'
import payments from '@earthdance/payments/convex.config.js'

// A minimal app that mounts the component, for `convex dev` while working on the library.
const app = defineApp()
app.use(payments)

export default app
