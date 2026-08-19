import * as cheerio from 'cheerio'
import type { JraAction } from './http'

const JRA_ORIGIN = 'https://www.jra.go.jp'

export function extractActions(html: string, baseUrl = JRA_ORIGIN): JraAction[] {
  const $ = cheerio.load(html)
  const actions: JraAction[] = []
  const seen = new Set<string>()

  const add = (urlValue: string, cname?: string, label?: string) => {
    try {
      const url = new URL(urlValue, baseUrl)
      if (url.hostname !== 'www.jra.go.jp' && url.hostname !== 'jra.go.jp') return
      const queryCname = url.searchParams.get('CNAME') ?? undefined
      const action = { url: url.toString(), cname: cname ?? queryCname, label: label?.replace(/\s+/g, ' ').trim() }
      const key = `${action.url}|${action.cname ?? ''}`
      if (!seen.has(key)) {
        seen.add(key)
        actions.push(action)
      }
    } catch {
      // Ignore malformed navigation fragments in JRA's inline JavaScript.
    }
  }

  $('a').each((_, element) => {
    const anchor = $(element)
    const label = anchor.text()
    const href = anchor.attr('href')
    if (href && href !== '#') add(href, undefined, label)

    const handler = anchor.attr('onclick') ?? anchor.attr('onClick') ?? ''
    const match = handler.match(/doAction\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/i)
    if (match?.[1] && match[2]) add(match[1], match[2], label)
  })

  return actions
}

export function findMenuAction(html: string, pathPart: string, cnamePrefix: string): JraAction {
  const action = extractActions(html).find((candidate) =>
    candidate.url.includes(pathPart) && candidate.cname?.startsWith(cnamePrefix),
  )
  if (!action) throw new Error(`JRA navigation action not found: ${pathPart} ${cnamePrefix}`)
  return action
}

export function actionsByCname(html: string, prefix: string): JraAction[] {
  return extractActions(html).filter((action) => action.cname?.startsWith(prefix))
}

export function racePageActions(html: string, mode: 'entry' | 'result'): JraAction[] {
  const path = mode === 'entry' ? '/JRADB/accessD.html' : '/JRADB/accessS.html'
  const prefix = mode === 'entry' ? 'pw01dde' : 'pw01sde'
  return extractActions(html).filter((action) => action.url.includes(path) && (
    action.cname?.startsWith(prefix) || new URL(action.url).searchParams.get('CNAME')?.startsWith(prefix)
  ))
}

export function parseMonthChecksums(html: string): Map<string, string> {
  const result = new Map<string, string>()
  for (const match of html.matchAll(/objParam\["(\d{4})"\]\s*=\s*"([A-F0-9]{2})"/g)) {
    if (match[1] && match[2]) result.set(match[1], match[2])
  }
  return result
}

export function historicalMonthAction(year: number, month: number, checksums: Map<string, string>): JraAction {
  const yyyymm = `${year}${String(month).padStart(2, '0')}`
  const checksum = checksums.get(yyyymm.slice(2))
  if (!checksum) throw new Error(`No JRA month checksum found for ${yyyymm}`)
  return {
    url: `${JRA_ORIGIN}/JRADB/accessS.html`,
    cname: `pw01skl10${yyyymm}/${checksum}`,
    label: yyyymm,
  }
}

export function dateFromCname(cname: string | undefined) {
  const matches = [...(cname?.matchAll(/20\d{6}/g) ?? [])]
  return matches.at(-1)?.[0]?.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') ?? ''
}
