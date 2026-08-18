import { applyRaceResult } from '../scripts/jra/aggregate'
import { generateWeekendData } from '../scripts/jra/generate'
import { EMPTY_STORE } from '../scripts/jra/store'
import { weekendDataSchema } from '../src/schema'
import type { ParsedRace } from '../src/types'

describe('weekend data generation', () => {
  it('produces a schema-valid ranked payload', () => {
    const store = structuredClone(EMPTY_STORE)
    const condition = { venue: '東京', kind: 'flat' as const, surface: 'turf' as const, distance: 2000, courseVariant: '左', classCode: 'class-1', classLabel: '1勝クラス', ageRestriction: '3歳以上', sexRestriction: 'open', weightRule: '定量' }
    for (let index = 0; index < 40; index += 1) {
      const race: ParsedRace = {
        id: `history-${index}`, sourceUrl: 'https://www.jra.go.jp/history', date: `2025-${String((index % 12) + 1).padStart(2, '0')}-01`, venue: '東京', number: 1, startTime: '10:00', name: '歷史', condition, isResult: true,
        runners: [{ id: `horse-${index}`, number: 1, frame: 1, name: '歷史馬', sexAge: '牡4', jockey: '騎手', assignedWeight: 57, bodyWeight: 510, bodyWeightChange: 0, scratched: false, finish: index < 20 ? 1 : 2 }],
      }
      applyRaceResult(store, race)
    }
    const current: ParsedRace = {
      id: 'current', sourceUrl: 'https://www.jra.go.jp/current', date: '2026-08-22', venue: '東京', number: 5, startTime: '12:30', name: '本週測試', condition, isResult: false,
      runners: [{ id: 'horse-0', number: 1, frame: 1, name: '條件馬', sexAge: '牡5', jockey: '騎手', assignedWeight: 57, bodyWeight: 505, bodyWeightChange: 1, scratched: false, finish: null }],
    }
    const data = generateWeekendData([current], store, new Date('2026-08-18T03:00:00Z'))
    expect(weekendDataSchema.parse(data)).toEqual(data)
    expect(data.meetings[0]?.races[0]?.runners[0]?.rank).toBe(1)
  })
})
