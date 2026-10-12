import { formatPct } from '../lib/format';

interface DeltaProps {
  /** Current and comparison values; rendered as a relative change unless `points` is set. */
  current: number | null | undefined;
  previous: number | null | undefined;
  /** Whether an increase is good (sales) or bad (stockouts, waste). */
  higherIsGood: boolean;
  /** Show the absolute difference in percentage points (for rates) instead of a relative change. */
  points?: boolean;
  suffix?: string;
}

/** Variance vs a comparison period with explicit good/bad notation (success / destructive tokens, ▲ ▼). */
export function Delta({ current, previous, higherIsGood, points, suffix = 'vs last year' }: DeltaProps) {
  if (current == null || previous == null || (!points && previous === 0)) {
    return <span className="text-muted-foreground">no comparison</span>;
  }
  const diff = points ? current - previous : (current - previous) / Math.abs(previous);
  const good = diff === 0 ? null : diff > 0 === higherIsGood;
  const tone = good === null ? 'text-muted-foreground' : good ? 'text-success' : 'text-destructive';
  const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '•';
  const text = points ? `${(Math.abs(diff) * 100).toFixed(1)} pts` : formatPct(Math.abs(diff));
  return (
    <span className={`tabular-nums ${tone}`}>
      {arrow} {text}
      {suffix && <span className="text-muted-foreground"> {suffix}</span>}
    </span>
  );
}
