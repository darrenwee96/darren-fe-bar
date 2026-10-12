import type { ReactNode } from 'react';
import { Card, Skeleton, useAnalyticsQuery } from '@databricks/appkit-ui/react';
import { Gift, ListChecks, Recycle, Target, CheckCircle2 } from 'lucide-react';
import type { ScopeFilters, Summary } from '../lib/api';
import { warehouseParams } from '../lib/filters';
import { formatDate, formatInt, formatPct, formatUsd, titleCase, toNumber } from '../lib/format';
import { useNumeric } from '../lib/useNumeric';
import { cn } from '../lib/utils';
import { Delta } from './Delta';

const NO_PARAMS = {};

interface Segment {
  label: string;
  value: number;
  className: string;
}

/**
 * The tile's mini visual: one thin bar split into labelled segments (share, split or progress). Every tile carries
 * one, so the five tiles share the same rhythm. Segment labels are always printed below, never color alone.
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
              title={`${s.label}: ${formatInt(s.value)}`}
            />
          ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        {segments.map((s) => (
          <span key={s.label} className="flex items-center gap-1">
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
      <div className="flex h-full flex-col gap-2 px-4 pb-3 pt-3.5">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <span
            className={cn(
              'flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
              tone === 'critical'
                ? 'bg-critical/10 text-destructive'
                : tone === 'good'
                  ? 'bg-good/10 text-success'
                  : 'bg-primary/10 text-primary'
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
          </span>
          <span className="truncate">{label}</span>
        </div>
        {loading ? (
          <>
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-full" />
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
            {detail && <div className="min-h-[2lh] text-xs leading-snug text-muted-foreground">{detail}</div>}
            {children && <div className="mt-auto">{children}</div>}
          </>
        )}
        <p className="truncate border-t pt-2 text-[11px] text-muted-foreground/80" title={source}>
          {source}
        </p>
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
      <div className="space-y-1" aria-label="WMAPE by channel: model (blue) vs same week last year (gray)">
        {CHANNELS.map((c) => {
          const r = bySegment.get(c);
          if (!r) return null;
          return (
            <div
              key={c}
              className={cn(
                'grid grid-cols-[58px_1fr_38px] items-center gap-2 text-[11px]',
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
  const markdown = k?.markdown_value ?? 0;
  const expired = Math.max(0, (k?.waste_value ?? 0) - markdown);
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
  const decided = toNumber(s?.decided_lines);
  const accepted = toNumber(s?.accepted);
  const adjusted = toNumber(s?.adjusted);
  const rejected = toNumber(s?.rejected);
  const linesToOrder = toNumber(s?.lines_to_order);
  const pending = toNumber(s?.pending_lines);
  const source = s?.as_of_date
    ? `Order week ${formatDate(s.as_of_date)} · Lakebase serving.recommendations`
    : 'Lakebase serving.recommendations';
  const busy = loading && !s;

  return (
    <section aria-label="Key figures" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
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
              <span className="text-sm font-normal text-muted-foreground">of {formatInt(peakLines)} lines</span>
            </span>
          ) : (
            '—'
          )
        }
        detail={s && `${formatUsd(s.peak_needs_order_sales)} lost if not ordered`}
        source={source}
      >
        {s && (
          <SplitBar
            total={peakLines}
            ariaLabel={`${formatInt(peakNeeds)} of ${formatInt(peakLines)} peak gift lines need an order`}
            segments={[
              {
                label: `${formatInt(s.peak_needs_order_pending)} pending`,
                value: toNumber(s.peak_needs_order_pending),
                className: 'bg-critical',
              },
              {
                label: `${formatInt(peakNeeds - toNumber(s.peak_needs_order_pending))} decided`,
                value: peakNeeds - toNumber(s.peak_needs_order_pending),
                className: 'bg-critical/40',
              },
            ]}
          />
        )}
      </KpiTile>
      <WmapeTile channel={filters.channel} />
      <WasteTile filters={filters} />
      <KpiTile
        icon={CheckCircle2}
        label="Orders placed from forecast"
        loading={busy}
        error={error}
        value={s ? (decided > 0 ? formatPct((accepted + adjusted) / decided, 0) : '—') : '—'}
        detail={
          s &&
          (decided > 0
            ? `${formatInt(accepted + adjusted)} of ${formatInt(decided)} decided lines`
            : 'No decisions yet in this scope')
        }
        source="Accepted + adjusted ÷ decided · Lakebase order_decisions"
      >
        {s && (
          <SplitBar
            total={decided}
            ariaLabel={`${formatInt(accepted)} accepted, ${formatInt(adjusted)} adjusted, ${formatInt(rejected)} rejected`}
            segments={[
              { label: `${formatInt(accepted)} accepted`, value: accepted, className: 'bg-good' },
              { label: `${formatInt(adjusted)} adjusted`, value: adjusted, className: 'bg-forecast' },
              { label: `${formatInt(rejected)} rejected`, value: rejected, className: 'bg-reference' },
            ]}
          />
        )}
      </KpiTile>
      <KpiTile
        icon={ListChecks}
        label="Pending decisions"
        loading={busy}
        error={error}
        tone={s && pending === 0 ? 'good' : 'default'}
        value={s ? formatInt(pending) : '—'}
        detail={s && `${formatUsd(s.pending_value_at_cost)} at cost`}
        source={source}
      >
        {s && (
          <SplitBar
            total={linesToOrder}
            ariaLabel={`${formatInt(decided)} of ${formatInt(linesToOrder)} order lines decided`}
            segments={[
              { label: `${formatInt(decided)} decided`, value: decided, className: 'bg-primary' },
              { label: `${formatInt(pending)} to go`, value: pending, className: 'bg-muted-foreground/25' },
            ]}
          />
        )}
      </KpiTile>
    </section>
  );
}
