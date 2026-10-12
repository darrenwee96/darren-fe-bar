import { Badge } from '@databricks/appkit-ui/react';
import { AlertTriangle, CheckCircle2, CircleDashed, CircleMinus, PencilLine, ShieldAlert, XCircle } from 'lucide-react';
import type { DecisionStatus, Risk } from '../lib/api';
import { EXPIRY_STATUS, STOCK_STATUS } from '../lib/risk';
import { cn } from '../lib/utils';

const TONE_CLASS = {
  critical: 'border-critical/30 bg-critical/10 text-destructive',
  warning: 'border-caution/50 bg-caution/15 text-foreground',
  good: 'border-good/30 bg-good/10 text-success',
} as const;

const TONE_ICON = { critical: AlertTriangle, warning: ShieldAlert, good: CheckCircle2 } as const;

/** Order status from the stockout_risk flag; icon + label, never color alone. */
export function StockStatusBadge({ risk, className }: { risk: Risk; className?: string }) {
  const s = STOCK_STATUS[risk];
  const Icon = TONE_ICON[s.tone];
  return (
    <Badge
      variant="outline"
      title={s.hint}
      className={cn('gap-1 whitespace-nowrap font-medium', TONE_CLASS[s.tone], className)}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {s.label}
    </Badge>
  );
}

export function ExpiryBadge({ risk }: { risk: Risk }) {
  if (risk !== 'HIGH') return null;
  const s = EXPIRY_STATUS[risk];
  return (
    <Badge variant="outline" title={s.hint} className={cn('gap-1 whitespace-nowrap font-medium', TONE_CLASS.warning)}>
      <ShieldAlert className="h-3 w-3" aria-hidden />
      {s.label}
    </Badge>
  );
}

const DECISION = {
  ACCEPTED: { label: 'Accepted', Icon: CheckCircle2, className: 'text-success border-good/30' },
  ADJUSTED: { label: 'Adjusted', Icon: PencilLine, className: 'text-primary border-primary/30' },
  REJECTED: { label: 'Rejected', Icon: XCircle, className: 'text-muted-foreground' },
} as const;

export function DecisionBadge({ status }: { status: DecisionStatus | null }) {
  if (!status)
    return (
      <Badge variant="outline" className="gap-1 whitespace-nowrap text-muted-foreground">
        <CircleDashed className="h-3 w-3" aria-hidden /> Pending
      </Badge>
    );
  const d = DECISION[status];
  return (
    <Badge variant="outline" className={cn('gap-1 whitespace-nowrap', d.className)}>
      <d.Icon className="h-3 w-3" aria-hidden /> {d.label}
    </Badge>
  );
}

export function NoOrderBadge() {
  return (
    <Badge variant="outline" className="gap-1 whitespace-nowrap text-muted-foreground">
      <CircleMinus className="h-3 w-3" aria-hidden /> No order
    </Badge>
  );
}
