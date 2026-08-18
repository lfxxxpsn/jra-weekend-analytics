import { buildConditionKey, FEATURE_LABELS } from '../../src/lib/conditions'
import { calculateContribution } from '../../src/lib/stats'
import type { AggregateStore, Meeting, ParsedRace, Race, Runner, WeekendData } from '../../src/types'
import { weekendDataSchema } from '../../src/schema'
import { featureValues, summarizeCondition } from './aggregate'

function japanDayLabel(date: string) {
  return new Intl.DateTimeFormat('zh-Hant-TW', { timeZone: 'Asia/Tokyo', weekday: 'long' })
    .format(new Date(`${date}T00:00:00+09:00`))
}

function round(value: number) {
  return Math.round(value * 10) / 10
}

function makeRace(parsed: ParsedRace, store: AggregateStore): Race {
  const conditionKey = buildConditionKey(parsed.condition)
  const summary = summarizeCondition(store, conditionKey, parsed.date)
  const statsByFeature = new Map(summary.stats.map((stat) => [stat.featureId, stat]))
  const runners: Runner[] = parsed.runners.map((parsedRunner) => {
    const values = featureValues(parsed, parsedRunner, store.horses[parsedRunner.id])
    const features = Object.entries(values).map(([featureId, value]) => {
      const typedId = featureId as keyof typeof values
      const stat = statsByFeature.get(typedId)
      return {
        featureId: typedId,
        label: FEATURE_LABELS[typedId],
        value,
        contribution: stat ? round(calculateContribution(stat, value)) : 0,
        ...(stat ? { stat } : {}),
      }
    })
    return {
      id: parsedRunner.id,
      number: parsedRunner.number,
      frame: parsedRunner.frame,
      name: parsedRunner.name,
      sexAge: parsedRunner.sexAge,
      jockey: parsedRunner.jockey,
      assignedWeight: parsedRunner.assignedWeight,
      bodyWeight: parsedRunner.bodyWeight,
      bodyWeightChange: parsedRunner.bodyWeightChange,
      scratched: parsedRunner.scratched,
      features,
      score: round(features.reduce((sum, feature) => sum + feature.contribution, 0)),
      rank: null,
    }
  })

  const ranked = runners.filter((runner) => !runner.scratched).sort((a, b) => b.score - a.score || (a.number ?? 99) - (b.number ?? 99))
  let previousScore: number | null = null
  let previousRank = 0
  ranked.forEach((runner, index) => {
    if (runner.score !== previousScore) previousRank = index + 1
    runner.rank = previousRank
    previousScore = runner.score
  })
  const scratched = runners.filter((runner) => runner.scratched)
  const weights = ranked.map((runner) => runner.bodyWeight)
  const publishedCount = weights.filter((weight) => weight != null).length

  return {
    id: parsed.id,
    sourceUrl: parsed.sourceUrl,
    date: parsed.date,
    venue: parsed.venue,
    number: parsed.number,
    startTime: parsed.startTime,
    name: parsed.name,
    condition: parsed.condition,
    conditionKey,
    runnerCount: ranked.length,
    bodyWeightStatus: publishedCount === 0 ? 'pending' : publishedCount === ranked.length ? 'published' : 'partial',
    sampleStarts: summary.totalStarts,
    sampleRaces: summary.raceCount,
    highConditions: summary.stats.filter((stat) => stat.classification === 'high').sort((a, b) => b.liftPercentagePoints - a.liftPercentagePoints),
    lowConditions: summary.stats.filter((stat) => stat.classification === 'low').sort((a, b) => a.liftPercentagePoints - b.liftPercentagePoints),
    otherConditions: summary.stats.filter((stat) => stat.classification !== 'high' && stat.classification !== 'low'),
    runners: [...ranked, ...scratched],
  }
}

export function generateWeekendData(races: ParsedRace[], store: AggregateStore, fetchedAt = new Date()): WeekendData {
  const groups = new Map<string, Meeting>()
  for (const parsed of races.filter((race) => !race.isResult).sort((a, b) => a.date.localeCompare(b.date) || a.venue.localeCompare(b.venue) || a.number - b.number)) {
    const key = `${parsed.date}|${parsed.venue}`
    const meeting = groups.get(key) ?? { date: parsed.date, dayLabel: japanDayLabel(parsed.date), venue: parsed.venue, races: [] }
    meeting.races.push(makeRace(parsed, store))
    groups.set(key, meeting)
  }

  const historyEnd = new Date(fetchedAt)
  historyEnd.setUTCDate(historyEnd.getUTCDate() - 1)
  const historyStart = new Date(historyEnd)
  historyStart.setUTCFullYear(historyStart.getUTCFullYear() - 10)
  const data: WeekendData = {
    metadata: {
      schemaVersion: 1,
      fetchedAt: fetchedAt.toISOString(),
      historyStart: historyStart.toISOString().slice(0, 10),
      historyEnd: historyEnd.toISOString().slice(0, 10),
      status: groups.size ? 'fresh' : 'unavailable',
      warnings: store.buckets.length ? [] : ['歷史統計尚未 bootstrap；目前只顯示出馬資料。'],
    },
    meetings: [...groups.values()],
  }
  return weekendDataSchema.parse(data)
}
