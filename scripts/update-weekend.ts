import { readFile } from 'node:fs/promises'
import { applyRaceResult, pruneStore } from './jra/aggregate'
import { actionsByCname, dateFromCname, findMenuAction, racePageActions } from './jra/discovery'
import { generateWeekendData } from './jra/generate'
import { fetchHtml, type JraAction } from './jra/http'
import { parseRacePage, stableRaceId } from './jra/parse'
import { createArchivedPrediction, upsertPredictionRaces } from './jra/prediction-archive'
import { readStore, writeJsonAtomic, writeStore } from './jra/store'
import { weekendDataSchema } from '../src/schema'
import type { ParsedRace, Race, WeekendData } from '../src/types'

const HOME_URL = 'https://www.jra.go.jp/'
const OUTPUT_PATH = process.env.WEEKEND_DATA_PATH ?? 'public/data/weekend.json'
const STORE_PATH = process.env.JRA_STORE_PATH ?? 'data/aggregate-store.json'
const ARCHIVE_YEAR = Number(process.env.PREDICTION_ARCHIVE_YEAR ?? 2026)
const ARCHIVE_DIRECTORY = process.env.PREDICTION_ARCHIVE_PATH ?? `public/data/predictions/${ARCHIVE_YEAR}`

function uniqueActions(actions: JraAction[]) {
  return [...new Map(actions.map((action) => [`${action.url}|${action.cname ?? ''}`, action])).values()]
}

function cnameFrom(action: JraAction) {
  return action.cname ?? new URL(action.url).searchParams.get('CNAME') ?? action.url
}

function weekendWindow(now = new Date()) {
  const tokyo = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
  const day = tokyo.getDay()
  const offsetToSaturday = day === 0 ? -1 : day === 6 ? 0 : 6 - day
  const start = new Date(tokyo)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() + offsetToSaturday)
  const end = new Date(start)
  end.setDate(end.getDate() + 2)
  const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return { start: iso(start), end: iso(end) }
}

async function discoverCurrentRaceActions(homeHtml: string) {
  const indexAction = findMenuAction(homeHtml, '/JRADB/accessD.html', 'pw01dli')
  const indexHtml = await fetchHtml(indexAction)
  const meetingActions = actionsByCname(indexHtml, 'pw01drl')
  const raceActions: JraAction[] = racePageActions(indexHtml, 'entry')
  for (const meeting of meetingActions) {
    const meetingHtml = await fetchHtml(meeting)
    raceActions.push(...racePageActions(meetingHtml, 'entry'))
  }
  return uniqueActions(raceActions)
}

async function discoverRecentResultActions(homeHtml: string, storeIds: Set<string>) {
  const indexAction = findMenuAction(homeHtml, '/JRADB/accessS.html', 'pw01sli')
  const indexHtml = await fetchHtml(indexAction)
  const recentWindowStart = new Date()
  recentWindowStart.setDate(recentWindowStart.getDate() - 35)
  const cutoff = recentWindowStart.toISOString().slice(0, 10)
  const meetings = actionsByCname(indexHtml, 'pw01srl').filter((action) => dateFromCname(action.cname) >= cutoff)
  const raceActions: JraAction[] = racePageActions(indexHtml, 'result')
  for (const meeting of meetings) {
    const meetingHtml = await fetchHtml(meeting)
    raceActions.push(...racePageActions(meetingHtml, 'result'))
  }
  return uniqueActions(raceActions).filter((action) => !storeIds.has(stableRaceId(cnameFrom(action))))
}

async function parseActions(actions: JraAction[], mode: 'entry' | 'result') {
  const races: ParsedRace[] = []
  for (const action of actions) {
    const url = action.cname
      ? `${action.url.split('?')[0]}?CNAME=${encodeURIComponent(action.cname)}`
      : action.url
    const race = parseRacePage(await fetchHtml(action), url)
    if (mode === 'entry' && race.runners.length === 0) continue
    races.push({ ...race, isResult: mode === 'result' })
  }
  return races
}

async function readPrevious(): Promise<WeekendData | null> {
  try {
    return weekendDataSchema.parse(JSON.parse(await readFile(OUTPUT_PATH, 'utf8')))
  } catch {
    return null
  }
}

async function preserveWithWarning(previous: WeekendData | null, message: string) {
  const fallback: WeekendData = previous
    ? {
        ...previous,
        metadata: {
          ...previous.metadata,
          status: previous.meetings.length ? 'stale' : 'unavailable',
          warnings: [...new Set([...previous.metadata.warnings, message])],
        },
      }
    : {
        metadata: {
          schemaVersion: 1,
          fetchedAt: new Date().toISOString(),
          historyStart: new Date().toISOString().slice(0, 10),
          historyEnd: new Date().toISOString().slice(0, 10),
          status: 'error',
          warnings: [message],
        },
        meetings: [],
      }
  await writeJsonAtomic(OUTPUT_PATH, weekendDataSchema.parse(fallback))
}

async function main() {
  const previous = await readPrevious()
  try {
    const store = await readStore(STORE_PATH)
    const homeHtml = await fetchHtml({ url: HOME_URL })

    const recentResults = await discoverRecentResultActions(homeHtml, new Set(store.processedRaceIds))
    const resultRaces = await parseActions(recentResults, 'result')
    let updatedResults = 0
    const archivePredictions: Race[] = []
    const sortedResults = resultRaces.sort((a, b) => a.date.localeCompare(b.date) || a.venue.localeCompare(b.venue) || a.number - b.number)
    for (let cursor = 0; cursor < sortedResults.length;) {
      const date = sortedResults[cursor]?.date
      if (!date) break
      const dayRaces: ParsedRace[] = []
      while (sortedResults[cursor]?.date === date) {
        const race = sortedResults[cursor]
        if (race) dayRaces.push(race)
        cursor += 1
      }
      pruneStore(store, date)
      for (const race of dayRaces) {
        if (race.date.startsWith(String(ARCHIVE_YEAR))) archivePredictions.push(createArchivedPrediction(race, store))
      }
      for (const race of dayRaces) {
        if (applyRaceResult(store, race, true)) updatedResults += 1
      }
    }

    const { start, end } = weekendWindow()
    const currentActions = (await discoverCurrentRaceActions(homeHtml)).filter((action) => {
      const date = dateFromCname(cnameFrom(action))
      return date >= start && date <= end
    })
    const currentRaces = await parseActions(currentActions, 'entry')
    const minimum = Number(process.env.JRA_MIN_EXPECTED_RACES ?? 6)
    if (currentRaces.length < minimum) {
      await preserveWithWarning(previous, `JRA 出馬資料尚未完整（目前 ${currentRaces.length} 場）；保留上次成功資料。`)
      await upsertPredictionRaces(archivePredictions, ARCHIVE_YEAR, ARCHIVE_DIRECTORY)
      if (updatedResults) {
        pruneStore(store, new Date().toISOString().slice(0, 10))
        await writeStore(store, STORE_PATH)
      }
      return
    }

    pruneStore(store, new Date().toISOString().slice(0, 10))
    const data = generateWeekendData(currentRaces, store)
    archivePredictions.push(...currentRaces
      .filter((race) => race.date.startsWith(String(ARCHIVE_YEAR)))
      .map((race) => createArchivedPrediction(race, store)))
    await writeStore(store, STORE_PATH)
    await writeJsonAtomic(OUTPUT_PATH, data)
    await upsertPredictionRaces(archivePredictions, ARCHIVE_YEAR, ARCHIVE_DIRECTORY)
    process.stdout.write(`Updated ${currentRaces.length} races; added ${updatedResults} completed results.\n`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await preserveWithWarning(previous, `本次自動更新失敗：${message}`)
    process.stderr.write(`${message}\n`)
  }
}

await main()
