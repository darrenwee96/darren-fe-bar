import { createBrowserRouter, Navigate, NavLink, Outlet, RouterProvider } from 'react-router';
import { useEffect, useState } from 'react';
import { Badge, Button, Sheet, SheetContent, SheetHeader, SheetTitle, useIsMobile } from '@databricks/appkit-ui/react';
import { Menu, Sparkles } from 'lucide-react';
import { GeniePanel } from './genie/GeniePanel';
import { useGenie } from './genie/context';
import { GenieProvider } from './genie/GenieProvider';
import { ForecastPage } from './pages/ForecastPage';
import { InventoryPage } from './pages/InventoryPage';
import { OverviewPage } from './pages/OverviewPage';
import { RecommendationsPage } from './pages/RecommendationsPage';
import { StoreDetailPage } from './pages/StoreDetailPage';
import { StoresPage } from './pages/StoresPage';
import { fetchWhoami } from './lib/api';

const NAV = [
  { to: '/', label: 'Overview', end: true },
  { to: '/stores', label: 'Stores' },
  { to: '/forecast', label: 'Forecast' },
  { to: '/inventory', label: 'Inventory' },
  { to: '/orders', label: 'Order approval' },
];

const linkClass =
  (block: boolean) =>
  ({ isActive }: { isActive: boolean }) =>
    `${block ? 'block py-2' : 'py-1.5'} px-3 rounded-md text-sm font-medium transition-colors ${
      isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
    }`;

function NavLinks({
  className,
  block = false,
  onClick,
}: {
  className?: string;
  block?: boolean;
  onClick?: () => void;
}) {
  return (
    <nav className={className}>
      {NAV.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end} className={linkClass(block)} onClick={onClick}>
          {n.label}
        </NavLink>
      ))}
    </nav>
  );
}

function AskGenieButton() {
  const { ask } = useGenie();
  return (
    <Button variant="outline" size="sm" onClick={() => ask()}>
      <Sparkles className="mr-1 h-4 w-4" /> Ask Genie
    </Button>
  );
}

function Layout() {
  const isMobile = useIsMobile();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    fetchWhoami()
      .then((w) => setEmail(w.email))
      .catch(() => setEmail(null));
  }, []);

  return (
    <GenieProvider>
      <div className="min-h-screen bg-background flex flex-col">
        <header className="sticky top-0 z-10 border-b bg-background px-4 md:px-6 py-3 flex items-center gap-4">
          <div className="shrink-0">
            <h1 className="text-lg font-semibold text-foreground">Eastwind Gourmet · Demand &amp; Replenishment</h1>
            <p className="text-xs text-muted-foreground">
              Analyst workbench: sales, forecast, inventory, order approval
            </p>
          </div>
          <NavLinks className="hidden lg:flex gap-1" />
          <div className="ml-auto flex items-center gap-2">
            <AskGenieButton />
            {email && (
              <Badge
                variant="outline"
                className="hidden md:inline-flex"
                title="Decisions you save are recorded under this identity"
              >
                {email}
              </Badge>
            )}
            <div className="lg:hidden">
              <Sheet open={mobileNavOpen && isMobile} onOpenChange={setMobileNavOpen}>
                <Button variant="ghost" size="icon" onClick={() => setMobileNavOpen(true)}>
                  <Menu className="h-5 w-5" />
                  <span className="sr-only">Open navigation</span>
                </Button>
                <SheetContent side="left">
                  <SheetHeader>
                    <SheetTitle>Navigation</SheetTitle>
                  </SheetHeader>
                  <NavLinks className="flex flex-col gap-1 px-4" block onClick={() => setMobileNavOpen(false)} />
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6">
          <Outlet />
        </main>
        <GeniePanel email={email} />
      </div>
    </GenieProvider>
  );
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <OverviewPage /> },
      { path: '/stores', element: <StoresPage /> },
      { path: '/stores/:locationId', element: <StoreDetailPage /> },
      { path: '/forecast', element: <ForecastPage /> },
      { path: '/inventory', element: <InventoryPage /> },
      { path: '/orders', element: <RecommendationsPage /> },
      { path: '/recommendations', element: <Navigate to="/orders" replace /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
