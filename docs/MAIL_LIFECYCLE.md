# Mail deletion and drafts

Sovereign Mail uses a two-step deletion flow for stored messages. Drafts use a separate private
discard flow.

## Delete a message or conversation

From Inbox, Sent, Starred, Archived, or Catch-all, **Move to Trash** moves the messages represented
by the current conversation view into Trash. It does not permanently remove their content.

From Trash, **Delete permanently** asks for confirmation, then removes the accessible Trash
messages in that conversation from D1 and removes their unreferenced message bodies and
attachments from R2. This action cannot be undone. It does not delete a copy held by a connected
IMAP provider because Sovereign Mail does not write folder moves or deletions back to that
provider. An operator-initiated full provider import can import that provider copy again.

The same mailbox access boundary applies to both actions. A person needs Agent or Manager access
to change or permanently delete mail. One action cannot change a copy in a mailbox that person
cannot access.

Messages left in Trash remain subject to the mailbox Trash retention period. The default period is
30 days.

## Discard a draft

Drafts are private to their author. The author can select **Discard** beside a draft in the Drafts
list or select **Discard draft** in an open composer. Sovereign Mail asks for confirmation, then
removes the draft and its stored attachments. This action cannot be undone.

Sending a draft also removes its saved draft record after delivery is accepted.

## API behavior

- `POST /api/conversations/{messageId}/trash` moves the accessible messages represented by the
  active folder to Trash.
- `DELETE /api/conversations/{messageId}` permanently deletes accessible messages that are already
  in Trash for that conversation.
- `DELETE /api/drafts/{draftId}` deletes a draft owned by the signed-in person.

Permanent conversation deletion and draft deletion write content-free audit events. Audit metadata
does not include senders, recipients, subjects, message bodies, attachment names, or storage keys.
