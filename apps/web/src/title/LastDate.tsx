import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';

interface LastDate {
  /** The last date typed into a mark form on this page, as it was typed. */
  value: string;
  remember: (value: string) => void;
}

const LastDateContext = createContext<LastDate>({ value: '', remember: () => {} });

/**
 * What the mark form opened with last time, kept for the page.
 *
 * A season entered cell by cell is the same year typed thirty times. Held
 * above the grid rather than in the form, since the popover unmounts the form
 * when it closes; keyed on the title by the route, so the next title's page
 * opens blank rather than with the last one's year. Without a provider — the
 * add screen — the form is blank every time.
 */
export function LastDateProvider({ children }: { children: ReactNode }) {
  const [value, remember] = useState('');
  const last = useMemo(() => ({ value, remember }), [value]);
  return <LastDateContext.Provider value={last}>{children}</LastDateContext.Provider>;
}

export const useLastDate = () => useContext(LastDateContext);
