import { useMemo, useState } from 'react';
import {
  BarChart,
  Card,
  CardContent,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ToggleGroup,
  ToggleGroupItem,
  useAnalyticsQuery,
  useChartUITokens,
  useThemeColors,
} from '@databricks/appkit-ui/react';
import { sql } from '@databricks/appkit-ui/js';
import { ChartCard } from '../components/ChartCard';
import { Delta } from '../components/Delta';
import { FilterSelect } from '../components/FilterSelect';
import { ALL, CHANNEL_OPTIONS } from '../lib/filters';
import { PageHeader } from '../components/PageHeader';
import { QueryStates } from '../components/QueryStates';
import { ScenarioChart } from '../components/ScenarioChart';
import { formatInt, formatPct, titleCase } from '../lib/format';
import { useNumeric } from '../lib/useNumeric';

const FOLDS = [
  { value: 'MA2025', label: 'Mid-Autumn 2025' },
  { value: 'LNY2026', label: 'Lunar New Year 2026' },
];
const units = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 0 });

export function ForecastPage() {
  const [channel, setChannel] = useState(ALL);
  const [category, setCategory] = useState(ALL);
  const [fold, setFold] = useState('MA2025');
  const ui = useChartUITokens();
  const [accent] = useThemeColors('categorical');

  const trendParams = useMemo(
    () => ({ channel: sql.string(channel), category: sql.string(category) }),
    [channel, category]
  );
  const channelParams = useMemo(() => ({ channel: sql.string(channel) }), [channel]);
  const foldParams = useMemo(() => ({ fold: sql.string(fold) }), [fold]);

  const trend = useAnalyticsQuery('forecast_trend', trendParams);
  const trendRows = useNumeric(trend.data);
  const byCategory = useAnalyticsQuery('forecast_by_category', channelParams);
  const categoryRows = useNumeric(byCategory.data);
  const summary = useAnalyticsQuery('accuracy_summary', foldParams);
  const summaryRows = useNumeric(summary.data);

  const categoryOptions = useMemo(
    () =>
      [...(categoryRows ?? [])]
        .map((c) => c.category)
        .sort()
        .map((c) => ({ value: c, label: c })),
    [categoryRows]
  );
  const outlook = useMemo(() => {
    const rows = (categoryRows ?? []).filter((c) => category === ALL || c.category === category);
    const expected = rows.reduce((s, r) => s + r.expected_units, 0);
    const lastYear = rows.reduce((s, r) => s + r.last_year_units, 0);
    return { expected, lastYear };
  }, [categoryRows, category]);

  const scope =
    [channel !== ALL && titleCase(channel), category !== ALL && category].filter(Boolean).join(' · ') ||
    'All stores and products';

  const foldLabel = FOLDS.find((f) => f.value === fold)?.label ?? fold;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <PageHeader
        context={`${scope} · 6 weeks from 31 Aug 2026 · ${formatInt(outlook.expected)} units expected`}
        title="Forecast"
      />

      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 pt-6">
          <FilterSelect
            id="fc-channel"
            label="Channel"
            value={channel}
            onChange={setChannel}
            options={CHANNEL_OPTIONS}
          />
          <FilterSelect
            id="fc-category"
            label="Category"
            value={category}
            onChange={setCategory}
            options={categoryOptions}
            width="w-44"
          />
        </CardContent>
      </Card>

      <ChartCard
        title="Weekly units: actual and forecast"
        description={`Units · ${scope} · vs last year`}
        source="gold.weekly_demand_features, gold.demand_forecasts (@champion model)"
        askGenie={`What is total expected ${category === ALL ? '' : category.toLowerCase() + ' '}demand for each forecast week${channel === ALL ? '' : ' in ' + titleCase(channel) + ' stores'} compared with the same weeks last year?`}
      >
        <QueryStates loading={trend.loading} error={trend.error} empty={!trend.data?.length} rows={6} />
        {trendRows && trendRows.length > 0 && (
          <ScenarioChart
            rows={trendRows}
            formatValue={units}
            height={320}
            ariaLabel="Weekly units, actual, forecast and last year"
          />
        )}
      </ChartCard>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title="Forecast by category"
          description={`Units · next 6 weeks vs last year · ${channel === ALL ? 'all channels' : titleCase(channel)}`}
          source="gold.demand_forecasts"
        >
          <QueryStates loading={byCategory.loading} error={byCategory.error} empty={!byCategory.data?.length} />
          {categoryRows && categoryRows.length > 0 && (
            <BarChart
              data={categoryRows}
              xKey="category"
              yKey={['expected_units', 'last_year_units']}
              orientation="vertical"
              colors={[accent, ui.axisLabel]}
              showLegend
              height={320}
              valueFormatter={(v) => units(Number(v))}
              ariaLabel="Expected units by category vs last year"
            />
          )}
        </ChartCard>

        <ChartCard title="Category outlook" description="Next 6 weeks vs last year" source="gold.demand_forecasts">
          {categoryRows && categoryRows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Expected units</TableHead>
                  <TableHead className="text-right">Last year</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categoryRows.map((c) => (
                  <TableRow key={c.category} className={category === c.category ? 'bg-muted' : ''}>
                    <TableCell className="font-medium">{c.category}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatInt(c.expected_units)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatInt(c.last_year_units)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Delta current={c.expected_units} previous={c.last_year_units} higherIsGood suffix="" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ChartCard>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Forecast accuracy</h3>
          <p className="text-sm text-muted-foreground">WMAPE, lower is better · {foldLabel} backtest</p>
        </div>
        <div className="space-y-1">
          <Label>Backtest</Label>
          <ToggleGroup type="single" variant="outline" value={fold} onValueChange={(v) => v && setFold(v)}>
            {FOLDS.map((f) => (
              <ToggleGroupItem key={f.value} value={f.value}>
                {f.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title="WMAPE by weeks ahead"
          description="% · model vs last-year baselines"
          source="gold.forecast_accuracy"
          askGenie="How does forecast error change with how many weeks ahead we forecast, compared with last year's sales?"
        >
          <BarChart
            queryKey="accuracy_by_horizon"
            parameters={foldParams}
            xKey="weeks_ahead"
            yKey={['model', 'same_week_last_year', 'same_holiday_last_year']}
            orientation="vertical"
            colorPalette="categorical"
            showLegend
            height={300}
            valueFormatter={(v) => `${Number(v).toFixed(1)}%`}
            ariaLabel="Forecast error by weeks ahead"
          />
        </ChartCard>

        <ChartCard
          title="Accuracy by segment"
          description="WMAPE, bias and p90 coverage (target 90%)"
          source="gold.forecast_accuracy"
        >
          <QueryStates loading={summary.loading} error={summary.error} empty={!summary.data?.length} />
          {summaryRows && summaryRows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Segment</TableHead>
                  <TableHead className="text-right">Model</TableHead>
                  <TableHead className="text-right">Same wk LY</TableHead>
                  <TableHead className="text-right">Same holiday LY</TableHead>
                  <TableHead className="text-right">Bias</TableHead>
                  <TableHead className="text-right" title="Share of actuals at or below the p90 forecast (target 90%)">
                    p90
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summaryRows.map((r) => {
                  const best = Math.min(r.model_wmape, r.same_week_ly_wmape, r.same_holiday_ly_wmape);
                  const cls = (v: number) =>
                    `text-right tabular-nums ${v === best ? 'font-semibold text-foreground' : 'text-muted-foreground'}`;
                  return (
                    <TableRow key={r.segment}>
                      <TableCell className="font-medium">{r.segment}</TableCell>
                      <TableCell className={cls(r.model_wmape)}>{formatPct(r.model_wmape)}</TableCell>
                      <TableCell className={cls(r.same_week_ly_wmape)}>{formatPct(r.same_week_ly_wmape)}</TableCell>
                      <TableCell className={cls(r.same_holiday_ly_wmape)}>
                        {formatPct(r.same_holiday_ly_wmape)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatPct(r.model_bias)}</TableCell>
                      <TableCell className={`text-right tabular-nums ${r.p90_coverage < 0.85 ? 'text-warning' : ''}`}>
                        {formatPct(r.p90_coverage, 0)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <p className="text-xs text-muted-foreground">Bold = lowest error in the row.</p>
        </ChartCard>
      </div>
    </div>
  );
}
