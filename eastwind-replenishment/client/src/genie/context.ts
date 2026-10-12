import { createContext, useContext } from 'react';
import type { UseGenieChatReturn } from '@databricks/appkit-ui/react';

export interface GenieContextValue {
  chat: UseGenieChatReturn;
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Open the panel and, if given, send a question. */
  ask: (question?: string) => void;
}

export const GenieContext = createContext<GenieContextValue | null>(null);

export function useGenie(): GenieContextValue {
  const ctx = useContext(GenieContext);
  if (!ctx) throw new Error('useGenie must be used inside <GenieProvider>');
  return ctx;
}
