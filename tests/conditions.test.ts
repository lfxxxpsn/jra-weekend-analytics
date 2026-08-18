import { buildConditionKey, normalizeClass, parseConditionText } from '../src/lib/conditions'

describe('race condition normalization', () => {
  it.each([
    ['3歳以上500万円以下', 'class-1'],
    ['3歳以上 1勝クラス', 'class-1'],
    ['1000万円以下', 'class-2'],
    ['1600万下', 'class-3'],
    ['テスト（GⅢ）', 'g3'],
  ])('maps %s to %s', (input, expected) => {
    expect(normalizeClass(input).code).toBe(expected)
  })

  it('creates a stable exact-condition key', () => {
    const condition = parseConditionText('3歳以上 3勝クラス 牝馬限定 ハンデ コース：1,600メートル（芝・左 外）', '東京')
    expect(condition).toMatchObject({
      venue: '東京', surface: 'turf', distance: 1600, classCode: 'class-3', sexRestriction: 'female-only', weightRule: 'ハンデ',
    })
    expect(buildConditionKey(condition)).toBe('東京|flat|turf|1600|左 外|class-3|3歳以上|female-only|ハンデ')
  })
})
