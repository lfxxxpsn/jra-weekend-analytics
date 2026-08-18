export const FEATURE_IDS = [
  'lastStartWon',
  'lastStartTop3',
  'bodyWeight500Plus',
  'wonSameDistance',
  'wonSameVenue',
  'wonSameSurface',
  'wonSameOrHigherClass',
] as const

export type FeatureId = (typeof FEATURE_IDS)[number]
export type DataStatus = 'fresh' | 'stale' | 'unavailable' | 'error'
export type StatClassification = 'high' | 'low' | 'neutral' | 'insufficient'
export type Surface = 'turf' | 'dirt' | 'jump' | 'unknown'
export type RaceKind = 'flat' | 'jump'

export interface RaceCondition {
  venue: string
  kind: RaceKind
  surface: Surface
  distance: number
  courseVariant: string
  classCode: string
  classLabel: string
  ageRestriction: string
  sexRestriction: string
  weightRule: string
}

export interface ConditionStat {
  featureId: FeatureId
  label: string
  starts: number
  wins: number
  rate: number
  baselineStarts: number
  baselineWins: number
  baselineRate: number
  liftPercentagePoints: number
  confidenceLow: number
  confidenceHigh: number
  classification: StatClassification
}

export interface RunnerFeature {
  featureId: FeatureId
  label: string
  value: boolean | null
  contribution: number
  stat?: ConditionStat
}

export interface Runner {
  id: string
  number: number | null
  frame: number | null
  name: string
  sexAge: string
  jockey: string
  assignedWeight: number | null
  bodyWeight: number | null
  bodyWeightChange: number | null
  scratched: boolean
  features: RunnerFeature[]
  score: number
  rank: number | null
}

export interface Race {
  id: string
  sourceUrl: string
  date: string
  venue: string
  number: number
  startTime: string
  name: string
  condition: RaceCondition
  conditionKey: string
  runnerCount: number
  bodyWeightStatus: 'published' | 'pending' | 'partial'
  sampleStarts: number
  sampleRaces: number
  highConditions: ConditionStat[]
  lowConditions: ConditionStat[]
  otherConditions: ConditionStat[]
  runners: Runner[]
}

export interface Meeting {
  date: string
  dayLabel: string
  venue: string
  races: Race[]
}

export interface WeekendData {
  metadata: {
    schemaVersion: 1
    fetchedAt: string
    historyStart: string
    historyEnd: string
    status: DataStatus
    warnings: string[]
  }
  meetings: Meeting[]
}

export interface FeatureCount {
  starts: number
  wins: number
}

export interface AggregateBucket {
  month: string
  conditionKey: string
  raceCount: number
  totalStarts: number
  totalWins: number
  features: Partial<Record<FeatureId, FeatureCount>>
}

export interface HorseState {
  lastRaceDate: string | null
  lastFinish: number | null
  wonDistances: number[]
  wonVenues: string[]
  wonSurfaces: Surface[]
  highestWonClassRank: number | null
  updatedAt: string
}

export interface AggregateStore {
  version: 1
  generatedAt: string
  buckets: AggregateBucket[]
  processedRaceIds: string[]
  horses: Record<string, HorseState>
}

export interface ParsedRunner {
  id: string
  number: number | null
  frame: number | null
  name: string
  sexAge: string
  jockey: string
  assignedWeight: number | null
  bodyWeight: number | null
  bodyWeightChange: number | null
  scratched: boolean
  finish: number | null
}

export interface ParsedRace {
  id: string
  sourceUrl: string
  date: string
  venue: string
  number: number
  startTime: string
  name: string
  condition: RaceCondition
  runners: ParsedRunner[]
  isResult: boolean
}
