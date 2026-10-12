import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useGenieChat } from '@databricks/appkit-ui/react';
import { GenieContext } from './context';

/** One Genie conversation for the whole app, so it survives page changes and closing the panel. */
export function GenieProvider({ children }: { children: ReactNode }) {
  const chat = useGenieChat({ alias: 'default', persistInUrl: false });
  // Docked open by default on wide screens, where the workspace still has room beside it.
  const [open, setOpen] = useState(() => window.innerWidth >= 1600);
  const { sendMessage, status } = chat;

  const ask = useCallback(
    (question?: string) => {
      setOpen(true);
      if (question && status !== 'streaming') sendMessage(question);
    },
    [sendMessage, status]
  );

  const value = useMemo(() => ({ chat, open, setOpen, ask }), [chat, open, ask]);
  return <GenieContext.Provider value={value}>{children}</GenieContext.Provider>;
}
