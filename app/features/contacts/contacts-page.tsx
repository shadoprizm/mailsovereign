import { ChevronDown, Download, FileUp, Plus, UsersRound } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";

import { listContacts } from "./api";
import { ContactDialog } from "./contact-dialog";
import { ContactImportDialog } from "./contact-import-dialog";
import type { Contact } from "./types";

export function ContactsPage({ search }: { search: string }): React.ReactElement {
  const [contacts, setContacts] = React.useState<Contact[]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<Contact | null>(null);
  const requestVersion = React.useRef(0);

  const refresh = React.useCallback(async (): Promise<void> => {
    const version = ++requestVersion.current;
    setLoading(true);
    try {
      const page = await listContacts({ query: search || undefined });
      if (requestVersion.current !== version) return;
      setContacts(page.contacts);
      setNextCursor(page.nextCursor);
    } catch (error) {
      if (requestVersion.current === version) {
        toast.error(error instanceof Error ? error.message : "Contacts could not be loaded.");
      }
    } finally {
      if (requestVersion.current === version) setLoading(false);
    }
  }, [search]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), search ? 180 : 0);
    return () => window.clearTimeout(timer);
  }, [refresh, search]);

  async function loadMore(): Promise<void> {
    if (!nextCursor || loadingMore) return;
    const version = requestVersion.current;
    setLoadingMore(true);
    try {
      const page = await listContacts({ cursor: nextCursor, query: search || undefined });
      if (requestVersion.current !== version) return;
      setContacts((current) => [
        ...current,
        ...page.contacts.filter((item) => !current.some((existing) => existing.id === item.id))
      ]);
      setNextCursor(page.nextCursor);
    } catch (error) {
      if (requestVersion.current === version) {
        toast.error(error instanceof Error ? error.message : "More contacts could not be loaded.");
      }
    } finally {
      if (requestVersion.current === version) setLoadingMore(false);
    }
  }

  function openEditor(contact: Contact | null): void {
    setSelected(contact);
    setEditorOpen(true);
  }

  return (
    <div className="h-full overflow-y-auto" data-mobile-scroll-surface>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-5 sm:px-6 sm:py-7">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-medium tracking-tight">Contacts</h1>
              {!loading ? (
                <span className="font-mono text-[11px] text-muted-foreground">
                  {contacts.length.toLocaleString()}
                  {nextCursor ? "+" : ""}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Your private address book and composer suggestions.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" type="button" variant="outline" onClick={() => setImportOpen(true)}>
              <FileUp />
              Import
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" type="button" variant="outline">
                  <Download />
                  Export
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <a href="/api/contacts/export?format=vcard">Export vCard</a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href="/api/contacts/export?format=csv">Export CSV</a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" type="button" onClick={() => openEditor(null)}>
              <Plus />
              New contact
            </Button>
          </div>
        </header>

        <section className="overflow-hidden rounded-lg border bg-background">
          {loading ? (
            <div className="grid min-h-56 place-items-center text-sm text-muted-foreground">
              Loading contacts…
            </div>
          ) : contacts.length === 0 ? (
            <EmptyContacts filtered={Boolean(search)} onCreate={() => openEditor(null)} />
          ) : (
            <div className="divide-y">
              {contacts.map((contact) => (
                <ContactRow contact={contact} key={contact.id} onOpen={() => openEditor(contact)} />
              ))}
            </div>
          )}
        </section>

        {nextCursor ? (
          <Button
            className="self-center"
            disabled={loadingMore}
            type="button"
            variant="outline"
            onClick={() => void loadMore()}
          >
            {loadingMore ? "Loading…" : "Load more contacts"}
          </Button>
        ) : null}
      </div>

      <ContactDialog
        contact={selected}
        open={editorOpen}
        onOpenChange={setEditorOpen}
        onSaved={() => void refresh()}
      />
      <ContactImportDialog
        open={importOpen}
        onImported={() => void refresh()}
        onOpenChange={setImportOpen}
      />
    </div>
  );
}

function ContactRow({
  contact,
  onOpen
}: {
  contact: Contact;
  onOpen: () => void;
}): React.ReactElement {
  const primary = contact.emails.find((email) => email.isPrimary) ?? contact.emails[0];
  return (
    <button
      className="grid w-full grid-cols-[2.25rem_minmax(0,1fr)] gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[2.25rem_minmax(0,1fr)_minmax(12rem,0.8fr)] sm:items-center"
      type="button"
      onClick={onOpen}
    >
      <span className="flex size-9 items-center justify-center rounded-full bg-muted text-xs font-medium uppercase text-muted-foreground">
        {initials(contact.displayName)}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{contact.displayName}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {primary?.email}
          {contact.emails.length > 1 ? ` +${contact.emails.length - 1}` : ""}
        </span>
      </span>
      <span className="col-start-2 min-w-0 text-xs text-muted-foreground sm:col-start-auto sm:text-right">
        {contact.company ? <span className="block truncate">{contact.company}</span> : null}
        {contact.phone ? <span className="block truncate">{contact.phone}</span> : null}
      </span>
    </button>
  );
}

function EmptyContacts({
  filtered,
  onCreate
}: {
  filtered: boolean;
  onCreate: () => void;
}): React.ReactElement {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-center">
      <span className="flex size-10 items-center justify-center rounded-md border bg-muted/20">
        <UsersRound className="size-4" />
      </span>
      <div>
        <h2 className="text-sm font-medium">
          {filtered ? "No matching contacts" : "No contacts yet"}
        </h2>
        <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
          {filtered
            ? "Try another name, company, or email address."
            : "Create a contact or import a CSV or vCard address book."}
        </p>
      </div>
      {!filtered ? (
        <Button size="sm" type="button" variant="outline" onClick={onCreate}>
          <Plus />
          New contact
        </Button>
      ) : null}
    </div>
  );
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/u).filter(Boolean);
  return (
    parts
      .slice(0, 2)
      .map((part) => part[0])
      .join("") || "?"
  );
}
