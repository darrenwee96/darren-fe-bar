import type { ReactNode } from 'react';
import { Card } from '@databricks/appkit-ui/react';
import { cn } from '../lib/utils';

/**
 * A workspace panel: short title, one-line meta (measure · period · scope), optional actions, and a source footer.
 * Titles name the subject ("Forecast vs actual"), never a sentence.
 */
export function Panel({
  title,
  meta,
  actions,
  source,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
  source?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <Card className={cn('min-w-0 gap-0 overflow-hidden py-0 shadow-sm', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold leading-tight text-foreground">{title}</h2>
          {meta && <p className="mt-0.5 text-xs text-muted-foreground">{meta}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className={cn('px-5 py-4', bodyClassName)}>{children}</div>
      {source && <div className="border-t bg-muted/40 px-5 py-2 text-[11px] text-muted-foreground">{source}</div>}
    </Card>
  );
}
