import { ALL } from '../lib/filters';
import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@databricks/appkit-ui/react';

export function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
  allLabel = 'All',
  width = 'w-40',
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  allLabel?: string | null;
  width?: string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className={width}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {allLabel !== null && <SelectItem value={ALL}>{allLabel}</SelectItem>}
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
