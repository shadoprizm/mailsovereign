import { ChevronDown, LayoutTemplate, Plus, Trash2, Type } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { RichEmailEditor } from "@/features/compose/rich-email-editor";
import type { Mailbox } from "@/features/mailboxes/types";
import { SettingsSection } from "@/features/settings/settings-section";
import {
  createSignature,
  deleteSignature,
  listSignaturePreferences,
  updateSignature,
  updateSignatureDefault
} from "./api";
import { buildProfessionalSignature } from "./professional-signature";
import { ProfessionalSignatureEditor } from "./professional-signature-editor";
import {
  newProfessionalSignatureEditor,
  newSimpleSignatureEditor,
  type SignatureEditorState,
  sendingAddresses,
  signatureEditorFromSignature,
  signatureInput
} from "./signature-editor-state";
import type { SignaturePreferences } from "./types";

const emptyPreferences: SignaturePreferences = { signatures: [], defaults: {} };

export function SignatureSettings({ mailboxes }: { mailboxes: Mailbox[] }): React.ReactElement {
  const [preferences, setPreferences] = React.useState(emptyPreferences);
  const [editor, setEditor] = React.useState<SignatureEditorState | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const identities = sendingAddresses(mailboxes);

  React.useEffect(() => {
    let active = true;
    void listSignaturePreferences()
      .then((next) => {
        if (!active) return;
        setPreferences(next);
        setEditor(next.signatures[0] ? signatureEditorFromSignature(next.signatures[0]) : null);
      })
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : "Signatures could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!editor) return;
    setSaving(true);
    try {
      const saved = editor.id
        ? await updateSignature(editor.id, signatureInput(editor))
        : await createSignature(signatureInput(editor));
      setPreferences((current) => ({
        ...current,
        signatures: [...current.signatures.filter((item) => item.id !== saved.id), saved].sort(
          (left, right) => left.name.localeCompare(right.name)
        )
      }));
      setEditor(signatureEditorFromSignature(saved));
      toast.success(editor.id ? "Signature updated." : "Signature created.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Signature could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!editor?.id || !window.confirm(`Delete the signature “${editor.name}”?`)) return;
    setSaving(true);
    try {
      await deleteSignature(editor.id);
      setPreferences((current) => {
        const signatures = current.signatures.filter((item) => item.id !== editor.id);
        const defaults = Object.fromEntries(
          Object.entries(current.defaults).filter(([, signatureId]) => signatureId !== editor.id)
        );
        setEditor(signatures[0] ? signatureEditorFromSignature(signatures[0]) : null);
        return { signatures, defaults };
      });
      toast.success("Signature deleted. Saved drafts keep their existing content.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Signature could not be deleted.");
    } finally {
      setSaving(false);
    }
  }

  async function changeDefault(address: string, value: string) {
    const signatureId = value === "none" ? null : value;
    try {
      await updateSignatureDefault(address, signatureId);
      setPreferences((current) => {
        const defaults = { ...current.defaults };
        if (signatureId) defaults[address] = signatureId;
        else delete defaults[address];
        return { ...current, defaults };
      });
      toast.success(`Default signature updated for ${address}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Default signature could not be saved.");
    }
  }

  return (
    <SettingsSection
      action={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" type="button">
              <Plus />
              New signature
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setEditor(newProfessionalSignatureEditor())}>
              <LayoutTemplate />
              Professional card
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setEditor(newSimpleSignatureEditor())}>
              <Type />
              Simple rich text
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
      description="Reusable personal signatures and defaults for each From address"
      title="Signatures"
    >
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading signatures…</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
          <div className="flex flex-col gap-1 border-y py-2 lg:border-y-0 lg:border-r lg:py-0 lg:pr-4">
            {preferences.signatures.length ? (
              preferences.signatures.map((signature) => (
                <Button
                  className="justify-start font-normal"
                  key={signature.id}
                  type="button"
                  variant={editor?.id === signature.id ? "secondary" : "ghost"}
                  onClick={() => setEditor(signatureEditorFromSignature(signature))}
                >
                  <span className="truncate">{signature.name}</span>
                </Button>
              ))
            ) : (
              <p className="px-2 py-3 text-xs text-muted-foreground">
                Create a professional card or simple signature, then assign it to one or more From
                addresses.
              </p>
            )}
          </div>
          {editor ? (
            <form className="min-w-0 space-y-5" onSubmit={(event) => void save(event)}>
              <Field>
                <FieldLabel htmlFor="signature-name">Signature name</FieldLabel>
                <Input
                  id="signature-name"
                  maxLength={80}
                  required
                  value={editor.name}
                  onChange={(event) =>
                    setEditor((current) =>
                      current ? { ...current, name: event.target.value } : current
                    )
                  }
                />
                <FieldDescription>Only you see this name.</FieldDescription>
              </Field>
              {editor.design ? (
                <ProfessionalSignatureEditor
                  design={editor.design}
                  onChange={(design) =>
                    setEditor((current) => {
                      if (!current) return current;
                      const content = buildProfessionalSignature(design);
                      return { ...current, ...content, design };
                    })
                  }
                />
              ) : (
                <Field>
                  <FieldLabel>Signature content</FieldLabel>
                  <div className="overflow-hidden rounded-md border">
                    <RichEmailEditor
                      contained={false}
                      html={editor.html}
                      placeholder="Write your signature…"
                      onChange={(html, text) =>
                        setEditor((current) => (current ? { ...current, html, text } : current))
                      }
                    />
                  </div>
                </Field>
              )}
              <div className="flex items-center justify-between gap-3">
                <Button
                  disabled={saving || !editor.name.trim() || !editor.text.trim()}
                  type="submit"
                >
                  {saving ? "Saving…" : "Save signature"}
                </Button>
                {editor.id ? (
                  <Button
                    aria-label="Delete signature"
                    disabled={saving}
                    size="icon"
                    type="button"
                    variant="ghost"
                    onClick={() => void remove()}
                  >
                    <Trash2 />
                  </Button>
                ) : null}
              </div>
            </form>
          ) : null}
        </div>
      )}

      {!loading && identities.length ? (
        <div className="space-y-4 border-t pt-5">
          <div>
            <h3 className="text-sm font-medium">Defaults by From address</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Each address can use a different default. You can still choose manually while writing.
            </p>
          </div>
          <div className="divide-y border-y">
            {identities.map((address) => (
              <div
                className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(14rem,20rem)] sm:items-center"
                key={address}
              >
                <span className="truncate text-sm">{address}</span>
                <Select
                  disabled={preferences.signatures.length === 0}
                  value={preferences.defaults[address] ?? "none"}
                  onValueChange={(value) => void changeDefault(address, value)}
                >
                  <SelectTrigger aria-label={`Default signature for ${address}`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="none">No default signature</SelectItem>
                      {preferences.signatures.map((signature) => (
                        <SelectItem key={signature.id} value={signature.id}>
                          {signature.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </SettingsSection>
  );
}
