import { Badge } from '@databricks/appkit-ui/react';
import type { DecisionStatus, Risk } from '../lib/api';

export function RiskBadge({ risk, label }: { risk: Risk; label: string }) {
  const variant = risk === 'HIGH' ? 'destructive' : risk === 'MEDIUM' ? 'secondary' : 'outline';
  return (
    <Badge variant={variant} title={`${label} risk: ${risk.toLowerCase()}`}>
      {risk === 'HIGH' ? 'High' : risk === 'MEDIUM' ? 'Medium' : 'Low'}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: DecisionStatus | null }) {
  if (!status) return <Badge variant="outline">Pending</Badge>;
  return (
    <Badge variant={status === 'REJECTED' ? 'secondary' : 'default'}>
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </Badge>
  );
}
