import { FEATURE_LABELS } from './conditions'
import type { ConditionStat, FeatureId, StatClassification } from '../types'

export function wilsonInterval(wins: number, starts: number, z = 1.96): [number, number] {
  if (starts <= 0) return [0, 1]
  const proportion = wins / starts
  const denominator = 1 + (z * z) / starts
  const center = proportion + (z * z) / (2 * starts)
  const margin = z * Math.sqrt((proportion * (1 - proportion) + (z * z) / (4 * starts)) / starts)
  return [Math.max(0, (center - margin) / denominator), Math.min(1, (center + margin) / denominator)]
}

export function classifyStat(
  starts: number,
  confidenceLow: number,
  confidenceHigh: number,
  baselineRate: number,
  minimumSample = 30,
): StatClassification {
  if (starts < minimumSample) return 'insufficient'
  if (confidenceLow > baselineRate) return 'high'
  if (confidenceHigh < baselineRate) return 'low'
  return 'neutral'
}

export function createConditionStat(input: {
  featureId: FeatureId
  starts: number
  wins: number
  baselineStarts: number
  baselineWins: number
}): ConditionStat {
  const rate = input.starts > 0 ? input.wins / input.starts : 0
  const baselineRate = input.baselineStarts > 0 ? input.baselineWins / input.baselineStarts : 0
  const [confidenceLow, confidenceHigh] = wilsonInterval(input.wins, input.starts)
  return {
    featureId: input.featureId,
    label: FEATURE_LABELS[input.featureId],
    starts: input.starts,
    wins: input.wins,
    rate,
    baselineStarts: input.baselineStarts,
    baselineWins: input.baselineWins,
    baselineRate,
    liftPercentagePoints: (rate - baselineRate) * 100,
    confidenceLow,
    confidenceHigh,
    classification: classifyStat(input.starts, confidenceLow, confidenceHigh, baselineRate),
  }
}

export function calculateContribution(stat: ConditionStat, matched: boolean | null): number {
  if (!matched || (stat.classification !== 'high' && stat.classification !== 'low')) return 0
  const evidenceWeight = Math.min(1, Math.sqrt(stat.starts / 100))
  return clamp(stat.liftPercentagePoints * evidenceWeight, -20, 20)
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
