import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-host-webserver'

const BALANCE_TIMEOUT_MS = 8_000
const DAY_COUNT = 14
const WEEK_COUNT = 8

export interface UsageBuckets {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  requests: number
}

export interface UsagePeriod extends UsageBuckets {
  key: string
  label: string
  from: string
  to: string
}

export interface BalanceInfo {
  currency: string
  totalBalance: string
  grantedBalance: string
  toppedUpBalance: string
}

export interface UsageReport {
  generatedAt: string
  balance: {
    status: 'ok' | 'unconfigured' | 'error'
    available?: boolean
    infos?: BalanceInfo[]
    message?: string
  }
  today: UsageBuckets
  thisWeek: UsageBuckets
  daily: UsagePeriod[]
  weekly: UsagePeriod[]
}

interface UsageSample {
  time: number
  usage: TokenUsage
}

const emptyBuckets = (): UsageBuckets => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 0,
  requests: 0,
})

function addUsage(target: UsageBuckets, usage: TokenUsage): void {
  const cacheRead = usage.cacheReadTokens ?? 0
  const cacheWrite = usage.cacheWriteTokens ?? 0
  target.inputTokens += usage.inputTokens
  target.outputTokens += usage.outputTokens
  target.cacheReadTokens += cacheRead
  target.cacheWriteTokens += cacheWrite
  target.totalTokens += usage.inputTokens + usage.outputTokens + cacheRead + cacheWrite
  target.requests += 1
}

function localDayStart(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

function localWeekStart(value: Date): Date {
  const start = localDayStart(value)
  const day = start.getDay()
  start.setDate(start.getDate() - (day === 0 ? 6 : day - 1))
  return start
}

function dateKey(value: Date): string {
  const year = String(value.getFullYear())
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value)
  next.setDate(next.getDate() + days)
  return next
}

function eventUsage(event: SessionEvent): { key: string; usage: TokenUsage } | undefined {
  if (event.type === 'assistant/message' && event.data.usage !== undefined) {
    return { key: `${event.data.turn}:${event.data.step}`, usage: event.data.usage }
  }
  return undefined
}

/** Keep the final provider usage for each request step. */
export function usageSamples(events: readonly SessionEvent[]): UsageSample[] {
  const byStep = new Map<string, UsageSample>()
  for (const event of events) {
    const sample = eventUsage(event)
    if (sample !== undefined) byStep.set(sample.key, { time: event.time, usage: sample.usage })
  }
  return [...byStep.values()]
}

/** Build fixed local-calendar daily and Monday-based weekly buckets. */
export function aggregateUsage(samples: readonly UsageSample[], now = new Date()): Pick<UsageReport, 'today' | 'thisWeek' | 'daily' | 'weekly'> {
  const todayStart = localDayStart(now)
  const weekStart = localWeekStart(now)
  const daily: UsagePeriod[] = []
  const weekly: UsagePeriod[] = []

  for (let offset = DAY_COUNT - 1; offset >= 0; offset--) {
    const from = addDays(todayStart, -offset)
    const to = addDays(from, 1)
    daily.push({ key: dateKey(from), label: dateKey(from), from: from.toISOString(), to: to.toISOString(), ...emptyBuckets() })
  }
  for (let offset = WEEK_COUNT - 1; offset >= 0; offset--) {
    const from = addDays(weekStart, -offset * 7)
    const to = addDays(from, 7)
    weekly.push({
      key: dateKey(from),
      label: `${dateKey(from)} — ${dateKey(addDays(to, -1))}`,
      from: from.toISOString(),
      to: to.toISOString(),
      ...emptyBuckets(),
    })
  }

  const dailyByKey = new Map(daily.map(item => [item.key, item]))
  const weeklyByKey = new Map(weekly.map(item => [item.key, item]))
  for (const sample of samples) {
    const at = new Date(sample.time)
    const day = dailyByKey.get(dateKey(localDayStart(at)))
    if (day !== undefined) addUsage(day, sample.usage)
    const week = weeklyByKey.get(dateKey(localWeekStart(at)))
    if (week !== undefined) addUsage(week, sample.usage)
  }
  return {
    today: { ...(daily.at(-1) ?? emptyBuckets()) },
    thisWeek: { ...(weekly.at(-1) ?? emptyBuckets()) },
    daily,
    weekly,
  }
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(JSON.stringify(value))
}

function balanceMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function readBalance(ctx: Context, baseURL: string, apiKeyEnv: string): Promise<UsageReport['balance']> {
  try {
    const hit = await ctx.get('credentials')?.resolve(credentialRef(apiKeyEnv))
    if (hit === undefined) return { status: 'unconfigured', message: 'DeepSeek API Key 未配置' }
    const response = await fetch(new URL('user/balance', `${baseURL.replace(/\/+$/u, '')}/`), {
      headers: { Accept: 'application/json', Authorization: `Bearer ${hit.value}` },
      signal: AbortSignal.timeout(BALANCE_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`余额接口返回 HTTP ${String(response.status)}`)
    const body = await response.json() as {
      is_available?: unknown
      balance_infos?: Array<Record<string, unknown>>
    }
    const infos = (body.balance_infos ?? []).map(info => ({
      currency: String(info.currency ?? ''),
      totalBalance: String(info.total_balance ?? '0'),
      grantedBalance: String(info.granted_balance ?? '0'),
      toppedUpBalance: String(info.topped_up_balance ?? '0'),
    }))
    return { status: 'ok', available: body.is_available === true, infos }
  } catch (error) {
    return { status: 'error', message: balanceMessage(error) }
  }
}

async function buildReport(ctx: Context, baseURL: string, apiKeyEnv: string): Promise<UsageReport> {
  const records = await ctx.sessionQuery.listSessions()
  const logs = await Promise.all(records.map(record => ctx.sessionQuery.readSession(record.header.id)))
  const samples = logs.flatMap(log => usageSamples(log.events))
  const [balance, usage] = await Promise.all([
    readBalance(ctx, baseURL, apiKeyEnv),
    Promise.resolve(aggregateUsage(samples)),
  ])
  return { generatedAt: new Date().toISOString(), balance, ...usage }
}

export function registerUsageReportRoute(
  ctx: Context,
  connection: () => { baseURL: string; apiKeyEnv: string },
): void {
  ctx.inject(['webServer', 'sessionQuery'], (routeCtx) => {
    routeCtx.effect(() => routeCtx.webServer.register({
      kind: 'exact',
      path: '/api/usage-report',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'method not allowed' })
          return
        }
        try {
          const facts = connection()
          sendJson(res, 200, await buildReport(routeCtx, facts.baseURL, facts.apiKeyEnv))
        } catch (error) {
          sendJson(res, 500, { error: balanceMessage(error) })
        }
      },
    }), 'llm-deepseek: usage report route')
  })
}
