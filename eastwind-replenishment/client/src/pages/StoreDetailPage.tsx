import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useAnalyticsQuery,
} from '@databricks/appkit-ui/react';
import { sql } from '@databricks/appkit-ui/js';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { ChartCard } from '../components/ChartCard';
import { Delta } from '../components/Delta';
import { ALL } from '../lib/filters';
import { KpiCard } from '../components/KpiCard';
import { PageHeader } from '../components/PageHeader';
import { QueryStates } from '../components/QueryStates';
import { RecommendationSheet } from '../components/RecommendationSheet';
import { RiskBadge } from '../components/RiskBadge';
import { ScenarioChart } from '../components/ScenarioChart';
import { useGenie } from '../genie/context';
import type { Risk } from '../lib/api';
import { formatInt, formatPct, formatUsd, titleCase } from '../lib/format';
import { useNumeric } from '../lib/useNumeric';

const ALL_STORES = { channel: sql.string(ALL), region: sql.string(ALL) };
const units = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 0 });

export function StoreDetailPage() {
  const { locationId = '' } = useParams();
  const genie = useGenie();
  const [selected, setSelected] = useState<string | null>(null);

  const params = useMemo(() => ({ location_id: sql.string(locationId) }), [locationId]);
  const stores = useAnalyticsQuery('store_scorecard', ALL_STORES);
  const storeRows = useNumeric(stores.data);
  const weekly = useAnalyticsQuery('store_weekly', params);
  const weeklyRows = useNumeric(weekly.data);
  const skus = useAnalyticsQuery('store_skus', params);
  const skuRows = useNumeric(skus.data);
  const store = storeRows?.find((s) => s.location_id === locationId);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/stores">
          <ArrowLeft className="mr-1 h-4 w-4" /> All stores
        </Link>
      </Button>

      <PageHeader
        context={
          store
            ? `${titleCase(store.channel)} · ${store.region} · size ${store.size}`
            : stores.loading
              ? 'Loading store…'
              : `Store ${locationId} not found`
        }
        title={store?.location_name ?? 'Store'}
        actions={
          store && (
            <Button
              variant="outline"
              onClick={() =>
                genie.ask(
                  `For ${store.location_name}, which products are at high stockout risk, how much sales are at risk, and what is recommended to order?`
                )
              }
            >
              <Sparkles className="mr-1 h-4 w-4" /> Ask Genie about this store
            </Button>
          )
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Net sales, last 13 weeks"
          loading={stores.loading}
          value={store ? formatUsd(store.net_sales) : '—'}
          detail={store && <Delta current={1 + store.sales_vs_py} previous={1} higherIsGood />}
          source="gold.weekly_demand_features"
        />
        <KpiCard
          label="Stockout days, last 13 weeks"
          loading={stores.loading}
          value={store ? formatPct(store.stockout_rate) : '—'}
          detail="% of SKU-days"
          source="gold.weekly_demand_features"
        />
        <KpiCard
          label="Waste, last 13 weeks"
          loading={stores.loading}
          value={store ? formatPct(store.waste_rate) : '—'}
          detail="% of net sales"
          source="gold.weekly_demand_features"
        />
        <KpiCard
          label="This week's orders"
          loading={stores.loading}
          tone={store && store.high_risk_skus > 0 ? 'bad' : 'default'}
          value={store ? `${formatInt(store.lines_to_order)} lines` : '—'}
          detail={store && `${formatInt(store.high_risk_skus)} SKUs at high stockout risk`}
          source="gold.replenishment_recommendations_current"
        />
      </div>

      <ChartCard
        title="Weekly units"
        description="Units · 26 weeks actual + 6-week forecast vs last year"
        source="gold.weekly_demand_features, gold.demand_forecasts"
      >
        <QueryStates loading={weekly.loading} error={weekly.error} empty={!weekly.data?.length} rows={6} />
        {weeklyRows && weeklyRows.length > 0 && (
          <ScenarioChart
            rows={weeklyRows}
            formatValue={units}
            ariaLabel="Store weekly units, actual, forecast and last year"
          />
        )}
      </ChartCard>

      <ChartCard
        title="Stock and orders by SKU"
        description="As of 31 Aug 2026 · click a SKU to review its order"
        source="gold.replenishment_recommendations_current"
      >
        <QueryStates loading={skus.loading} error={skus.error} empty={!skus.data?.length} rows={8} />
        {skuRows && skuRows.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead className="text-right">On hand</TableHead>
                <TableHead className="text-right">Inbound</TableHead>
                <TableHead className="text-right">Weekly sales</TableHead>
                <TableHead className="text-right">Weeks of cover</TableHead>
                <TableHead>Stockout</TableHead>
                <TableHead>Overstock</TableHead>
                <TableHead className="text-right">Recommended</TableHead>
                <TableHead className="text-right">Sales at risk</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {skuRows.map((s) => (
                <TableRow
                  key={s.recommendation_id}
                  className="cursor-pointer"
                  tabIndex={0}
                  onClick={() => setSelected(s.recommendation_id)}
                  onKeyDown={(e) => e.key === 'Enter' && setSelected(s.recommendation_id)}
                >
                  <TableCell>
                    <p className="font-medium text-foreground">{s.sku_name}</p>
                    <p className="text-xs text-muted-foreground">{s.category}</p>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatInt(s.on_hand)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatInt(s.inbound)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatInt(s.weekly_sales)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {s.weeks_of_cover == null ? '—' : s.weeks_of_cover.toFixed(1)}
                  </TableCell>
                  <TableCell>
                    <RiskBadge risk={s.stockout_risk as Risk} label="Stockout" />
                  </TableCell>
                  <TableCell>
                    <RiskBadge risk={s.overstock_risk as Risk} label="Overstock" />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatInt(s.recommended_units)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatUsd(s.sales_at_risk)}</TableCell>
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
