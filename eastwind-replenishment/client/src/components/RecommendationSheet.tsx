import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AlertDescription,
  Button,
  Input,
  Label,
  Separator,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  useAnalyticsQuery,
} from '@databricks/appkit-ui/react';
import { sql } from '@databricks/appkit-ui/js';
import {
  ApiError,
  fetchRecommendation,
  saveDecision,
  type DecisionEvent,
  type DecisionStatus,
  type RecommendationDetail,
} from '../lib/api';
import { formatDate, formatDateTime, formatInt, formatUsd, titleCase, toNumber } from '../lib/format';
import { RiskBadge, StatusBadge } from './RiskBadge';
import { ScenarioChart } from './ScenarioChart';
import { useNumeric } from '../lib/useNumeric';

interface Props {
  recommendationId: string | null;
  onClose: () => void;
  onSaved: () => void;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function ForecastTable({
  parameters,
}: {
  parameters: { location_id: ReturnType<typeof sql.string>; sku_id: ReturnType<typeof sql.string> };
}) {
  const { data, loading, error } = useAnalyticsQuery('sku_forecast', parameters);
  if (loading) return <Skeleton className="h-32 w-full" />;
  if (error) return <p className="text-sm text-destructive">Could not load the forecast: {error}</p>;
  if (!data || data.length === 0)
    return <p className="text-sm text-muted-foreground">No forecast for this store-SKU.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Forecast week</TableHead>
          <TableHead className="text-right">Expected</TableHead>
          <TableHead className="text-right">p90 (plan for)</TableHead>
          <TableHead className="text-right">Same week last year</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((r) => (
          <TableRow key={r.week}>
            <TableCell>{formatDate(r.week)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatInt(r.expected)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatInt(r.p90)}</TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">{formatInt(r.last_year)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function SkuWeeklyChart({
  parameters,
}: {
  parameters: { location_id: ReturnType<typeof sql.string>; sku_id: ReturnType<typeof sql.string> };
}) {
  const query = useAnalyticsQuery('sku_weekly', parameters);
  const { loading, error } = query;
  const data = useNumeric(query.data);
  if (loading) return <Skeleton className="h-60 w-full" />;
  if (error) return <p className="text-sm text-destructive">Could not load weekly units: {error}</p>;
  if (!data || data.length === 0)
    return <p className="text-sm text-muted-foreground">No sales history for this store-SKU.</p>;
  return <ScenarioChart rows={data} height={240} ariaLabel="Weekly units, actual, forecast and last year" />;
}

export function RecommendationSheet({ recommendationId, onClose, onSaved }: Props) {
  const [detail, setDetail] = useState<RecommendationDetail | null>(null);
  const [events, setEvents] = useState<DecisionEvent[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [units, setUnits] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null);

  const load = useCallback((id: string) => {
    setLoadError(null);
    fetchRecommendation(id)
      .then(({ recommendation, events: history }) => {
        setDetail(recommendation);
        setEvents(history);
        setUnits(String(toNumber(recommendation.final_order_units ?? recommendation.recommended_units)));
        setReason(recommendation.reason ?? '');
      })
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  useEffect(() => {
    setDetail(null);
    setEvents([]);
    setMessage(null);
    if (recommendationId) load(recommendationId);
  }, [recommendationId, load]);

  const chartParams = useMemo(
    () => (detail ? { location_id: sql.string(detail.location_id), sku_id: sql.string(detail.sku_id) } : null),
    [detail]
  );

  async function decide(status: DecisionStatus) {
    if (!detail) return;
    const recommended = toNumber(detail.recommended_units);
    const parsedUnits = Number.parseInt(units, 10);
    if (status === 'ADJUSTED' && (Number.isNaN(parsedUnits) || parsedUnits < 0)) {
      setMessage({ tone: 'error', text: 'Enter the order quantity you want to place.' });
      return;
    }
    if (status === 'ADJUSTED' && parsedUnits === recommended) {
      setMessage({ tone: 'error', text: 'The quantity matches the recommendation; use Accept instead.' });
      return;
    }
    if ((status === 'ADJUSTED' || status === 'REJECTED') && !reason.trim()) {
      setMessage({ tone: 'error', text: 'Add a short reason so planners can learn from the override.' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await saveDecision(detail.recommendation_id, {
        status,
        finalUnits: status === 'ADJUSTED' ? parsedUnits : undefined,
        reason: reason.trim() || undefined,
        expectedVersion: detail.version === null ? null : toNumber(detail.version),
      });
      setMessage({ tone: 'ok', text: `Saved: ${titleCase(status)}.` });
      load(detail.recommendation_id);
      onSaved();
    } catch (e) {
      const text =
        e instanceof ApiError && e.status === 409 ? `${e.message}` : e instanceof Error ? e.message : 'Save failed';
      setMessage({ tone: 'error', text });
      if (e instanceof ApiError && e.status === 409) load(detail.recommendation_id);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={recommendationId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{detail ? `${detail.sku_name}` : 'Recommendation'}</SheetTitle>
          <SheetDescription>
            {detail
              ? `${detail.location_name} · ${titleCase(detail.channel_type)} · ${detail.region} region`
              : 'Loading…'}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-6">
          {loadError && (
            <Alert variant="destructive">
              <AlertDescription>{loadError}</AlertDescription>
            </Alert>
          )}
          {!detail && !loadError && (
            <div className="space-y-3">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-48 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}

          {detail && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">Stockout</span>
                <RiskBadge risk={detail.stockout_risk} label="Stockout" />
                <span className="ml-2 text-sm text-muted-foreground">Overstock</span>
                <RiskBadge risk={detail.overstock_risk} label="Overstock" />
                <span className="ml-2 text-sm text-muted-foreground">Decision</span>
                <StatusBadge status={detail.decision_status} />
              </div>

              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Recommended order</p>
                <p className="text-2xl font-semibold tabular-nums text-foreground">
                  {formatInt(detail.recommended_units)} units
                </p>
                <p className="text-sm text-foreground">
                  {detail.explanation_text || 'Stock covers expected demand; no change from the usual pattern.'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Main forecast driver: {detail.top_driver} · model v{detail.model_version} · refreshed{' '}
                  {formatDateTime(detail.refreshed_at)}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="On hand" value={formatInt(detail.on_hand_units)} />
                <Stat label="Inbound" value={formatInt(detail.inbound_units)} />
                <Stat
                  label={`Demand over ${Math.floor(toNumber(detail.lead_time_days) / 7) + 1} wk`}
                  value={formatInt(detail.demand_cover_units)}
                />
                <Stat label="Safety stock" value={formatInt(detail.safety_units)} />
                <Stat label="Recent weekly sales" value={formatInt(detail.recent_weekly_units)} />
                <Stat label="Lead time" value={`${formatInt(detail.lead_time_days)} days`} />
                <Stat label="Shelf life" value={`${formatInt(detail.shelf_life_days)} days`} />
                <Stat label="Case pack" value={`${formatInt(detail.case_pack_units)} units`} />
                <Stat label="Sales at risk if not ordered" value={formatUsd(detail.est_lost_sales_if_no_order)} />
                <Stat label="Stock expected to expire" value={formatUsd(detail.est_expiry_value)} />
                <Stat label="Cap applied" value={detail.cap_applied === 'SHELF_LIFE' ? 'Shelf life' : 'None'} />
                <Stat
                  label="Order value at cost"
                  value={formatUsd(toNumber(detail.recommended_units) * toNumber(detail.unit_cost))}
                />
              </div>

              <div>
                <p className="text-sm font-medium text-foreground">
                  Weekly units: 26 weeks actual, then the 6-week forecast from {formatDate(detail.as_of_date)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Actual from gold.weekly_demand_features, forecast (dashed) from gold.demand_forecasts; last year =
                  same calendar week
                </p>
                {chartParams && <SkuWeeklyChart parameters={chartParams} />}
                {chartParams && <ForecastTable parameters={chartParams} />}
              </div>

              <Separator />

              <div className="space-y-3">
                <p className="text-sm font-medium text-foreground">Your decision</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="space-y-1">
                    <Label htmlFor="order-units">Order quantity (units)</Label>
                    <Input
                      id="order-units"
                      type="number"
                      min={0}
                      step={toNumber(detail.case_pack_units)}
                      value={units}
                      onChange={(e) => setUnits(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label htmlFor="order-reason">Reason (required to adjust or reject)</Label>
                    <Textarea
                      id="order-reason"
                      rows={2}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="e.g. Local event this weekend"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={saving} onClick={() => void decide('ACCEPTED')}>
                    Accept {formatInt(detail.recommended_units)}
                  </Button>
                  <Button variant="secondary" disabled={saving} onClick={() => void decide('ADJUSTED')}>
                    Save adjusted quantity
                  </Button>
                  <Button variant="outline" disabled={saving} onClick={() => void decide('REJECTED')}>
                    Reject
                  </Button>
                </div>
                {message && (
                  <p
                    className={`text-sm ${message.tone === 'error' ? 'text-destructive' : 'text-success'}`}
                    role="status"
                  >
                    {message.text}
                  </p>
                )}
                {detail.decided_by && (
                  <p className="text-xs text-muted-foreground">
                    Last decision by {detail.decided_by} · {formatDateTime(detail.decided_at)} · version{' '}
                    {formatInt(detail.version)}
                  </p>
                )}
              </div>

              {events.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">
                    Audit trail (Lakebase replenishment.decision_events)
                  </p>
                  <ul className="space-y-1 text-sm">
                    {events.map((ev) => (
                      <li key={ev.event_id} className="text-muted-foreground">
                        {formatDateTime(ev.changed_at)} · {ev.changed_by}:{' '}
                        {ev.previous_status
                          ? `${titleCase(ev.previous_status)} ${formatInt(ev.previous_units)} → `
                          : ''}
                        {titleCase(ev.new_status)} {formatInt(ev.new_units)}
                        {ev.reason ? ` ("${ev.reason}")` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
