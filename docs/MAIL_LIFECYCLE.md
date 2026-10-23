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
to move or permanently delete mail. Read access is sufficient to mark mail read or unread. One action cannot change a copy in a mailbox that person
cannot access.

In selection mode, the mailbox header uses two rows: selection controls, count, and Cancel above
a separate row of action buttons. Counts remain fully visible and actions wrap within narrow
mailbox panes and mobile screens without overlapping.

The conversation-list **Select** control enables bulk actions across the conversations currently
loaded in the active view. A person can select individual conversations or select all loaded
conversations, mark them as read or unread, then move them to Archive or Trash where those actions
apply. In Trash, the bulk action is **Delete permanently** and uses the same confirmation and
storage cleanup rules as single-conversation deletion. Successful conversations leave the
selection; any conversation that could not be changed remains selected so the action can be
retried.

After selecting all loaded conversations, **Select all N conversations** expands the selection to
every conversation matching the current folder, mailbox, search, filters, and private label. The
banner identifies this as all matching conversations and offers **Clear selection**. Mark as read
and mark as unread apply to that entire selection in one server-side transaction, without a page
limit. Other bulk actions require a loaded selection and are disabled while all matches are selected.
Changing the folder, mailbox, search, filters, or label clears the selection; deselecting an individual
row returns to the loaded selection. The match is evaluated when the action runs, including mail
that arrived since selection. As with single-conversation read actions, all accessible inbound
messages in matching conversations are updated; inaccessible mailbox copies and outbound mail are
unchanged. A failure leaves the selection available for retry. Counts and unread badges refresh
when the operation finishes.

Messages left in Trash remain subject to the mailbox Trash retention period. The default period is
30 days.

## HTML message display

Sanitized HTML messages render inside an isolated light canvas, independent of the application
theme. Safe embedded presentation rules, colors, and layouts are retained. Scripts, forms,
document metadata, CSS imports, and remote fonts remain blocked.

Embedded raster attachments referenced by Content-ID and bounded raster data images display
without remote permission. Missing or unsupported embedded images have a readable unavailable
placeholder. Remote HTTP/HTTPS images, including responsive sources, picture elements, CSS
backgrounds, and legacy table backgrounds, remain blocked until **Load images** is selected or
the reader has saved **Always load from sender**. The sender preference is private to the reader
and survives reopening messages; one-time permission applies only to the current message view.
Remote requests send no referrer. Loading remote images can disclose that the message was opened.

Blocked images use intentional placeholders rather than browser broken-image icons. The reader
observes actual image loads and errors, provides **Retry images** for failed images, and resizes
when images arrive. An unavailable host or browser-blocked insecure image remains a visible
failure rather than being reported as successfully loaded. Delayed responses from a message that
has been left cannot update another message's content or image permission. Quoted history uses
the same image policy. No mail content or image URLs are written to diagnostic logs.

The reader uses a temporary, same-origin Blob document with an explicit sandbox and restrictive
content policy. Its URL is revoked when the view closes. This also prevents CSS background
requests from inheriting an application referrer, as they can with `srcdoc` documents.
The application document permits these local Blob frames and HTTP/HTTPS images; the reader permits remote
sources only after permission. Bounded raster data is permitted by the reader policy only after
server sanitization. Mailbox access checks protect embedded attachment requests.

## Discard a draft

Drafts are private to their author. The author can select **Discard** beside a draft in the Drafts
list or select **Discard draft** in an open composer. Sovereign Mail asks for confirmation, then
removes the draft and its stored attachments. This action cannot be undone.

Sending a draft also removes its saved draft record after delivery is accepted.

## Disconnect and erase a provider import

**Settings → Connections → Disconnect and erase imported mail** removes the provider
credential immediately, then queues a resumable purge for messages imported through that exact
connection. Each purge batch deletes its D1 message rows and records the corresponding R2 keys
before object deletion, so an interrupted R2 cleanup can be retried without losing its inventory.
Empty conversation rows are removed after their imported messages are deleted.

The purge does not delete sent mail created in Sovereign Mail, mail received through another
connection, or any provider-side copy. A later connection for the same address receives a new
connection identity and is not in scope for the older purge. Owners and admins can see pending,
running, failed, and completed purge status from Connections.

## API behavior

- `POST /api/conversations/bulk-read-state` accepts `{ action: "read" | "unread", filters: { folder,
  ... } }`. Filters use the list endpoint's matching rules without cursor or pagination. Folder is
  required. Access and private-label ownership come from the authenticated user. The atomic result
  contains `conversationCount` (all matching conversations) and `affected` (inbound messages whose
  read state changed). Content-free audit metadata records only action and counts.

- `POST /api/conversations/{messageId}/trash` moves the accessible messages represented by the
  active folder to Trash.
- `DELETE /api/conversations/{messageId}` permanently deletes accessible messages that are already
  in Trash for that conversation.
- `DELETE /api/drafts/{draftId}` deletes a draft owned by the signed-in person.
- `DELETE /api/provider-connections/{providerId}` disconnects a provider and optionally schedules
  erasure of mail attributed to that exact connection.

Permanent conversation deletion and draft deletion write content-free audit events. Audit metadata
does not include senders, recipients, subjects, message bodies, attachment names, or storage keys.
