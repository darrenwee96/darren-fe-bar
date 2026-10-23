import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { useCallback, useState } from 'react';
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
import { Moon, Sparkles, Store, Sun, TriangleAlert } from 'lucide-react';
import { ForecastPanel } from './components/ForecastPanel';
import { FilterBar } from './components/FilterBar';
import { KpiStrip } from './components/KpiStrip';
import { OrderQueue } from './components/OrderQueue';
import { RecommendationSheet } from './components/RecommendationSheet';
import { StoreNeedPanel } from './components/StoreNeedPanel';
import { GenieDock } from './genie/GeniePanel';
import { useGenie } from './genie/context';
import { GenieProvider } from './genie/GenieProvider';
import { fetchFilterOptions, fetchSummary, fetchWhoami, type Summary } from './lib/api';
import { useGlobalFilters } from './lib/filters';
import { formatDate, formatDateTime, titleCase } from './lib/format';
import { useAsync } from './lib/useAsync';
import { useTheme } from './lib/theme';

const HEADER_HEIGHT = 'h-14';

/** One line: brand, data freshness, Genie, theme, signed-in identity. */
function Header({ email, summary }: { email: string | null; summary: Summary | null }) {
  const { open, setOpen } = useGenie();
  const { theme, toggle } = useTheme();
  return (
    <header
      className={`sticky top-0 z-30 flex ${HEADER_HEIGHT} items-center gap-4 border-b bg-card/95 px-4 backdrop-blur md:px-8`}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <div
          aria-hidden
          className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#1b3139] text-[13px] font-bold text-white dark:bg-[#eeede9] dark:text-[#0b2026]"
        >
          E
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-lava ring-2 ring-card" />
        </div>
        <h1 className="truncate text-[15px] font-semibold text-foreground">Eastwind replenishment</h1>
        {summary?.as_of_date && (
          <p className="hidden truncate border-l pl-3 text-xs text-muted-foreground tabular-nums lg:block">
            Order week {formatDate(summary.as_of_date)} · data loaded {formatDateTime(summary.loaded_at)} · model v
            {summary.model_version}
          </p>
        )}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Button variant={open ? 'secondary' : 'outline'} size="sm" onClick={() => setOpen(!open)} aria-pressed={open}>
          <Sparkles className="mr-1 h-4 w-4" /> Ask Genie
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
            className="hidden max-w-[220px] truncate font-normal md:inline-flex"
            title="Decisions you save are recorded under this identity"
          >
            {email}
          </Badge>
        )}
      </div>
    </header>
  );
}

/** A signed-in user with no rows in replenishment.user_scope: say so plainly instead of showing empty panels. */
function NoScope({ email }: { email: string | undefined }) {
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
            {email ?? 'you'} yet. Ask your replenishment app admin to add you. The forecast chart below stays available.
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
  const { filters, setFilter } = useGlobalFilters();
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const refresh = useCallback(() => setRevision((r) => r + 1), []);

  const whoami = useAsync('whoami', fetchWhoami);
  const options = useAsync('filters', fetchFilterOptions);
  const filterKey = JSON.stringify(filters);
  const summary = useAsync(`${filterKey}|${revision}`, () => fetchSummary(filters));

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
      <Header email={email} summary={s} />
      <div className="flex">
        <div className="min-w-0 flex-1">
          <div className="sticky top-14 z-20 border-b bg-background/90 px-4 py-2.5 backdrop-blur md:px-8">
            <FilterBar options={options.data} />
          </div>
          <main className="mx-auto max-w-[1680px] space-y-6 px-4 py-6 md:px-8">
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
              <NoScope email={whoami.data?.email} />
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
                onOpen={setSelected}
                onChanged={refresh}
              />
            )}
          </main>
        </div>
        <GenieDock email={email} filters={filters} storeName={store?.location_name} />
      </div>

      <RecommendationSheet
        recommendationId={selected}
        rules={whoami.data?.exceptionRules ?? null}
        onClose={() => setSelected(null)}
        onSaved={refresh}
        onFocusStore={(id) => {
          setFilter('location', id);
          setSelected(null);
        }}
      />
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
