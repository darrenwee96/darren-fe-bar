import {
  Alert,
  AlertDescription,
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Skeleton,
} from '@databricks/appkit-ui/react';
import { AlertTriangle, ShieldAlert, X } from 'lucide-react';
import { fetchStoreNeeds, type ScopeFilters } from '../lib/api';
import { formatInt, formatUsd, titleCase, toNumber } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { cn } from '../lib/utils';
import { Panel } from './Panel';

/**
 * Top stores by sales lost if the "order needed" lines are not ordered. Each bar is stacked: lines needing an order
 * (critical) + lines below safety stock (warning). Clicking a store drills every panel down to it.
 */
export function StoreNeedPanel({
  filters,
  revision,
  onSelect,
}: {
  filters: ScopeFilters;
  revision: number;
  onSelect: (locationId: string | undefined) => void;
}) {
  // The ranking ignores the store filter so the selected store stays visible among its peers.
  const { location, ...rest } = filters;
  const { data, error, loading } = useAsync(`${JSON.stringify(rest)}|${revision}`, () => fetchStoreNeeds(rest));
  const rows = data?.rows ?? [];
  const max = Math.max(1, ...rows.map((r) => toNumber(r.needs_order) + toNumber(r.safety_top_up)));

  return (
    <Panel
      title="Order need by store"
      meta="Top 10 · lines needing an order · sales lost if not ordered"
      source="Lakebase serving.recommendations · click a store to drill down"
      actions={
        location && (
          <Button variant="ghost" size="sm" className="h-7 text-muted-foreground" onClick={() => onSelect(undefined)}>
            <X className="mr-1 h-3.5 w-3.5" /> All stores
          </Button>
        )
      }
      bodyClassName="px-3 py-3"
    >
      <div className="mb-2 flex items-center gap-4 px-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm bg-critical" />
          <AlertTriangle className="h-3 w-3" aria-hidden /> Order needed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm bg-caution" />
          <ShieldAlert className="h-3 w-3" aria-hidden /> Below safety stock
        </span>
      </div>
      {error && (
        <Alert variant="destructive" className="py-2">
          <AlertDescription>Could not load stores: {error}</AlertDescription>
        </Alert>
      )}
      {loading && !data && (
        <div className="space-y-2 px-2">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      )}
      {data && rows.length === 0 && !error && (
        <Empty className="py-8">
          <EmptyHeader>
            <EmptyTitle>No stores need an order</EmptyTitle>
            <EmptyDescription>Stock + inbound covers demand for every store in this selection.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <ol className={cn('space-y-0.5', loading && data && 'opacity-60')}>
        {rows.map((r) => {
          const need = toNumber(r.needs_order);
          const safety = toNumber(r.safety_top_up);
          const selected = r.location_id === location;
          return (
            <li key={r.location_id}>
              <button
                type="button"
                onClick={() => onSelect(selected ? undefined : r.location_id)}
                aria-pressed={selected}
                title={`${r.location_name}: ${need} lines need an order, ${safety} below safety stock, ${formatUsd(r.needs_order_sales)} lost if not ordered, ${formatInt(r.pending_lines)} pending`}
                className={cn(
                  'grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_56px] items-center gap-3 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selected && 'bg-accent ring-1 ring-primary/40'
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-foreground">{r.location_name}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {titleCase(r.channel_type)} · {r.region}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="flex h-2.5 flex-1 gap-[2px] overflow-hidden rounded-full bg-muted">
                    <span className="h-full rounded-l-full bg-critical" style={{ width: `${(need / max) * 100}%` }} />
                    {safety > 0 && (
                      <span
                        className="h-full rounded-r-full bg-caution"
                        style={{ width: `${(safety / max) * 100}%` }}
                      />
                    )}
                  </span>
                  <span className="w-6 text-right tabular-nums text-muted-foreground">{need}</span>
                </span>
                <span className="text-right font-semibold tabular-nums text-foreground">
                  {formatUsd(r.needs_order_sales)}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
