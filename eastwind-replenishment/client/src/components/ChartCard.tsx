import type { ReactNode } from 'react';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@databricks/appkit-ui/react';
import { Sparkles } from 'lucide-react';
import { useGenie } from '../genie/context';

/**
 * A titled analysis block. Title = the message; description = subject, measure, period; footer = source.
 * `askGenie` adds a follow-up question that opens the Genie panel pre-filled with it.
 */
export function ChartCard({
  title,
  description,
  source,
  askGenie,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  description: ReactNode;
  source: string;
  askGenie?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const genie = useGenie();
  return (
    <Card className={`min-w-0 ${className ?? ''}`}>
      <CardHeader className="space-y-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="text-base leading-snug">{title}</CardTitle>
          <div className="flex items-center gap-2">
            {actions}
            {askGenie && (
              <Button variant="ghost" size="sm" onClick={() => genie.ask(askGenie)} title={`Ask Genie: ${askGenie}`}>
                <Sparkles className="mr-1 h-4 w-4" /> Ask why
              </Button>
            )}
          </div>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {children}
        <p className="text-xs text-muted-foreground">Source: {source}</p>
      </CardContent>
    </Card>
  );
}
