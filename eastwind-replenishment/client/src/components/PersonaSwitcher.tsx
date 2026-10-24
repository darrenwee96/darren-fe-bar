import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@databricks/appkit-ui/react';
import { ShieldCheck, UserRound } from 'lucide-react';
import { SELF_PERSONA, type Persona } from '../lib/api';
import { ROLE_ICON } from '../lib/persona';

/** Header control: "Viewing as" persona picker (personas from Unity Catalog) and the Governance drawer button. */
export function PersonaSwitcher({
  personas,
  value,
  onChange,
  onGovernance,
}: {
  personas: Persona[];
  value: string;
  onChange: (id: string) => void;
  onGovernance: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <label
        htmlFor="viewing-as"
        className="hidden shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:block"
      >
        Viewing as
      </label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          id="viewing-as"
          size="sm"
          aria-label="Viewing as"
          className="h-8 w-[150px] min-w-0 bg-card sm:w-[200px] xl:w-[270px] [&>span]:truncate"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end" className="w-[300px]">
          <SelectItem value={SELF_PERSONA}>
            <span className="flex items-center gap-2">
              <UserRound className="h-4 w-4 text-muted-foreground" aria-hidden />
              <span>Me · signed-in access</span>
            </span>
          </SelectItem>
          <SelectSeparator />
          {personas.map((p) => {
            const Icon = ROLE_ICON[p.role];
            return (
              <SelectItem key={p.id} value={p.id}>
                <span className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                  <span className="truncate">{p.label}</span>
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      <Button variant="outline" size="sm" className="h-8 shrink-0 px-2.5" onClick={onGovernance} title="Governance">
        <ShieldCheck className="h-4 w-4 xl:mr-1" aria-hidden />
        <span className="hidden xl:inline">Governance</span>
        <span className="sr-only xl:hidden">Governance</span>
      </Button>
    </div>
  );
}
