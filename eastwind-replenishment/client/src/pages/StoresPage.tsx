import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  BarChart,
  Card,
  CardContent,
  HeatmapChart,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useAnalyticsQuery,
} from '@databricks/appkit-ui/react';
import { sql } from '@databricks/appkit-ui/js';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { ChartCard } from '../components/ChartCard';
import { Delta } from '../components/Delta';
import { FilterSelect } from '../components/FilterSelect';
import { ALL, CHANNEL_OPTIONS, REGION_OPTIONS } from '../lib/filters';
import { PageHeader } from '../components/PageHeader';
import { QueryStates } from '../components/QueryStates';
import { formatInt, formatPct, formatUsd, titleCase } from '../lib/format';
import { useNumeric } from '../lib/useNumeric';

const NO_PARAMS = {};

type SortKey =
  | 'location_name'
  | 'net_sales'
  | 'sales_vs_py'
  | 'stockout_rate'
  | 'waste_rate'
  | 'high_risk_skus'
  | 'sales_at_risk'
  | 'lines_to_order';

const COLUMNS: { key: SortKey; label: string; numeric: boolean; title?: string }[] = [
  { key: 'location_name', label: 'Store', numeric: false },
  { key: 'net_sales', label: 'Net sales', numeric: true },
  { key: 'sales_vs_py', label: 'vs last year', numeric: true },
  { key: 'stockout_rate', label: 'Stockout days', numeric: true },
  { key: 'waste_rate', label: 'Waste % sales', numeric: true },
  {
    key: 'high_risk_skus',
    label: 'High-risk SKUs',
    numeric: true,
    title: 'SKUs whose stock will not cover demand before the next delivery',
  },
  {
    key: 'sales_at_risk',
    label: 'Sales at risk',
    numeric: true,
    title: 'List-price sales lost if the recommended orders are not placed',
  },
  { key: 'lines_to_order', label: 'Lines to order', numeric: true },
];

export function StoresPage() {
  const navigate = useNavigate();
  const [channel, setChannel] = useState(ALL);
  const [region, setRegion] = useState(ALL);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'sales_at_risk', desc: true });

  const params = useMemo(() => ({ channel: sql.string(channel), region: sql.string(region) }), [channel, region]);
  const query = useAnalyticsQuery('store_scorecard', params);
  const { loading, error } = query;
  const data = useNumeric(query.data);

  const sorted = useMemo(() => {
    if (!data) return [];
    const rows = [...data];
    rows.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return sort.desc ? -cmp : cmp;
    });
    return rows;
  }, [data, sort]);

  const topAtRisk = useMemo(
    () =>
      [...(data ?? [])]
        .sort((a, b) => b.sales_at_risk - a.sales_at_risk)
        .slice(0, 12)
        .reverse()
        .map((r) => ({ store: r.location_name, sales_at_risk_usd: Math.round(r.sales_at_risk) })),
    [data]
  );

  const totalAtRisk = (data ?? []).reduce((s, r) => s + r.sales_at_risk, 0);
  const scope =
    [channel !== ALL && titleCase(channel), region !== ALL && region].filter(Boolean).join(' · ') || 'All stores';

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <PageHeader
        context={`${scope} · last 13 weeks vs last year · sales at risk ${formatUsd(totalAtRisk)}`}
        title="Stores"
      />

      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 pt-6">
          <FilterSelect
            id="store-channel"
            label="Channel"
            value={channel}
            onChange={setChannel}
            options={CHANNEL_OPTIONS}
          />
          <FilterSelect id="store-region" label="Region" value={region} onChange={setRegion} options={REGION_OPTIONS} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title="Sales at risk by store, top 12"
          description={`USD · ${scope}`}
          source="gold.replenishment_recommendations_current"
          askGenie="Which stores have the most sales at risk from high stockout risk, and which products drive it?"
        >
          <QueryStates loading={loading} error={error} empty={topAtRisk.length === 0} />
          {topAtRisk.length > 0 && (
            <BarChart
              data={topAtRisk}
              xKey="store"
              yKey="sales_at_risk_usd"
              orientation="horizontal"
              colorPalette="categorical"
              showLegend={false}
              height={360}
              valueFormatter={(v) => formatUsd(Number(v))}
              ariaLabel="Top stores by sales at risk"
            />
          )}
        </ChartCard>

        <ChartCard
          title="Stockout-day rate by region × channel"
          description="% of store-SKU-days · last 13 weeks"
          source="gold.channel_weekly_kpis"
          askGenie="Which region and channel combination had the highest stockout day rate over the last 13 weeks?"
        >
          <HeatmapChart
            queryKey="stockout_heatmap"
            parameters={NO_PARAMS}
            xKey="channel"
            yAxisKey="region"
            yKey="stockout_rate_pct"
            colorPalette="sequential"
            height={360}
            valueFormatter={(v) => `${Number(v).toFixed(1)}%`}
            ariaLabel="Stockout-day rate heatmap by region and channel"
          />
        </ChartCard>
      </div>

      <ChartCard
        title="Store scorecard"
        description={`${scope} · last 13 weeks · click a store for detail`}
        source="gold.weekly_demand_features, gold.replenishment_recommendations_current"
      >
        <QueryStates loading={loading} error={error} empty={sorted.length === 0} rows={8} />
        {sorted.length > 0 && (
          <div className="max-h-[560px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {COLUMNS.map((c) => (
                    <TableHead
                      key={c.key}
                      className={`cursor-pointer select-none ${c.numeric ? 'text-right' : ''}`}
                      title={c.title}
                      onClick={() => setSort((s) => ({ key: c.key, desc: s.key === c.key ? !s.desc : c.numeric }))}
                    >
                      <span className="inline-flex items-center gap-1">
                        {c.label}
                        {sort.key === c.key &&
                          (sort.desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
                      </span>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((r) => (
                  <TableRow
                    key={r.location_id}
                    className="cursor-pointer"
                    tabIndex={0}
                    onClick={() => void navigate(`/stores/${r.location_id}`)}
                    onKeyDown={(e) => e.key === 'Enter' && void navigate(`/stores/${r.location_id}`)}
                  >
                    <TableCell>
                      <p className="font-medium text-foreground">{r.location_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {titleCase(r.channel)} · {r.region} · size {r.size}
                      </p>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatUsd(r.net_sales)}</TableCell>
                    <TableCell className="text-right">
                      <Delta current={1 + r.sales_vs_py} previous={1} higherIsGood suffix="" />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatPct(r.stockout_rate)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPct(r.waste_rate)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatInt(r.high_risk_skus)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatUsd(r.sales_at_risk)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatInt(r.lines_to_order)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </ChartCard>
    </div>
  );
}
