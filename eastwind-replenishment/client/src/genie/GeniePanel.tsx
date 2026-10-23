import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  GenieChatInput,
  GenieChatMessageList,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Spinner,
  useIsMobile,
} from '@databricks/appkit-ui/react';
import { PanelRightClose, RotateCcw, ShieldCheck, Sparkles } from 'lucide-react';
import type { ScopeFilters } from '../lib/api';
import { titleCase } from '../lib/format';
import { useGenie } from './context';

/** Starter questions follow the active filters so they answer about what the planner is looking at. */
function suggestionsFor(filters: ScopeFilters, storeName: string | undefined): string[] {
  const where = storeName
    ? ` at ${storeName}`
    : [
        filters.region && `in the ${filters.region} region`,
        filters.channel && `in ${titleCase(filters.channel)} stores`,
      ]
        .filter(Boolean)
        .map((s) => ` ${s}`)
        .join('');
  const category = filters.category ? ` ${filters.category}` : '';
  return [
    `Which${category} store-SKUs${where} need an order to avoid a stockout before Mid-Autumn, ranked by sales lost if not ordered?`,
    `Where did managers override the recommended order${where}, and what reasons did they give?`,
    `How does the 6-week forecast${where} compare with the same festival weeks last year?`,
    `What was waste as a percentage of net sales${where} over the last 13 weeks versus last year?`,
  ];
}

function GenieContent({
  email,
  filters,
  storeName,
  onClose,
}: {
  email: string | null;
  filters: ScopeFilters;
  storeName: string | undefined;
  onClose?: () => void;
}) {
  const { chat, ask } = useGenie();
  const { messages, status, error, reset } = chat;
  const busy = status === 'streaming' || status === 'loading-history';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-[15px] font-semibold text-foreground">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden /> Ask Genie
          </h2>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <Button variant="ghost" size="sm" className="h-7" onClick={reset} disabled={busy}>
                <RotateCcw className="mr-1 h-3.5 w-3.5" /> New
              </Button>
            )}
            {onClose && (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label="Close Genie">
                <PanelRightClose className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Eastwind Gourmet: Demand &amp; Replenishment space</p>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <Badge variant="secondary">{email ?? 'Signed-in user'}</Badge>
          <span className="flex items-center gap-1">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Runs as you (on-behalf-of): only data you can access in
            Unity Catalog
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {messages.length === 0 && !busy ? (
          <div className="h-full space-y-3 overflow-y-auto p-4">
            <Empty className="p-4">
              <EmptyHeader>
                <EmptyTitle className="text-sm">Ask about orders, stock, forecasts or waste</EmptyTitle>
                <EmptyDescription className="text-xs">Suggestions follow your filters:</EmptyDescription>
              </EmptyHeader>
            </Empty>
            <div className="flex flex-col gap-2">
              {suggestionsFor(filters, storeName).map((q) => (
                <Button
                  key={q}
                  variant="outline"
                  className="h-auto justify-start whitespace-normal py-2 text-left text-xs font-normal"
                  onClick={() => ask(q)}
                >
                  {q}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <GenieChatMessageList messages={messages} status={status} className="h-full p-4" />
        )}
      </div>

      <div className="space-y-2 border-t p-3">
        {status === 'streaming' && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <Spinner className="h-3.5 w-3.5" /> Genie is working…
          </p>
        )}
        {status === 'error' && (
          <Alert variant="destructive" className="py-2">
            <AlertDescription>
              {error ?? 'Genie could not answer. Rephrase the question or try again.'}
            </AlertDescription>
          </Alert>
        )}
        <GenieChatInput onSend={(q) => ask(q)} disabled={busy} placeholder="Ask a question about your data" />
        <p className="text-[11px] text-muted-foreground">
          AI-generated from Unity Catalog data. Open &ldquo;SQL Query&rdquo; under an answer to check how it was
          computed before acting on it.
        </p>
      </div>
    </div>
  );
}

/**
 * Ask-your-data panel over the curated Genie space, docked to the right of the control panel on wide screens (the
 * workspace reflows beside it) and a sheet on small screens. Trust cues: who is asking and the identity queries run
 * as, each answer's generated SQL (expandable in the message), live status, and a persistent AI disclaimer.
 */
export function GenieDock(props: { email: string | null; filters: ScopeFilters; storeName: string | undefined }) {
  const { open, setOpen } = useGenie();
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full gap-0 p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Ask Genie</SheetTitle>
            <SheetDescription>Natural-language questions over the Demand &amp; Replenishment space</SheetDescription>
          </SheetHeader>
          <GenieContent {...props} />
        </SheetContent>
      </Sheet>
    );
  }
  if (!open) return null;
  return (
    <aside
      aria-label="Ask Genie"
      className="sticky top-14 h-[calc(100vh-3.5rem)] w-[400px] shrink-0 border-l bg-card xl:w-[440px]"
    >
      <GenieContent {...props} onClose={() => setOpen(false)} />
    </aside>
  );
}
