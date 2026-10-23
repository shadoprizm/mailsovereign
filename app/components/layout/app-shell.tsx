import { Cable } from "lucide-react";
import * as React from "react";
import { usePanelRef } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import type { CurrentUser } from "@/features/auth/types";
import type { Mailbox } from "@/features/mailboxes/types";
import { McpConnectionDialog } from "@/features/mcp/connection-dialog";
import type { UnreadCounts } from "@/features/notifications/types";
import type { UpdateStatus } from "@/features/updates/types";
import { UpdateBanner } from "@/features/updates/update-banner";
import { useDesktopShell } from "@/hooks/use-desktop-shell";
import { scrollActiveMobileMailSurfaceToTop } from "@/lib/mobile-scroll";
import type { FolderId } from "@/lib/routes";
import {
  defaultSidebarWidth,
  maximumSidebarWidth,
  minimumSidebarWidth,
  readStoredBoolean,
  readStoredWidth,
  sidebarCollapsedStorageKey,
  sidebarWidthStorageKey,
  storeLayoutValue
} from "./desktop-layout";
import { MobileChrome } from "./mobile-chrome";
import { NetworkStatus } from "./network-status";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";

type AppShellProps = {
  reading?: boolean;
  activeFolder: FolderId;
  children: React.ReactNode;
  mailboxId: string;
  mailboxes: Mailbox[];
  search: string;
  user: CurrentUser;
  updateInProgress: boolean;
  updateReady: boolean;
  updateStatus: UpdateStatus | null;
  unread: UnreadCounts;
  draftCount: number;
  onCompose: () => void;
  onFolderChange: (folder: FolderId) => void;
  onMailboxChange: (mailboxId: string) => void;
  onSearchChange: (search: string) => void;
  onSignedOut: () => void;
  onOpenUpdates: () => void;
};

export function AppShell(props: AppShellProps): React.ReactElement {
  const desktopShell = useDesktopShell();
  const sidebarPanelRef = usePanelRef();
  const [mcpOpen, setMcpOpen] = React.useState(false);
  const mcpTriggerRef = React.useRef<HTMLButtonElement>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(() =>
    readStoredBoolean(sidebarCollapsedStorageKey, false)
  );
  const [initialSidebarWidth] = React.useState(() =>
    readStoredWidth(
      sidebarWidthStorageKey,
      defaultSidebarWidth,
      minimumSidebarWidth,
      maximumSidebarWidth
    )
  );

  const toggleSidebar = React.useCallback((): void => {
    if (sidebarCollapsed) {
      sidebarPanelRef.current?.expand();
      setSidebarCollapsed(false);
      storeLayoutValue(sidebarCollapsedStorageKey, false);
      return;
    }
    sidebarPanelRef.current?.collapse();
    setSidebarCollapsed(true);
    storeLayoutValue(sidebarCollapsedStorageKey, true);
  }, [sidebarCollapsed, sidebarPanelRef]);

  const content = (
    <ShellContent
      {...props}
      sidebarCollapsed={sidebarCollapsed}
      {...(desktopShell ? { onToggleSidebar: toggleSidebar } : {})}
    />
  );
  const mcpAction = (
    <Button
      className="h-8 w-full justify-start gap-2.5 px-2.5 text-[13px] font-normal text-muted-foreground"
      onClick={() => setMcpOpen(true)}
      ref={mcpTriggerRef}
      type="button"
      variant="ghost"
    >
      <Cable data-icon="inline-start" />
      Connect MCP
    </Button>
  );

  return (
    <div
      data-app-shell=""
      className="relative flex h-screen h-[100dvh] touch-manipulation overflow-hidden bg-background pt-[env(safe-area-inset-top)] text-foreground"
    >
      {desktopShell ? (
        <ResizablePanelGroup
          id="sovereign-mail-desktop-shell"
          onLayoutChanged={() => {
            const size = sidebarPanelRef.current?.getSize();
            if (!size) return;
            const collapsed = size.inPixels < 1;
            setSidebarCollapsed(collapsed);
            storeLayoutValue(sidebarCollapsedStorageKey, collapsed);
            if (!collapsed) storeLayoutValue(sidebarWidthStorageKey, Math.round(size.inPixels));
          }}
          orientation="horizontal"
        >
          <ResizablePanel
            collapsedSize={0}
            collapsible
            defaultSize={sidebarCollapsed ? 0 : initialSidebarWidth}
            groupResizeBehavior="preserve-pixel-size"
            id="desktop-sidebar"
            maxSize={maximumSidebarWidth}
            minSize={minimumSidebarWidth}
            onResize={(size) => setSidebarCollapsed(size.inPixels < 1)}
            panelRef={sidebarPanelRef}
          >
            <Sidebar
              activeFolder={props.activeFolder}
              draftCount={props.draftCount}
              mailboxId={props.mailboxId}
              resizable
              unread={props.unread}
              user={props.user}
              utilityAction={mcpAction}
              onFolderChange={props.onFolderChange}
              onSignedOut={props.onSignedOut}
            />
          </ResizablePanel>
          <ResizableHandle
            aria-label="Resize sidebar"
            className={sidebarCollapsed ? "pointer-events-none opacity-0" : undefined}
            disabled={sidebarCollapsed}
            id="desktop-sidebar-divider"
          />
          <ResizablePanel id="desktop-content" minSize={700}>
            {content}
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        content
      )}
      <button
        aria-label="Scroll current view to top"
        data-safe-area-scroll=""
        className="absolute inset-x-0 top-0 z-40 h-[env(safe-area-inset-top)] touch-none cursor-default appearance-none border-0 bg-transparent p-0"
        tabIndex={-1}
        type="button"
        onClick={scrollActiveMobileMailSurfaceToTop}
      />
      <McpConnectionDialog
        open={mcpOpen}
        restoreFocusRef={mcpTriggerRef}
        user={props.user}
        onOpenChange={setMcpOpen}
      />
    </div>
  );
}

function ShellContent({
  reading = false,
  activeFolder,
  children,
  draftCount,
  mailboxId,
  mailboxes,
  search,
  sidebarCollapsed,
  unread,
  updateInProgress,
  updateReady,
  updateStatus,
  user,
  onCompose,
  onFolderChange,
  onMailboxChange,
  onOpenUpdates,
  onSearchChange,
  onSignedOut,
  onToggleSidebar
}: AppShellProps & {
  sidebarCollapsed: boolean;
  onToggleSidebar?: () => void;
}): React.ReactElement {
  const desktopShell = useDesktopShell();
  if (!desktopShell) {
    return (
      <div className="compact-shell flex h-full min-w-0 flex-1 flex-col">
        <MobileChrome
          activeFolder={activeFolder}
          draftCount={draftCount}
          mailboxId={mailboxId}
          mailboxes={mailboxes}
          search={search}
          unread={unread}
          user={user}
          reading={reading}
          onCompose={onCompose}
          onFolderChange={onFolderChange}
          onMailboxChange={onMailboxChange}
          onSearchChange={onSearchChange}
          onSignedOut={onSignedOut}
        >
          <UpdateBanner
            inProgress={updateInProgress}
            ready={updateReady}
            status={updateStatus}
            onOpen={onOpenUpdates}
          />
          <main className="flex h-full min-h-0 flex-col overflow-hidden">
            <NetworkStatus />
            <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
          </main>
        </MobileChrome>
      </div>
    );
  }
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <TopBar
        activeFolder={activeFolder}
        draftCount={draftCount}
        mailboxId={mailboxId}
        mailboxes={mailboxes}
        search={search}
        sidebarCollapsed={sidebarCollapsed}
        unread={unread}
        user={user}
        onCompose={onCompose}
        onFolderChange={onFolderChange}
        onMailboxChange={onMailboxChange}
        onSearchChange={onSearchChange}
        onSignedOut={onSignedOut}
        {...(onToggleSidebar ? { onToggleSidebar } : {})}
      />
      <NetworkStatus />
      <UpdateBanner
        inProgress={updateInProgress}
        ready={updateReady}
        status={updateStatus}
        onOpen={onOpenUpdates}
      />
      <main className="min-h-0 flex-1 overflow-hidden bg-background md:bg-card/30">{children}</main>
    </div>
  );
}
