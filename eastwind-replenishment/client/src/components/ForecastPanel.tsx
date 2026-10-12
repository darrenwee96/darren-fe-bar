import { useMemo } from 'react';
import { Button, useAnalyticsQuery } from '@databricks/appkit-ui/react';
import { sql } from '@databricks/appkit-ui/js';
import { Sparkles } from 'lucide-react';
import type { ScopeFilters } from '../lib/api';
import { warehouseParams } from '../lib/filters';
import { formatInt, formatPct } from '../lib/format';
import { useNumeric } from '../lib/useNumeric';
import { useGenie } from '../genie/context';
import { Panel } from './Panel';
import { QueryStates } from './QueryStates';
import { ScenarioChart } from './ScenarioChart';

const compactUnits = (v: number) =>
  v >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)}M` : v >= 10_000 ? `${(v / 1_000).toFixed(0)}K` : formatInt(v);

/** Forecast vs actual for whatever the global filters select: network, region, channel, category or one store. */
export function ForecastPanel({ filters, scopeLabel }: { filters: ScopeFilters; scopeLabel: string }) {
  const genie = useGenie();
  const params = useMemo(() => ({ ...warehouseParams(filters), sku_id: sql.string('ALL') }), [filters]);
  const q = useAnalyticsQuery('forecast_vs_actual', params);
  const rows = useNumeric(q.data);

  const outlook = useMemo(() => {
    const fc = (rows ?? []).filter((r) => r.actual === null);
    if (fc.length === 0) return null;
    const expected = fc.reduce((s, r) => s + (r.forecast ?? 0), 0);
    const p90 = fc.reduce((s, r) => s + (r.p90 ?? 0), 0);
    const ly = fc.reduce((s, r) => s + (r.last_year ?? 0), 0);
    return { weeks: fc.length, expected, p90, vsLy: ly ? (expected - ly) / ly : null };
  }, [rows]);

  return (
    <Panel
      title="Forecast vs actual"
      meta={`Weekly units · 26 wks actual + 6-wk forecast · ${scopeLabel}`}
      source="Actual: gold.weekly_demand_features · forecast + p90: gold.demand_forecasts, latest run only"
      actions={
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-muted-foreground"
          onClick={() =>
            genie.ask(
              `What is driving the forecast for the next 6 weeks${scopeLabel === 'All stores' ? '' : ` for ${scopeLabel}`} compared with last year?`
            )
          }
        >
          <Sparkles className="mr-1 h-3.5 w-3.5" /> Ask why
        </Button>
      }
    >
      {outlook && (
        <dl className="mb-2 grid grid-cols-3 gap-3 text-xs">
          <div>
            <dt className="text-muted-foreground">Next {outlook.weeks} wks</dt>
            <dd className="text-base font-semibold tabular-nums text-foreground">{compactUnits(outlook.expected)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">vs last year</dt>
            <dd className="text-base font-semibold tabular-nums text-foreground">
              {outlook.vsLy === null ? '—' : `${outlook.vsLy >= 0 ? '+' : '−'}${formatPct(Math.abs(outlook.vsLy))}`}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground" title="Sum of store-SKU p90s: the plan-for upper bound">
              p90 plan-for
            </dt>
            <dd className="text-base font-semibold tabular-nums text-foreground">{compactUnits(outlook.p90)}</dd>
          </div>
        </dl>
      )}
      <QueryStates
        loading={q.loading && !rows}
        error={q.error}
        empty={!!rows && rows.length === 0}
        rows={6}
        emptyText="No sales or forecast for this selection."
      />
      {rows && rows.length > 0 && (
        <ScenarioChart
          rows={rows}
          height={270}
          ariaLabel={`Weekly units for ${scopeLabel}: actual, forecast with p90 band, last year`}
        />
      )}
    </Panel>
  );
}
