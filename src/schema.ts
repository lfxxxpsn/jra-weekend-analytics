import { z } from 'zod'
import { FEATURE_IDS } from './types'

const featureIdSchema = z.enum(FEATURE_IDS)
const conditionStatSchema = z.object({
  featureId: featureIdSchema,
  label: z.string(),
  starts: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  rate: z.number().min(0).max(1),
  baselineStarts: z.number().int().nonnegative(),
  baselineWins: z.number().int().nonnegative(),
  baselineRate: z.number().min(0).max(1),
  liftPercentagePoints: z.number(),
  confidenceLow: z.number().min(0).max(1),
  confidenceHigh: z.number().min(0).max(1),
  classification: z.enum(['high', 'low', 'neutral', 'insufficient']),
})

const raceConditionSchema = z.object({
  venue: z.string().min(1),
  kind: z.enum(['flat', 'jump']),
  surface: z.enum(['turf', 'dirt', 'jump', 'unknown']),
  distance: z.number().int().nonnegative(),
  courseVariant: z.string(),
  classCode: z.string().min(1),
  classLabel: z.string().min(1),
  ageRestriction: z.string(),
  sexRestriction: z.string(),
  weightRule: z.string(),
})

const runnerSchema = z.object({
  id: z.string().min(1),
  number: z.number().int().positive().nullable(),
  frame: z.number().int().positive().nullable(),
  name: z.string().min(1),
  sexAge: z.string(),
  jockey: z.string(),
  assignedWeight: z.number().nullable(),
  bodyWeight: z.number().int().positive().nullable(),
  bodyWeightChange: z.number().int().nullable(),
  scratched: z.boolean(),
  features: z.array(z.object({
    featureId: featureIdSchema,
    label: z.string(),
    value: z.boolean().nullable(),
    contribution: z.number(),
    stat: conditionStatSchema.optional(),
  })),
  score: z.number(),
  rank: z.number().int().positive().nullable(),
})

const raceSchema = z.object({
  id: z.string().min(1),
  sourceUrl: z.string().url(),
  date: z.string().date(),
  venue: z.string().min(1),
  number: z.number().int().positive(),
  startTime: z.string(),
  name: z.string().min(1),
  condition: raceConditionSchema,
  conditionKey: z.string().min(1),
  runnerCount: z.number().int().nonnegative(),
  bodyWeightStatus: z.enum(['published', 'pending', 'partial']),
  sampleStarts: z.number().int().nonnegative(),
  sampleRaces: z.number().int().nonnegative(),
  highConditions: z.array(conditionStatSchema),
  lowConditions: z.array(conditionStatSchema),
  otherConditions: z.array(conditionStatSchema),
  runners: z.array(runnerSchema),
})

export const weekendDataSchema = z.object({
  metadata: z.object({
    schemaVersion: z.literal(1),
    fetchedAt: z.string().datetime(),
    historyStart: z.string().date(),
    historyEnd: z.string().date(),
    status: z.enum(['fresh', 'stale', 'unavailable', 'error']),
    warnings: z.array(z.string()),
  }),
  meetings: z.array(z.object({
    date: z.string().date(),
    dayLabel: z.string(),
    venue: z.string().min(1),
    races: z.array(raceSchema),
  })),
})
