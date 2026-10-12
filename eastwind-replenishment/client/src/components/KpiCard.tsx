import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@databricks/appkit-ui/react';

interface KpiCardProps {
  label: string;
  value: ReactNode;
  /** Comparison or context line, e.g. "vs 37% for same-week-last-year". */
  detail?: ReactNode;
  /** Provenance: source table and freshness. */
  source: string;
  tone?: 'default' | 'bad' | 'good';
  loading?: boolean;
}

/** KPI = value + unit + comparison + source/freshness (AppKit ships no KPI card; composed from Card). */
export function KpiCard({ label, value, detail, source, tone = 'default', loading }: KpiCardProps) {
  const valueClass = tone === 'bad' ? 'text-destructive' : tone === 'good' ? 'text-success' : 'text-foreground';
  return (
    <Card className="min-w-0">
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <CardTitle className={`text-2xl font-semibold tabular-nums ${valueClass}`}>{value}</CardTitle>
        )}
      </CardHeader>
      <CardContent className="space-y-1">
        {loading ? (
          <Skeleton className="h-4 w-40" />
        ) : (
          detail && <p className="text-sm text-muted-foreground">{detail}</p>
        )}
        <p className="text-xs text-muted-foreground">{source}</p>
      </CardContent>
    </Card>
  );
}
