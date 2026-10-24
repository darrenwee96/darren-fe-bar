import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type React from 'react';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@databricks/appkit-ui/react';
import { EyeOff, Lock, Moon, ShieldCheck, Sparkles, Store, Sun, TriangleAlert } from 'lucide-react';
import { ForecastPanel } from './components/ForecastPanel';
import { FilterBar } from './components/FilterBar';
import { GovernanceSheet } from './components/GovernanceSheet';
import { PersonaSwitcher } from './components/PersonaSwitcher';
import { KpiStrip } from './components/KpiStrip';
import { OrderQueue } from './components/OrderQueue';
import { RecommendationSheet } from './components/RecommendationSheet';
import { StoreNeedPanel } from './components/StoreNeedPanel';
import { GenieDock } from './genie/GeniePanel';
import { useGenie } from './genie/context';
import { GenieProvider } from './genie/GenieProvider';
import {
  fetchFilterOptions,
  fetchPersonas,
  fetchSummary,
  fetchWhoami,
  SELF_PERSONA,
  setActivePersona,
  type Persona,
  type Summary,
  type Whoami,
} from './lib/api';
import { pinToScope, useGlobalFilters, usePersonaParam } from './lib/filters';
import { ROLE_ICON, scopeText } from './lib/persona';
import { formatDate, formatDateTime, titleCase } from './lib/format';
import { useAsync } from './lib/useAsync';
import { useTheme } from './lib/theme';

const HEADER_HEIGHT = 'h-14';

/** One line: brand, data freshness, "Viewing as", Genie, theme, signed-in identity. */
function Header({
  email,
  summary,
  personaControl,
}: {
  email: string | null;
  summary: Summary | null;
  personaControl?: React.ReactNode;
}) {
  const { open, setOpen } = useGenie();
  const { theme, toggle } = useTheme();
  return (
    <header
      className={`sticky top-0 z-30 flex ${HEADER_HEIGHT} items-center gap-4 border-b bg-card/95 px-4 backdrop-blur md:px-8`}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <div
          aria-hidden
          className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-[13px] font-bold text-primary-foreground"
        >
          E
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-lava ring-2 ring-card" />
        </div>
        <h1 className="truncate text-[15px] font-semibold text-foreground">Eastwind replenishment</h1>
        {summary?.as_of_date && (
          <p className="hidden truncate border-l pl-3 text-xs text-muted-foreground tabular-nums 2xl:block">
            Order week {formatDate(summary.as_of_date)} · data loaded {formatDateTime(summary.loaded_at)} · model v
            {summary.model_version}
          </p>
        )}
      </div>
      <div className="ml-auto flex min-w-0 items-center gap-2">
        {personaControl}
        <Button variant={open ? 'secondary' : 'outline'} size="sm" onClick={() => setOpen(!open)} aria-pressed={open}>
          <Sparkles className="h-4 w-4 md:mr-1" />
          <span className="hidden md:inline">Ask Genie</span>
          <span className="sr-only md:hidden">Ask Genie</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={toggle}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        {email && (
          <Badge
            variant="secondary"
            className="hidden max-w-[220px] truncate font-normal lg:inline-flex"
            title="Decisions you save are recorded under this identity"
          >
            {email}
          </Badge>
        )}
      </div>
    </header>
  );
}

/** One line under the filters while viewing as a persona: who, what scope, what they can do, what is masked. */
function PersonaStrip({ me, onGovernance }: { me: Whoami; onGovernance: () => void }) {
  const p = me.persona;
  if (!p) return null;
  const Icon = ROLE_ICON[p.role];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border bg-card px-4 py-2.5 text-xs shadow-card">
      <span className="flex items-center gap-1.5 font-semibold text-foreground">
        <Icon className="h-4 w-4" aria-hidden /> Viewing as {p.label}
      </span>
      <span className="text-muted-foreground">{scopeText(me.scope)}</span>
      {me.canDecide ? (
        <Badge variant="secondary" className="font-normal">
          Can decide
        </Badge>
      ) : (
        <Badge variant="outline" className="gap-1 border-caution/50 font-normal text-caution">
          <Lock className="h-3 w-3" aria-hidden /> Read-only
        </Badge>
      )}
      {me.costMasked && (
        <Badge variant="outline" className="gap-1 font-normal">
          <EyeOff className="h-3 w-3" aria-hidden /> Unit cost masked
        </Badge>
      )}
      <Button variant="ghost" size="sm" className="ml-auto h-7 px-2 text-muted-foreground" onClick={onGovernance}>
        <ShieldCheck className="mr-1 h-3.5 w-3.5" aria-hidden /> How UC enforces this
      </Button>
    </div>
  );
}

/** A signed-in user with no rows in replenishment.user_scope: say so plainly instead of showing empty panels. */
function NoScope({ email, persona }: { email: string | undefined; persona?: Persona | null }) {
  if (persona)
    return (
      <Card className="rounded-xl py-0 shadow-card">
        <Empty className="py-14">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Store className="h-5 w-5" />
            </EmptyMedia>
            <EmptyTitle>No stores in both scopes</EmptyTitle>
            <EmptyDescription>
              {persona.label} covers {scopeText(persona.scope)}, which does not overlap your own access. A persona can
              only narrow what you may already see.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Card>
    );
  return (
    <Card className="rounded-xl py-0 shadow-card">
      <Empty className="py-14">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Store className="h-5 w-5" />
          </EmptyMedia>
          <EmptyTitle>You don&apos;t have any stores assigned yet</EmptyTitle>
          <EmptyDescription>
            Order lines and decisions are limited to the regions or stores you plan for, and none are assigned to{' '}
            {email || 'you'} yet. Ask your replenishment app admin to add you. The forecast chart below stays available.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <p className="text-xs text-muted-foreground">
            Access is granted per region or store in replenishment.user_scope.
          </p>
        </EmptyContent>
      </Empty>
    </Card>
  );
}

function ControlPanel() {
  const { filters: urlFilters, setFilter } = useGlobalFilters();
  const { persona, setPersona } = usePersonaParam();
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [governanceOpen, setGovernanceOpen] = useState(false);
  const refresh = useCallback(() => setRevision((r) => r + 1), []);

  // Every API call below is made viewing as this persona; it is set before any child fetches for the new persona.
  setActivePersona(persona);
  const personas = useAsync('personas', fetchPersonas);
  const whoami = useAsync(`whoami|${persona}`, fetchWhoami);
  const options = useAsync(`filters|${persona}`, fetchFilterOptions);
  // Charts read the warehouse directly: pin them to a single-region / single-store persona's scope.
  const filters = whoami.data?.persona ? pinToScope(urlFilters, whoami.data.scope) : urlFilters;
  const filterKey = JSON.stringify(filters);
  const summary = useAsync(`${persona}|${filterKey}|${revision}`, () => fetchSummary(filters));

  // A persona id the UC mapping no longer has (stale link): fall back to the signed-in view.
  const known = useMemo(() => personas.data?.personas ?? [], [personas.data]);
  useEffect(() => {
    if (personas.data && persona !== SELF_PERSONA && !known.some((p) => p.id === persona)) setPersona(SELF_PERSONA);
  }, [personas.data, persona, known, setPersona]);

  const switchPersona = (id: string) => {
    setSelected(null);
    setPersona(id);
  };
  const readOnly =
    whoami.data && !whoami.data.canDecide
      ? `${whoami.data.persona?.label ?? 'This view'} is read-only: decisions are disabled (the server answers 403).`
      : null;

  const scope = whoami.data?.scope;
  const noScope = !!scope && scope.restricted && scope.regions.length === 0 && scope.locations.length === 0;
  const store = options.data?.stores.find((s) => s.location_id === filters.location);
  const scopeLabel =
    store?.location_name ??
    ([filters.region, filters.channel && titleCase(filters.channel), filters.category].filter(Boolean).join(' · ') ||
      'All stores');
  const s = summary.data;
  const email = whoami.data?.email ?? null;

  return (
    <div className="min-h-screen bg-background">
      <Header
        email={email}
        summary={s}
        personaControl={
          personas.data?.enabled ? (
            <PersonaSwitcher
              personas={known}
              value={known.some((p) => p.id === persona) ? persona : SELF_PERSONA}
              onChange={switchPersona}
              onGovernance={() => setGovernanceOpen(true)}
            />
          ) : undefined
        }
      />
      <div className="flex">
        <div className="min-w-0 flex-1">
          <div className="sticky top-14 z-20 border-b bg-background/90 px-4 py-2.5 backdrop-blur md:px-8">
            <FilterBar options={options.data} />
          </div>
          <main key={persona} className="mx-auto max-w-[1680px] space-y-6 px-4 py-6 md:px-8">
            {whoami.data?.persona && <PersonaStrip me={whoami.data} onGovernance={() => setGovernanceOpen(true)} />}
            {whoami.error && (
              <Alert variant="destructive">
                <TriangleAlert className="h-4 w-4" />
                <AlertTitle>Could not verify who you are</AlertTitle>
                <AlertDescription>{whoami.error}</AlertDescription>
              </Alert>
            )}
            {summary.error && !s && !whoami.error && !noScope && (
              <Alert variant="destructive">
                <TriangleAlert className="h-4 w-4" />
                <AlertTitle>Order recommendations unavailable</AlertTitle>
                <AlertDescription>
                  {summary.error}. The forecast chart still works; try again in a few minutes.
                </AlertDescription>
              </Alert>
            )}
            {noScope ? (
              <NoScope email={whoami.data?.email} persona={whoami.data?.persona} />
            ) : (
              <KpiStrip filters={filters} summary={s} loading={summary.loading} error={summary.error} />
            )}
            {/*
              Charts share a row (forecast 3/5, store ranking 2/5) once the workspace is >= 1100px, else they stack, so
              they keep a proper aspect ratio at any width, with or without the Genie dock. Container queries follow
              the space actually left beside the dock.
            */}
            <div className="@container">
              <div
                className={
                  noScope
                    ? 'grid grid-cols-1 gap-6'
                    : 'grid grid-cols-1 gap-6 @min-[1100px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]'
                }
              >
                <ForecastPanel filters={filters} scopeLabel={scopeLabel} />
                {!noScope && (
                  <StoreNeedPanel filters={filters} revision={revision} onSelect={(id) => setFilter('location', id)} />
                )}
              </div>
            </div>
            {!noScope && (
              <OrderQueue
                filters={filters}
                summary={s}
                revision={revision}
                rules={whoami.data?.exceptionRules ?? null}
                email={email}
                readOnly={readOnly}
                onOpen={setSelected}
                onChanged={refresh}
              />
            )}
          </main>
        </div>
        <GenieDock email={email} filters={filters} storeName={store?.location_name} />
      </div>

      <RecommendationSheet
        key={persona}
        readOnly={readOnly}
        recommendationId={selected}
        rules={whoami.data?.exceptionRules ?? null}
        onClose={() => setSelected(null)}
        onSaved={refresh}
        onFocusStore={(id) => {
          setFilter('location', id);
          setSelected(null);
        }}
      />
      {personas.data?.enabled && (
        <GovernanceSheet open={governanceOpen} persona={persona} onClose={() => setGovernanceOpen(false)} />
      )}
    </div>
  );
}

function Root() {
  return (
    <GenieProvider>
      <ControlPanel />
    </GenieProvider>
  );
}

const router = createBrowserRouter([
  { path: '/', element: <Root /> },
  // Former page routes (/orders, /stores/:id, ...) all land on the single control panel.
  { path: '*', element: <Navigate to="/" replace /> },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
