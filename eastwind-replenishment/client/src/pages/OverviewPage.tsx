import { Link } from 'react-router';
import {
  Alert,
  AlertDescription,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useAnalyticsQuery,
} from '@databricks/appkit-ui/react';
import { ArrowRight } from 'lucide-react';
import { ChartCard } from '../components/ChartCard';
import { Delta } from '../components/Delta';
import { KpiCard } from '../components/KpiCard';
import { PageHeader } from '../components/PageHeader';
import { QueryStates } from '../components/QueryStates';
import { ScenarioChart } from '../components/ScenarioChart';
import { formatDate, formatDateTime, formatInt, formatPct, formatUsd, titleCase, toNumber } from '../lib/format';
import { useSummary } from '../lib/useSummary';
import { useNumeric } from '../lib/useNumeric';

const NO_PARAMS = {};
const usdK = (v: number) => `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}K`;

export function OverviewPage() {
  const { summary, error: summaryError, loading: summaryLoading } = useSummary();
  const kpiQuery = useAnalyticsQuery('overview_kpis', NO_PARAMS);
  const { loading: kpiLoading, error: kpiError } = kpiQuery;
  const kpiRows = useNumeric(kpiQuery.data);
  const trend = useAnalyticsQuery('weekly_sales_trend', NO_PARAMS);
  const trendRows = useNumeric(trend.data);
  const channels = useAnalyticsQuery('channel_scorecard', NO_PARAMS);
  const channelRows = useNumeric(channels.data);
  const kpi = kpiRows?.[0];

  const period = kpi ? `${formatDate(kpi.period_start)} – ${formatDate(kpi.period_end)}` : '…';
  const pending = summary ? toNumber(summary.lines_to_order) - toNumber(summary.decided_lines) : 0;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <PageHeader
        context={`All stores · last 13 weeks (${period}) vs last year`}
        title="Overview"
        actions={
          <Button asChild>
            <Link to="/orders">
              Review {pending > 0 ? `${formatInt(pending)} pending` : ''} orders <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        }
      />

      {kpiError && (
        <Alert variant="destructive">
          <AlertDescription>Could not load network KPIs: {kpiError}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard
          label="Net sales, last 13 weeks"
          loading={kpiLoading}
          value={kpi ? formatUsd(kpi.net_sales) : '—'}
          detail={kpi && <Delta current={kpi.net_sales} previous={kpi.net_sales_py} higherIsGood />}
          source="gold.channel_weekly_kpis"
        />
        <KpiCard
          label="Stockout days"
          loading={kpiLoading}
          value={kpi ? formatPct(kpi.stockout_rate) : '—'}
          detail={
            kpi && <Delta current={kpi.stockout_rate} previous={kpi.stockout_rate_py} higherIsGood={false} points />
          }
          source="gold.channel_weekly_kpis"
        />
        <KpiCard
          label="Waste (expiry + markdown)"
          loading={kpiLoading}
          value={kpi ? formatUsd(kpi.waste_value) : '—'}
          detail={
            kpi && (
              <>
                {formatPct(kpi.waste_rate)} of sales ·{' '}
                <Delta current={kpi.waste_rate} previous={kpi.waste_rate_py} higherIsGood={false} points />
              </>
            )
          }
          source="gold.channel_weekly_kpis"
        />
        <KpiCard
          label="Forecast error (WMAPE)"
          loading={kpiLoading}
          tone="good"
          value={kpi ? formatPct(kpi.model_wmape) : '—'}
          detail={kpi && `vs ${formatPct(kpi.baseline_wmape)} last-year baseline`}
          source="gold.forecast_accuracy"
        />
        <KpiCard
          label="Orders awaiting approval"
          loading={summaryLoading}
          tone={summary && pending === 0 ? 'good' : 'default'}
          value={summary ? `${formatInt(pending)} lines` : '—'}
          detail={
            summary && `${formatUsd(summary.order_value_at_cost)} at cost · ${formatInt(summary.decided_lines)} decided`
          }
          source={
            summary ? `Lakebase · loaded ${formatDateTime(summary.loaded_at)}` : 'Lakebase serving.recommendations'
          }
        />
      </div>
      {summaryError && <p className="text-sm text-destructive">Order recommendations unavailable: {summaryError}</p>}

      <ChartCard
        title="Weekly net sales"
        description="USD K · last 52 weeks · actual vs last year"
        source="gold.channel_weekly_kpis"
        askGenie="Which weeks in the last 52 had the biggest drop in net sales versus the same week last year, and why?"
      >
        <QueryStates loading={trend.loading} error={trend.error} empty={!trend.data?.length} rows={6} />
        {trendRows && trendRows.length > 0 && (
          <ScenarioChart rows={trendRows} formatValue={usdK} height={300} ariaLabel="Weekly net sales vs last year" />
        )}
      </ChartCard>

      <ChartCard
        title="Channel scorecard"
        description={`Last 13 weeks vs last year`}
        source="gold.channel_weekly_kpis"
        askGenie="Which channel lost the most sales to stockouts in the last 13 weeks, and in which region?"
      >
        <QueryStates loading={channels.loading} error={channels.error} empty={!channels.data?.length} rows={3} />
        {channelRows && channelRows.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel</TableHead>
                <TableHead className="text-right">Net sales</TableHead>
                <TableHead className="text-right">vs last year</TableHead>
                <TableHead className="text-right">Stockout days</TableHead>
                <TableHead className="text-right">vs last year</TableHead>
                <TableHead className="text-right">Waste % of sales</TableHead>
                <TableHead
                  className="text-right"
                  title="Store-SKU-weeks with 2+ out-of-stock days: sales understate demand"
                >
                  Censored weeks
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {channelRows.map((c) => (
                <TableRow key={c.channel}>
                  <TableCell className="font-medium">{titleCase(c.channel)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatUsd(c.net_sales)}</TableCell>
                  <TableCell className="text-right">
                    <Delta current={c.net_sales} previous={c.net_sales_py} higherIsGood suffix="" />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatPct(c.stockout_rate)}</TableCell>
                  <TableCell className="text-right">
                    <Delta
                      current={c.stockout_rate}
                      previous={c.stockout_rate_py}
                      higherIsGood={false}
                      points
                      suffix=""
                    />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatPct(c.waste_rate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPct(c.censored_share)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </ChartCard>
    </div>
  );
}
