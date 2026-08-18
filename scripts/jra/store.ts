import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { AggregateStore } from '../../src/types'

export const EMPTY_STORE: AggregateStore = {
  version: 1,
  generatedAt: new Date(0).toISOString(),
  buckets: [],
  processedRaceIds: [],
  horses: {},
}

export async function readStore(path = 'data/aggregate-store.json'): Promise<AggregateStore> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as AggregateStore
    if (parsed.version !== 1 || !Array.isArray(parsed.buckets)) throw new Error('Unsupported aggregate store')
    return parsed
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(EMPTY_STORE)
    throw error
  }
}

export async function writeJsonAtomic(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  const { rename } = await import('node:fs/promises')
  await rename(temporary, path)
}

export async function writeStore(store: AggregateStore, path = 'data/aggregate-store.json') {
  store.generatedAt = new Date().toISOString()
  await writeJsonAtomic(path, store)
}
