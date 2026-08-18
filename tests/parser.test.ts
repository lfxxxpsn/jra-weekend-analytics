import { readFile } from 'node:fs/promises'
import { parseRacePage } from '../scripts/jra/parse'

describe('JRA page parser', () => {
  it('parses an entry card including pending body weight', async () => {
    const html = await readFile('tests/fixtures/entry.html', 'utf8')
    const race = parseRacePage(html, 'https://www.jra.go.jp/JRADB/accessD.html?CNAME=test-entry')
    expect(race).toMatchObject({ date: '2026-08-22', venue: '新潟', number: 7, startTime: '15:25', name: 'テスト杯', isResult: false })
    expect(race.condition).toMatchObject({ distance: 1600, surface: 'turf', courseVariant: '左 外', classCode: 'class-3' })
    expect(race.runners).toHaveLength(2)
    expect(race.runners[0]).toMatchObject({ number: 1, frame: 1, bodyWeight: 502, bodyWeightChange: 4, jockey: '騎手一' })
    expect(race.runners[1]?.bodyWeight).toBeNull()
  })

  it('handles dead heat and excludes a scratched runner later in aggregation', async () => {
    const html = await readFile('tests/fixtures/result.html', 'utf8')
    const race = parseRacePage(html, 'https://www.jra.go.jp/JRADB/accessS.html?CNAME=test-result')
    expect(race.isResult).toBe(true)
    expect(race.runners.map((runner) => runner.finish)).toEqual([1, 1, null])
    expect(race.runners[2]?.scratched).toBe(true)
  })

  it('recognizes obstacle races', async () => {
    const html = await readFile('tests/fixtures/jump-result.html', 'utf8')
    const race = parseRacePage(html, 'https://www.jra.go.jp/JRADB/accessS.html?CNAME=jump-result')
    expect(race.condition).toMatchObject({ kind: 'jump', surface: 'jump', distance: 4250 })
  })
})
