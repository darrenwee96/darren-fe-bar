import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Input,
  Label,
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
} from '@databricks/appkit-ui/react';
import { AlertTriangle } from 'lucide-react';
import { fetchRecommendations, type ListFilters, type RecommendationRow, type Risk } from '../lib/api';
import { formatDate, formatInt, formatUsd, titleCase } from '../lib/format';
import { RecommendationSheet } from '../components/RecommendationSheet';
import { RiskBadge, StatusBadge } from '../components/RiskBadge';
import { useSummary } from '../lib/useSummary';

const PAGE_SIZE = 25;
const ALL = 'ALL';

function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function RecommendationsPage() {
  const { summary, reload: reloadSummary } = useSummary();
  const [region, setRegion] = useState(ALL);
  const [channel, setChannel] = useState(ALL);
  const [risk, setRisk] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [search, setSearch] = useState('');
  const [actionableOnly, setActionableOnly] = useState(true);
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<RecommendationRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(() => {
    const filters: ListFilters = {
      region: region === ALL ? undefined : region,
      channel: channel === ALL ? undefined : channel,
      risk: risk === ALL ? undefined : (risk as Risk),
      status: status === ALL ? undefined : (status as ListFilters['status']),
      search: search.trim() || undefined,
      actionableOnly,
      limit: PAGE_SIZE,
      offset,
    };
    setRows(null);
    fetchRecommendations(filters)
      .then((r) => {
        setRows(r.rows);
        setTotal(r.total);
        setError(null);
      })
      .catch((e: Error) => {
        setRows([]);
        setError(e.message);
      });
  }, [region, channel, risk, status, search, actionableOnly, offset]);

  useEffect(() => {
    const t = setTimeout(load, 250); // debounce typing in the search box
    return () => clearTimeout(t);
  }, [load]);

  const resetPage =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setOffset(0);
    };

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold text-foreground">Order approval</h2>
        <p className="text-sm text-muted-foreground">
          {summary
            ? `Order week of ${formatDate(summary.as_of_date)} · sorted by stockout risk, then sales at risk · ${formatInt(summary.decided_lines)} of ${formatInt(summary.lines_to_order)} order lines decided`
            : 'Loading…'}
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 pt-6">
          <div className="space-y-1">
            <Label htmlFor="search">Store or product</Label>
            <Input
              id="search"
              className="w-56"
              placeholder="e.g. Zhongshan, Mooncake"
              value={search}
              onChange={(e) => resetPage(setSearch)(e.target.value)}
            />
          </div>
          <FilterSelect
            id="region"
            label="Region"
            value={region}
            onChange={resetPage(setRegion)}
            options={['North', 'Central', 'South', 'East'].map((r) => ({ value: r, label: r }))}
          />
          <FilterSelect
            id="channel"
            label="Channel"
            value={channel}
            onChange={resetPage(setChannel)}
            options={['DOWNTOWN', 'HIGHWAY', 'AIRPORT'].map((c) => ({ value: c, label: titleCase(c) }))}
          />
          <FilterSelect
            id="risk"
            label="Stockout risk"
            value={risk}
            onChange={resetPage(setRisk)}
            options={['HIGH', 'MEDIUM', 'LOW'].map((r) => ({ value: r, label: titleCase(r) }))}
          />
          <FilterSelect
            id="status"
            label="Decision"
            value={status}
            onChange={resetPage(setStatus)}
            options={['PENDING', 'ACCEPTED', 'ADJUSTED', 'REJECTED'].map((s) => ({ value: s, label: titleCase(s) }))}
          />
          <div className="flex items-center gap-2 pb-2">
            <Switch id="actionable" checked={actionableOnly} onCheckedChange={resetPage(setActionableOnly)} />
            <Label htmlFor="actionable">Only lines needing attention</Label>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Could not load recommendations</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Store</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Stockout</TableHead>
                <TableHead>Overstock</TableHead>
                <TableHead className="text-right">On hand + inbound</TableHead>
                <TableHead className="text-right">Recommended</TableHead>
                <TableHead className="text-right">Sales at risk</TableHead>
                <TableHead>Why</TableHead>
                <TableHead>Decision</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows === null &&
                Array.from({ length: 8 }, (_, i) => (
                  <TableRow key={`skeleton-${i}`}>
                    <TableCell colSpan={9}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  </TableRow>
                ))}
              {rows?.map((r) => (
                <TableRow
                  key={r.recommendation_id}
                  className="cursor-pointer"
                  onClick={() => setSelected(r.recommendation_id)}
                >
                  <TableCell>
                    <div className="font-medium text-foreground">{r.location_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {titleCase(r.channel_type)} · {r.region}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-foreground">{r.sku_name}</div>
                    <div className="text-xs text-muted-foreground">{r.category}</div>
                  </TableCell>
                  <TableCell>
                    <RiskBadge risk={r.stockout_risk} label="Stockout" />
                  </TableCell>
                  <TableCell>
                    <RiskBadge risk={r.overstock_risk} label="Overstock" />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatInt(r.on_hand_units)} + {formatInt(r.inbound_units)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {formatInt(r.recommended_units)}
                    {r.cap_applied === 'SHELF_LIFE' && (
                      <div className="text-xs font-normal text-muted-foreground">shelf-life cap</div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatUsd(r.est_lost_sales_if_no_order)}</TableCell>
                  <TableCell className="max-w-xs whitespace-normal text-xs text-muted-foreground">
                    {r.explanation_text}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={r.decision_status} />
                    {r.decision_status === 'ADJUSTED' && (
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {formatInt(r.final_order_units)} units
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {rows?.length === 0 && !error && (
            <Empty className="py-10">
              <EmptyHeader>
                <EmptyTitle>No recommendations match these filters</EmptyTitle>
                <EmptyDescription>
                  Clear a filter or turn off &quot;Only lines needing attention&quot; to see every store-SKU.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {total > 0
            ? `${formatInt(offset + 1)}–${formatInt(Math.min(offset + PAGE_SIZE, total))} of ${formatInt(total)}`
            : ''}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Next
          </Button>
        </div>
      </div>

      <RecommendationSheet
        recommendationId={selected}
        onClose={() => setSelected(null)}
        onSaved={() => {
          load();
          void reloadSummary();
        }}
      />
    </div>
  );
}
