import * as React from "react";

export type InboxDensity = "comfortable" | "compact";
type MobilePreferences = {
  accountId: string | null;
  density: InboxDensity;
  setDensity: (density: InboxDensity) => void;
};

const Preferences = React.createContext<MobilePreferences>({
  accountId: null,
  density: "comfortable",
  setDensity: () => undefined
});

export function readInboxDensity(accountId: string): InboxDensity {
  try {
    return localStorage.getItem(`sovereign-mail:inbox-density:${accountId}`) === "compact"
      ? "compact"
      : "comfortable";
  } catch {
    return "comfortable";
  }
}

export function MobilePreferencesProvider({
  accountId,
  children
}: {
  accountId: string;
  children: React.ReactNode;
}): React.ReactElement {
  const [density, updateDensity] = React.useState(() => readInboxDensity(accountId));
  const setDensity = React.useCallback(
    (next: InboxDensity) => {
      updateDensity(next);
      try {
        localStorage.setItem(`sovereign-mail:inbox-density:${accountId}`, next);
      } catch {
        // The current session remains usable when device storage is unavailable.
      }
    },
    [accountId]
  );
  const value = React.useMemo(
    () => ({ accountId, density, setDensity }),
    [accountId, density, setDensity]
  );
  return <Preferences.Provider value={value}>{children}</Preferences.Provider>;
}

export const useMobilePreferences = (): MobilePreferences => React.useContext(Preferences);
