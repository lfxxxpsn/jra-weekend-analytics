import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { predictionArchiveIndexSchema, predictionMonthDataSchema } from '../src/schema'
import { createArchivedPrediction, generatePredictionArchive, readPendingPredictionRaceIdentities, upsertPredictionRaces } from '../scripts/jra/prediction-archive'
import { EMPTY_STORE } from '../scripts/jra/store'
import type { ParsedRace } from '../src/types'

const condition = {
  venue: '東京',
  kind: 'flat' as const,
  surface: 'turf' as const,
  distance: 2000,
  courseVariant: '左',
  classCode: 'class-1',
  classLabel: '1勝クラス',
  ageRestriction: '3歲以上',
  sexRestriction: 'open',
  weightRule: '定量',
}

function resultRace(id: string, date: string, number: number, finish = 1): ParsedRace {
  return {
    id,
    sourceUrl: `https://www.jra.go.jp/result/${id}`,
    date,
    venue: '東京',
    number,
    startTime: '10:00',
    name: `測試賽事 ${number}`,
    condition,
    isResult: true,
    runners: [{
      id: `horse-${id}`,
      number: 1,
      frame: 1,
      name: `測試馬 ${id}`,
      sexAge: '牡4',
      jockey: '測試騎師',
      assignedWeight: 57,
      bodyWeight: 500,
      bodyWeightChange: 0,
      scratched: false,
      finish,
    }],
  }
}

describe('2026 pre-race prediction archive', () => {
  it('generates schema-valid monthly shards without same-day result leakage', () => {
    const history = Array.from({ length: 30 }, (_, index) => resultRace(
      `history-${index}`,
      `2025-${String((index % 12) + 1).padStart(2, '0')}-${String(Math.floor(index / 12) + 1).padStart(2, '0')}`,
      1,
    ))
    const races = [
      ...history,
      resultRace('target-a', '2026-01-04', 1),
      resultRace('target-b', '2026-01-04', 2, 2),
      resultRace('target-c', '2026-01-05', 1),
    ]

    const archive = generatePredictionArchive(races, 2026, new Date('2026-08-19T00:00:00Z'))
    expect(predictionArchiveIndexSchema.parse(archive.index)).toEqual(archive.index)
    expect(archive.months).toHaveLength(1)
    expect(predictionMonthDataSchema.parse(archive.months[0])).toEqual(archive.months[0])

    const predictions = archive.months[0]?.meetings.flatMap((meeting) => meeting.races) ?? []
    const firstDay = predictions.filter((race) => race.date === '2026-01-04')
    expect(firstDay).toHaveLength(2)
    expect(firstDay.every((race) => race.sampleStarts === 30)).toBe(true)
    expect(predictions.find((race) => race.id === 'target-c')?.sampleStarts).toBe(32)
    expect(predictions.find((race) => race.id === 'target-a')?.runners[0]?.actualFinish).toBe(1)
    expect(predictions.every((race) => race.predictionStatus === 'completed')).toBe(true)
  })

  it('preserves completed results and repairs pending archive entries', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'prediction-archive-'))
    try {
      const cnameCore = '0107202603030320260829'
      const parsed = resultRace('same-race', '2026-08-29', 3)
      const entry = createArchivedPrediction({
        ...parsed,
        sourceUrl: `https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde${cnameCore}/D8`,
        isResult: false,
      }, structuredClone(EMPTY_STORE))
      const completed = createArchivedPrediction({
        ...parsed,
        sourceUrl: `https://www.jra.go.jp/JRADB/accessS.html?CNAME=pw01sde${cnameCore}/7A`,
      }, structuredClone(EMPTY_STORE))

      await upsertPredictionRaces([entry], 2026, directory)
      expect(await readPendingPredictionRaceIdentities(directory)).toEqual(new Set([cnameCore]))

      await upsertPredictionRaces([completed, entry], 2026, directory)
      const month = predictionMonthDataSchema.parse(JSON.parse(
        await readFile(join(directory, '08.json'), 'utf8'),
      ))
      const race = month.meetings.flatMap((meeting) => meeting.races)[0]
      expect(race?.predictionStatus).toBe('completed')
      expect(race?.runners[0]?.actualFinish).toBe(1)
      expect(await readPendingPredictionRaceIdentities(directory)).toEqual(new Set())
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
