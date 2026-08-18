const DEFAULT_DELAY_MS = Number(process.env.JRA_REQUEST_DELAY_MS ?? 1200)
const DEFAULT_RETRIES = Number(process.env.JRA_REQUEST_RETRIES ?? 3)
const USER_AGENT = process.env.JRA_USER_AGENT ?? 'jra-weekend-insights/0.1 (personal non-commercial research; contact via repository)'

let nextRequestAt = 0

export interface JraAction {
  url: string
  cname?: string
  label?: string
}

async function waitForTurn() {
  const wait = Math.max(0, nextRequestAt - Date.now())
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  nextRequestAt = Date.now() + DEFAULT_DELAY_MS
}

function decodeResponse(buffer: ArrayBuffer, contentType: string | null) {
  const bytes = new Uint8Array(buffer)
  const ascii = new TextDecoder('latin1').decode(bytes.slice(0, 2048))
  const declared = `${contentType ?? ''} ${ascii}`
  const encoding = /shift[_-]?jis|windows-31j|x-sjis/i.test(declared) ? 'shift_jis' : 'utf-8'
  return new TextDecoder(encoding).decode(bytes)
}

export async function fetchHtml(action: JraAction): Promise<string> {
  let lastError: unknown
  for (let attempt = 0; attempt < DEFAULT_RETRIES; attempt += 1) {
    try {
      await waitForTurn()
      const body = action.cname ? new URLSearchParams({ cname: action.cname }) : undefined
      const response = await fetch(action.url, {
        method: body ? 'POST' : 'GET',
        body,
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml',
          ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(30_000),
      })
      if (!response.ok) throw new Error(`JRA responded with HTTP ${response.status} for ${action.url}`)
      return decodeResponse(await response.arrayBuffer(), response.headers.get('content-type'))
    } catch (error) {
      lastError = error
      if (attempt + 1 < DEFAULT_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (2 ** attempt)))
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Unable to fetch ${action.url}`)
}
