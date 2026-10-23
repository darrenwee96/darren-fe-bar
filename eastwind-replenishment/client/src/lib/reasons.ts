// Plain-word order reasons from the recommendation's explanation_text (ml/src/build_recommendations.py), e.g.
//   "+5 units from holiday timing · Mid-Autumn Festival 2026 in 3 weeks · Forecast 15.9x recent weekly sales ·
//    Stock covers 0.2 of 3 weeks needed"
// becomes, strongest first:
//   "Mid-Autumn in 3 weeks – forecast 15.9× recent sales", "Stock covers 0.2 of the 3 weeks needed",
//   "Holiday timing adds 5 units"
// Drivers that move the forecast by zero units are dropped; so is a 0% change vs recent sales.

const DRIVER = /^([+-]?)([\d,]+(?:\.\d+)?) units from (.+)$/;
const EVENT = /^(.+?) in (\d+) weeks?$/;
const MULTIPLE = /^Forecast ([\d,.]+)x recent weekly sales$/;
const PERCENT = /^Forecast (-?[\d,.]+)% vs last 4 weeks$/;
const COVER = /^Stock covers ([\d,.]+) of (\d+) weeks needed$/;
const CAP = /^Capped by (\d+)-day shelf life$/;

const DRIVER_NAMES: Record<string, string> = {
  'holiday timing': 'Holiday timing',
  'recent trend': 'Recent trend',
  'last year': 'Last year’s sales',
  'store-product baseline': 'Store baseline',
};

/** "Mid-Autumn Festival 2026" → "Mid-Autumn"; "Lunar New Year 2026" → "Lunar New Year". */
export function shortEventName(name: string): string {
  return name
    .replace(/\s+\d{4}$/, '')
    .replace(/\s+Festival$/, '')
    .trim();
}

const num = (s: string) => Number(s.replace(/,/g, ''));

export function orderReasons(explanation: string | null | undefined): string[] {
  if (!explanation) return [];
  let event: string | null = null;
  let multiple: string | null = null;
  let percent: string | null = null;
  let cover: string | null = null;
  let cap: string | null = null;
  const drivers: { text: string; size: number }[] = [];
  const other: string[] = [];

  for (const raw of explanation.split('·')) {
    const part = raw.trim();
    if (!part) continue;
    let m: RegExpMatchArray | null;
    if ((m = part.match(DRIVER))) {
      const size = num(m[2]);
      if (size === 0) continue;
      const name = DRIVER_NAMES[m[3]] ?? m[3].charAt(0).toUpperCase() + m[3].slice(1);
      const units = size.toLocaleString('en-US', { maximumFractionDigits: 0 });
      drivers.push({ text: `${name} ${m[1] === '-' ? 'removes' : 'adds'} ${units} units`, size });
    } else if ((m = part.match(EVENT))) {
      event = `${shortEventName(m[1])} in ${m[2]} ${m[2] === '1' ? 'week' : 'weeks'}`;
    } else if ((m = part.match(MULTIPLE))) {
      multiple = `forecast ${m[1]}× recent sales`;
    } else if ((m = part.match(PERCENT))) {
      const pct = num(m[1]);
      if (pct !== 0) percent = `forecast ${pct > 0 ? '+' : '−'}${Math.abs(pct)}% vs the last 4 weeks`;
    } else if ((m = part.match(COVER))) {
      cover = `Stock covers ${m[1]} of the ${m[2]} weeks needed`;
    } else if ((m = part.match(CAP))) {
      cap = `Capped to what sells within the ${m[1]}-day shelf life`;
    } else {
      other.push(part);
    }
  }

  const demand = multiple ?? percent;
  const out: string[] = [];
  if (event && demand) out.push(`${event} – ${demand}`);
  else if (event) out.push(event);
  else if (demand) out.push(demand.charAt(0).toUpperCase() + demand.slice(1));
  if (cover) out.push(cover);
  if (cap) out.push(cap);
  out.push(...drivers.sort((a, b) => b.size - a.size).map((d) => d.text));
  out.push(...other);
  return out;
}
