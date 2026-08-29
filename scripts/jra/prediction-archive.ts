import { mkdir, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { predictionArchiveIndexSchema, predictionMonthDataSchema } from '../../src/schema'
import type {
  AggregateStore,
  Meeting,
  ParsedRace,
  PredictionArchiveIndex,
  PredictionMonthData,
  Race,
} from '../../src/types'
import { applyRaceResult, pruneStore } from './aggregate'
import { raceIdentityFromCname } from './discovery'
import { generateRacePrediction } from './generate'
import { EMPTY_STORE, writeJsonAtomic } from './store'

function dayLabel(date: string) {
  return new Intl.DateTimeFormat('zh-Hant-TW', { timeZone: 'Asia/Tokyo', weekday: 'long' })
    .format(new Date(`${date}T00:00:00+09:00`))
}

function raceKey(race: Pick<Race, 'date' | 'venue' | 'number'>) {
  return `${race.date}|${race.venue}|${race.number}`
}

export function createArchivedPrediction(parsed: ParsedRace, store: AggregateStore): Race {
  const prediction = generateRacePrediction({ ...parsed, isResult: false }, store)
  const finishByHorse = new Map(parsed.runners.map((runner) => [runner.id, runner.finish]))
  const finishByName = new Map(parsed.runners.map((runner) => [runner.name, runner.finish]))

  return {
    ...prediction,
    predictionStatus: parsed.isResult ? 'completed' : 'upcoming',
    otherConditions: [],
    runners: prediction.runners.map((runner) => {
      const positive = runner.features
        .filter((feature) => feature.value === true && feature.contribution > 0)
        .sort((a, b) => b.contribution - a.contribution)
        .slice(0, 3)
      const negative = runner.features
        .filter((feature) => feature.value === true && feature.contribution < 0)
        .sort((a, b) => a.contribution - b.contribution)
        .slice(0, 3)
      return {
        ...runner,
        features: [...positive, ...negative].map((feature) => ({
          featureId: feature.featureId,
          label: feature.label,
          value: feature.value,
          contribution: feature.contribution,
        })),
        actualFinish: parsed.isResult
          ? (finishByHorse.get(runner.id) ?? finishByName.get(runner.name) ?? null)
          : null,
      }
    }),
  }
}

function groupMeetings(races: Race[]) {
  const meetings = new Map<string, Meeting>()
  for (const race of races.sort((a, b) => a.date.localeCompare(b.date) || a.venue.localeCompare(b.venue) || a.number - b.number)) {
    const key = `${race.date}|${race.venue}`
    const meeting = meetings.get(key) ?? { date: race.date, dayLabel: dayLabel(race.date), venue: race.venue, races: [] }
    meeting.races.push(race)
    meetings.set(key, meeting)
  }
  return [...meetings.values()]
}

export function generatePredictionArchive(
  races: ParsedRace[],
  year: number,
  generatedAt = new Date(),
): { index: PredictionArchiveIndex; months: PredictionMonthData[] } {
  const store = structuredClone(EMPTY_STORE)
  const targetRaces: Race[] = []
  const sorted = [...races].sort((a, b) => a.date.localeCompare(b.date) || a.venue.localeCompare(b.venue) || a.number - b.number)
  const statisticsStart = `${year - 10}-01-01`

  for (let cursor = 0; cursor < sorted.length;) {
    const date = sorted[cursor]?.date
    if (!date) break
    const dayRaces: ParsedRace[] = []
    while (sorted[cursor]?.date === date) {
      const race = sorted[cursor]
      if (race) dayRaces.push(race)
      cursor += 1
    }

    pruneStore(store, date)
    if (date.startsWith(String(year))) {
      for (const race of dayRaces) targetRaces.push(createArchivedPrediction(race, store))
    }
    for (const race of dayRaces) applyRaceResult(store, race, race.date >= statisticsStart)
  }

  const generatedAtIso = generatedAt.toISOString()
  const months = [...new Set(targetRaces.map((race) => race.date.slice(0, 7)))].sort().map((month) => {
    const monthRaces = targetRaces.filter((race) => race.date.startsWith(month))
    return predictionMonthDataSchema.parse({
      metadata: { schemaVersion: 1, year, month, generatedAt: generatedAtIso, methodology: 'pre-race-only' },
      meetings: groupMeetings(monthRaces),
    })
  })
  const index = predictionArchiveIndexSchema.parse({
    metadata: { schemaVersion: 1, year, generatedAt: generatedAtIso, methodology: 'pre-race-only' },
    months: months.map((month) => ({
      month: month.metadata.month,
      raceCount: month.meetings.reduce((sum, meeting) => sum + meeting.races.length, 0),
      dates: [...new Set(month.meetings.map((meeting) => meeting.date))],
    })),
  })
  return { index, months }
}

export async function writePredictionArchive(
  races: ParsedRace[],
  year: number,
  outputDirectory: string,
  generatedAt = new Date(),
) {
  const archive = generatePredictionArchive(races, year, generatedAt)
  await mkdir(outputDirectory, { recursive: true })
  for (const month of archive.months) {
    await writeJsonAtomic(join(outputDirectory, `${month.metadata.month.slice(5)}.json`), month)
  }
  await writeJsonAtomic(join(outputDirectory, 'index.json'), archive.index)
  return archive.index
}

async function readMonth(outputDirectory: string, year: number, month: string, generatedAt: Date): Promise<PredictionMonthData> {
  try {
    return predictionMonthDataSchema.parse(JSON.parse(await readFile(join(outputDirectory, `${month.slice(5)}.json`), 'utf8')))
  } catch {
    return predictionMonthDataSchema.parse({
      metadata: { schemaVersion: 1, year, month, generatedAt: generatedAt.toISOString(), methodology: 'pre-race-only' },
      meetings: [],
    })
  }
}

function mergeCompletedPrediction(existing: Race, incoming: Race) {
  if (existing.predictionStatus === 'completed') return existing
  if (incoming.predictionStatus !== 'completed') return incoming
  const actualById = new Map(incoming.runners.map((runner) => [runner.id, runner.actualFinish]))
  const actualByName = new Map(incoming.runners.map((runner) => [runner.name, runner.actualFinish]))
  return {
    ...existing,
    sourceUrl: incoming.sourceUrl,
    bodyWeightStatus: incoming.bodyWeightStatus,
    predictionStatus: 'completed' as const,
    runners: existing.runners.map((runner) => ({
      ...runner,
      actualFinish: actualById.get(runner.id) ?? actualByName.get(runner.name) ?? runner.actualFinish ?? null,
    })),
  }
}

export async function readPendingPredictionRaceIdentities(outputDirectory: string) {
  let files: string[]
  try {
    files = (await readdir(outputDirectory)).filter((file) => /^\d{2}\.json$/.test(file))
  } catch {
    return new Set<string>()
  }

  const pending = new Set<string>()
  for (const file of files) {
    const month = predictionMonthDataSchema.parse(JSON.parse(await readFile(join(outputDirectory, file), 'utf8')))
    for (const race of month.meetings.flatMap((meeting) => meeting.races)) {
      if (race.predictionStatus === 'completed') continue
      const identity = raceIdentityFromCname(new URL(race.sourceUrl).searchParams.get('CNAME') ?? undefined)
      if (identity) pending.add(identity)
    }
  }
  return pending
}
export async function upsertPredictionRaces(
  races: Race[],
  year: number,
  outputDirectory: string,
  generatedAt = new Date(),
) {
  if (!races.length) return
  await mkdir(outputDirectory, { recursive: true })
  const byMonth = new Map<string, Race[]>()
  for (const race of races.filter((candidate) => candidate.date.startsWith(String(year)))) {
    const month = race.date.slice(0, 7)
    byMonth.set(month, [...(byMonth.get(month) ?? []), race])
  }

  for (const [month, incomingRaces] of byMonth) {
    const monthData = await readMonth(outputDirectory, year, month, generatedAt)
    const existing = monthData.meetings.flatMap((meeting) => meeting.races)
    const merged = new Map(existing.map((race) => [raceKey(race), race]))
    for (const incoming of incomingRaces) {
      const key = raceKey(incoming)
      const previous = merged.get(key)
      merged.set(key, previous ? mergeCompletedPrediction(previous, incoming) : incoming)
    }
    monthData.metadata.generatedAt = generatedAt.toISOString()
    monthData.meetings = groupMeetings([...merged.values()])
    await writeJsonAtomic(join(outputDirectory, `${month.slice(5)}.json`), predictionMonthDataSchema.parse(monthData))
  }

  const files = (await readdir(outputDirectory)).filter((file) => /^\d{2}\.json$/.test(file)).sort()
  const months = await Promise.all(files.map(async (file) => predictionMonthDataSchema.parse(
    JSON.parse(await readFile(join(outputDirectory, file), 'utf8')),
  )))
  const index = predictionArchiveIndexSchema.parse({
    metadata: { schemaVersion: 1, year, generatedAt: generatedAt.toISOString(), methodology: 'pre-race-only' },
    months: months.map((month) => ({
      month: month.metadata.month,
      raceCount: month.meetings.reduce((sum, meeting) => sum + meeting.races.length, 0),
      dates: [...new Set(month.meetings.map((meeting) => meeting.date))],
    })),
  })
  await writeJsonAtomic(join(outputDirectory, 'index.json'), index)
}
