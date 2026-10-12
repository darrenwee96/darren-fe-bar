import { useLocation } from 'react-router';
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
} from '@databricks/appkit-ui/react';
import { RotateCcw, ShieldCheck } from 'lucide-react';
import { useGenie } from './context';

const SUGGESTIONS: Record<string, string[]> = {
  '/': [
    'Which channel had the highest stockout day rate over the last 13 weeks?',
    'What was waste as a percentage of net sales by channel over the last 52 weeks?',
    'Which highway stores face the highest Mid-Autumn stockout risk?',
  ],
  '/stores': [
    'Which 5 stores had the highest stockout day rate over the last 13 weeks?',
    'Which region has the most sales at risk from high stockout risk?',
    'Which 5 downtown stores have the largest recommended order value at cost?',
  ],
  '/forecast': [
    'What is total expected mooncake demand for each forecast week?',
    "Compare the model's WMAPE with the same-week-last-year baseline by channel for the Mid-Autumn 2025 backtest.",
    'Which categories are forecast to grow most vs the same weeks last year?',
  ],
  '/inventory': [
    'How many store-SKUs are at high overstock risk and how much stock value is expected to expire?',
    'Which products had their recommended order capped by shelf life most often?',
    'Which categories have the most store-SKUs at high stockout risk?',
  ],
  '/orders': [
    'Where did managers override the recommended order?',
    'How many order lines are recommended and what is the order value at cost by channel?',
    'Which stores have the largest recommended order value at cost?',
  ],
};

function suggestionsFor(pathname: string): string[] {
  const key = Object.keys(SUGGESTIONS)
    .filter((k) => (k === '/' ? pathname === '/' : pathname.startsWith(k)))
    .sort((a, b) => b.length - a.length)[0];
  return SUGGESTIONS[key ?? '/'];
}

/**
 * Ask-your-data panel over the curated Genie space. Trust cues: who is asking and the identity queries run as,
 * each answer's generated SQL (expandable in the message), live status, and a persistent AI disclaimer.
 */
export function GeniePanel({ email }: { email: string | null }) {
  const { chat, open, setOpen, ask } = useGenie();
  const { messages, status, error, reset } = chat;
  const { pathname } = useLocation();
  const busy = status === 'streaming' || status === 'loading-history';

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="border-b p-4">
          <div className="flex items-center justify-between gap-2 pr-8">
            <SheetTitle>Ask Genie</SheetTitle>
            {messages.length > 0 && (
              <Button variant="ghost" size="sm" onClick={reset} disabled={busy}>
                <RotateCcw className="mr-1 h-4 w-4" /> New conversation
              </Button>
            )}
          </div>
          <SheetDescription>Eastwind Gourmet: Demand &amp; Replenishment space</SheetDescription>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">{email ?? 'Signed-in user'}</Badge>
            <span className="flex items-center gap-1">
              <ShieldCheck className="h-3.5 w-3.5" /> Runs as you (on-behalf-of): answers only use data you can access
              in Unity Catalog.
            </span>
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-hidden">
          {messages.length === 0 && !busy ? (
            <div className="space-y-3 p-4">
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>Ask about sales, stockouts, forecasts or orders</EmptyTitle>
                  <EmptyDescription>Try a question for this page:</EmptyDescription>
                </EmptyHeader>
              </Empty>
              <div className="flex flex-col gap-2">
                {suggestionsFor(pathname).map((q) => (
                  <Button
                    key={q}
                    variant="outline"
                    className="h-auto justify-start whitespace-normal py-2 text-left"
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

        <div className="space-y-2 border-t p-4">
          {status === 'streaming' && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Spinner className="h-4 w-4" /> Genie is working…
            </p>
          )}
          {status === 'error' && (
            <Alert variant="destructive">
              <AlertDescription>
                {error ?? 'Genie could not answer. Rephrase the question or try again.'}
              </AlertDescription>
            </Alert>
          )}
          <GenieChatInput
            onSend={(q) => ask(q)}
            disabled={busy}
            placeholder="e.g. Which airport stores had the most waste last quarter?"
          />
          <p className="text-xs text-muted-foreground">
            AI-generated from Unity Catalog data via Genie. Open &ldquo;SQL Query&rdquo; under an answer to check how it
            was computed before acting on it.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
