import type * as React from "react";

import { useBackDismiss } from "@/hooks/use-back-dismiss";
import { ComposeWindow } from "./compose-window";
import { ThreadComposeSurface } from "./thread-compose-surface";

export function ComposeSurface({
  children,
  formId,
  open,
  presentation,
  sendDisabled,
  status,
  title,
  onOpenChange
}: {
  children: React.ReactNode;
  formId: string;
  open: boolean;
  presentation: "window" | "thread";
  sendDisabled: boolean;
  status: string;
  title: string;
  onOpenChange: (open: boolean) => void;
}): React.ReactElement {
  const close = useBackDismiss(open, () => onOpenChange(false));
  return presentation === "thread" ? (
    <ThreadComposeSurface
      formId={formId}
      sendDisabled={sendDisabled}
      status={status}
      title={title}
      onClose={close}
    >
      {children}
    </ThreadComposeSurface>
  ) : (
    <ComposeWindow
      open={open}
      status={status}
      title={title}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else close();
      }}
    >
      {children}
    </ComposeWindow>
  );
}
