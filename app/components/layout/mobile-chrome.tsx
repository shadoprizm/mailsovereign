import { ArrowLeft, Inbox, MailPlus, MoreHorizontal, Search } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { McpConnectionDialog } from "@/features/mcp/connection-dialog";
import { useMobilePreferences } from "@/features/mobile/mobile-preferences";
import { useTheme } from "@/features/theme/theme-provider";
import { useMobileSurface } from "@/hooks/use-mobile-surface";
import { type FolderId, folders } from "@/lib/routes";
import { Sidebar } from "./sidebar";
import type { TopBarProps } from "./top-bar";

export function MobileChrome({
  children,
  reading,
  ...props
}: TopBarProps & {
  children: React.ReactNode;
  reading: boolean;
}): React.ReactElement {
  const { surface, open, close } = useMobileSurface();
  const { density, setDensity } = useMobilePreferences();
  const { theme, setTheme } = useTheme();
  const [mcpOpen, setMcpOpen] = React.useState(false);
  const lastMail = React.useRef<FolderId>("inbox");
  const moreRef = React.useRef<HTMLButtonElement>(null);
  if (props.activeFolder !== "contacts" && props.activeFolder !== "settings") {
    lastMail.current = props.activeFolder;
  }
  const title = folders.find((folder) => folder.id === props.activeFolder)?.label ?? "Mail";
  const searchOpen = surface === "search";
  const changeFolder = (folder: FolderId): void => close(() => props.onFolderChange(folder));

  return (
    <>
      {!reading ? (
        <header
          className="flex min-h-14 shrink-0 items-center gap-2 border-b bg-background px-3"
          data-mobile-header
        >
          {searchOpen ? (
            <>
              <Button aria-label="Close search" size="icon" variant="ghost" onClick={() => close()}>
                <ArrowLeft />
              </Button>
              <Input
                aria-label={props.activeFolder === "contacts" ? "Search contacts" : "Search mail"}
                autoFocus
                className="min-w-0 flex-1"
                placeholder={props.activeFolder === "contacts" ? "Search contacts" : "Search mail"}
                value={props.search}
                onChange={(event) => props.onSearchChange(event.target.value)}
              />
              {props.search ? (
                <Button variant="ghost" onClick={() => props.onSearchChange("")}>
                  Clear
                </Button>
              ) : null}
            </>
          ) : (
            <div className="min-w-0 flex-1 py-1.5">
              <h1 className="truncate text-xl font-semibold">{title}</h1>
              {props.activeFolder !== "contacts" && props.activeFolder !== "settings" ? (
                <select
                  aria-label="Mailbox filter"
                  className="-ml-1 max-w-full bg-transparent px-1 text-sm text-muted-foreground"
                  value={props.mailboxId}
                  onChange={(event) => props.onMailboxChange(event.target.value)}
                >
                  <option value="all">All mailboxes</option>
                  {props.mailboxes.map((mailbox) => (
                    <option key={mailbox.id} value={mailbox.id}>
                      {mailbox.address}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          )}
          {!searchOpen && props.activeFolder !== "settings" ? (
            <Button aria-label="New email" className="gap-2" onClick={props.onCompose}>
              <MailPlus />
              <span>Compose</span>
            </Button>
          ) : null}
        </header>
      ) : null}
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      {!reading ? (
        <nav
          aria-label="Main navigation"
          className="grid shrink-0 grid-cols-3 gap-1 border-t bg-background px-2 pt-1 pb-[env(safe-area-inset-bottom)]"
        >
          <NavItem
            active={
              !surface && props.activeFolder !== "settings" && props.activeFolder !== "contacts"
            }
            label="Mail"
            onClick={() => close(() => props.onFolderChange(lastMail.current))}
          >
            <Inbox />
          </NavItem>
          <NavItem
            active={searchOpen}
            label="Search"
            onClick={() => {
              if (props.activeFolder === "settings") props.onFolderChange(lastMail.current);
              open("search");
            }}
          >
            <Search />
          </NavItem>
          <button
            aria-current={
              surface === "more" ||
              props.activeFolder === "settings" ||
              props.activeFolder === "contacts"
                ? "page"
                : undefined
            }
            className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl text-[13px] font-medium text-muted-foreground aria-[current=page]:bg-muted aria-[current=page]:text-foreground"
            ref={moreRef}
            onClick={() => open("more")}
            type="button"
          >
            <MoreHorizontal />
            <span>More</span>
          </button>
        </nav>
      ) : null}
      <Sheet
        dismissOnBack={false}
        open={surface === "more"}
        onOpenChange={(next) => {
          if (!next) close();
        }}
      >
        <SheetContent
          aria-describedby={undefined}
          className="flex w-full max-w-none flex-col gap-0 overflow-y-auto p-0 sm:max-w-md"
          side="right"
        >
          <SheetTitle className="sr-only">More</SheetTitle>
          <div className="shrink-0 space-y-2 border-b px-5 pb-3 pt-12">
            <label
              className="flex items-center justify-between gap-3 text-sm"
              htmlFor="mobile-theme"
            >
              Theme
              <select
                className="min-h-11 rounded-md border bg-background px-3"
                id="mobile-theme"
                value={theme}
                onChange={(event) => setTheme(event.target.value === "light" ? "light" : "dark")}
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <label
              className="flex items-center justify-between gap-3 text-sm"
              htmlFor="inbox-density"
            >
              Inbox appearance
              <select
                className="min-h-11 rounded-md border bg-background px-3"
                id="inbox-density"
                value={density}
                onChange={(event) =>
                  setDensity(event.target.value === "compact" ? "compact" : "comfortable")
                }
              >
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
            </label>
          </div>
          <Sidebar
            {...props}
            showThemeSwitcher={false}
            variant="drawer"
            mailboxFilter={{
              mailboxes: props.mailboxes,
              value: props.mailboxId,
              onChange: (id) => close(() => props.onMailboxChange(id))
            }}
            onFolderChange={changeFolder}
            utilityAction={
              <Button
                className="min-h-11 w-full justify-start"
                variant="ghost"
                onClick={() => close(() => setMcpOpen(true))}
              >
                Connect MCP
              </Button>
            }
          />
        </SheetContent>
      </Sheet>
      <McpConnectionDialog
        open={mcpOpen}
        restoreFocusRef={moreRef}
        user={props.user}
        onOpenChange={setMcpOpen}
      />
    </>
  );
}

function NavItem({
  active,
  children,
  label,
  onClick
}: {
  active: boolean;
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      aria-current={active ? "page" : undefined}
      className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl text-[13px] font-medium text-muted-foreground aria-[current=page]:bg-muted aria-[current=page]:text-foreground"
      onClick={onClick}
      type="button"
    >
      {children}
      <span>{label}</span>
    </button>
  );
}
