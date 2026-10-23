import * as React from "react";

import { listMailLabels } from "./api";
import type { MailLabel } from "./types";

export function useMailLabels(userId: string | null): {
  labels: MailLabel[];
  refresh: () => Promise<void>;
} {
  const [labels, setLabels] = React.useState<MailLabel[]>([]);
  const refresh = React.useCallback(async () => {
    if (!userId) {
      setLabels([]);
      return;
    }
    setLabels(await listMailLabels());
  }, [userId]);

  React.useEffect(() => {
    void refresh().catch(() => setLabels([]));
  }, [refresh]);

  return { labels, refresh };
}
