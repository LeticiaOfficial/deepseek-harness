import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { en } from './locales.ts'
import css from './UsageSection.module.css'

interface UsageBuckets {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  requests: number
}

interface UsagePeriod extends UsageBuckets {
  key: string
  label: string
}

interface UsageReport {
  generatedAt: string
  balance: {
    status: 'ok' | 'unconfigured' | 'error'
    available?: boolean
    infos?: Array<{
      currency: string
      totalBalance: string
      grantedBalance: string
      toppedUpBalance: string
    }>
    message?: string
  }
  today: UsageBuckets
  thisWeek: UsageBuckets
  daily: UsagePeriod[]
  weekly: UsagePeriod[]
}

export interface UsageSectionInjected {
  loadReport: () => Promise<UsageReport>
  t: (key: keyof typeof en) => string
}

export type UsageSectionProps = Partial<InjectFace<UsageSectionInjected>>

const number = new Intl.NumberFormat('zh-CN')

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return number.format(value)
}

function BalanceCard({ report, t }: { report: UsageReport; t: UsageSectionInjected['t'] }): ReactNode {
  const { balance } = report
  if (balance.status !== 'ok') {
    return (
      <div className={css.balanceCard}>
        <span className={css.cardLabel}>{t('usage.balance')}</span>
        <strong className={css.balanceUnavailable}>{balance.message ?? t('usage.balanceUnavailable')}</strong>
      </div>
    )
  }
  return (
    <div className={css.balanceCard}>
      <span className={css.cardLabel}>{t('usage.balance')}</span>
      <div className={css.balanceRows}>
        {(balance.infos ?? []).map(info => (
          <div key={info.currency} className={css.balanceRow}>
            <strong>{info.currency === 'CNY' ? '¥' : info.currency === 'USD' ? '$' : info.currency} {info.totalBalance}</strong>
            <span>{t('usage.granted')} {info.grantedBalance} · {t('usage.toppedUp')} {info.toppedUpBalance}</span>
          </div>
        ))}
      </div>
      <span className={balance.available === true ? css.available : css.unavailable}>
        {balance.available === true ? t('usage.available') : t('usage.unavailable')}
      </span>
    </div>
  )
}

function TokenCard({ label, value }: { label: string; value: UsageBuckets }): ReactNode {
  return (
    <div className={css.tokenCard}>
      <span className={css.cardLabel}>{label}</span>
      <strong className={css.tokenTotal}>{formatTokens(value.totalTokens)}</strong>
      <span className={css.cardMeta}>{number.format(value.requests)} 次请求</span>
      <span className={css.cardMeta}>输入 {formatTokens(value.inputTokens)} · 输出 {formatTokens(value.outputTokens)}</span>
      <span className={css.cardMeta}>缓存命中 {formatTokens(value.cacheReadTokens)}</span>
    </div>
  )
}

function UsageTable({ title, rows, t }: {
  title: string
  rows: readonly UsagePeriod[]
  t: UsageSectionInjected['t']
}): ReactNode {
  return (
    <section className={css.tableSection}>
      <h3>{title}</h3>
      <div className={css.tableWrap}>
        <table>
          <thead>
            <tr>
              <th>{t('usage.period')}</th>
              <th>{t('usage.requests')}</th>
              <th>{t('usage.input')}</th>
              <th>{t('usage.cache')}</th>
              <th>{t('usage.output')}</th>
              <th>{t('usage.total')}</th>
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map(row => (
              <tr key={row.key}>
                <td>{row.label}</td>
                <td>{number.format(row.requests)}</td>
                <td>{number.format(row.inputTokens)}</td>
                <td>{number.format(row.cacheReadTokens)}</td>
                <td>{number.format(row.outputTokens)}</td>
                <td>{number.format(row.totalTokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function UsageSection(props: UsageSectionProps): ReactNode {
  const { loadReport, t } = props
  const [report, setReport] = useState<UsageReport | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const refresh = useCallback(async () => {
    if (loadReport === undefined) return
    setLoading(true)
    setFailure(undefined)
    try {
      setReport(await loadReport())
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [loadReport])

  useEffect(() => { void refresh() }, [refresh])
  if (t === undefined || loadReport === undefined) return null

  return (
    <div className={css.section}>
      <header className={css.heading}>
        <div>
          <h2>{t('usage.title')}</h2>
          <p>{t('usage.intro')}</p>
        </div>
        <button type="button" onClick={() => { void refresh() }} disabled={loading}>
          {loading ? t('usage.refreshing') : t('usage.refresh')}
        </button>
      </header>
      {failure !== undefined && <p className={css.error} role="alert">{failure}</p>}
      {report === undefined
        ? <div className={css.loading}>{t('usage.loading')}</div>
        : (
          <>
            <div className={css.cards}>
              <BalanceCard report={report} t={t} />
              <TokenCard label={t('usage.today')} value={report.today} />
              <TokenCard label={t('usage.thisWeek')} value={report.thisWeek} />
            </div>
            <p className={css.updated}>{t('usage.updated')} {new Date(report.generatedAt).toLocaleString()}</p>
            <UsageTable title={t('usage.daily')} rows={report.daily} t={t} />
            <UsageTable title={t('usage.weekly')} rows={report.weekly} t={t} />
          </>
        )}
    </div>
  )
}
