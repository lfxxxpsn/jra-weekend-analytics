import { buildConditionKey, canonicalizeConditionKey, normalizeClass, parseConditionText } from '../src/lib/conditions'

describe('race condition normalization', () => {
  it.each([
    ['3歳以上500万円以下', 'class-1'],
    ['3歳以上 1勝クラス', 'class-1'],
    ['1000万円以下', 'class-2'],
    ['1600万下', 'class-3'],
    ['テスト（GⅢ）', 'graded'],
    ['テスト GII', 'graded'],
    ['テスト GI', 'graded'],
  ])('maps %s to %s', (input, expected) => {
    expect(normalizeClass(input).code).toBe(expected)
  })

  it('groups graded races and canonicalizes legacy class and weight keys', () => {
    expect(normalizeClass('\u30c6\u30b9\u30c8\uff08GIII\uff09')).toMatchObject({ code: 'graded', label: '\u91cd\u8cde\u4ee5\u4e0a' })
    expect(canonicalizeConditionKey('\u6771\u4eac|flat|turf|2000|\u5de6|g1|3\u6b73\u4ee5\u4e0a|open|\u5225\u5b9a'))
      .toBe('\u6771\u4eac|flat|turf|2000|\u5de6|graded|3\u6b73\u4ee5\u4e0a|open|handicap-special')
  })

  it('creates a stable exact-condition key', () => {
    const condition = parseConditionText('3歳以上 3勝クラス 牝馬限定 ハンデ コース：1,600メートル（芝・左 外）', '東京')
    expect(condition).toMatchObject({
      venue: '東京', surface: 'turf', distance: 1600, classCode: 'class-3', sexRestriction: 'female-only', weightRule: 'ハンデ',
    })
    expect(buildConditionKey(condition)).toBe('東京|flat|turf|1600|左 外|class-3|3歳以上|female-only|handicap-special')
  })
})
