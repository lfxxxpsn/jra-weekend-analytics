import type { FeatureId, RaceCondition, Surface } from '../types'

export const FEATURE_LABELS: Record<FeatureId, string> = {
  lastStartWon: '前走勝利',
  lastStartTop3: '前走前三名',
  bodyWeight500Plus: '馬體重 500 公斤以上',
  wonSameDistance: '曾勝出相同距離',
  wonSameVenue: '曾在相同競馬場勝利',
  wonSameSurface: '曾在相同跑道勝利',
  wonSameOrHigherClass: '曾在同級或更高級別勝利',
}

const CLASS_PATTERNS: Array<[RegExp, string, string, number]> = [
  [/新馬/, 'maiden-new', '新馬', 0],
  [/未勝利/, 'maiden', '未勝利', 0],
  [/(?:1勝クラス|500万(?:(?:円)?以下|下))/, 'class-1', '1勝クラス', 1],
  [/(?:2勝クラス|1000万(?:(?:円)?以下|下))/, 'class-2', '2勝クラス', 2],
  [/(?:3勝クラス|1600万(?:(?:円)?以下|下))/, 'class-3', '3勝クラス', 3],
  [/(?:G|\uff27)(?:III|II|I|3|2|1|[\u2160-\u2162])/i, 'graded', '重賞以上', 6],
  [/(?:リステッド|Listed|\(L\)|（L）)/i, 'listed', 'Listed', 5],
  [/(?:オープン|OPEN)/i, 'open', 'Open', 4],
]

const LEGACY_GRADED_CLASS_CODES = new Set(['g1', 'g2', 'g3', 'graded'])
const MERGED_WEIGHT_RULES = new Set(['ハンデ', '別定'])

function normalizeClassCode(code: string) {
  return LEGACY_GRADED_CLASS_CODES.has(code.toLowerCase()) ? 'graded' : code
}

function normalizeWeightRule(rule: string) {
  const normalized = rule.toLowerCase()
  return MERGED_WEIGHT_RULES.has(normalized) ? 'handicap-special' : rule
}

export function normalizeClass(text: string): { code: string; label: string; rank: number } {
  const compact = text.replace(/\s+/g, '')
  for (const [pattern, code, label, rank] of CLASS_PATTERNS) {
    if (pattern.test(compact)) return { code, label, rank }
  }
  return { code: 'other', label: text.trim() || '其他', rank: 0 }
}

export function classRank(code: string): number {
  const normalizedCode = normalizeClassCode(code)
  return CLASS_PATTERNS.find(([, candidate]) => candidate === normalizedCode)?.[3] ?? 0
}

export function canonicalizeConditionKey(conditionKey: string): string {
  const parts = conditionKey.split('|').map((part) => part.trim().toLowerCase())
  if (parts.length > 5) parts[5] = normalizeClassCode(parts[5] ?? '')
  if (parts.length > 8) parts[8] = normalizeWeightRule(parts[8] ?? '')
  return parts.join('|')
}

export function normalizeSurface(text: string): Surface {
  if (/障害/.test(text)) return 'jump'
  if (/芝/.test(text)) return 'turf'
  if (/ダート|ダ\d/.test(text)) return 'dirt'
  return 'unknown'
}

export function buildConditionKey(condition: RaceCondition): string {
  return [
    condition.venue,
    condition.kind,
    condition.surface,
    condition.distance,
    condition.courseVariant || '-',
    normalizeClassCode(condition.classCode),
    condition.ageRestriction || '-',
    condition.sexRestriction || '-',
    normalizeWeightRule(condition.weightRule || '-'),
  ].map((part) => String(part).trim().toLowerCase()).join('|')
}

export function parseConditionText(text: string, venue: string): RaceCondition {
  const normalized = text.replace(/[\u3000\s]+/g, ' ').trim()
  const distance = Number(normalized.match(/([1-4],?\d{3})\s*メートル/)?.[1]?.replace(',', '') ?? 0)
  const classInfo = normalizeClass(normalized)
  const surface = normalizeSurface(normalized)
  const variant = normalized.match(/（(?:芝|ダート|障害)[・･]?([^）]*)）/)?.[1]?.trim() ?? ''
  const age = normalized.match(/(?:サラ系)?(\d歳(?:以上)?|\d歳上|\d歳)/)?.[1] ?? ''
  const sex = /牝馬限定|牝/.test(normalized) ? 'female-only' : /牡・牝|牡牝/.test(normalized) ? 'colt-filly' : 'open'
  const weight = ['ハンデ', '定量', '別定', '馬齢'].find((rule) => normalized.includes(rule)) ?? ''

  return {
    venue,
    kind: surface === 'jump' ? 'jump' : 'flat',
    surface,
    distance,
    courseVariant: variant,
    classCode: classInfo.code,
    classLabel: classInfo.label,
    ageRestriction: age,
    sexRestriction: sex,
    weightRule: weight,
  }
}
