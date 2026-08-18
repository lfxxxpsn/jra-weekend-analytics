import { useEffect, useMemo, useState } from 'react'
import { weekendDataSchema } from './schema'
import type { ConditionStat, Meeting, Race, Runner, WeekendData } from './types'

const STATUS_COPY = {
  fresh: { label: '資料已更新', tone: 'good' },
  stale: { label: '資料可能已過期', tone: 'warn' },
  unavailable: { label: '尚無本週資料', tone: 'muted' },
  error: { label: '更新發生錯誤', tone: 'bad' },
} as const

function formatDate(date: string, includeYear = false) {
  return new Intl.DateTimeFormat('zh-Hant-TW', {
    timeZone: 'Asia/Tokyo',
    ...(includeYear ? { year: 'numeric' as const } : {}),
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date(`${date}T00:00:00+09:00`))
}

function formatFetchedAt(value: string) {
  return new Intl.DateTimeFormat('zh-Hant-TW', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

function percentage(value: number) {
  return `${(value * 100).toFixed(1)}%`
}

function score(value: number) {
  const rounded = value.toFixed(1)
  return value > 0 ? `+${rounded}` : rounded
}

function resolvedStatus(data: WeekendData) {
  if (data.metadata.status !== 'fresh') return data.metadata.status
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())
  const isRaceDay = data.meetings.some((meeting) => meeting.date === today)
  const ageHours = (Date.now() - new Date(data.metadata.fetchedAt).getTime()) / 3_600_000
  return isRaceDay && ageHours > 2 ? 'stale' : 'fresh'
}

function App() {
  const [data, setData] = useState<WeekendData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedVenue, setSelectedVenue] = useState('all')

  useEffect(() => {
    let active = true
    const dataUrl = `${import.meta.env.BASE_URL}data/weekend.json`
    fetch(dataUrl, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return weekendDataSchema.parse(await response.json())
      })
      .then((parsed) => {
        if (!active) return
        setData(parsed)
        setSelectedDate(parsed.meetings[0]?.date ?? '')
      })
      .catch(() => {
        if (active) setError('無法讀取賽事資料，請稍後重新整理。')
      })
    return () => { active = false }
  }, [])

  const dates = useMemo(
    () => [...new Set(data?.meetings.map((meeting) => meeting.date) ?? [])],
    [data],
  )
  const dateMeetings = useMemo(
    () => data?.meetings.filter((meeting) => meeting.date === selectedDate) ?? [],
    [data, selectedDate],
  )
  const venues = useMemo(
    () => [...new Set(dateMeetings.map((meeting) => meeting.venue))],
    [dateMeetings],
  )
  const activeVenue = selectedVenue === 'all' || venues.includes(selectedVenue) ? selectedVenue : 'all'
  const visibleMeetings = activeVenue === 'all'
    ? dateMeetings
    : dateMeetings.filter((meeting) => meeting.venue === activeVenue)

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="eyebrow">JRA WEEKEND CONDITIONS</div>
        <div className="title-row">
          <div>
            <h1>週末競馬條件簿</h1>
            <p>用近十年相同賽事條件，看懂哪些特徵經常贏、哪些經常失手。</p>
          </div>
          {data && <StatusBadge data={data} />}
        </div>
      </header>

      <main>
        {error && <Notice tone="bad">{error}</Notice>}
        {!data && !error && <LoadingState />}

        {data && (
          <>
            {data.metadata.warnings.map((warning) => (
              <Notice key={warning} tone={resolvedStatus(data) === 'fresh' ? 'muted' : 'warn'}>{warning}</Notice>
            ))}

            {dates.length > 0 ? (
              <>
                <section className="filters" aria-label="賽事篩選">
                  <div className="filter-group">
                    <span className="filter-label">日期</span>
                    <div className="segmented" role="group" aria-label="選擇日期">
                      {dates.map((date) => (
                        <button
                          type="button"
                          className={date === selectedDate ? 'active' : ''}
                          aria-pressed={date === selectedDate}
                          key={date}
                          onClick={() => setSelectedDate(date)}
                        >
                          {formatDate(date)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="filter-group">
                    <span className="filter-label">競馬場</span>
                    <div className="segmented" role="group" aria-label="選擇競馬場">
                      <button
                        type="button"
                        className={activeVenue === 'all' ? 'active' : ''}
                        aria-pressed={activeVenue === 'all'}
                        onClick={() => setSelectedVenue('all')}
                      >
                        全部
                      </button>
                      {venues.map((venue) => (
                        <button
                          type="button"
                          className={venue === activeVenue ? 'active' : ''}
                          aria-pressed={venue === activeVenue}
                          key={venue}
                          onClick={() => setSelectedVenue(venue)}
                        >
                          {venue}
                        </button>
                      ))}
                    </div>
                  </div>
                </section>

                <div className="meeting-list">
                  {visibleMeetings.map((meeting) => <MeetingSection key={`${meeting.date}-${meeting.venue}`} meeting={meeting} />)}
                </div>
              </>
            ) : (
              <EmptyState />
            )}
          </>
        )}
      </main>

      <footer>
        <p>本網站為非官方統計工具，條件指數不是預測勝率，也不構成投注建議。</p>
        <p>賽事資料來源：<a href="https://www.jra.go.jp/" target="_blank" rel="noreferrer">JRA 日本中央競馬會</a></p>
      </footer>
    </div>
  )
}

function StatusBadge({ data }: { data: WeekendData }) {
  const status = resolvedStatus(data)
  const copy = STATUS_COPY[status]
  return (
    <div className={`status-badge ${copy.tone}`} aria-label={`${copy.label}，日本時間 ${formatFetchedAt(data.metadata.fetchedAt)}`}>
      <span className="status-dot" aria-hidden="true" />
      <span>
        <strong>{copy.label}</strong>
        <small>{formatFetchedAt(data.metadata.fetchedAt)} JST</small>
      </span>
    </div>
  )
}

function Notice({ tone, children }: { tone: 'warn' | 'bad' | 'muted'; children: React.ReactNode }) {
  return <div className={`notice ${tone}`} role={tone === 'bad' ? 'alert' : 'status'}>{children}</div>
}

function LoadingState() {
  return (
    <div className="loading-state" aria-live="polite">
      <span className="loading-mark" aria-hidden="true" />
      <p>正在讀取本週資料…</p>
    </div>
  )
}

function EmptyState() {
  return (
    <section className="empty-state">
      <div className="empty-number">—</div>
      <h2>目前沒有可顯示的週末賽事</h2>
      <p>首次部署後，請在 GitHub Actions 執行「Update JRA weekend data」。資料公布後會自動顯示。</p>
    </section>
  )
}

function MeetingSection({ meeting }: { meeting: Meeting }) {
  return (
    <section className="meeting" aria-labelledby={`meeting-${meeting.date}-${meeting.venue}`}>
      <div className="meeting-heading">
        <div>
          <span>{formatDate(meeting.date, true)}</span>
          <h2 id={`meeting-${meeting.date}-${meeting.venue}`}>{meeting.venue}競馬場</h2>
        </div>
        <strong>{meeting.races.length} 場</strong>
      </div>
      <div className="race-list">
        {meeting.races.map((race) => <RaceCard key={race.id} race={race} />)}
      </div>
    </section>
  )
}

function RaceCard({ race }: { race: Race }) {
  const surface = race.condition.surface === 'turf' ? '芝' : race.condition.surface === 'dirt' ? '泥地' : race.condition.surface === 'jump' ? '障礙' : '未定'
  return (
    <details className="race-card">
      <summary>
        <div className="race-number"><span>{race.number}</span><small>R</small></div>
        <div className="race-primary">
          <div className="race-title-row">
            <h3>{race.name}</h3>
            <time dateTime={`${race.date}T${race.startTime}:00+09:00`}>{race.startTime}</time>
          </div>
          <div className="race-meta">
            <span>{race.condition.classLabel}</span>
            <span>{surface} {race.condition.distance.toLocaleString()}m{race.condition.courseVariant ? `・${race.condition.courseVariant}` : ''}</span>
            <span>{race.runnerCount} 頭</span>
            <span className={`weight-state ${race.bodyWeightStatus}`}>{race.bodyWeightStatus === 'published' ? '馬體重已公布' : race.bodyWeightStatus === 'partial' ? '部分馬體重' : '等待馬體重'}</span>
          </div>
        </div>
        <span className="expand-label" aria-hidden="true">查看分析</span>
      </summary>
      <div className="race-detail">
        <div className="analysis-header">
          <div>
            <span>歷史樣本</span>
            <strong>{race.sampleRaces} 場・{race.sampleStarts.toLocaleString()} 次出走</strong>
          </div>
          <a href={race.sourceUrl} target="_blank" rel="noreferrer">JRA 官方出馬表 ↗</a>
        </div>

        <ConditionPanels race={race} />

        <div className="ranking-heading">
          <div>
            <span className="section-kicker">CONDITION RANKING</span>
            <h4>馬匹條件排行</h4>
          </div>
          <p>只計入樣本足夠且顯著的條件</p>
        </div>
        <div className="runner-table" role="table" aria-label={`${race.name}馬匹條件排行`}>
          <div className="runner-row table-head" role="row">
            <span role="columnheader">順位</span>
            <span role="columnheader">馬匹</span>
            <span role="columnheader">馬體重</span>
            <span role="columnheader">主要理由</span>
            <span role="columnheader">指數</span>
          </div>
          {race.runners.filter((runner) => !runner.scratched).map((runner) => <RunnerRow runner={runner} key={runner.id} />)}
        </div>
        <p className="score-note">條件指數僅供比較，不代表實際勝率。缺少的條件不扣分。</p>
      </div>
    </details>
  )
}

function ConditionPanels({ race }: { race: Race }) {
  return (
    <div className="condition-grid">
      <ConditionPanel title="高勝率條件" marker="↑" tone="high" stats={race.highConditions} />
      <ConditionPanel title="低勝率條件" marker="↓" tone="low" stats={race.lowConditions} />
    </div>
  )
}

function ConditionPanel({ title, marker, tone, stats }: { title: string; marker: string; tone: 'high' | 'low'; stats: ConditionStat[] }) {
  return (
    <section className={`condition-panel ${tone}`}>
      <h4><span aria-hidden="true">{marker}</span>{title}</h4>
      {stats.length ? (
        <ul>
          {stats.map((stat) => (
            <li key={stat.featureId}>
              <div><strong>{stat.label}</strong><small>{stat.wins}/{stat.starts}・基準 {percentage(stat.baselineRate)}</small></div>
              <div className="stat-value"><strong>{percentage(stat.rate)}</strong><small>{stat.liftPercentagePoints > 0 ? '+' : ''}{stat.liftPercentagePoints.toFixed(1)}pt</small></div>
            </li>
          ))}
        </ul>
      ) : <p className="no-condition">目前沒有達到可信門檻的條件</p>}
    </section>
  )
}

function RunnerRow({ runner }: { runner: Runner }) {
  const reasons = runner.features
    .filter((feature) => feature.value === true && feature.contribution !== 0)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 3)
  return (
    <div className="runner-row" role="row">
      <span className="rank" role="cell">{runner.rank ?? '—'}</span>
      <div className="runner-name" role="cell">
        <span className="horse-number">{runner.number ?? '–'}</span>
        <span><strong>{runner.name}</strong><small>{runner.sexAge}・{runner.jockey}</small></span>
      </div>
      <span className="body-weight" role="cell">
        {runner.bodyWeight ? <>{runner.bodyWeight}kg <small>({runner.bodyWeightChange && runner.bodyWeightChange > 0 ? '+' : ''}{runner.bodyWeightChange ?? 0})</small></> : '未公布'}
      </span>
      <div className="reason-list" role="cell">
        {reasons.length ? reasons.map((reason) => (
          <span className={reason.contribution > 0 ? 'positive' : 'negative'} key={reason.featureId}>
            {reason.label} {score(reason.contribution)}
          </span>
        )) : <span className="neutral">無顯著條件</span>}
      </div>
      <strong className={`runner-score ${runner.score > 0 ? 'positive' : runner.score < 0 ? 'negative' : ''}`} role="cell">{score(runner.score)}</strong>
    </div>
  )
}

export default App
