import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { applyRaceResult, pruneStore } from './jra/aggregate'
import { actionsByCname, findMenuAction, historicalMonthAction, parseMonthChecksums, racePageActions } from './jra/discovery'
import { fetchHtml, type JraAction } from './jra/http'
import { parseRacePage } from './jra/parse'
import { EMPTY_STORE, writeJsonAtomic, writeStore } from './jra/store'
import type { ParsedRace } from '../src/types'

const HOME_URL = 'https://www.jra.go.jp/'

function argument(name: string) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function uniqueActions(actions: JraAction[]) {
  return [...new Map(actions.map((action) => [`${action.url}|${action.cname ?? ''}`, action])).values()]
}

async function discoverChecksums() {
  const homeHtml = await fetchHtml({ url: HOME_URL })
  const searchAction = findMenuAction(homeHtml, '/JRADB/accessS.html', 'pw01skl00')
  const searchHtml = await fetchHtml(searchAction)
  return parseMonthChecksums(searchHtml)
}

async function fetchYear(year: number): Promise<ParsedRace[]> {
  const checksums = await discoverChecksums()
  const races: ParsedRace[] = []
  for (let month = 1; month <= 12; month += 1) {
    const monthHtml = await fetchHtml(historicalMonthAction(year, month, checksums))
    const meetings = actionsByCname(monthHtml, 'pw01srl').filter((action) => action.cname?.includes(String(year)))
    for (const meeting of meetings) {
      const meetingHtml = await fetchHtml(meeting)
      const actions = uniqueActions(racePageActions(meetingHtml, 'result'))
      for (const action of actions) {
        const url = action.cname
          ? `${action.url.split('?')[0]}?CNAME=${encodeURIComponent(action.cname)}`
          : action.url
        const race = parseRacePage(await fetchHtml(action), url)
        if (race.date.startsWith(String(year))) races.push({ ...race, isResult: true })
      }
    }
    process.stdout.write(`${year}-${String(month).padStart(2, '0')}: ${races.length} races\n`)
  }
  if (!races.length) throw new Error(`No races found for ${year}`)
  return races
}

async function mergeParts(directory: string, storePath: string) {
  const files = await jsonFiles(directory)
  const races = (await Promise.all(files.map(async (file) => JSON.parse(await readFile(file, 'utf8')) as ParsedRace[])))
    .flat()
    .sort((a, b) => a.date.localeCompare(b.date) || a.venue.localeCompare(b.venue) || a.number - b.number)
  if (!races.length) throw new Error('Bootstrap parts contain no races')

  const latest = races.at(-1)?.date ?? new Date().toISOString().slice(0, 10)
  const statisticsCutoff = new Date(`${latest}T00:00:00Z`)
  statisticsCutoff.setUTCFullYear(statisticsCutoff.getUTCFullYear() - 10)
  const cutoff = statisticsCutoff.toISOString().slice(0, 10)
  const store = structuredClone(EMPTY_STORE)
  for (const race of races) applyRaceResult(store, race, race.date >= cutoff)
  pruneStore(store, latest)
  await writeStore(store, storePath)
  process.stdout.write(`Merged ${races.length} races into ${store.buckets.length} aggregate buckets.\n`)
}

async function jsonFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return jsonFiles(path)
    return entry.isFile() && entry.name.endsWith('.json') ? [path] : []
  }))
  return files.flat()
}

async function main() {
  const mergeDirectory = argument('--merge')
  const storePath = argument('--store') ?? 'data/aggregate-store.json'
  if (mergeDirectory) return mergeParts(mergeDirectory, storePath)

  const year = Number(argument('--year'))
  if (!Number.isInteger(year) || year < 1986) {
    throw new Error('Use --year YYYY, or --merge DIRECTORY')
  }
  const output = argument('--output') ?? `data/bootstrap-parts/${year}.json`
  const races = await fetchYear(year)
  await writeJsonAtomic(output, races)
}

await main()
