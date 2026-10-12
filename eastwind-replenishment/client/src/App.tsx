import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { useCallback, useState } from 'react';
import { Alert, AlertDescription, AlertTitle, Badge, Button } from '@databricks/appkit-ui/react';
import { Clock, Lock, Moon, Sparkles, Sun, TriangleAlert } from 'lucide-react';
import { ForecastPanel } from './components/ForecastPanel';
import { FilterBar } from './components/FilterBar';
import { KpiStrip } from './components/KpiStrip';
import { OrderQueue } from './components/OrderQueue';
import { RecommendationSheet } from './components/RecommendationSheet';
import { StoreNeedPanel } from './components/StoreNeedPanel';
import { GenieDock } from './genie/GeniePanel';
import { useGenie } from './genie/context';
import { GenieProvider } from './genie/GenieProvider';
import { fetchFilterOptions, fetchSummary, fetchWhoami } from './lib/api';
import { useGlobalFilters } from './lib/filters';
import { formatDate, formatDateTime, titleCase } from './lib/format';
import { useAsync } from './lib/useAsync';
import { useTheme } from './lib/theme';

function Header({ email, freshness }: { email: string | null; freshness: string | null }) {
  const { open, setOpen } = useGenie();
  const { theme, toggle } = useTheme();
  return (
    <header className="sticky top-0 z-30 flex h-[57px] items-center gap-4 border-b bg-card/95 px-4 backdrop-blur md:px-6">
      <div className="flex items-center gap-2.5">
        <div
          aria-hidden
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-[#104281] text-sm font-bold text-primary-foreground shadow-sm"
        >
          E
        </div>
        <div className="leading-tight">
          <h1 className="text-[15px] font-semibold text-foreground">Eastwind Replenishment</h1>
          <p className="text-[11px] text-muted-foreground">Demand &amp; order control panel</p>
        </div>
      </div>
      {freshness && (
        <Badge variant="outline" className="hidden gap-1 font-normal text-muted-foreground lg:inline-flex">
          <Clock className="h-3 w-3" aria-hidden /> {freshness}
        </Badge>
      )}
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
            className="hidden max-w-[220px] truncate md:inline-flex"
            title="Decisions you save are recorded under this identity"
          >
            {email}
          </Badge>
        )}
      </div>
    </header>
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
  const freshness = s?.as_of_date
    ? `Order week ${formatDate(s.as_of_date)} · model v${s.model_version} · loaded ${formatDateTime(s.loaded_at)}`
    : null;

  return (
    <div className="min-h-screen bg-background">
      <Header email={whoami.data?.email ?? null} freshness={freshness} />
      <div className="flex">
        <div className="min-w-0 flex-1">
          <div className="sticky top-[57px] z-20 border-b bg-background/90 px-4 py-2.5 backdrop-blur md:px-6">
            <FilterBar options={options.data} />
          </div>
          <main className="space-y-4 p-4 md:px-6">
            {whoami.error && (
              <Alert variant="destructive">
                <TriangleAlert className="h-4 w-4" />
                <AlertTitle>Could not verify who you are</AlertTitle>
                <AlertDescription>{whoami.error}</AlertDescription>
              </Alert>
            )}
            {noScope && (
              <Alert>
                <Lock className="h-4 w-4" />
                <AlertTitle>No planning scope assigned</AlertTitle>
                <AlertDescription>
                  Order lines and decisions are limited to the regions or stores you plan for, and none are assigned to{' '}
                  {whoami.data?.email}. Ask an app admin to add you to replenishment.user_scope. Forecast and accuracy
                  charts stay available.
                </AlertDescription>
              </Alert>
            )}
            {summary.error && !s && !whoami.error && (
              <Alert variant="destructive">
                <TriangleAlert className="h-4 w-4" />
                <AlertTitle>Order recommendations unavailable</AlertTitle>
                <AlertDescription>{summary.error}</AlertDescription>
              </Alert>
            )}
            <KpiStrip filters={filters} summary={s} loading={summary.loading} error={summary.error} />
            {/*
              Container queries, so the layout follows the space actually left beside the Genie dock:
              queue | charts side by side when the workspace is >= 1560px, otherwise charts on top, queue full width.
            */}
            <div className="@container">
              <div className="grid grid-cols-1 items-start gap-4 @min-[1560px]:grid-cols-[minmax(0,1fr)_400px]">
                <OrderQueue filters={filters} revision={revision} onOpen={setSelected} onChanged={refresh} />
                <div className="order-first grid grid-cols-1 gap-4 @3xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] @min-[1560px]:order-none @min-[1560px]:grid-cols-1">
                  <ForecastPanel filters={filters} scopeLabel={scopeLabel} />
                  <StoreNeedPanel filters={filters} revision={revision} onSelect={(id) => setFilter('location', id)} />
                </div>
              </div>
            </div>
          </main>
        </div>
        <GenieDock email={whoami.data?.email ?? null} filters={filters} storeName={store?.location_name} />
      </div>

      <RecommendationSheet
        recommendationId={selected}
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
