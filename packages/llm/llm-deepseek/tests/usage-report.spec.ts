import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { aggregateUsage, usageSamples } from '../src/usage-report.ts'

const usageEvent = (
  time: number,
  turn: number,
  step: number,
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number },
): SessionEvent => (
  { seq: 0, time, type: 'assistant/message', data: { turn, step, message: { role: 'assistant', content: [] }, usage } }
) as unknown as SessionEvent

describe('usage report aggregation', () => {
  it('uses the final usage sample for a step without double counting', () => {
    const samples = usageSamples([
      usageEvent(Date.parse('2026-08-22T01:00:00+08:00'), 1, 1, { inputTokens: 10, outputTokens: 2 }),
      usageEvent(Date.parse('2026-08-22T01:00:01+08:00'), 1, 1, { inputTokens: 12, outputTokens: 3 }),
      usageEvent(Date.parse('2026-08-22T02:00:00+08:00'), 1, 2, { inputTokens: 7, outputTokens: 1, cacheReadTokens: 5 }),
    ])
    const report = aggregateUsage(samples, new Date('2026-08-22T12:00:00+08:00'))
    expect(report.today).toMatchObject({
      inputTokens: 19,
      outputTokens: 4,
      cacheReadTokens: 5,
      totalTokens: 28,
      requests: 2,
    })
  })

  it('creates fourteen daily and eight Monday-based weekly rows', () => {
    const report = aggregateUsage([], new Date('2026-08-23T12:00:00+08:00'))
    expect(report.daily).toHaveLength(14)
    expect(report.weekly).toHaveLength(8)
    expect(report.weekly.at(-1)?.key).toBe('2026-08-17')
  })
})
