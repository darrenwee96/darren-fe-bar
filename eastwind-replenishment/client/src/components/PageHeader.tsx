import type { ReactNode } from 'react';

/** Page header: context line (scope, period, freshness), the page's message as the title, and actions. */
export function PageHeader({ context, title, actions }: { context: ReactNode; title: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <p className="text-sm text-muted-foreground">{context}</p>
        <h2 className="text-2xl font-semibold text-foreground">{title}</h2>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
