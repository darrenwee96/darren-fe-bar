import type { ReactNode } from 'react';
import {
  Alert,
  AlertDescription,
  Badge,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
} from '@databricks/appkit-ui/react';
import { Database, EyeOff, Filter, KeyRound, ShieldCheck, Table2 } from 'lucide-react';
import { fetchGovernance, type Governance } from '../lib/api';
import { formatDateTime, formatInt } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { cn } from '../lib/utils';
import { ROLE_ICON, ROLE_LABEL, scopeText } from '../lib/persona';

const SERVICE_PRINCIPAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function Section({ icon: Icon, title, children }: { icon: typeof Filter; title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" aria-hidden /> {title}
      </h3>
      {children}
    </section>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'caution' }) {
  return (
    <div className="min-w-0 rounded-lg border bg-card px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          'truncate text-sm font-semibold text-foreground',
          tone === 'good' && 'text-good',
          tone === 'caution' && 'text-caution'
        )}
        title={value}
      >
        {value}
      </p>
      {sub && (
        <p className="truncate text-[11px] text-muted-foreground" title={sub}>
          {sub}
        </p>
      )}
    </div>
  );
}

function RowBar({ label, visible, total, note }: { label: string; visible: number; total: number; note: string }) {
  const share = total > 0 ? visible / total : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="font-medium text-foreground">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          <span className="font-semibold text-foreground">{formatInt(visible)}</span> / {formatInt(total)} rows
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div
          className="h-full rounded-full bg-forecast"
          style={{ width: `${Math.max(share * 100, visible > 0 ? 1 : 0)}%` }}
        />
      </div>
      <p className="text-[11px] text-muted-foreground">{note}</p>
    </div>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="max-h-44 overflow-auto rounded-lg border bg-muted/60 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-foreground">
      {children.trim()}
    </pre>
  );
}

const Mono = ({ children }: { children: ReactNode }) => (
  <code className="break-all rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">{children}</code>
);

function Body({ g }: { g: Governance }) {
  const p = g.persona;
  const Icon = ROLE_ICON[p?.role ?? 'SELF'];
  const ucCount = p ? g.uc?.personaCounts[p.id] : undefined;
  const grants = new Map<string, string[]>();
  for (const grant of g.uc?.grants ?? [])
    grants.set(grant.grantee, [...(grants.get(grant.grantee) ?? []), grant.privilege]);

  return (
    <div className="space-y-6 p-4">
      <div className="flex items-start gap-3 rounded-xl border bg-gradient-to-br from-primary/5 to-transparent p-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-card shadow-card">
          <Icon className="h-4 w-4 text-foreground" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{p?.label ?? 'Me · signed-in access'}</p>
          <p className="text-xs text-muted-foreground">
            {p
              ? `${ROLE_LABEL[p.role]} · narrowed from your own access`
              : 'Your own scope from replenishment.user_scope'}
          </p>
          {p && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {p.bindings.map((b) => (
                <Badge
                  key={`${b.ucGroup}-${b.region}-${b.storeId}`}
                  variant="secondary"
                  className="font-mono text-[10px]"
                >
                  {b.ucGroup ?? 'principal'}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>

      <Section icon={KeyRound} title="Access">
        <div className="grid grid-cols-3 gap-2">
          <Tile label="Scope" value={scopeText(g.scope)} sub={p ? `Yours: ${scopeText(g.ownScope)}` : undefined} />
          <Tile
            label="Decisions"
            value={g.canDecide ? 'Can decide' : 'Read-only'}
            tone={g.canDecide ? 'good' : 'caution'}
          />
          <Tile
            label="Unit cost"
            value={g.costMasked ? 'Masked' : 'Visible'}
            tone={g.costMasked ? 'caution' : undefined}
          />
        </div>
      </Section>

      <Section icon={Table2} title="Rows">
        <div className="space-y-3 rounded-xl border p-3">
          <RowBar
            label="App · Lakebase"
            visible={g.rows.visible}
            total={g.rows.total}
            note="serving.recommendations, scoped on the server from the UC mapping"
          />
          {ucCount ? (
            <RowBar
              label="Unity Catalog · row filter"
              visible={ucCount.visible}
              total={ucCount.total}
              note="persona_row_visible() over the Gold table, evaluated by UC on the warehouse"
            />
          ) : (
            <p className="text-[11px] text-muted-foreground">
              {p ? 'UC count unavailable right now.' : 'Pick a persona to see the count UC evaluates for it.'}
            </p>
          )}
        </div>
      </Section>

      {g.ucError && (
        <Alert variant="destructive" className="py-2">
          <AlertDescription>{g.ucError}</AlertDescription>
        </Alert>
      )}

      {g.uc && (
        <>
          <Section icon={Filter} title="Row filter">
            {g.uc.rowFilter ? (
              <>
                <p className="text-xs text-muted-foreground">
                  <Mono>{g.uc.rowFilter.name}</Mono> on <Mono>{g.uc.rowFilter.columns}</Mono> of{' '}
                  <Mono>{g.uc.table}</Mono>
                </p>
                {g.uc.rowFilter.definition && <Code>{g.uc.rowFilter.definition}</Code>}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">No row filter is set on {g.uc.table}.</p>
            )}
          </Section>

          <Section icon={EyeOff} title="Column mask">
            {g.uc.masks.length === 0 && <p className="text-xs text-muted-foreground">No column masks.</p>}
            {g.uc.masks.map((m) => (
              <div key={m.column} className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Mono>{m.column}</Mono> ← <Mono>{m.name}</Mono>
                  <Badge variant={g.costMasked ? 'destructive' : 'secondary'} className="text-[10px]">
                    {g.costMasked ? 'Masked here' : 'Visible here'}
                  </Badge>
                </div>
                {m.definition && <Code>{m.definition}</Code>}
              </div>
            ))}
          </Section>

          <Section icon={Database} title="Mapping">
            <p className="text-xs text-muted-foreground">
              <Mono>{g.uc.mappingTable}</Mono>
            </p>
            {p && (
              <div className="overflow-hidden rounded-lg border text-xs">
                <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-2 bg-muted/50 px-3 py-1.5 font-medium text-muted-foreground">
                  <span>Account group</span>
                  <span>Region · store</span>
                  <span>Can</span>
                </div>
                {p.bindings.map((b) => (
                  <div
                    key={`${b.ucGroup}-${b.region}-${b.storeId}`}
                    className="grid grid-cols-[1.4fr_1fr_1fr] gap-2 border-t px-3 py-1.5"
                  >
                    <span className="truncate font-mono text-[11px]" title={b.ucGroup ?? ''}>
                      {b.ucGroup ?? '—'}
                    </span>
                    <span>{b.region === '*' ? 'All regions' : (b.region ?? `Store ${b.storeId}`)}</span>
                    <span>{p.canDecide ? 'See + decide' : 'See only'}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section icon={ShieldCheck} title="Grants">
            <div className="overflow-hidden rounded-lg border text-xs">
              {[...grants.entries()].map(([grantee, privileges]) => (
                <div
                  key={grantee}
                  className="flex items-center justify-between gap-3 border-t px-3 py-1.5 first:border-t-0"
                >
                  <span className="min-w-0 truncate" title={grantee}>
                    {SERVICE_PRINCIPAL.test(grantee) ? (
                      <>
                        <span className="font-mono text-[11px]">{grantee.slice(0, 8)}…</span>{' '}
                        <span className="text-muted-foreground">service principal</span>
                      </>
                    ) : (
                      grantee
                    )}
                  </span>
                  <span className="flex shrink-0 flex-wrap justify-end gap-1">
                    {privileges.map((pr) => (
                      <Badge key={pr} variant="outline" className="text-[10px]">
                        {pr}
                      </Badge>
                    ))}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              information_schema.table_privileges as the app&apos;s service principal sees it.
            </p>
          </Section>

          <p className="border-t pt-3 text-[11px] leading-relaxed text-muted-foreground">
            Read live from Unity Catalog at {formatDateTime(g.uc.readAt)}. Warehouse and Genie reads of the Gold table
            are filtered by UC at query time for the caller; this app reads a Lakebase copy and applies the same mapping
            on the server, for reads and for every decision.
          </p>
        </>
      )}
    </div>
  );
}

/** Governance drawer for the "Viewing as" persona: access, row counts and the live UC objects enforcing them. */
export function GovernanceSheet({ open, persona, onClose }: { open: boolean; persona: string; onClose: () => void }) {
  const { data, error, loading } = useAsync(open ? `governance|${persona}` : 'governance|closed', () =>
    open ? fetchGovernance() : Promise.resolve(null)
  );
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck className="h-5 w-5" aria-hidden /> Governance
          </SheetTitle>
          <SheetDescription>Unity Catalog · row filter, column mask, grants</SheetDescription>
        </SheetHeader>
        {error && (
          <div className="p-4">
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        )}
        {loading && !data && !error && (
          <div className="space-y-3 p-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}
        {data && <Body g={data} />}
      </SheetContent>
    </Sheet>
  );
}
