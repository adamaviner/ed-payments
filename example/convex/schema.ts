import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  hostRows: defineTable({ note: v.string() }),
})
