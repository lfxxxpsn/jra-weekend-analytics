import { dateFromCname, raceIdentityFromCname } from '../scripts/jra/discovery'

describe('JRA navigation discovery', () => {
  it('uses the final YYYYMMDD segment as the actual race date', () => {
    expect(dateFromCname('pw01srl10042026020720260815/95')).toBe('2026-08-15')
    expect(dateFromCname('pw01dde1007202602080720260816/08')).toBe('2026-08-16')
  })

  it('returns an empty date when the navigation token has no date', () => {
    expect(dateFromCname('pw01dli00/F3')).toBe('')
    expect(dateFromCname(undefined)).toBe('')
  })

  it('matches entry and result actions for the same race', () => {
    const entry = raceIdentityFromCname('pw01dde0107202603030320260829/D8')
    const result = raceIdentityFromCname('pw01sde0107202603030320260829/7A')
    expect(entry).toBe(result)
    expect(entry).not.toBe('')
  })
})
