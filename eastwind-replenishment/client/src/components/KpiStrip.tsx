import type { ReactNode } from 'react';
import { Card, Skeleton, useAnalyticsQuery } from '@databricks/appkit-ui/react';
import { Gift, ListChecks, Recycle, TriangleAlert } from 'lucide-react';
import type { ScopeFilters, Summary } from '../lib/api';
import { warehouseParams } from '../lib/filters';
import { formatDate, formatInt, formatPct, formatUsd, toNumber } from '../lib/format';
import { useNumeric } from '../lib/useNumeric';
import { cn } from '../lib/utils';
import { Delta } from './Delta';

interface Segment {
  label: string;
  value: number;
  className: string;
}

/**
 * The tile's mini visual: one thin bar split into labelled segments (share, split or progress). Every tile carries
 * one, so the four tiles share the same rhythm. Segment labels are always printed below, never colour alone.
 */
function SplitBar({ segments, total, ariaLabel }: { segments: Segment[]; total: number; ariaLabel: string }) {
  const sum = Math.max(total, 1);
  return (
    <div className="space-y-1.5" role="img" aria-label={ariaLabel}>
      <div className="flex h-1.5 gap-[2px] overflow-hidden rounded-full bg-muted">
        {segments
          .filter((s) => s.value > 0)
          .map((s) => (
            <span
              key={s.label}
              className={cn('h-full first:rounded-l-full last:rounded-r-full', s.className)}
              style={{ width: `${(s.value / sum) * 100}%` }}
              title={s.label}
            />
          ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        {segments.map((s) => (
          <span key={s.label} className="flex items-center gap-1 tabular-nums">
            <span className={cn('h-1.5 w-1.5 rounded-full', s.className)} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function KpiTile({
  icon: Icon,
  label,
  value,
  unit,
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
  unit?: ReactNode;
  detail?: ReactNode;
  source: string;
  /** critical = a risk that needs action; default = neutral navy. Colour is for risk only. */
  tone?: 'default' | 'critical';
  loading?: boolean;
  error?: string | null;
  children?: ReactNode;
}) {
  return (
    <Card className="min-w-0 gap-0 rounded-xl border py-0 shadow-card">
      <div className="flex h-full flex-col gap-3 px-5 pb-4 pt-4">
        <div className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
          <span
            className={cn(
              'flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
              tone === 'critical' ? 'bg-critical/10 text-destructive' : 'bg-secondary text-foreground'
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
          </span>
          <span className="truncate">{label}</span>
        </div>
        {loading ? (
          <>
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-full" />
          </>
        ) : error ? (
          <p className="text-sm text-destructive" role="alert">
            Unavailable: {error}
          </p>
        ) : (
          <>
            <div className="flex items-baseline gap-1.5">
              <span className="text-[32px] font-semibold leading-none tracking-tight text-foreground tabular-nums">
                {value}
              </span>
              {unit && <span className="text-sm text-muted-foreground tabular-nums">{unit}</span>}
            </div>
            {detail && <div className="min-h-[2lh] text-xs leading-snug text-muted-foreground">{detail}</div>}
            {children && <div className="mt-auto">{children}</div>}
          </>
        )}
        <p className="truncate border-t pt-2.5 text-[11px] text-muted-foreground/80" title={source}>
          {source}
        </p>
      </div>
    </Card>
  );
}

/** Waste guardrail: expired + markdown value in the last 13 weeks, as a share of sales vs a year earlier. */
function WasteTile({ filters }: { filters: ScopeFilters }) {
  const q = useAnalyticsQuery('waste_kpis', warehouseParams(filters));
  const rows = useNumeric(q.data);
  const k = rows?.[0];
  const rate = k && k.net_sales ? k.waste_value / k.net_sales : null;
  const ratePy = k && k.net_sales_py ? k.waste_value_py / k.net_sales_py : null;
  const markdown = k?.markdown_value ?? 0;
  const expired = Math.max(0, (k?.waste_value ?? 0) - markdown);
  return (
    <KpiTile
      icon={Recycle}
      label="Waste guardrail"
      loading={q.loading && !rows}
      error={q.error}
      value={k ? formatUsd(k.waste_value) : '—'}
      unit="expired + markdown"
      detail={
        k && (
          <>
            {rate !== null && `${formatPct(rate)} of sales · `}
            <Delta current={rate} previous={ratePy} higherIsGood={false} points suffix="vs last year" />
          </>
        )
      }
      source={
        k?.period_start
          ? `Last 13 wks (${formatDate(k.period_start)} – ${formatDate(k.period_end)}) · gold.weekly_demand_features`
          : 'Last 13 weeks · gold.weekly_demand_features'
      }
    >
      {k && (
        <SplitBar
          total={markdown + expired}
          ariaLabel={`Markdown ${formatUsd(markdown)}, expired ${formatUsd(expired)}`}
          segments={[
            { label: `Markdown ${formatUsd(markdown)}`, value: markdown, className: 'bg-forecast' },
            { label: `Expired ${formatUsd(expired)}`, value: expired, className: 'bg-reference' },
          ]}
        />
      )}
    </KpiTile>
  );
}

/** Four tiles, in the deck's order: the peak problem, what it costs, what needs you today, and the waste guardrail. */
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
  const peakLines = toNumber(s?.peak_lines);
  const peakPending = toNumber(s?.peak_needs_order_pending);
  const peakSales = toNumber(s?.peak_needs_order_sales);
  const allSales = toNumber(s?.needs_order_sales);
  const linesToOrder = toNumber(s?.lines_to_order);
  const review = toNumber(s?.exception_pending);
  const routine = toNumber(s?.routine_pending);
  const decided = toNumber(s?.decided_lines);
  const source = s?.as_of_date
    ? `Order week ${formatDate(s.as_of_date)} · Lakebase serving.recommendations`
    : 'Lakebase serving.recommendations';
  const busy = loading && !s;

  return (
    <section aria-label="Key figures" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiTile
        icon={Gift}
        label="Peak lines needing an order"
        loading={busy}
        error={error}
        tone={peakNeeds > 0 ? 'critical' : 'default'}
        value={s ? formatInt(peakNeeds) : '—'}
        unit={s && `of ${formatInt(peakLines)} peak lines`}
        detail={s && 'Stock + inbound is below peak demand until the next delivery'}
        source={source}
      >
        {s && (
          <SplitBar
            total={peakNeeds}
            ariaLabel={`${formatInt(peakPending)} of ${formatInt(peakNeeds)} peak lines needing an order are still pending`}
            segments={[
              { label: `${formatInt(peakPending)} pending`, value: peakPending, className: 'bg-critical' },
              {
                label: `${formatInt(peakNeeds - peakPending)} decided`,
                value: peakNeeds - peakPending,
                className: 'bg-critical/35',
              },
            ]}
          />
        )}
      </KpiTile>
      <KpiTile
        icon={TriangleAlert}
        label="Peak sales at risk"
        loading={busy}
        error={error}
        tone={peakSales > 0 ? 'critical' : 'default'}
        value={s ? formatUsd(peakSales) : '—'}
        detail={s && 'Lost before the next delivery if those peak lines are not ordered'}
        source={source}
      >
        {s && (
          <SplitBar
            total={allSales}
            ariaLabel={`${formatUsd(peakSales)} of ${formatUsd(allSales)} sales at risk is on peak gift lines`}
            segments={[
              { label: `Peak gifts ${formatUsd(peakSales)}`, value: peakSales, className: 'bg-critical' },
              {
                label: `Other lines ${formatUsd(allSales - peakSales)}`,
                value: allSales - peakSales,
                className: 'bg-critical/35',
              },
            ]}
          />
        )}
      </KpiTile>
      <KpiTile
        icon={ListChecks}
        label="Lines that need you today"
        loading={busy}
        error={error}
        value={s ? formatInt(review) : '—'}
        unit={s && `of ${formatInt(linesToOrder)} lines`}
        detail={
          s &&
          `${formatUsd(s.exception_pending_at_risk)} at risk across ${formatInt(s.exception_pending_stores)} stores · the other ${formatInt(routine)} are routine`
        }
        source="Exception rules · Lakebase serving.recommendations + replenishment.*"
      >
        {s && (
          <SplitBar
            total={linesToOrder}
            ariaLabel={`${formatInt(review)} lines need review, ${formatInt(routine)} routine, ${formatInt(decided)} decided`}
            segments={[
              { label: `${formatInt(review)} need review`, value: review, className: 'bg-primary' },
              { label: `${formatInt(routine)} routine`, value: routine, className: 'bg-primary/30' },
              { label: `${formatInt(decided)} decided`, value: decided, className: 'bg-muted-foreground/40' },
            ]}
          />
        )}
      </KpiTile>
      <WasteTile filters={filters} />
    </section>
  );
}
