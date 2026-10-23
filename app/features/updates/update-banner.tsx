import { ArrowUpCircle } from "lucide-react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { UpdateStatus } from "./types";

export function UpdateBanner({
  inProgress,
  ready,
  status,
  onOpen
}: {
  inProgress: boolean;
  ready: boolean;
  status: UpdateStatus | null;
  onOpen: () => void;
}): React.ReactElement | null {
  if (ready || (!inProgress && !status?.available)) return null;
  const targetVersion = status?.release.version;
  return (
    <div
      aria-live="polite"
      className="mx-3 mt-3 flex min-h-12 shrink-0 items-center justify-between gap-3 rounded-xl border bg-card px-3 py-2 text-xs shadow-sm md:mx-0 md:mt-0 md:min-h-10 md:rounded-none md:border-x-0 md:border-t-0 md:bg-muted/45 md:px-4 md:py-0 md:shadow-none"
      role="status"
    >
      <div className="flex min-w-0 items-center gap-2">
        {inProgress ? (
          <Spinner
            aria-hidden="true"
            className="size-3.5 text-muted-foreground"
            role="presentation"
          />
        ) : (
          <ArrowUpCircle aria-hidden="true" className="size-4 text-muted-foreground" />
        )}
        <span className="min-w-0 leading-5">
          <strong>{inProgress ? "Update in progress" : "Update available"}</strong>
          {targetVersion ? ` · Sovereign Mail ${targetVersion}` : null}
        </span>
      </div>
      <Button
        className="h-9 shrink-0 px-3 text-xs md:h-7"
        onClick={onOpen}
        type="button"
        variant="outline"
      >
        {inProgress ? "View progress" : "Review update"}
      </Button>
    </div>
  );
}
