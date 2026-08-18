import { buildConditionKey, classRank } from '../../src/lib/conditions'
import { createConditionStat } from '../../src/lib/stats'
import { FEATURE_IDS, type AggregateBucket, type AggregateStore, type FeatureId, type HorseState, type ParsedRace, type Surface } from '../../src/types'

export function featureValues(race: ParsedRace, runner: ParsedRace['runners'][number], state?: HorseState): Record<FeatureId, boolean | null> {
  return {
    lastStartWon: state?.lastFinish != null ? state.lastFinish === 1 : null,
    lastStartTop3: state?.lastFinish != null ? state.lastFinish <= 3 : null,
    bodyWeight500Plus: runner.bodyWeight != null ? runner.bodyWeight >= 500 : null,
    wonSameDistance: state ? state.wonDistances.includes(race.condition.distance) : null,
    wonSameVenue: state ? state.wonVenues.includes(race.venue) : null,
    wonSameSurface: state ? state.wonSurfaces.includes(race.condition.surface) : null,
    wonSameOrHigherClass: state?.highestWonClassRank != null
      ? state.highestWonClassRank >= classRank(race.condition.classCode)
      : null,
  }
}

function unique<T>(items: T[]) {
  return [...new Set(items)]
}

function updateHorseState(existing: HorseState | undefined, race: ParsedRace, finish: number | null): HorseState {
  const won = finish === 1
  return {
    lastRaceDate: race.date,
    lastFinish: finish,
    wonDistances: unique([...(existing?.wonDistances ?? []), ...(won ? [race.condition.distance] : [])]),
    wonVenues: unique([...(existing?.wonVenues ?? []), ...(won ? [race.venue] : [])]),
    wonSurfaces: unique([...(existing?.wonSurfaces ?? []), ...(won ? [race.condition.surface] : [])]) as Surface[],
    highestWonClassRank: won
      ? Math.max(existing?.highestWonClassRank ?? 0, classRank(race.condition.classCode))
      : existing?.highestWonClassRank ?? null,
    updatedAt: race.date,
  }
}

function bucketFor(store: AggregateStore, race: ParsedRace): AggregateBucket {
  const month = race.date.slice(0, 7)
  const conditionKey = buildConditionKey(race.condition)
  let bucket = store.buckets.find((candidate) => candidate.month === month && candidate.conditionKey === conditionKey)
  if (!bucket) {
    bucket = { month, conditionKey, raceCount: 0, totalStarts: 0, totalWins: 0, features: {} }
    store.buckets.push(bucket)
  }
  return bucket
}

export function applyRaceResult(store: AggregateStore, race: ParsedRace, recordStatistics = true): boolean {
  if (!race.isResult || store.processedRaceIds.includes(race.id)) return false
  const active = race.runners.filter((runner) => !runner.scratched && runner.finish != null)
  if (!active.length) return false
  const bucket = recordStatistics ? bucketFor(store, race) : undefined
  if (bucket) bucket.raceCount += 1

  for (const runner of active) {
    const state = store.horses[runner.id]
    const values = featureValues(race, runner, state)
    const won = runner.finish === 1
    if (bucket) {
      bucket.totalStarts += 1
      if (won) bucket.totalWins += 1
      for (const featureId of FEATURE_IDS) {
        if (values[featureId] !== true) continue
        const counts = bucket.features[featureId] ?? { starts: 0, wins: 0 }
        counts.starts += 1
        if (won) counts.wins += 1
        bucket.features[featureId] = counts
      }
    }
    store.horses[runner.id] = updateHorseState(state, race, runner.finish)
  }

  store.processedRaceIds.push(race.id)
  return true
}

export function pruneStore(store: AggregateStore, asOfDate: string) {
  const cutoff = new Date(`${asOfDate}T00:00:00Z`)
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 10)
  const cutoffMonth = cutoff.toISOString().slice(0, 7)
  store.buckets = store.buckets.filter((bucket) => bucket.month >= cutoffMonth)

  const horseCutoff = new Date(`${asOfDate}T00:00:00Z`)
  horseCutoff.setUTCFullYear(horseCutoff.getUTCFullYear() - 3)
  const horseCutoffDate = horseCutoff.toISOString().slice(0, 10)
  store.horses = Object.fromEntries(
    Object.entries(store.horses).filter(([, state]) => state.updatedAt >= horseCutoffDate),
  )
}

export function summarizeCondition(store: AggregateStore, conditionKey: string, asOfDate: string) {
  const month = asOfDate.slice(0, 7)
  const buckets = store.buckets.filter((bucket) => bucket.conditionKey === conditionKey && bucket.month <= month)
  const totalStarts = buckets.reduce((sum, bucket) => sum + bucket.totalStarts, 0)
  const totalWins = buckets.reduce((sum, bucket) => sum + bucket.totalWins, 0)
  const raceCount = buckets.reduce((sum, bucket) => sum + bucket.raceCount, 0)
  const stats = FEATURE_IDS.map((featureId) => {
    const starts = buckets.reduce((sum, bucket) => sum + (bucket.features[featureId]?.starts ?? 0), 0)
    const wins = buckets.reduce((sum, bucket) => sum + (bucket.features[featureId]?.wins ?? 0), 0)
    return createConditionStat({ featureId, starts, wins, baselineStarts: totalStarts, baselineWins: totalWins })
  })
  return { totalStarts, totalWins, raceCount, stats }
}
