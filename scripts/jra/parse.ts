import { createHash } from 'node:crypto'
import * as cheerio from 'cheerio'
import { normalizeClass, parseConditionText } from '../../src/lib/conditions'
import type { ParsedRace, ParsedRunner } from '../../src/types'

function compact(value: string) {
  return value.replace(/[\u00a0\u3000\s]+/g, ' ').trim()
}

function numberFrom(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Number(value.replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeBodyWeightText(value: string) {
  // JRA uses this marker when no previous-race weight change exists.
  return value.replace(/\u521d\u51fa\u8d70/g, '\u8a08\u4e0d')
}

export function stableRaceId(source: string) {
  return createHash('sha256').update(source).digest('hex').slice(0, 20)
}

function idFromLink(href: string | undefined, fallback: string) {
  if (!href) return stableRaceId(fallback)
  const cname = href.match(/[?&]CNAME=([^&]+)/i)?.[1] ?? href.match(/pw01dud[^'"\s)]+/i)?.[0]
  return cname ? stableRaceId(decodeURIComponent(cname)) : stableRaceId(href)
}

function selectRaceName($: cheerio.CheerioAPI, classLabel: string) {
  const selectors = ['.race_name', '.race_name h2', '.main h2', '#main h2', 'h2']
  const ignored = /出馬表|レース結果|払戻金|勝馬の紹介|タイム|コーナー通過|過去の成績/
  for (const selector of selectors) {
    const candidates = $(selector).toArray().map((element) => compact($(element).text()))
    const named = candidates.find((text) => text && !ignored.test(text) && text !== classLabel && text.length < 80)
    if (named) return named
  }
  return classLabel
}

function parseTableRunners($: cheerio.CheerioAPI, isResult: boolean): ParsedRunner[] {
  const runners: ParsedRunner[] = []
  const horseTable = $('table').filter((_, table) => {
    const root = $(table)
    return /馬名/.test(compact(root.find('thead').text())) && root.find('a[href*="accessU"], a[onclick*="pw01dud"]').length > 0
  }).first()
  horseTable.find('tbody tr, tr').each((rowIndex, row) => {
    const cells = $(row).find('th, td').toArray().map((cell) => compact($(cell).text()))
    const horseAnchor = $(row).find('a[href*="accessU"], a[onclick*="pw01dud"], a[href*="pw01dud"]').first()
    const name = compact(horseAnchor.text())
    if (!name || cells.length < 3 || /馬名|取消馬/.test(name)) return
    const currentRaceRow = $(row).clone()
    currentRaceRow.find('.past').remove()
    const rowText = normalizeBodyWeightText(compact(currentRaceRow.text()))
    const sexAge = rowText.match(/(牡|牝|せん)\s*(\d{1,2})/)?.slice(1).join('') ?? ''
    const weightMatch = rowText.match(/(\d{3})\s*(?:kg)?\s*\(\s*([+−-]?\d+|前計不|計不)\s*\)/i)
    const assignedWeight = numberFrom(rowText.match(/(?:^|\s)(\d{2}(?:\.\d))\s*(?:kg)?(?:\s|$)/)?.[1])
    const numericCells = cells.map((cell) => cell.match(/^\d+$/)?.[0]).filter(Boolean)
    const finish = isResult ? numberFrom(cells[0]?.match(/^\d+$/)?.[0]) : null
    const number = numberFrom(
      $(row).find('[class*="horse_num"], [class*="umaban"], .num').first().text().match(/\d+/)?.[0]
        ?? numericCells[isResult ? 2 : 1]
        ?? numericCells[0],
    )
    const frame = numberFrom(
      $(row).find('[class*="waku"] img').first().attr('alt')?.match(/枠(\d+)/)?.[1]
        ?? $(row).find('[class*="waku"]').first().text().match(/\d+/)?.[0]
        ?? numericCells[isResult ? 1 : 0],
    )
    const jockeyAnchor = $(row).find('a[href*="accessK"], a[onclick*="pw01k"], [class*="jockey"] a').first()
    const jockey = compact(jockeyAnchor.text())
    const href = horseAnchor.attr('href') ?? horseAnchor.attr('onclick')

    runners.push({
      id: idFromLink(href, `${name}-${sexAge}-${rowIndex}`),
      number,
      frame,
      name,
      sexAge,
      jockey,
      assignedWeight,
      bodyWeight: numberFrom(weightMatch?.[1]),
      bodyWeightChange: weightMatch?.[2] && !/計不/.test(weightMatch[2])
        ? numberFrom(weightMatch[2].replace('−', '-'))
        : null,
      scratched: /取消|除外/.test(rowText),
      finish,
    })
  })
  return dedupeRunners(runners)
}

function parseCardRunners($: cheerio.CheerioAPI): ParsedRunner[] {
  const runners: ParsedRunner[] = []
  $('[class*="horse_info"], [class*="horse-list"] li, [class*="entry"] [class*="horse"]').each((index, element) => {
    const root = $(element)
    const anchor = root.find('a[href*="accessU"], a[onclick*="pw01dud"], a[href*="pw01dud"]').first()
    const name = compact(anchor.text())
    if (!name) return
    const currentRaceCard = root.clone()
    currentRaceCard.find('.past').remove()
    const text = normalizeBodyWeightText(compact(currentRaceCard.text()))
    const sexAge = text.match(/(牡|牝|せん)\s*(\d{1,2})/)?.slice(1).join('') ?? ''
    const body = text.match(/(\d{3})\s*(?:kg)?\s*\(\s*([+−-]?\d+|前計不|計不)\s*\)/i)
    runners.push({
      id: idFromLink(anchor.attr('href') ?? anchor.attr('onclick'), `${name}-${index}`),
      number: numberFrom(root.find('[class*="umaban"], [class*="horse_num"]').first().text().match(/\d+/)?.[0]),
      frame: numberFrom(root.find('[class*="waku"]').first().text().match(/\d+/)?.[0]),
      name,
      sexAge,
      jockey: compact(root.find('[class*="jockey"] a, [class*="jockey"]').first().text()),
      assignedWeight: numberFrom(text.match(/(?:^|\s)(\d{2}(?:\.\d))\s*(?:kg)?(?:\s|$)/)?.[1]),
      bodyWeight: numberFrom(body?.[1]),
      bodyWeightChange: body?.[2] && !/計不/.test(body[2]) ? numberFrom(body[2].replace('−', '-')) : null,
      scratched: /取消|除外/.test(text),
      finish: null,
    })
  })
  return dedupeRunners(runners)
}

function dedupeRunners(runners: ParsedRunner[]) {
  return [...new Map(runners.map((runner) => [runner.id, runner])).values()]
}

export function parseRacePage(html: string, sourceUrl: string): ParsedRace {
  const $ = cheerio.load(html)
  const pageText = compact($('#main, #contentsBody, main, body').first().text())
  const dateMatch = pageText.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/)
  const date = dateMatch
    ? `${dateMatch[1]}-${String(dateMatch[2]).padStart(2, '0')}-${String(dateMatch[3]).padStart(2, '0')}`
    : ''
  const venue = pageText.match(/\d+回\s*([^\s\d]{2,5})\s*\d+日/)?.[1] ?? ''
  const number = numberFrom(pageText.match(/(?:^|\s)(\d{1,2})\s*レース/)?.[1]) ?? 0
  const startTimeMatch = pageText.match(/発走時刻[：:]?\s*(\d{1,2})時(\d{2})分/)
  const startTime = startTimeMatch ? `${startTimeMatch[1]?.padStart(2, '0')}:${startTimeMatch[2]}` : ''
  const courseMatch = pageText.match(/(?:サラ系[^。]*?)?(?:コース[：:]\s*)?[1-4],?\d{3}\s*メートル（[^）]+）/)
  const conditionContext = compact(`${pageText.slice(Math.max(0, pageText.indexOf(courseMatch?.[0] ?? '') - 180), pageText.indexOf(courseMatch?.[0] ?? '') + 160)} ${courseMatch?.[0] ?? ''}`)
  const condition = parseConditionText(conditionContext, venue)
  const name = selectRaceName($, condition.classLabel)
  const gradeText = compact($('#main [class*="grade"] img, #contentsBody [class*="grade"] img').first().attr('alt') ?? '')
  const resolvedClass = normalizeClass(`${conditionContext} ${name} ${gradeText}`)
  condition.classCode = resolvedClass.code
  condition.classLabel = resolvedClass.label
  const isResult = /レース結果/.test($('title, h1').text()) || /着順/.test(pageText)
  const runners = parseTableRunners($, isResult)
  const cardRunners = runners.length ? runners : parseCardRunners($)
  const cname = new URL(sourceUrl).searchParams.get('CNAME') ?? sourceUrl

  if (!date || !venue || !number || !condition.distance) {
    throw new Error(`Incomplete JRA race metadata at ${sourceUrl}`)
  }

  return {
    id: stableRaceId(cname),
    sourceUrl,
    date,
    venue,
    number,
    startTime,
    name,
    condition,
    runners: cardRunners,
    isResult,
  }
}
