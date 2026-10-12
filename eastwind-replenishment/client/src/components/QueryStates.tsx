import {
  Alert,
  AlertDescription,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Skeleton,
} from '@databricks/appkit-ui/react';

/** Loading / error / empty states for tables fed by useAnalyticsQuery. Returns null when there is data. */
export function QueryStates({
  loading,
  error,
  empty,
  emptyText = 'No rows match these filters.',
  rows = 5,
}: {
  loading: boolean;
  error: string | null | undefined;
  empty: boolean;
  emptyText?: string;
  rows?: number;
}) {
  if (loading)
    return (
      <div className="space-y-2">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  if (error)
    return (
      <Alert variant="destructive">
        <AlertDescription>Could not load data: {error}</AlertDescription>
      </Alert>
    );
  if (empty)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No data</EmptyTitle>
          <EmptyDescription>{emptyText}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  return null;
}
