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
import { Check, CircleAlert, Gift, History, Layers, PencilLine, Store, X } from 'lucide-react';
import {
  ApiError,
  fetchRecommendation,
  saveDecision,
  type DecisionEvent,
  type DecisionStatus,
  type ExceptionRules,
  type RecommendationDetail,
} from '../lib/api';
import { coverWeeks, EXCEPTION_LABEL, exceptionDetail, exceptionRuleText } from '../lib/exceptions';
import { orderReasons, shortEventName } from '../lib/reasons';
import { formatDate, formatDateTime, formatInt, formatUsd, titleCase, toNumber } from '../lib/format';
import { STOCK_STATUS } from '../lib/risk';
import { useNumeric } from '../lib/useNumeric';
import { ScenarioChart } from './ScenarioChart';
import { DecisionBadge, ExpiryBadge, StockStatusBadge } from './StatusBadges';

interface Props {
  recommendationId: string | null;
  rules: ExceptionRules | null;
  onClose: () => void;
  onSaved: () => void;
  /** Drill the whole control panel down to this store. */
  onFocusStore: (locationId: string) => void;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-muted/50 px-3 py-2" title={hint}>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

/** Weekly units for one store-SKU (actual, latest-run forecast with p90 band, last year) and the forecast table. */
function SkuForecast({ locationId, skuId }: { locationId: string; skuId: string }) {
  const params = useMemo(
    () => ({
      region: sql.string('ALL'),
      channel: sql.string('ALL'),
      category: sql.string('ALL'),
      location_id: sql.string(locationId),
      sku_id: sql.string(skuId),
    }),
    [locationId, skuId]
  );
  const query = useAnalyticsQuery('forecast_vs_actual', params);
  const rows = useNumeric(query.data);
  if (query.loading && !rows) return <Skeleton className="h-60 w-full" />;
  if (query.error) return <p className="text-sm text-destructive">Could not load weekly units: {query.error}</p>;
  if (!rows || rows.length === 0)
    return <p className="text-sm text-muted-foreground">No sales history or forecast for this store-SKU.</p>;
  const forecast = rows.filter((r) => r.actual === null);
  return (
    <div className="space-y-3">
      <ScenarioChart rows={rows} height={230} ariaLabel="Weekly units: actual, forecast with p90 band, last year" />
      {forecast.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Week of</TableHead>
              <TableHead className="text-right">Expected</TableHead>
              <TableHead className="text-right">p90 (plan for)</TableHead>
              <TableHead className="text-right">Last year</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {forecast.map((r) => (
              <TableRow key={r.week_start}>
                <TableCell>
                  {formatDate(r.week_start)}
                  {r.festival && (
                    <span className="ml-1.5 text-xs text-muted-foreground">{shortEventName(r.festival)}</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatInt(r.forecast)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatInt(r.p90)}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {formatInt(r.last_year)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function AuditTrail({ events }: { events: DecisionEvent[] }) {
  return (
    <ol className="relative space-y-3 border-l pl-4">
      {events.map((ev) => (
        <li key={ev.event_id} className="text-sm">
          <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-primary" />
          <div className="flex flex-wrap items-center gap-x-2 text-foreground">
            <DecisionBadge status={ev.new_status} />
            {ev.decision_source === 'bulk' && <span className="text-[11px] text-muted-foreground">bulk accept</span>}
            <span className="tabular-nums">
              {ev.previous_status ? `${formatInt(ev.previous_units)} → ` : ''}
              {formatInt(ev.new_units)} units
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {ev.changed_by} · {formatDateTime(ev.changed_at)}
            {ev.reason ? ` · “${ev.reason}”` : ''}
          </p>
        </li>
      ))}
    </ol>
  );
}

export function RecommendationSheet({ recommendationId, rules, onClose, onSaved, onFocusStore }: Props) {
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
      const text = e instanceof Error ? e.message : 'Save failed';
      setMessage({ tone: 'error', text });
      if (e instanceof ApiError && e.status === 409) load(detail.recommendation_id);
    } finally {
      setSaving(false);
    }
  }

  const leadWeeks = detail ? coverWeeks(detail.lead_time_days) : 0;
  const reasons = orderReasons(detail?.explanation_text);

  return (
    <Sheet open={recommendationId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="border-b">
          <div className="flex items-center gap-2 pr-6">
            <SheetTitle className="text-lg">{detail ? detail.sku_name : 'Order line'}</SheetTitle>
            {detail?.peak_gift_flag && <Gift className="h-4 w-4 text-primary" aria-label="Peak gift SKU" />}
          </div>
          <SheetDescription>
            {detail
              ? `${detail.location_name} · ${titleCase(detail.channel_type)} · ${detail.region} · ${detail.category}`
              : 'Loading…'}
          </SheetDescription>
          {detail && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <StockStatusBadge risk={detail.stockout_risk} />
              <ExpiryBadge risk={detail.overstock_risk} />
              <DecisionBadge status={detail.decision_status} />
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-7 text-muted-foreground"
                onClick={() => onFocusStore(detail.location_id)}
              >
                <Store className="mr-1 h-3.5 w-3.5" /> Focus panel on this store
              </Button>
            </div>
          )}
        </SheetHeader>

        <div className="space-y-6 p-4">
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
              <section className="rounded-xl border bg-gradient-to-br from-primary/5 to-transparent p-4">
                <p className="text-xs font-medium text-muted-foreground">Recommended order</p>
                <p className="text-3xl font-semibold tabular-nums tracking-tight text-foreground">
                  {formatInt(detail.recommended_units)} <span className="text-base font-normal">units</span>
                </p>
                {reasons.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-sm text-foreground">
                    {reasons.map((reason, i) => (
                      <li key={reason} className={i === 0 ? 'font-medium' : undefined}>
                        {reason}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-foreground">
                    Stock covers expected demand; no change from the usual pattern.
                  </p>
                )}
                <p className="mt-3 text-xs text-muted-foreground">
                  {STOCK_STATUS[detail.stockout_risk].hint}. Model v{detail.model_version} · refreshed{' '}
                  {formatDateTime(detail.refreshed_at)}
                </p>
              </section>

              {toNumber(detail.recommended_units) > 0 &&
                (detail.exception_reasons.length > 0 ? (
                  <section className="space-y-2 rounded-xl border p-4">
                    <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                      <CircleAlert className="h-4 w-4 text-destructive" aria-hidden /> Why this line needs you
                    </h3>
                    <ul className="space-y-1.5 text-sm">
                      {detail.exception_reasons.map((reason) => (
                        <li key={reason} title={exceptionRuleText(reason, rules)}>
                          <span className="font-medium text-foreground">{EXCEPTION_LABEL[reason]}</span>
                          <span className="text-muted-foreground"> · {exceptionDetail(reason, detail)}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : (
                  <p className="flex items-center gap-1.5 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
                    <Layers className="h-4 w-4" aria-hidden /> Routine line: no exception rule fired, so it can be
                    accepted with the other routine lines.
                  </p>
                ))}

              <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="On hand" value={formatInt(detail.on_hand_units)} />
                <Stat label="Inbound" value={formatInt(detail.inbound_units)} />
                <Stat label={`Demand over ${leadWeeks} wk`} value={formatInt(detail.demand_cover_units)} />
                <Stat label="Safety stock" value={formatInt(detail.safety_units)} />
                <Stat label="Recent weekly sales" value={formatInt(detail.recent_weekly_units)} />
                <Stat
                  label="Last year, same weeks"
                  value={detail.last_year_cover_units == null ? '—' : formatInt(detail.last_year_cover_units)}
                  hint={`Units sold last year in the same ${leadWeeks} weeks relative to the festival`}
                />
                <Stat label="Lead time" value={`${formatInt(detail.lead_time_days)} days`} />
                <Stat label="Shelf life" value={`${formatInt(detail.shelf_life_days)} days`} />
                <Stat label="Case pack" value={`${formatInt(detail.case_pack_units)} units`} />
                <Stat
                  label="Lost if not ordered"
                  value={formatUsd(detail.est_lost_sales_if_no_order)}
                  hint="Estimated sales lost before the next delivery if no order is placed"
                />
                <Stat label="Expected to expire" value={formatUsd(detail.est_expiry_value)} />
                <Stat
                  label="Order value at cost"
                  value={formatUsd(toNumber(detail.recommended_units) * toNumber(detail.unit_cost))}
                />
              </section>

              <section className="space-y-2">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Forecast vs actual</h3>
                  <p className="text-xs text-muted-foreground">
                    Weekly units · this store-SKU · forecast from {formatDate(detail.as_of_date)}, latest run
                  </p>
                </div>
                <SkuForecast locationId={detail.location_id} skuId={detail.sku_id} />
              </section>

              <Separator />

              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">Decision</h3>
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
                    <Check className="mr-1 h-4 w-4" /> Accept {formatInt(detail.recommended_units)}
                  </Button>
                  <Button variant="secondary" disabled={saving} onClick={() => void decide('ADJUSTED')}>
                    <PencilLine className="mr-1 h-4 w-4" /> Save adjusted quantity
                  </Button>
                  <Button variant="outline" disabled={saving} onClick={() => void decide('REJECTED')}>
                    <X className="mr-1 h-4 w-4" /> Reject
                  </Button>
                </div>
                {message && (
                  <Alert variant={message.tone === 'error' ? 'destructive' : 'default'} className="py-2">
                    <AlertDescription role="status">{message.text}</AlertDescription>
                  </Alert>
                )}
                {detail.decided_by && (
                  <p className="text-xs text-muted-foreground">
                    Last decision by {detail.decided_by} · {formatDateTime(detail.decided_at)} · version{' '}
                    {formatInt(detail.version)}
                  </p>
                )}
              </section>

              {events.length > 0 && (
                <section className="space-y-3">
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                    <History className="h-4 w-4" aria-hidden /> Audit trail
                  </h3>
                  <AuditTrail events={events} />
                  <p className="text-[11px] text-muted-foreground">
                    Lakebase replenishment.decision_events (append-only)
                  </p>
                </section>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
