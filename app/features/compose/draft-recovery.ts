const legacyPrefix = "sovereign-mail:compose:draft:";
const accountPrefix = "sovereign-mail:compose:account:";

export function writeDraftRecovery(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeDraftRecovery(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* Device storage may be unavailable. */
  }
}

export function clearDraftRecovery(): void {
  try {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith(legacyPrefix) || key?.startsWith(accountPrefix)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    /* Sign-out must remain possible without browser storage. */
  }
}
