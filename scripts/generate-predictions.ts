import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writePredictionArchive } from './jra/prediction-archive'
import type { ParsedRace } from '../src/types'

function argument(name: string) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
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
  const partsDirectory = argument('--parts') ?? 'data/bootstrap-parts'
  const year = Number(argument('--year') ?? new Date().getUTCFullYear())
  const outputDirectory = argument('--output') ?? `public/data/predictions/${year}`
  if (!Number.isInteger(year) || year < 1986) throw new Error('Use --year YYYY')

  const files = await jsonFiles(partsDirectory)
  const races = (await Promise.all(files.map(async (file) => JSON.parse(await readFile(file, 'utf8')) as ParsedRace[]))).flat()
  if (!races.length) throw new Error(`No bootstrap JSON found under ${partsDirectory}`)
  const index = await writePredictionArchive(races, year, outputDirectory)
  const count = index.months.reduce((sum, month) => sum + month.raceCount, 0)
  process.stdout.write(`Generated ${count} pre-race predictions across ${index.months.length} months.\n`)
}

await main()
