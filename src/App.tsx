import { useEffect, useMemo, useState } from 'react'
import { predictionArchiveIndexSchema, predictionMonthDataSchema, weekendDataSchema } from './schema'
import type {
  ConditionStat,
  Meeting,
  PredictionArchiveIndex,
  PredictionMonthData,
  Race,
  Runner,
  WeekendData,
} from './types'

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

function formatMonth(month: string) {
  return new Intl.DateTimeFormat('zh-Hant-TW', { timeZone: 'Asia/Tokyo', month: 'long' })
    .format(new Date(`${month}-01T00:00:00+09:00`))
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
  const [view, setView] = useState<'weekend' | 'archive'>('weekend')
  const [data, setData] = useState<WeekendData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetch(`${import.meta.env.BASE_URL}data/weekend.json`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return weekendDataSchema.parse(await response.json())
      })
      .then((parsed) => { if (active) setData(parsed) })
      .catch(() => { if (active) setError('無法讀取賽事資料，請稍後重新整理。') })
    return () => { active = false }
  }, [])

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="eyebrow">JRA RACE CONDITIONS</div>
        <div className="title-row">
          <div>
            <h1>中央競馬條件簿</h1>
            <p>用近十年相同賽事條件，查看本週排行與 2026 每場賽前預測紀錄。</p>
          </div>
          {data && <StatusBadge data={data} />}
        </div>
        <nav className="view-tabs" aria-label="資料範圍">
          <button type="button" className={view === 'weekend' ? 'active' : ''} aria-pressed={view === 'weekend'} onClick={() => setView('weekend')}>本週賽事</button>
          <button type="button" className={view === 'archive' ? 'active' : ''} aria-pressed={view === 'archive'} onClick={() => setView('archive')}>2026 預測紀錄</button>
        </nav>
      </header>

      <main>{view === 'weekend' ? <WeekendView data={data} error={error} /> : <PredictionArchiveView />}</main>

      <footer>
        <p>本網站為非官方統計工具；條件預測排行不是實際勝率，也不構成投注建議。</p>
        <p>賽事資料來源：<a href="https://www.jra.go.jp/" target="_blank" rel="noreferrer">JRA 日本中央競馬會</a></p>
      </footer>
    </div>
  )
}

function WeekendView({ data, error }: { data: WeekendData | null; error: string | null }) {
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedVenue, setSelectedVenue] = useState('all')

  const dates = useMemo(() => [...new Set(data?.meetings.map((meeting) => meeting.date) ?? [])], [data])
  const activeDate = dates.includes(selectedDate) ? selectedDate : (dates[0] ?? '')
  const dateMeetings = useMemo(() => data?.meetings.filter((meeting) => meeting.date === activeDate) ?? [], [activeDate, data])
  const venues = useMemo(() => [...new Set(dateMeetings.map((meeting) => meeting.venue))], [dateMeetings])
  const activeVenue = selectedVenue === 'all' || venues.includes(selectedVenue) ? selectedVenue : 'all'
  const visibleMeetings = activeVenue === 'all' ? dateMeetings : dateMeetings.filter((meeting) => meeting.venue === activeVenue)

  if (error) return <Notice tone="bad">{error}</Notice>
  if (!data) return <LoadingState label="正在讀取本週資料…" />
  return (
    <>
      {data.metadata.warnings.map((warning) => <Notice key={warning} tone={resolvedStatus(data) === 'fresh' ? 'muted' : 'warn'}>{warning}</Notice>)}
      {dates.length ? (
        <>
          <RaceFilters dates={dates} selectedDate={activeDate} onDate={setSelectedDate} venues={venues} selectedVenue={activeVenue} onVenue={setSelectedVenue} />
          <div className="meeting-list">{visibleMeetings.map((meeting) => <MeetingSection key={`${meeting.date}-${meeting.venue}`} meeting={meeting} />)}</div>
        </>
      ) : <EmptyState />}
    </>
  )
}

function PredictionArchiveView() {
  const [index, setIndex] = useState<PredictionArchiveIndex | null>(null)
  const [monthData, setMonthData] = useState<PredictionMonthData | null>(null)
  const [selectedMonth, setSelectedMonth] = useState('')
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedVenue, setSelectedVenue] = useState('all')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetch(`${import.meta.env.BASE_URL}data/predictions/2026/index.json`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return predictionArchiveIndexSchema.parse(await response.json())
      })
      .then((parsed) => {
        if (!active) return
        setIndex(parsed)
        setSelectedMonth(parsed.months.at(-1)?.month ?? '')
      })
      .catch(() => { if (active) setError('無法讀取 2026 預測紀錄。') })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!selectedMonth) return
    let active = true
    fetch(`${import.meta.env.BASE_URL}data/predictions/2026/${selectedMonth.slice(5)}.json`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return predictionMonthDataSchema.parse(await response.json())
      })
      .then((parsed) => {
        if (!active) return
        setMonthData(parsed)
        setSelectedDate(parsed.meetings.at(-1)?.date ?? '')
        setSelectedVenue('all')
      })
      .catch(() => { if (active) setError('這個月份的預測資料無法讀取。') })
    return () => { active = false }
  }, [selectedMonth])

  const dates = useMemo(() => [...new Set(monthData?.meetings.map((meeting) => meeting.date) ?? [])], [monthData])
  const dateMeetings = useMemo(() => monthData?.meetings.filter((meeting) => meeting.date === selectedDate) ?? [], [monthData, selectedDate])
  const venues = useMemo(() => [...new Set(dateMeetings.map((meeting) => meeting.venue))], [dateMeetings])
  const activeVenue = selectedVenue === 'all' || venues.includes(selectedVenue) ? selectedVenue : 'all'
  const visibleMeetings = activeVenue === 'all' ? dateMeetings : dateMeetings.filter((meeting) => meeting.venue === activeVenue)

  if (error) return <Notice tone="bad">{error}</Notice>
  if (!index || !monthData || monthData.metadata.month !== selectedMonth) return <LoadingState label="正在讀取 2026 預測紀錄…" />
  return (
    <>
      <Notice tone="muted">歷史預測先以當時賽前可知資料計分，再附上實際名次供對照；賽果不會回頭改寫預測分數。</Notice>
      <section className="filters archive-filters" aria-label="2026 預測紀錄篩選">
        <div className="filter-group">
          <span className="filter-label">月份</span>
          <div className="segmented" role="group" aria-label="選擇月份">
            {index.months.map((month) => (
              <button type="button" className={selectedMonth === month.month ? 'active' : ''} aria-pressed={selectedMonth === month.month} key={month.month} onClick={() => { setError(null); setMonthData(null); setSelectedMonth(month.month) }}>
                {formatMonth(month.month)} <small>{month.raceCount}</small>
              </button>
            ))}
          </div>
        </div>
      </section>
      <RaceFilters dates={dates} selectedDate={selectedDate} onDate={setSelectedDate} venues={venues} selectedVenue={activeVenue} onVenue={setSelectedVenue} />
      <div className="meeting-list">{visibleMeetings.map((meeting) => <MeetingSection historical key={`${meeting.date}-${meeting.venue}`} meeting={meeting} />)}</div>
    </>
  )
}

function RaceFilters({ dates, selectedDate, onDate, venues, selectedVenue, onVenue }: {
  dates: string[]
  selectedDate: string
  onDate: (date: string) => void
  venues: string[]
  selectedVenue: string
  onVenue: (venue: string) => void
}) {
  return (
    <section className="filters" aria-label="賽事篩選">
      <div className="filter-group">
        <span className="filter-label">日期</span>
        <div className="segmented" role="group" aria-label="選擇日期">
          {dates.map((date) => <button type="button" className={date === selectedDate ? 'active' : ''} aria-pressed={date === selectedDate} key={date} onClick={() => onDate(date)}>{formatDate(date)}</button>)}
        </div>
      </div>
      <div className="filter-group">
        <span className="filter-label">競馬場</span>
        <div className="segmented" role="group" aria-label="選擇競馬場">
          <button type="button" className={selectedVenue === 'all' ? 'active' : ''} aria-pressed={selectedVenue === 'all'} onClick={() => onVenue('all')}>全部</button>
          {venues.map((venue) => <button type="button" className={venue === selectedVenue ? 'active' : ''} aria-pressed={venue === selectedVenue} key={venue} onClick={() => onVenue(venue)}>{venue}</button>)}
        </div>
      </div>
    </section>
  )
}

function StatusBadge({ data }: { data: WeekendData }) {
  const status = resolvedStatus(data)
  const copy = STATUS_COPY[status]
  return (
    <div className={`status-badge ${copy.tone}`} aria-label={`${copy.label}，日本時間 ${formatFetchedAt(data.metadata.fetchedAt)}`}>
      <span className="status-dot" aria-hidden="true" /><span><strong>{copy.label}</strong><small>{formatFetchedAt(data.metadata.fetchedAt)} JST</small></span>
    </div>
  )
}

function Notice({ tone, children }: { tone: 'warn' | 'bad' | 'muted'; children: React.ReactNode }) {
  return <div className={`notice ${tone}`} role={tone === 'bad' ? 'alert' : 'status'}>{children}</div>
}

function LoadingState({ label }: { label: string }) {
  return <div className="loading-state" aria-live="polite"><span className="loading-mark" aria-hidden="true" /><p>{label}</p></div>
}

function EmptyState() {
  return (
    <section className="empty-state">
      <div className="empty-number">—</div><h2>目前沒有可顯示的週末賽事</h2>
      <p>JRA 正式出馬表公布後會自動更新；你仍可切換到「2026 預測紀錄」查看已完賽場次。</p>
    </section>
  )
}

function MeetingSection({ meeting, historical = false }: { meeting: Meeting; historical?: boolean }) {
  return (
    <section className="meeting" aria-labelledby={`meeting-${meeting.date}-${meeting.venue}`}>
      <div className="meeting-heading"><div><span>{formatDate(meeting.date, true)}</span><h2 id={`meeting-${meeting.date}-${meeting.venue}`}>{meeting.venue}競馬場</h2></div><strong>{meeting.races.length} 場</strong></div>
      <div className="race-list">{meeting.races.map((race) => <RaceCard historical={historical} key={race.id} race={race} />)}</div>
    </section>
  )
}

function RaceCard({ race, historical = false }: { race: Race; historical?: boolean }) {
  const surface = race.condition.surface === 'turf' ? '芝' : race.condition.surface === 'dirt' ? '泥地' : race.condition.surface === 'jump' ? '障礙' : '未定'
  return (
    <details className="race-card">
      <summary>
        <div className="race-number"><span>{race.number}</span><small>R</small></div>
        <div className="race-primary">
          <div className="race-title-row"><h3>{race.name}</h3><time dateTime={`${race.date}T${race.startTime}:00+09:00`}>{race.startTime}</time></div>
          <div className="race-meta">
            <span>{race.condition.classLabel}</span><span>{surface} {race.condition.distance.toLocaleString()}m{race.condition.courseVariant ? `・${race.condition.courseVariant}` : ''}</span><span>{race.runnerCount} 頭</span>
            {historical ? <span className="prediction-state">{race.predictionStatus === 'completed' ? '已完賽・可對照' : '賽前預測'}</span> : <span className={`weight-state ${race.bodyWeightStatus}`}>{race.bodyWeightStatus === 'published' ? '馬體重已公布' : race.bodyWeightStatus === 'partial' ? '部分馬體重' : '等待馬體重'}</span>}
          </div>
        </div>
        <span className="expand-label" aria-hidden="true">查看分析</span>
      </summary>
      <div className="race-detail">
        <div className="analysis-header"><div><span>賽前歷史樣本</span><strong>{race.sampleRaces} 場・{race.sampleStarts.toLocaleString()} 次出走</strong></div><a href={race.sourceUrl} target="_blank" rel="noreferrer">JRA 官方{historical && race.predictionStatus === 'completed' ? '賽果' : '出馬表'} ↗</a></div>
        <ConditionPanels race={race} />
        <div className="ranking-heading"><div><span className="section-kicker">PRE-RACE CONDITION RANKING</span><h4>{historical ? '賽前條件預測排行' : '馬匹條件排行'}</h4></div><p>{historical ? '實際名次只供賽後對照' : '只計入樣本足夠且顯著的條件'}</p></div>
        <div className="runner-table" role="table" aria-label={`${race.name}馬匹條件排行`}>
          <div className="runner-row table-head" role="row"><span role="columnheader">{historical ? '預測／實際' : '順位'}</span><span role="columnheader">馬匹</span><span role="columnheader">馬體重</span><span role="columnheader">主要理由</span><span role="columnheader">指數</span></div>
          {race.runners.filter((runner) => !runner.scratched).map((runner) => <RunnerRow historical={historical} runner={runner} key={runner.id} />)}
        </div>
        <p className="score-note">條件預測僅供比較，不代表實際勝率；缺少資料不扣分。</p>
      </div>
    </details>
  )
}

function ConditionPanels({ race }: { race: Race }) {
  return <div className="condition-grid"><ConditionPanel title="高勝率條件" marker="↑" tone="high" stats={race.highConditions} /><ConditionPanel title="低勝率條件" marker="↓" tone="low" stats={race.lowConditions} /></div>
}

function ConditionPanel({ title, marker, tone, stats }: { title: string; marker: string; tone: 'high' | 'low'; stats: ConditionStat[] }) {
  return (
    <section className={`condition-panel ${tone}`}>
      <h4><span aria-hidden="true">{marker}</span>{title}</h4>
      {stats.length ? <ul>{stats.map((stat) => <li key={stat.featureId}><div><strong>{stat.label}</strong><small>{stat.wins}/{stat.starts}・基準 {percentage(stat.baselineRate)}</small></div><div className="stat-value"><strong>{percentage(stat.rate)}</strong><small>{stat.liftPercentagePoints > 0 ? '+' : ''}{stat.liftPercentagePoints.toFixed(1)}pt</small></div></li>)}</ul> : <p className="no-condition">目前沒有達到可信門檻的條件</p>}
    </section>
  )
}

function RunnerRow({ runner, historical = false }: { runner: Runner; historical?: boolean }) {
  const positive = runner.features.filter((feature) => feature.value === true && feature.contribution > 0).sort((a, b) => b.contribution - a.contribution).slice(0, 3)
  const negative = runner.features.filter((feature) => feature.value === true && feature.contribution < 0).sort((a, b) => a.contribution - b.contribution).slice(0, 3)
  const reasons = [...positive, ...negative]
  return (
    <div className="runner-row" role="row">
      <span className="rank" role="cell">{runner.rank ?? '—'}{historical && <small>{runner.actualFinish ? `實 ${runner.actualFinish}` : '未賽'}</small>}</span>
      <div className="runner-name" role="cell"><span className="horse-number">{runner.number ?? '–'}</span><span><strong>{runner.name}</strong><small>{runner.sexAge}・{runner.jockey}</small></span></div>
      <span className="body-weight" role="cell">{runner.bodyWeight ? <>{runner.bodyWeight}kg <small>({runner.bodyWeightChange && runner.bodyWeightChange > 0 ? '+' : ''}{runner.bodyWeightChange ?? 0})</small></> : '未公布'}</span>
      <div className="reason-list" role="cell">{reasons.length ? reasons.map((reason) => <span className={reason.contribution > 0 ? 'positive' : 'negative'} key={reason.featureId}>{reason.label} {score(reason.contribution)}</span>) : <span className="neutral">無顯著條件</span>}</div>
      <strong className={`runner-score ${runner.score > 0 ? 'positive' : runner.score < 0 ? 'negative' : ''}`} role="cell">{score(runner.score)}</strong>
    </div>
  )
}

export default App
