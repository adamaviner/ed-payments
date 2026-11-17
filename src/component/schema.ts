import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  // Stage 0 only: what the probe wrote, to see which writes survive a host callback that throws.
  probes: defineTable({ note: v.string() }),
})
