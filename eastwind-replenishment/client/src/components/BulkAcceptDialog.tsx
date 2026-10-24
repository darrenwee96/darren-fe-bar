import { useEffect, useState } from 'react';
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Spinner,
} from '@databricks/appkit-ui/react';
import { CheckCircle2, CircleAlert } from 'lucide-react';
import {
  acceptRoutine,
  ApiError,
  bulkAccept,
  type BulkItem,
  type BulkLineResult,
  type BulkOutcome,
  type ScopeFilters,
} from '../lib/api';
import { formatInt, formatUsd } from '../lib/format';

interface BulkRequestBase {
  units: number;
  /** null when unit cost is masked for the persona. */
  valueAtCost: number | null;
  /** Human label for a line id, used to list lines that could not be accepted. */
  labelFor?: (id: string) => string;
}

/**
 * "routine" = Accept all routine: only the filters and the count + snapshot shown are sent; the server recomputes the
 * set. "selected" = the lines ticked in Needs review, sent by id with the version each row showed.
 */
export type BulkRequest =
  | (BulkRequestBase & { kind: 'routine'; filters: ScopeFilters; expected: { count: number; snapshot: string } })
  | (BulkRequestBase & { kind: 'selected'; items: BulkItem[] });

const WHY: Record<BulkLineResult['status'], string> = {
  200: 'Accepted',
  201: 'Accepted',
  403: 'Outside your planning scope',
  404: 'No longer recommended',
  409: 'Changed by someone else',
  422: 'Nothing to order',
};

/**
 * One confirmation for many lines. The server saves one decision + audit event per line and reports every line it
 * could not accept (scope, version conflict, ...), which this dialog lists instead of hiding.
 */
export function BulkAcceptDialog({
  request,
  email,
  onClose,
  onDone,
  onStale,
}: {
  request: BulkRequest | null;
  email: string | null;
  onClose: () => void;
  /** Called after a save attempt that accepted at least one line, so panels refresh. */
  onDone: (outcome: BulkOutcome) => void;
  /** Called when the server reports the lines changed since the user looked (nothing saved), so panels refresh. */
  onStale: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<BulkOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOutcome(null);
    setError(null);
    setSaving(false);
  }, [request]);

  const n = !request ? 0 : request.kind === 'routine' ? request.expected.count : request.items.length;
  const what = request?.kind === 'routine' ? 'routine lines' : 'selected lines';

  async function confirm() {
    if (!request) return;
    setSaving(true);
    setError(null);
    try {
      const result =
        request.kind === 'routine'
          ? await acceptRoutine(request.filters, request.expected)
          : await bulkAccept(request.items);
      setOutcome(result);
      if (result.accepted > 0) onDone(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
      if (e instanceof ApiError && e.status === 409) onStale();
    } finally {
      setSaving(false);
    }
  }

  const failed = outcome?.results.filter((r) => r.status !== 200 && r.status !== 201) ?? [];

  return (
    <AlertDialog open={request !== null} onOpenChange={(open) => !open && !saving && onClose()}>
      <AlertDialogContent className="sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {outcome
              ? `Accepted ${formatInt(outcome.accepted)} of ${formatInt(outcome.requested)} lines`
              : `Accept ${formatInt(n)} ${what}?`}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              {!outcome && request && (
                <>
                  <p>
                    Orders <span className="font-medium text-foreground tabular-nums">{formatInt(request.units)}</span>{' '}
                    units
                    {request.valueAtCost === null ? (
                      ''
                    ) : (
                      <>
                        {' '}
                        (<span className="tabular-nums">{formatUsd(request.valueAtCost)}</span> at cost)
                      </>
                    )}{' '}
                    at the recommended quantities.
                  </p>
                  <p>
                    Each line is saved as its own decision under {email ?? 'your name'}, marked as a bulk accept and
                    logged in the audit trail. Lines someone else changed in the meantime are skipped and listed here.
                  </p>
                </>
              )}
              {outcome && (
                <p className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
                  {formatInt(outcome.acceptedUnits)} units saved as {formatInt(outcome.accepted)} decisions.
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {failed.length > 0 && (
          <div className="space-y-2" role="status">
            <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <CircleAlert className="h-4 w-4 text-destructive" aria-hidden />
              {formatInt(failed.length)} {failed.length === 1 ? 'line was' : 'lines were'} not accepted
            </p>
            <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border bg-muted/40 p-2 text-xs">
              {failed.map((r) => (
                <li key={r.id} className="flex justify-between gap-3">
                  <span className="truncate text-foreground">{request?.labelFor?.(r.id) ?? r.id}</span>
                  <span className="shrink-0 text-muted-foreground">{WHY[r.status]}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && (
          <Alert variant="destructive" className="py-2">
            <AlertDescription>{/[.!]$/.test(error) ? error : `${error}. Nothing was saved.`}</AlertDescription>
          </Alert>
        )}

        <AlertDialogFooter>
          {outcome || error ? (
            <Button onClick={onClose}>{outcome ? 'Done' : 'Close'}</Button>
          ) : (
            <>
              <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
              <Button onClick={() => void confirm()} disabled={saving || n === 0}>
                {saving && <Spinner className="mr-1.5 h-4 w-4" />}
                Accept {formatInt(n)} lines
              </Button>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
