import { applyRaceResult, featureValues, pruneStore, summarizeCondition } from '../scripts/jra/aggregate'
import { EMPTY_STORE } from '../scripts/jra/store'
import type { ParsedRace } from '../src/types'

function resultRace(overrides: Partial<ParsedRace> = {}): ParsedRace {
  return {
    id: 'race-1', sourceUrl: 'https://www.jra.go.jp/test', date: '2026-01-10', venue: '中山', number: 1, startTime: '10:00', name: '測試', isResult: true,
    condition: { venue: '中山', kind: 'flat', surface: 'turf', distance: 2000, courseVariant: '右', classCode: 'class-1', classLabel: '1勝クラス', ageRestriction: '3歳以上', sexRestriction: 'open', weightRule: '定量' },
    runners: [{ id: 'horse-1', number: 1, frame: 1, name: '測試馬', sexAge: '牡4', jockey: '騎手', assignedWeight: 57, bodyWeight: 510, bodyWeightChange: 2, scratched: false, finish: 1 }],
    ...overrides,
  }
}

describe('incremental aggregate store', () => {
  it('uses only horse state known before the target race', () => {
    const store = structuredClone(EMPTY_STORE)
    const first = resultRace()
    expect(featureValues(first, first.runners[0]!, store.horses['horse-1']).lastStartWon).toBeNull()
    expect(applyRaceResult(store, first)).toBe(true)

    const second = resultRace({ id: 'race-2', date: '2026-02-10' })
    expect(featureValues(second, second.runners[0]!, store.horses['horse-1']).lastStartWon).toBe(true)
  })

  it('is idempotent and counts dead-heat winners', () => {
    const store = structuredClone(EMPTY_STORE)
    const race = resultRace({
      runners: [
        resultRace().runners[0]!,
        { ...resultRace().runners[0]!, id: 'horse-2', number: 2, finish: 1 },
        { ...resultRace().runners[0]!, id: 'horse-3', number: 3, finish: null, scratched: true },
      ],
    })
    expect(applyRaceResult(store, race)).toBe(true)
    expect(applyRaceResult(store, race)).toBe(false)
    expect(store.buckets[0]).toMatchObject({ totalStarts: 2, totalWins: 2 })
  })

  it('prunes statistics beyond the ten-year window', () => {
    const store = structuredClone(EMPTY_STORE)
    store.buckets = [
      { month: '2015-12', conditionKey: 'old', raceCount: 1, totalStarts: 1, totalWins: 1, features: {} },
      { month: '2016-08', conditionKey: 'keep', raceCount: 1, totalStarts: 1, totalWins: 1, features: {} },
    ]
    pruneStore(store, '2026-08-18')
    expect(store.buckets.map((bucket) => bucket.conditionKey)).toEqual(['keep'])
  })

  it('combines legacy graded classes and handicap or special-weight buckets', () => {
    const store = structuredClone(EMPTY_STORE)
    store.buckets = [
      { month: '2024-05', conditionKey: '\u6771\u4eac|flat|turf|2000|\u5de6|g1|3\u6b73\u4ee5\u4e0a|open|\u5225\u5b9a', raceCount: 1, totalStarts: 10, totalWins: 1, features: {} },
      { month: '2025-05', conditionKey: '\u6771\u4eac|flat|turf|2000|\u5de6|g2|3\u6b73\u4ee5\u4e0a|open|\u30cf\u30f3\u30c7', raceCount: 2, totalStarts: 20, totalWins: 2, features: {} },
      { month: '2026-05', conditionKey: '\u6771\u4eac|flat|turf|2000|\u5de6|g3|3\u6b73\u4ee5\u4e0a|open|\u5225\u5b9a', raceCount: 3, totalStarts: 30, totalWins: 3, features: {} },
      { month: '2026-05', conditionKey: '\u6771\u4eac|flat|turf|2000|\u5de6|open|3\u6b73\u4ee5\u4e0a|open|\u30cf\u30f3\u30c7', raceCount: 4, totalStarts: 40, totalWins: 4, features: {} },
    ]

    expect(summarizeCondition(store, '\u6771\u4eac|flat|turf|2000|\u5de6|graded|3\u6b73\u4ee5\u4e0a|open|\u30cf\u30f3\u30c7', '2026-08-30'))
      .toMatchObject({ raceCount: 6, totalStarts: 60, totalWins: 6 })
  })
})
