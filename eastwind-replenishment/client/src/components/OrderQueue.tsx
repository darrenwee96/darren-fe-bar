import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Checkbox,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Spinner,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ToggleGroup,
  ToggleGroupItem,
} from '@databricks/appkit-ui/react';
import { Check, CheckCheck, ChevronLeft, ChevronRight, Gift, Layers, Search, Store, X } from 'lucide-react';
import {
  ApiError,
  fetchRecommendations,
  fetchRoutinePending,
  saveDecision,
  type ExceptionRules,
  type ListFilters,
  type RecommendationListRow,
  type Risk,
  type ScopeFilters,
  type Summary,
} from '../lib/api';
import { EXCEPTION_LABEL, exceptionDetail, exceptionRuleText } from '../lib/exceptions';
import { ALL } from '../lib/filters';
import { formatInt, formatPct, formatUsd, titleCase, toNumber } from '../lib/format';
import { orderReasons } from '../lib/reasons';
import { STOCK_STATUS } from '../lib/risk';
import { useAsync } from '../lib/useAsync';
import { cn } from '../lib/utils';
import { BulkAcceptDialog, type BulkRequest } from './BulkAcceptDialog';
import { Panel } from './Panel';
import { DecisionBadge, ExpiryBadge, NoOrderBadge, StockStatusBadge } from './StatusBadges';

const PAGE_SIZE = { EXCEPTIONS: 25, ROUTINE: 25, DECIDED: 25 } as const;
/** Adoption is not shown as a percentage until there are this many real decisions in scope. */
export const MIN_DECISIONS_FOR_ADOPTION = 20;
type View = keyof typeof PAGE_SIZE;

const lineLabel = (r: RecommendationListRow) => `${r.location_name} · ${r.sku_name}`;

/** Share of decided lines ordered from the forecast (accepted or adjusted), once the sample is big enough. */
function AdoptionStat({ summary }: { summary: Summary | null }) {
  if (!summary) return null;
  const decided = toNumber(summary.decided_lines);
  const fromForecast = toNumber(summary.accepted) + toNumber(summary.adjusted);
  return (
    <span
      className="tabular-nums"
      title="Accepted or adjusted ÷ decided lines · Lakebase replenishment.order_decisions"
    >
      Orders from forecast:{' '}
      {decided >= MIN_DECISIONS_FOR_ADOPTION ? (
        <span className="font-medium text-foreground">
          {formatPct(fromForecast / decided, 0)} of {formatInt(decided)} decided lines
        </span>
      ) : (
        <span>
          not enough decisions yet ({formatInt(decided)} of {MIN_DECISIONS_FOR_ADOPTION} needed)
        </span>
      )}
    </span>
  );
}

function ExceptionChips({ row, rules }: { row: RecommendationListRow; rules: ExceptionRules | null }) {
  if (row.exception_reasons.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {row.exception_reasons.map((reason) => (
        <Badge
          key={reason}
          variant="outline"
          className="whitespace-nowrap border-border bg-secondary/60 px-1.5 py-0 text-[11px] font-medium text-foreground"
          title={`${exceptionDetail(reason, row)}. Rule: ${exceptionRuleText(reason, rules)}.`}
        >
          {EXCEPTION_LABEL[reason]}
        </Badge>
      ))}
    </div>
  );
}

/** "1,330 routine lines · 180,518 units · $1.72M — Accept all" in one row. */
function RoutineSummary({
  summary,
  loadingItems,
  onReview,
  onAcceptAll,
}: {
  summary: Summary;
  loadingItems: boolean;
  onReview: () => void;
  onAcceptAll: () => void;
}) {
  const count = toNumber(summary.routine_pending);
  if (count === 0) return null;
  return (
    <div className="mx-5 mt-4 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-dashed bg-muted/50 px-4 py-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-card text-foreground shadow-card">
        <Layers className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground tabular-nums">
          {formatInt(count)} routine lines · {formatUsd(summary.routine_pending_value_at_cost)} at cost
        </p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {formatInt(summary.routine_pending_units)} units where no exception rule fired: the order follows the
          forecast, last year and recent sales
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onReview}>
          Review list
        </Button>
        <Button size="sm" onClick={onAcceptAll} disabled={loadingItems}>
          {loadingItems ? <Spinner className="mr-1.5 h-3.5 w-3.5" /> : <CheckCheck className="mr-1.5 h-4 w-4" />}
          Accept all routine
        </Button>
      </div>
    </div>
  );
}

export function OrderQueue({
  filters,
  summary,
  revision,
  rules,
  email,
  onOpen,
  onChanged,
}: {
  filters: ScopeFilters;
  summary: Summary | null;
  revision: number;
  rules: ExceptionRules | null;
  email: string | null;
  onOpen: (id: string) => void;
  onChanged: () => void;
}) {
  const [view, setView] = useState<View>('EXCEPTIONS');
  const [risk, setRisk] = useState<string>(ALL);
  const [peakOnly, setPeakOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [offset, setOffset] = useState(0);
  const [overrides, setOverrides] = useState<Record<string, Partial<RecommendationListRow>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null);
  const [selected, setSelected] = useState<Map<string, RecommendationListRow>>(new Map());
  const [bulk, setBulk] = useState<BulkRequest | null>(null);
  const [loadingRoutine, setLoadingRoutine] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  // Any filter change goes back to page 1 and drops the selection (it may no longer be visible).
  const filterKey = JSON.stringify({ filters, view, risk, peakOnly, debounced });
  useEffect(() => {
    setOffset(0);
    setSelected(new Map());
  }, [filterKey]);

  const pageSize = PAGE_SIZE[view];
  const listFilters: ListFilters = {
    ...filters,
    risk: risk === ALL ? undefined : (risk as Risk),
    status: view === 'DECIDED' ? 'DECIDED' : 'PENDING',
    segment: view === 'DECIDED' ? 'ALL' : view,
    search: debounced || undefined,
    peakOnly,
    actionableOnly: true,
    limit: pageSize,
    offset,
  };
  const { data, error, loading } = useAsync(`${filterKey}|${offset}|${revision}`, () =>
    fetchRecommendations(listFilters)
  );
  useEffect(() => setOverrides({}), [data]);

  const rows = useMemo(
    () => (data?.rows ?? []).map((r) => ({ ...r, ...overrides[r.recommendation_id] })),
    [data, overrides]
  );
  const total = data?.total ?? 0;
  const selectable = (r: RecommendationListRow) => !r.decision_status && toNumber(r.recommended_units) > 0;

  /** One-click accept with an optimistic row update; reverts and explains on conflict or failure. */
  async function accept(r: RecommendationListRow) {
    setBusy(r.recommendation_id);
    setNotice(null);
    const before = { decision_status: r.decision_status, version: r.version, final_order_units: r.final_order_units };
    setOverrides((o) => ({
      ...o,
      [r.recommendation_id]: { decision_status: 'ACCEPTED', final_order_units: r.recommended_units },
    }));
    try {
      const saved = await saveDecision(r.recommendation_id, {
        status: 'ACCEPTED',
        expectedVersion: r.version === null ? null : toNumber(r.version),
      });
      setOverrides((o) => ({ ...o, [r.recommendation_id]: { ...o[r.recommendation_id], version: saved.version } }));
      setNotice({
        tone: 'ok',
        text: `Accepted ${formatInt(r.recommended_units)} × ${r.sku_name} for ${r.location_name}.`,
      });
      setSelected((s) => {
        const next = new Map(s);
        next.delete(r.recommendation_id);
        return next;
      });
      onChanged();
    } catch (e) {
      setOverrides((o) => ({ ...o, [r.recommendation_id]: before }));
      const text =
        e instanceof ApiError && e.status === 409
          ? `${lineLabel(r)}: ${e.message}`
          : e instanceof Error
            ? e.message
            : 'Save failed';
      setNotice({ tone: 'error', text });
      if (e instanceof ApiError && e.status === 409) onChanged();
    } finally {
      setBusy(null);
    }
  }

  function toggle(r: RecommendationListRow, on: boolean) {
    setSelected((s) => {
      const next = new Map(s);
      if (on) next.set(r.recommendation_id, r);
      else next.delete(r.recommendation_id);
      return next;
    });
  }

  function acceptSelected() {
    const lines = [...selected.values()];
    const names = new Map(lines.map((r) => [r.recommendation_id, lineLabel(r)]));
    setBulk({
      kind: 'selected',
      items: lines.map((r) => ({
        id: r.recommendation_id,
        expectedVersion: r.version === null ? null : toNumber(r.version),
      })),
      units: lines.reduce((s, r) => s + toNumber(r.recommended_units), 0),
      valueAtCost: lines.reduce((s, r) => s + toNumber(r.recommended_units) * toNumber(r.unit_cost), 0),
      labelFor: (id) => names.get(id) ?? id,
    });
  }

  async function acceptAllRoutine() {
    setLoadingRoutine(true);
    setNotice(null);
    try {
      const routine = await fetchRoutinePending(filters);
      if (routine.count === 0) {
        setNotice({ tone: 'ok', text: 'No routine lines are left to accept here.' });
        onChanged();
        return;
      }
      setBulk({ kind: 'routine', items: routine.items, units: routine.units, valueAtCost: routine.valueAtCost });
    } catch (e) {
      setNotice({ tone: 'error', text: e instanceof Error ? e.message : 'Could not load routine lines' });
    } finally {
      setLoadingRoutine(false);
    }
  }

  const initialLoad = loading && !data;
  const grouped = view === 'EXCEPTIONS';
  const showSelect = view === 'EXCEPTIONS';
  const columns = showSelect ? 7 : 6;
  const selectedLines = [...selected.values()];
  const reviewCount = toNumber(summary?.exception_pending);
  const routineCount = toNumber(summary?.routine_pending);
  const decidedCount = toNumber(summary?.decided_lines);

  const meta =
    view === 'EXCEPTIONS'
      ? summary
        ? `${formatInt(reviewCount)} of ${formatInt(summary.lines_to_order)} lines need you · sorted by $ at risk, grouped by store`
        : 'Lines an exception rule flagged'
      : view === 'ROUTINE'
        ? 'Lines where no exception rule fired · accept one at a time or all at once'
        : 'Lines with a decision · by order need';

  return (
    <Panel
      title={view === 'EXCEPTIONS' ? 'Needs review' : view === 'ROUTINE' ? 'Routine lines' : 'Decided lines'}
      meta={meta}
      source={
        <span className="flex flex-wrap justify-between gap-x-4 gap-y-1">
          <span>Recommendations: Lakebase serving.recommendations · decisions + audit trail: replenishment.*</span>
          <AdoptionStat summary={summary} />
        </span>
      }
      bodyClassName="p-0"
      actions={
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={view}
          onValueChange={(v) => v && setView(v as View)}
          aria-label="Order lines to show"
        >
          <ToggleGroupItem value="EXCEPTIONS" className="px-3">
            Needs review
            {summary && <span className="ml-1.5 tabular-nums text-muted-foreground">{formatInt(reviewCount)}</span>}
          </ToggleGroupItem>
          <ToggleGroupItem value="ROUTINE" className="px-3">
            Routine
            {summary && <span className="ml-1.5 tabular-nums text-muted-foreground">{formatInt(routineCount)}</span>}
          </ToggleGroupItem>
          <ToggleGroupItem value="DECIDED" className="px-3">
            Decided
            {summary && <span className="ml-1.5 tabular-nums text-muted-foreground">{formatInt(decidedCount)}</span>}
          </ToggleGroupItem>
        </ToggleGroup>
      }
    >
      {view !== 'DECIDED' && summary && (
        <RoutineSummary
          summary={summary}
          loadingItems={loadingRoutine}
          onReview={() => setView('ROUTINE')}
          onAcceptAll={() => void acceptAllRoutine()}
        />
      )}

      <div className="flex flex-wrap items-center gap-3 px-5 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search store or product"
            className="h-8 w-56 pl-8"
            placeholder="Search store or product"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={risk} onValueChange={setRisk}>
          <SelectTrigger size="sm" className="w-[170px]" aria-label="Stock status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any stock status</SelectItem>
            {(['HIGH', 'MEDIUM', 'LOW'] as const).map((r) => (
              <SelectItem key={r} value={r}>
                {STOCK_STATUS[r].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Switch checked={peakOnly} onCheckedChange={setPeakOnly} aria-label="Peak gift SKUs only" />
          <Gift className="h-3.5 w-3.5" aria-hidden /> Peak gifts only
        </label>
        {selectedLines.length > 0 && (
          <div className="ml-auto flex items-center gap-2 rounded-lg bg-secondary px-3 py-1" role="status">
            <span className="text-xs font-medium text-foreground tabular-nums">
              {formatInt(selectedLines.length)} selected ·{' '}
              {formatInt(selectedLines.reduce((s, r) => s + toNumber(r.recommended_units), 0))} units
            </span>
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setSelected(new Map())}>
              <X className="mr-1 h-3.5 w-3.5" /> Clear
            </Button>
            <Button size="sm" className="h-7" onClick={acceptSelected}>
              <CheckCheck className="mr-1 h-3.5 w-3.5" /> Accept selected
            </Button>
          </div>
        )}
      </div>

      {notice && (
        <div className="px-5 pb-3">
          <Alert variant={notice.tone === 'error' ? 'destructive' : 'default'} className="py-2">
            <AlertDescription role="status">{notice.text}</AlertDescription>
          </Alert>
        </div>
      )}
      {error && (
        <div className="px-5 pb-3">
          <Alert variant="destructive" className="py-2">
            <AlertDescription>Could not load the order lines: {error}</AlertDescription>
          </Alert>
        </div>
      )}

      <div className={cn('overflow-x-auto border-t transition-opacity', loading && data && 'opacity-60')}>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              {showSelect && (
                <TableHead className="w-10 pl-5">
                  <span className="sr-only">Select</span>
                </TableHead>
              )}
              <TableHead className={cn(!showSelect && 'pl-5')}>
                {grouped ? 'Product · why it needs you' : 'Store · product'}
              </TableHead>
              <TableHead>Stock status</TableHead>
              <TableHead className="text-right">On hand + inbound</TableHead>
              <TableHead className="text-right">Order</TableHead>
              <TableHead
                className="text-right"
                title="Sales lost before the next delivery if not ordered, plus stock expected to expire"
              >
                $ at risk
              </TableHead>
              <TableHead className="pr-5 text-right">Decision</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialLoad &&
              Array.from({ length: 8 }, (_, i) => (
                <TableRow key={`s-${i}`}>
                  <TableCell colSpan={columns} className="px-5">
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))}
            {rows.map((r, i) => {
              const recommended = toNumber(r.recommended_units);
              const newStore = grouped && (i === 0 || rows[i - 1].location_id !== r.location_id);
              const storeRows = grouped ? rows.filter((x) => x.location_id === r.location_id && selectable(x)) : [];
              const storeAll = storeRows.length > 0 && storeRows.every((x) => selected.has(x.recommendation_id));
              const reasons = orderReasons(r.explanation_text);
              return (
                <Fragment key={r.recommendation_id}>
                  {newStore && (
                    <TableRow className="bg-muted/25 hover:bg-muted/25">
                      <TableCell className="pl-5">
                        <Checkbox
                          checked={storeAll}
                          disabled={storeRows.length === 0}
                          onCheckedChange={(v) => storeRows.forEach((x) => toggle(x, v === true))}
                          aria-label={`Select every pending line for ${r.location_name}`}
                        />
                      </TableCell>
                      <TableCell colSpan={columns - 1} className="py-2.5 pr-5">
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                          <span className="flex items-center gap-1.5 font-semibold text-foreground">
                            <Store className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                            {r.location_name}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {titleCase(r.channel_type)} · {r.region}
                          </span>
                          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                            {formatInt(r.store_lines)} {toNumber(r.store_lines) === 1 ? 'line' : 'lines'} ·{' '}
                            <span className="font-semibold text-foreground">{formatUsd(r.store_at_risk)}</span> at risk
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                  <TableRow
                    className="group cursor-pointer"
                    data-state={selected.has(r.recommendation_id) ? 'selected' : undefined}
                    onClick={() => onOpen(r.recommendation_id)}
                  >
                    {showSelect && (
                      <TableCell className="pl-5 align-top" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selected.has(r.recommendation_id)}
                          disabled={!selectable(r)}
                          onCheckedChange={(v) => toggle(r, v === true)}
                          aria-label={`Select ${r.sku_name} for ${r.location_name}`}
                          className="mt-0.5"
                        />
                      </TableCell>
                    )}
                    <TableCell className={cn('max-w-[420px] align-top', !showSelect && 'pl-5')}>
                      {!grouped && <div className="text-xs font-medium text-muted-foreground">{r.location_name}</div>}
                      <div className="flex items-center gap-1.5 font-medium text-foreground">
                        <span className="truncate">{r.sku_name}</span>
                        {r.peak_gift_flag && (
                          <Gift className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Peak gift SKU" />
                        )}
                      </div>
                      <div className="mt-1 space-y-1">
                        <ExceptionChips row={r} rules={rules} />
                        <p className="truncate text-xs text-muted-foreground" title={reasons.join(' · ')}>
                          {reasons[0] ?? r.category}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex flex-col items-start gap-1">
                        <StockStatusBadge risk={r.stockout_risk} />
                        <ExpiryBadge risk={r.overstock_risk} />
                      </div>
                    </TableCell>
                    <TableCell className="text-right align-top tabular-nums text-muted-foreground">
                      {formatInt(r.on_hand_units)} + {formatInt(r.inbound_units)}
                    </TableCell>
                    <TableCell className="text-right align-top tabular-nums">
                      <div className="font-semibold text-foreground">{formatInt(recommended)}</div>
                      {r.cap_applied === 'SHELF_LIFE' && (
                        <div className="text-[11px] text-muted-foreground">shelf-life cap</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right align-top font-medium tabular-nums text-foreground">
                      {toNumber(r.at_risk) > 0 ? formatUsd(r.at_risk) : '—'}
                    </TableCell>
                    <TableCell className="pr-5 text-right align-top" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        {r.decision_status ? (
                          <>
                            <DecisionBadge status={r.decision_status} />
                            {r.decision_source === 'bulk' && (
                              <span className="text-[11px] text-muted-foreground">bulk</span>
                            )}
                            {r.decision_status === 'ADJUSTED' && (
                              <span className="text-xs tabular-nums text-muted-foreground">
                                {formatInt(r.final_order_units)}
                              </span>
                            )}
                          </>
                        ) : recommended > 0 ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2.5"
                              disabled={busy !== null}
                              onClick={() => void accept(r)}
                              aria-label={`Accept ${formatInt(recommended)} units of ${r.sku_name} for ${r.location_name}`}
                            >
                              <Check className="mr-1 h-3.5 w-3.5" /> Accept
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={() => onOpen(r.recommendation_id)}
                              aria-label={`Review ${r.sku_name} for ${r.location_name}`}
                              title="Review, adjust or reject"
                            >
                              <ChevronRight className="h-4 w-4" />
                            </Button>
                          </>
                        ) : (
                          <NoOrderBadge />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {data && rows.length === 0 && !error && (
        <Empty className="py-12">
          <EmptyHeader>
            <EmptyTitle>
              {view === 'EXCEPTIONS'
                ? 'Nothing needs your review'
                : view === 'ROUTINE'
                  ? 'No routine lines left'
                  : 'No decisions yet'}
            </EmptyTitle>
            <EmptyDescription>
              {view === 'EXCEPTIONS'
                ? routineCount > 0
                  ? 'No line here trips an exception rule. Accept the routine lines above in one step.'
                  : 'Every line in this selection has a decision, or a filter hides the rest.'
                : view === 'ROUTINE'
                  ? 'Every routine line in this selection has a decision.'
                  : 'Decisions you and other planners save appear here with their audit trail.'}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      <div className="flex items-center justify-between border-t px-5 py-2.5 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {total > 0
            ? `${formatInt(offset + 1)}–${formatInt(Math.min(offset + pageSize, total))} of ${formatInt(total)}`
            : ''}
        </span>
        <div className="flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - pageSize))}
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Prev
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7"
            disabled={offset + pageSize >= total}
            onClick={() => setOffset(offset + pageSize)}
          >
            Next <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <BulkAcceptDialog
        request={bulk}
        email={email}
        onClose={() => setBulk(null)}
        onDone={() => {
          setSelected(new Map());
          onChanged();
        }}
      />
    </Panel>
  );
}
