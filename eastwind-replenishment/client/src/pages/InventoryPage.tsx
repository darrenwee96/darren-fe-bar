import { useMemo, useState } from 'react';
import {
  BarChart,
  HeatmapChart,
  Label,
  LineChart,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ToggleGroup,
  ToggleGroupItem,
  useAnalyticsQuery,
} from '@databricks/appkit-ui/react';
import { sql } from '@databricks/appkit-ui/js';
import { ChartCard } from '../components/ChartCard';
import { FilterSelect } from '../components/FilterSelect';
import { ALL, CHANNEL_OPTIONS } from '../lib/filters';
import { KpiCard } from '../components/KpiCard';
import { PageHeader } from '../components/PageHeader';
import { QueryStates } from '../components/QueryStates';
import { RecommendationSheet } from '../components/RecommendationSheet';
import { formatDate, formatInt, formatUsd, titleCase } from '../lib/format';
import { useNumeric } from '../lib/useNumeric';

const NO_PARAMS = {};

export function InventoryPage() {
  const [channel, setChannel] = useState(ALL);
  const [risk, setRisk] = useState<'STOCKOUT' | 'OVERSTOCK'>('STOCKOUT');
  const [selected, setSelected] = useState<string | null>(null);

  const channelParams = useMemo(() => ({ channel: sql.string(channel) }), [channel]);
  const exceptionParams = useMemo(() => ({ channel: sql.string(channel), risk: sql.string(risk) }), [channel, risk]);

  const kpis = useAnalyticsQuery('inventory_kpis', NO_PARAMS);
  const kpiRows = useNumeric(kpis.data);
  const byCategory = useAnalyticsQuery('inventory_by_category', channelParams);
  const categoryRows = useNumeric(byCategory.data);
  const exceptions = useAnalyticsQuery('inventory_exceptions', exceptionParams);
  const exceptionRows = useNumeric(exceptions.data);
  const k = kpiRows?.[0];

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <PageHeader
        context={`As of ${k ? formatDate(k.as_of_date) : '…'} · ${k ? formatInt(k.store_skus) : '…'} store-SKUs`}
        title="Inventory"
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Stock on hand + inbound"
          loading={kpis.loading}
          value={k ? `${formatInt(k.on_hand_units + k.inbound_units)} units` : '—'}
          detail={k && `${formatUsd(k.stock_value_at_cost)} at cost · ${formatInt(k.inbound_units)} in transit`}
          source="gold.replenishment_recommendations_current"
        />
        <KpiCard
          label="Median weeks of cover"
          loading={kpis.loading}
          value={k ? `${k.median_weeks_of_cover.toFixed(1)} weeks` : '—'}
          detail="per store-SKU"
          source="gold.replenishment_recommendations_current"
        />
        <KpiCard
          label="High stockout risk"
          loading={kpis.loading}
          tone="bad"
          value={k ? formatInt(k.high_stockout) : '—'}
          detail={k && `${formatUsd(k.sales_at_risk)} sales at risk`}
          source="gold.replenishment_recommendations_current"
        />
        <KpiCard
          label="High overstock risk"
          loading={kpis.loading}
          tone={k && k.high_overstock > 0 ? 'bad' : 'default'}
          value={k ? formatInt(k.high_overstock) : '—'}
          detail={k && `${formatUsd(k.expiry_value)} expected to expire`}
          source="gold.replenishment_recommendations_current"
        />
      </div>
      {kpis.error && <p className="text-sm text-destructive">Could not load inventory KPIs: {kpis.error}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title="High stockout risk by category × channel"
          description="Store-SKUs, count"
          source="gold.replenishment_recommendations_current"
          askGenie="Which categories and channels have the most store-SKUs at high stockout risk?"
        >
          <HeatmapChart
            queryKey="inventory_risk_matrix"
            parameters={NO_PARAMS}
            xKey="channel"
            yAxisKey="category"
            yKey="high_stockout_skus"
            colorPalette="sequential"
            height={380}
            ariaLabel="High stockout risk by category and channel"
          />
        </ChartCard>

        <ChartCard
          title="Weeks of cover by category"
          description={`(On hand + inbound) ÷ weekly forecast · ${channel === ALL ? 'all channels' : titleCase(channel)}`}
          source="gold.replenishment_recommendations_current"
          actions={
            <FilterSelect
              id="inv-channel"
              label="Channel"
              value={channel}
              onChange={setChannel}
              options={CHANNEL_OPTIONS}
              width="w-36"
            />
          }
        >
          <QueryStates loading={byCategory.loading} error={byCategory.error} empty={!byCategory.data?.length} />
          {categoryRows && categoryRows.length > 0 && (
            <BarChart
              data={[...categoryRows].reverse()}
              xKey="category"
              yKey="weeks_of_cover"
              orientation="horizontal"
              colorPalette="categorical"
              showLegend={false}
              height={340}
              valueFormatter={(v) => `${Number(v).toFixed(1)} wk`}
              ariaLabel="Weeks of cover by category"
            />
          )}
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title="Stockout-day rate by channel"
          description="% of store-SKU-days · weekly, last 52 weeks"
          source="gold.channel_weekly_kpis"
          askGenie="In which weeks of the last year was the stockout day rate highest, and in which channel?"
        >
          <LineChart
            queryKey="stock_health_trend"
            parameters={NO_PARAMS}
            xKey="week"
            yKey={['downtown_stockout', 'highway_stockout', 'airport_stockout']}
            colorPalette="categorical"
            showLegend
            showSymbol={false}
            smooth={false}
            height={300}
            valueFormatter={(v) => `${Number(v).toFixed(1)}%`}
            ariaLabel="Weekly stockout-day rate by channel"
          />
        </ChartCard>
        <ChartCard
          title="Waste by channel"
          description="Expiry + markdown, USD K · weekly, last 52 weeks"
          source="gold.channel_weekly_kpis"
          askGenie="What was waste as a percentage of net sales by channel over the last 52 weeks?"
        >
          <BarChart
            queryKey="stock_health_trend"
            parameters={NO_PARAMS}
            xKey="week"
            yKey={['downtown_waste', 'highway_waste', 'airport_waste']}
            orientation="vertical"
            stacked
            colorPalette="categorical"
            showLegend
            height={300}
            valueFormatter={(v) => `$${Number(v).toFixed(1)}K`}
            ariaLabel="Weekly waste by channel"
          />
        </ChartCard>
      </div>

      <ChartCard
        title={risk === 'STOCKOUT' ? 'Top 25 stockout exceptions' : 'Top 25 overstock exceptions'}
        description={`${channel === ALL ? 'All channels' : titleCase(channel)} · ${
          risk === 'STOCKOUT' ? 'by sales at risk' : 'by expiry value'
        } · click a row to review`}
        source="gold.replenishment_recommendations_current"
        actions={
          <div className="flex items-center gap-2">
            <Label className="sr-only">Exception type</Label>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={risk}
              onValueChange={(v) => v && setRisk(v as typeof risk)}
            >
              <ToggleGroupItem value="STOCKOUT">Stockout risk</ToggleGroupItem>
              <ToggleGroupItem value="OVERSTOCK">Overstock risk</ToggleGroupItem>
            </ToggleGroup>
          </div>
        }
      >
        <QueryStates
          loading={exceptions.loading}
          error={exceptions.error}
          empty={!exceptions.data?.length}
          emptyText="No store-SKUs at high risk for this channel."
          rows={8}
        />
        {exceptionRows && exceptionRows.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Store</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead className="text-right">On hand</TableHead>
                <TableHead className="text-right">Inbound</TableHead>
                <TableHead className="text-right">Weeks of cover</TableHead>
                <TableHead className="text-right">Recommended order</TableHead>
                <TableHead className="text-right">{risk === 'STOCKOUT' ? 'Sales at risk' : 'Expiry value'}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {exceptionRows.map((r) => (
                <TableRow
                  key={r.recommendation_id}
                  className="cursor-pointer"
                  tabIndex={0}
                  onClick={() => setSelected(r.recommendation_id)}
                  onKeyDown={(e) => e.key === 'Enter' && setSelected(r.recommendation_id)}
                >
                  <TableCell>
                    <p className="font-medium text-foreground">{r.location_name}</p>
                    <p className="text-xs text-muted-foreground">{titleCase(r.channel)}</p>
                  </TableCell>
                  <TableCell>{r.sku_name}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatInt(r.on_hand)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatInt(r.inbound)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.weeks_of_cover == null ? '—' : r.weeks_of_cover.toFixed(1)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatInt(r.recommended_units)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatUsd(r.value_at_risk)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </ChartCard>

      <RecommendationSheet recommendationId={selected} onClose={() => setSelected(null)} onSaved={() => undefined} />
    </div>
  );
}
