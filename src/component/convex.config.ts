import { defineComponent } from 'convex/server'

// Apps mount this as `app.use(payments)`, which makes it `components.payments` in their generated api.
export default defineComponent('payments')
