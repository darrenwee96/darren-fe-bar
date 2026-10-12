import {
  Badge,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@databricks/appkit-ui/react';
import { Lock, X } from 'lucide-react';
import type { FilterOptions } from '../lib/api';
import { ALL, CHANNEL_OPTIONS, type FilterKey, useGlobalFilters } from '../lib/filters';

function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
  allLabel,
  className = 'w-[150px]',
}: {
  id: string;
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
  options: { value: string; label: string; hint?: string }[];
  allLabel: string;
  className?: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <Select value={value ?? ALL} onValueChange={onChange}>
        <SelectTrigger id={id} size="sm" className={`${className} bg-card`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-80">
          <SelectItem value={ALL}>{allLabel}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
              {o.hint && <span className="ml-1 text-xs text-muted-foreground">{o.hint}</span>}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Global filters: region / channel / category / store narrow every panel (KPIs, queue, charts). */
export function FilterBar({ options }: { options: FilterOptions | null }) {
  const { filters, setFilter, clear, active } = useGlobalFilters();
  const set = (key: FilterKey) => (v: string) => {
    setFilter(key, v);
    // A store outside the newly chosen region / channel would silently empty every panel; drop it.
    if ((key === 'region' || key === 'channel') && filters.location && v !== ALL) {
      const store = options?.stores.find((s) => s.location_id === filters.location);
      if (store && (key === 'region' ? store.region !== v : store.channel_type !== v)) setFilter('location', undefined);
    }
  };
  const stores = (options?.stores ?? []).filter(
    (s) => (!filters.region || s.region === filters.region) && (!filters.channel || s.channel_type === filters.channel)
  );

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <FilterSelect
        id="f-region"
        label="Region"
        value={filters.region}
        onChange={set('region')}
        allLabel="All regions"
        options={(options?.regions ?? []).map((r) => ({ value: r, label: r }))}
      />
      <FilterSelect
        id="f-channel"
        label="Channel"
        value={filters.channel}
        onChange={set('channel')}
        allLabel="All channels"
        options={CHANNEL_OPTIONS}
      />
      <FilterSelect
        id="f-category"
        label="Category"
        value={filters.category}
        onChange={set('category')}
        allLabel="All categories"
        options={(options?.categories ?? []).map((c) => ({ value: c, label: c }))}
        className="w-[170px]"
      />
      <FilterSelect
        id="f-store"
        label="Store"
        value={filters.location}
        onChange={set('location')}
        allLabel={`All stores (${stores.length})`}
        options={stores.map((s) => ({ value: s.location_id, label: s.location_name, hint: s.region }))}
        className="w-[210px]"
      />
      {active > 0 && (
        <Button variant="ghost" size="sm" onClick={clear} className="h-8 text-muted-foreground">
          <X className="mr-1 h-3.5 w-3.5" /> Clear {active}
        </Button>
      )}
      {options?.scope.restricted && (
        <Badge
          variant="outline"
          className="gap-1 text-muted-foreground"
          title="Enforced by the server from replenishment.user_scope; filters only narrow within it"
        >
          <Lock className="h-3 w-3" aria-hidden />
          Your scope: {[...options.scope.regions, ...options.scope.locations].join(', ') || 'none'}
        </Badge>
      )}
    </div>
  );
}
