import { Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { createContact, deleteContact, updateContact } from "./api";
import type { Contact, ContactEmailInput, ContactInput } from "./types";

type ContactDialogProps = {
  contact: Contact | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (contact: Contact | null) => void;
};

type ContactDraftEmail = ContactEmailInput & { clientId: string };
type ContactDraft = Omit<ContactInput, "emails"> & { emails: ContactDraftEmail[] };

export function ContactDialog({
  contact,
  open,
  onOpenChange,
  onSaved
}: ContactDialogProps): React.ReactElement {
  const [draft, setDraft] = React.useState<ContactDraft>(() => draftFromContact(contact));
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) setDraft(draftFromContact(contact));
  }, [contact, open]);

  async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    try {
      const input = inputFromDraft(draft);
      const saved = contact ? await updateContact(contact.id, input) : await createContact(input);
      onSaved(saved);
      onOpenChange(false);
      toast.success(contact ? "Contact updated." : "Contact created.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Contact could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(): Promise<void> {
    if (!contact || !window.confirm(`Delete “${contact.displayName}” from your contacts?`)) return;
    setSaving(true);
    try {
      await deleteContact(contact.id);
      onSaved(null);
      onOpenChange(false);
      toast.success("Contact deleted. Recent recipients are unchanged.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Contact could not be deleted.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(90dvh,760px)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{contact ? "Edit contact" : "New contact"}</DialogTitle>
          <DialogDescription>
            This contact is private to your Sovereign Mail account.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-5" onSubmit={(event) => void save(event)}>
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="contact-display-name">Display name</FieldLabel>
              <Input
                autoFocus
                id="contact-display-name"
                maxLength={200}
                placeholder="Ada Lovelace"
                value={draft.displayName}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, displayName: event.target.value }))
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="contact-given-name">Given name</FieldLabel>
              <Input
                id="contact-given-name"
                maxLength={100}
                value={draft.givenName ?? ""}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, givenName: event.target.value || null }))
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="contact-family-name">Family name</FieldLabel>
              <Input
                id="contact-family-name"
                maxLength={100}
                value={draft.familyName ?? ""}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, familyName: event.target.value || null }))
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="contact-company">Company</FieldLabel>
              <Input
                id="contact-company"
                maxLength={200}
                value={draft.company ?? ""}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, company: event.target.value || null }))
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="contact-phone">Phone</FieldLabel>
              <Input
                autoComplete="tel"
                id="contact-phone"
                maxLength={100}
                type="tel"
                value={draft.phone ?? ""}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, phone: event.target.value || null }))
                }
              />
            </Field>
          </FieldGroup>

          <Field>
            <div className="flex items-center justify-between gap-3">
              <FieldLabel>Email addresses</FieldLabel>
              <Button
                disabled={draft.emails.length >= 5}
                size="sm"
                type="button"
                variant="ghost"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    emails: [
                      ...current.emails,
                      {
                        clientId: crypto.randomUUID(),
                        email: "",
                        label: null,
                        isPrimary: current.emails.length === 0
                      }
                    ]
                  }))
                }
              >
                <Plus />
                Add email
              </Button>
            </div>
            <div className="space-y-2">
              {draft.emails.map((email, index) => (
                <EmailEditor
                  email={email}
                  index={index}
                  key={email.clientId}
                  removable={draft.emails.length > 1}
                  onChange={(next) =>
                    setDraft((current) => ({
                      ...current,
                      emails: current.emails.map((item, itemIndex) =>
                        itemIndex === index ? next : item
                      )
                    }))
                  }
                  onMakePrimary={() =>
                    setDraft((current) => ({
                      ...current,
                      emails: current.emails.map((item, itemIndex) => ({
                        ...item,
                        isPrimary: itemIndex === index
                      }))
                    }))
                  }
                  onRemove={() =>
                    setDraft((current) => {
                      const emails = current.emails.filter((_, itemIndex) => itemIndex !== index);
                      if (!emails.some((item) => item.isPrimary) && emails[0]) {
                        emails[0] = { ...emails[0], isPrimary: true };
                      }
                      return { ...current, emails };
                    })
                  }
                />
              ))}
            </div>
          </Field>

          <Field>
            <FieldLabel htmlFor="contact-notes">Notes</FieldLabel>
            <Textarea
              id="contact-notes"
              maxLength={2000}
              rows={4}
              value={draft.notes ?? ""}
              onChange={(event) =>
                setDraft((current) => ({ ...current, notes: event.target.value || null }))
              }
            />
          </Field>

          <DialogFooter className="items-center sm:justify-between">
            {contact ? (
              <Button disabled={saving} type="button" variant="ghost" onClick={() => void remove()}>
                <Trash2 />
                Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex justify-end gap-2">
              <Button
                disabled={saving}
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                disabled={saving || draft.emails.some((email) => !email.email.trim())}
                type="submit"
              >
                {saving ? "Saving…" : "Save contact"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EmailEditor({
  email,
  index,
  removable,
  onChange,
  onMakePrimary,
  onRemove
}: {
  email: ContactDraftEmail;
  index: number;
  removable: boolean;
  onChange: (email: ContactDraftEmail) => void;
  onMakePrimary: () => void;
  onRemove: () => void;
}): React.ReactElement {
  return (
    <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-end">
      <Field className="gap-1.5">
        <FieldLabel htmlFor={`contact-email-${index}`}>Email {index + 1}</FieldLabel>
        <Input
          autoComplete="email"
          id={`contact-email-${index}`}
          maxLength={254}
          required
          type="email"
          value={email.email}
          onChange={(event) => onChange({ ...email, email: event.target.value })}
        />
      </Field>
      <Field className="gap-1.5">
        <FieldLabel htmlFor={`contact-email-label-${index}`}>Label</FieldLabel>
        <Input
          id={`contact-email-label-${index}`}
          maxLength={40}
          placeholder="Work"
          value={email.label ?? ""}
          onChange={(event) => onChange({ ...email, label: event.target.value || null })}
        />
      </Field>
      <div className="flex h-9 items-center gap-1">
        <label className="flex cursor-pointer items-center gap-2 px-2 text-xs text-muted-foreground">
          <input
            checked={email.isPrimary}
            name="primary-contact-email"
            type="radio"
            onChange={onMakePrimary}
          />
          Primary
        </label>
        {removable ? (
          <Button
            aria-label={`Remove email ${index + 1}`}
            size="icon"
            type="button"
            variant="ghost"
            onClick={onRemove}
          >
            <Trash2 />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function draftFromContact(contact: Contact | null): ContactDraft {
  if (!contact) {
    return {
      displayName: "",
      givenName: null,
      familyName: null,
      company: null,
      phone: null,
      notes: null,
      emails: [{ clientId: crypto.randomUUID(), email: "", label: null, isPrimary: true }]
    };
  }
  return {
    displayName: contact.displayName,
    givenName: contact.givenName,
    familyName: contact.familyName,
    company: contact.company,
    phone: contact.phone,
    notes: contact.notes,
    emails: contact.emails.map(({ id, email, label, isPrimary }) => ({
      clientId: id,
      email,
      label,
      isPrimary
    }))
  };
}

function inputFromDraft(draft: ContactDraft): ContactInput {
  return {
    ...draft,
    emails: draft.emails.map(({ email, label, isPrimary }) => ({ email, label, isPrimary }))
  };
}
