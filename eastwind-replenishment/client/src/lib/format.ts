export const toNumber = (value: number | string | null | undefined): number => Number(value ?? 0);

export const formatInt = (value: number | string | null | undefined): string =>
  toNumber(value).toLocaleString('en-US', { maximumFractionDigits: 0 });

export const formatUsd = (value: number | string | null | undefined): string => {
  const n = toNumber(value);
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};

/** A cost value, or "Masked" when Unity Catalog masks unit cost for the persona (the API sends null). */
export const formatCost = (value: number | string | null | undefined): string =>
  value === null || value === undefined ? 'Masked' : formatUsd(value);

/** Units × unit cost, or null when unit cost is masked. */
export const costOf = (units: number | string | null | undefined, unitCost: number | string | null | undefined) =>
  unitCost === null || unitCost === undefined ? null : toNumber(units) * toNumber(unitCost);

export const formatPct = (value: number | string | null | undefined, digits = 1): string =>
  `${(toNumber(value) * 100).toFixed(digits)}%`;

export const formatDate = (value: string | null | undefined): string =>
  value
    ? new Date(value.length === 10 ? `${value}T00:00:00` : value).toLocaleDateString('en-US', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '—';

export const formatDateTime = (value: string | null | undefined): string =>
  value
    ? new Date(value).toLocaleString('en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '—';

export const titleCase = (value: string): string => value.charAt(0) + value.slice(1).toLowerCase();
