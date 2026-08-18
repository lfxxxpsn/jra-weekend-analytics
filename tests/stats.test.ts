import { calculateContribution, classifyStat, createConditionStat, wilsonInterval } from '../src/lib/stats'

describe('statistical classification and scoring', () => {
  it('keeps 100% from a tiny sample out of ranking', () => {
    const stat = createConditionStat({ featureId: 'wonSameDistance', starts: 3, wins: 3, baselineStarts: 300, baselineWins: 20 })
    expect(stat.rate).toBe(1)
    expect(stat.classification).toBe('insufficient')
    expect(calculateContribution(stat, true)).toBe(0)
  })

  it('classifies only when the Wilson interval clears baseline', () => {
    const [low, high] = wilsonInterval(40, 100)
    expect(low).toBeGreaterThan(0.3)
    expect(high).toBeLessThan(0.5)
    expect(classifyStat(100, low, high, 0.1)).toBe('high')
    expect(classifyStat(100, low, high, 0.7)).toBe('low')
  })

  it('caps each transparent contribution at twenty points', () => {
    const stat = createConditionStat({ featureId: 'lastStartWon', starts: 100, wins: 80, baselineStarts: 1000, baselineWins: 50 })
    expect(calculateContribution(stat, true)).toBe(20)
    expect(calculateContribution(stat, false)).toBe(0)
    expect(calculateContribution(stat, null)).toBe(0)
  })
})
