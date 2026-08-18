import { applyRaceResult, featureValues, pruneStore } from '../scripts/jra/aggregate'
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
})
