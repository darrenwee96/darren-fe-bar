import type { ReactNode } from 'react';
import { Card, Progress, Skeleton, useAnalyticsQuery } from '@databricks/appkit-ui/react';
import { AlertTriangle, CheckCircle2, Gift, ListChecks, Recycle, Target } from 'lucide-react';
import type { ScopeFilters, Summary } from '../lib/api';
import { warehouseParams } from '../lib/filters';
import { formatDate, formatInt, formatPct, formatUsd, titleCase, toNumber } from '../lib/format';
import { useNumeric } from '../lib/useNumeric';
import { cn } from '../lib/utils';
import { Delta } from './Delta';

const NO_PARAMS = {};

function KpiTile({
  icon: Icon,
  label,
  value,
  detail,
  source,
  tone = 'default',
  loading,
  error,
  children,
}: {
  icon: typeof Gift;
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  source: string;
  tone?: 'default' | 'critical' | 'good';
  loading?: boolean;
  error?: string | null;
  children?: ReactNode;
}) {
  return (
    <Card className="min-w-0 gap-0 py-0 shadow-sm">
      <div className="flex h-full flex-col gap-2 px-4 py-3.5">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <span
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-md',
              tone === 'critical'
                ? 'bg-critical/10 text-destructive'
                : tone === 'good'
                  ? 'bg-good/10 text-success'
                  : 'bg-primary/10 text-primary'
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
          </span>
          {label}
        </div>
        {loading ? (
          <>
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-4 w-36" />
          </>
        ) : error ? (
          <p className="text-sm text-destructive" role="alert">
            Unavailable: {error}
          </p>
        ) : (
          <>
            <div className="text-[26px] font-semibold leading-none tracking-tight text-foreground tabular-nums">
              {value}
            </div>
            {detail && <div className="text-xs leading-snug text-muted-foreground">{detail}</div>}
            {children}
          </>
        )}
        <p className="mt-auto pt-1 text-[11px] text-muted-foreground/80">{source}</p>
      </div>
    </Card>
  );
}

const CHANNELS = ['DOWNTOWN', 'HIGHWAY', 'AIRPORT'];

function WmapeTile({ channel }: { channel?: string }) {
  const q = useAnalyticsQuery('accuracy_by_channel', NO_PARAMS);
  const rows = useNumeric(q.data);
  const bySegment = new Map(rows?.map((r) => [r.segment, r]) ?? []);
  const headline = bySegment.get(channel ?? 'ALL') ?? bySegment.get('ALL');
  const max = Math.max(1, ...CHANNELS.map((c) => bySegment.get(c)?.same_week_last_year ?? 0));
  return (
    <KpiTile
      icon={Target}
      label={channel ? `Forecast error · ${titleCase(channel)}` : 'Forecast error (WMAPE)'}
      loading={q.loading && !rows}
      error={q.error}
      tone="good"
      value={headline ? `${headline.model.toFixed(1)}%` : '—'}
      detail={headline && `vs ${headline.same_week_last_year.toFixed(1)}% same week last year`}
      source="Backtest MA 2025 + LNY 2026 · gold.forecast_accuracy"
    >
      <div className="space-y-1" aria-label="WMAPE by channel">
        {CHANNELS.map((c) => {
          const r = bySegment.get(c);
          if (!r) return null;
          return (
            <div
              key={c}
              className={cn(
                'grid grid-cols-[64px_1fr_38px] items-center gap-2 text-[11px]',
                channel && channel !== c && 'opacity-50'
              )}
              title={`${titleCase(c)}: model ${r.model}% vs ${r.same_week_last_year}% same week last year`}
            >
              <span className="text-muted-foreground">{titleCase(c)}</span>
              <span className="relative h-1.5 rounded-full bg-muted">
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-reference/40"
                  style={{ width: `${(r.same_week_last_year / max) * 100}%` }}
                />
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-forecast"
                  style={{ width: `${(r.model / max) * 100}%` }}
                />
              </span>
              <span className="text-right font-medium text-foreground tabular-nums">{r.model.toFixed(1)}%</span>
            </div>
          );
        })}
      </div>
    </KpiTile>
  );
}

function WasteTile({ filters }: { filters: ScopeFilters }) {
  const q = useAnalyticsQuery('waste_kpis', warehouseParams(filters));
  const rows = useNumeric(q.data);
  const k = rows?.[0];
  const rate = k && k.net_sales ? k.waste_value / k.net_sales : null;
  const ratePy = k && k.net_sales_py ? k.waste_value_py / k.net_sales_py : null;
  return (
    <KpiTile
      icon={Recycle}
      label="Waste + markdown"
      loading={q.loading && !rows}
      error={q.error}
      value={k ? formatUsd(k.waste_value) : '—'}
      detail={
        k && (
          <>
            {rate !== null && `${formatPct(rate)} of sales · `}
            <Delta current={rate} previous={ratePy} higherIsGood={false} points suffix="vs LY" />
          </>
        )
      }
      source={
        k?.period_start
          ? `Last 13 wks ${formatDate(k.period_start)} – ${formatDate(k.period_end)} · gold.weekly_demand_features`
          : 'Last 13 weeks · gold.weekly_demand_features'
      }
    />
  );
}

export function KpiStrip({
  filters,
  summary,
  loading,
  error,
}: {
  filters: ScopeFilters;
  summary: Summary | null;
  loading: boolean;
  error: string | null;
}) {
  const s = summary;
  const peakNeeds = toNumber(s?.peak_needs_order);
  const decided = toNumber(s?.decided_lines);
  const fromForecast = toNumber(s?.accepted) + toNumber(s?.adjusted);
  const linesToOrder = toNumber(s?.lines_to_order);
  const pending = toNumber(s?.pending_lines);
  const source = s?.loaded_at
    ? `Order week ${formatDate(s.as_of_date)} · Lakebase serving.recommendations`
    : 'Lakebase serving.recommendations';
  const busy = loading && !s;

  return (
    <section aria-label="Key figures" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <KpiTile
        icon={Gift}
        label="Peak gifts needing an order"
        loading={busy}
        error={error}
        tone={peakNeeds > 0 ? 'critical' : 'good'}
        value={
          s ? (
            <span className="flex items-baseline gap-1.5">
              {formatInt(peakNeeds)}
              <span className="text-sm font-normal text-muted-foreground">of {formatInt(s.peak_lines)} lines</span>
            </span>
          ) : (
            '—'
          )
        }
        detail={
          s && (
            <span className="flex items-center gap-1">
              <AlertTriangle className="h-3 w-3 text-destructive" aria-hidden />
              {formatUsd(s.peak_needs_order_sales)} lost if not ordered · {formatInt(s.peak_needs_order_pending)}{' '}
              pending
            </span>
          )
        }
        source={source}
      />
      <WmapeTile channel={filters.channel} />
      <WasteTile filters={filters} />
      <KpiTile
        icon={CheckCircle2}
        label="Orders placed from forecast"
        loading={busy}
        error={error}
        value={s ? (decided > 0 ? formatPct(fromForecast / decided, 0) : '—') : '—'}
        detail={
          s &&
          (decided > 0
            ? `${formatInt(fromForecast)} of ${formatInt(decided)} decided · ${formatInt(s.accepted)} unchanged, ${formatInt(s.adjusted)} adjusted`
            : 'No decisions yet in this scope')
        }
        source="Accepted + adjusted ÷ decided · Lakebase order_decisions"
      />
      <KpiTile
        icon={ListChecks}
        label="Pending decisions"
        loading={busy}
        error={error}
        tone={s && pending === 0 ? 'good' : 'default'}
        value={s ? formatInt(pending) : '—'}
        detail={
          s &&
          `${formatUsd(s.pending_value_at_cost)} at cost · ${formatInt(decided)} of ${formatInt(linesToOrder)} decided`
        }
        source={source}
      >
        {s && linesToOrder > 0 && (
          <Progress
            value={(decided / linesToOrder) * 100}
            className="h-1.5"
            aria-label="Share of order lines decided"
          />
        )}
      </KpiTile>
    </section>
  );
}
