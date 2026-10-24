import { Building2, Eye, MapPin, Store, UserRound } from 'lucide-react';
import type { ComponentType } from 'react';
import type { PersonaRole, Scope } from './api';

export const ROLE_ICON: Record<PersonaRole | 'SELF', ComponentType<{ className?: string }>> = {
  SELF: UserRound,
  ANALYST: Building2,
  PLANNER: MapPin,
  STORE_MANAGER: Store,
  AUDITOR: Eye,
};

export const ROLE_LABEL: Record<PersonaRole, string> = {
  ANALYST: 'Analyst',
  PLANNER: 'Planner',
  STORE_MANAGER: 'Store manager',
  AUDITOR: 'Auditor',
};

/** "All regions", "North", "Store L0001", "2 stores" … */
export function scopeText(scope: Scope): string {
  if (!scope.restricted) return 'All regions';
  const parts = [
    ...scope.regions,
    ...(scope.locations.length === 1
      ? [`Store ${scope.locations[0]}`]
      : scope.locations.length > 1
        ? [`${scope.locations.length} stores`]
        : []),
  ];
  return parts.length > 0 ? parts.join(' · ') : 'No stores';
}
