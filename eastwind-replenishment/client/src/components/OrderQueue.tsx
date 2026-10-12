import { useEffect, useState } from 'react';
import {
  Alert,
  AlertDescription,
  Button,
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
import { Check, ChevronLeft, ChevronRight, Gift, Search } from 'lucide-react';
import {
  ApiError,
  fetchRecommendations,
  saveDecision,
  type ListFilters,
  type RecommendationRow,
  type Risk,
  type ScopeFilters,
} from '../lib/api';
import { ALL } from '../lib/filters';
import { formatInt, formatUsd, titleCase, toNumber } from '../lib/format';
import { STOCK_STATUS } from '../lib/risk';
import { useAsync } from '../lib/useAsync';
import { cn } from '../lib/utils';
import { Panel } from './Panel';
import { DecisionBadge, ExpiryBadge, NoOrderBadge, StockStatusBadge } from './StatusBadges';

const PAGE_SIZE = 25;
type View = 'PENDING' | 'DECIDED' | 'ALL';

export function OrderQueue({
  filters,
  revision,
  onOpen,
  onChanged,
  noScope = false,
}: {
  filters: ScopeFilters;
  revision: number;
  /** The caller has no planning scope: explain that instead of "nothing to decide". */
  noScope?: boolean;
  onOpen: (id: string) => void;
  onChanged: () => void;
}) {
  const [view, setView] = useState<View>('PENDING');
  const [risk, setRisk] = useState<string>(ALL);
  const [peakOnly, setPeakOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [offset, setOffset] = useState(0);
  const [overrides, setOverrides] = useState<Record<string, Partial<RecommendationRow>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  // Any filter change goes back to page 1.
  const filterKey = JSON.stringify({ filters, view, risk, peakOnly, debounced });
  useEffect(() => setOffset(0), [filterKey]);

  const listFilters: ListFilters = {
    ...filters,
    risk: risk === ALL ? undefined : (risk as Risk),
    status: view === 'ALL' ? undefined : view,
    search: debounced || undefined,
    peakOnly,
    actionableOnly: true,
    limit: PAGE_SIZE,
    offset,
  };
  const { data, error, loading } = useAsync(`${filterKey}|${offset}|${revision}`, () =>
    fetchRecommendations(listFilters)
  );
  useEffect(() => setOverrides({}), [data]);

  const rows = (data?.rows ?? []).map((r) => ({ ...r, ...overrides[r.recommendation_id] }));
  const total = data?.total ?? 0;

  /** One-click accept with an optimistic row update; reverts and explains on conflict or failure. */
  async function accept(r: RecommendationRow) {
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
      onChanged();
    } catch (e) {
      setOverrides((o) => ({ ...o, [r.recommendation_id]: before }));
      const text =
        e instanceof ApiError && e.status === 409
          ? `${r.location_name} · ${r.sku_name}: ${e.message}`
          : e instanceof Error
            ? e.message
            : 'Save failed';
      setNotice({ tone: 'error', text });
      if (e instanceof ApiError && e.status === 409) onChanged();
    } finally {
      setBusy(null);
    }
  }

  const initialLoad = loading && !data;

  return (
    <Panel
      title="Order queue"
      meta={
        data
          ? `${formatInt(total)} lines needing attention · by order need, then sales lost if not ordered`
          : 'Store-SKU order recommendations'
      }
      source="Recommendations: Lakebase serving.recommendations · decisions + audit trail: Lakebase replenishment.*"
      bodyClassName="p-0"
      actions={
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={view}
          onValueChange={(v) => v && setView(v as View)}
          aria-label="Decision filter"
        >
          <ToggleGroupItem value="PENDING" className="px-3">
            Pending
          </ToggleGroupItem>
          <ToggleGroupItem value="DECIDED" className="px-3">
            Decided
          </ToggleGroupItem>
          <ToggleGroupItem value="ALL" className="px-3">
            All
          </ToggleGroupItem>
        </ToggleGroup>
      }
    >
      <div className="flex flex-wrap items-center gap-3 border-b px-5 py-2.5">
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
      </div>

      {notice && (
        <div className="px-5 pt-3">
          <Alert variant={notice.tone === 'error' ? 'destructive' : 'default'} className="py-2">
            <AlertDescription role="status">{notice.text}</AlertDescription>
          </Alert>
        </div>
      )}
      {error && (
        <div className="px-5 pt-3">
          <Alert variant="destructive" className="py-2">
            <AlertDescription>Could not load the order queue: {error}</AlertDescription>
          </Alert>
        </div>
      )}

      <div className={cn('overflow-x-auto transition-opacity', loading && data && 'opacity-60')}>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="pl-5">Store</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>Stock status</TableHead>
              <TableHead className="text-right">On hand + inbound</TableHead>
              <TableHead className="text-right">Order</TableHead>
              <TableHead
                className="text-right"
                title="Estimated sales lost before the next delivery if no order is placed"
              >
                Lost if not ordered
              </TableHead>
              <TableHead className="pr-5 text-right">Decision</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialLoad &&
              Array.from({ length: 10 }, (_, i) => (
                <TableRow key={`s-${i}`}>
                  <TableCell colSpan={7} className="px-5">
                    <Skeleton className="h-7 w-full" />
                  </TableCell>
                </TableRow>
              ))}
            {rows.map((r) => {
              const recommended = toNumber(r.recommended_units);
              return (
                <TableRow
                  key={r.recommendation_id}
                  className="group cursor-pointer"
                  onClick={() => onOpen(r.recommendation_id)}
                >
                  <TableCell className="pl-5 align-top">
                    <div className="font-medium text-foreground">{r.location_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {titleCase(r.channel_type)} · {r.region}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[260px] align-top">
                    <div className="flex items-center gap-1.5 text-foreground">
                      <span className="truncate">{r.sku_name}</span>
                      {r.peak_gift_flag && (
                        <Gift className="h-3.5 w-3.5 shrink-0 text-primary" aria-label="Peak gift SKU" />
                      )}
                    </div>
                    <div className="truncate text-xs text-muted-foreground" title={r.explanation_text ?? undefined}>
                      {r.explanation_text || r.category}
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
                  <TableCell className="text-right align-top tabular-nums">
                    {toNumber(r.est_lost_sales_if_no_order) > 0 ? formatUsd(r.est_lost_sales_if_no_order) : '—'}
                  </TableCell>
                  <TableCell className="pr-5 text-right align-top" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1.5">
                      {r.decision_status ? (
                        <>
                          <DecisionBadge status={r.decision_status} />
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
              );
            })}
          </TableBody>
        </Table>
      </div>

      {data && rows.length === 0 && !error && (
        <Empty className="py-12">
          <EmptyHeader>
            <EmptyTitle>
              {noScope
                ? 'No stores in your scope'
                : view === 'PENDING'
                  ? 'Nothing left to decide here'
                  : 'No lines match'}
            </EmptyTitle>
            <EmptyDescription>
              {noScope
                ? 'Order lines appear once a region or store is assigned to you.'
                : view === 'PENDING'
                  ? 'Every order line in this scope has a decision. Switch to Decided to review them, or widen the filters.'
                  : 'Clear a filter or the search to see more store-SKUs.'}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      <div className="flex items-center justify-between border-t px-5 py-2.5 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {total > 0
            ? `${formatInt(offset + 1)}–${formatInt(Math.min(offset + PAGE_SIZE, total))} of ${formatInt(total)}`
            : ''}
        </span>
        <div className="flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Prev
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Next <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </Panel>
  );
}
