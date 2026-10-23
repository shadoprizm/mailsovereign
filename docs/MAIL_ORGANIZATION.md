# Mail organization

Sovereign Mail provides private, per-user labels and review-first AI organization. Labels organize
the stored Sovereign Mail view of a conversation; they do not create or move folders at a connected
IMAP provider.

## Labels and views

Every user receives eight built-in labels: **Priority**, **Action required**, **Needs reply**,
**Client work**, **Account & security**, **Orders & delivery**, **Receipts**, and **Newsletters**. A
user may create additional labels. Labels and assignments are private to that user, including on
shared mailboxes.

The type labels are deliberately distinct. **Account & security** includes address verification,
one-time codes, password changes, sign-in notices, account linking, and security alerts. **Orders &
delivery** includes order confirmations, shipment updates, and delivery notices. **Receipts** is for
completed payment records and invoices. **Newsletters** is reserved for recurring editorial,
digest, or promotional mail; transactional account, security, verification, order, receipt, and
delivery messages must never be classified as newsletters. **Action required** means the recipient
must complete a step, while **Needs reply** requires an actual reply to a person or organization.

The Inbox label filter creates a focused view. A conversation may have multiple labels. The
filter never expands mailbox access and only returns messages the signed-in user could already read.

Users can select loaded conversations and add or remove labels without invoking a model. Removing a
custom label removes its assignments. Built-in labels cannot be deleted.

## AI organization

From conversation selection, **Organize with AI** sends a bounded summary of selected conversations
to the same configured model path used by Sovereign AI email drafting. Attachments and remote
content are excluded. The model may suggest any label currently owned by the user and must return a
short reason for each suggestion. Small selection previews remain limited to ten conversations so
the suggestions can be reviewed individually.

From the Inbox header, **Organize inbox** defaults to **New mail**. It includes conversations not
covered by one of the user's applied bulk runs, plus previously organized conversations that have
received an inbound message since their most recent applied snapshot. **Entire inbox** is an
explicit alternative for reclassification. Both options show server-calculated conversation counts
and estimate credits for only the selected scope, independent of the current list page or filters.

New-mail eligibility uses the existing per-user processed targets and applied-run snapshot times,
so installations with earlier completed organization runs do not need to repeat them. Successfully
processed conversations with no suggested label are still covered once the run is applied.
Paused, pending-review, and undone runs do not advance that history. Arrival is measured by the
message's local creation time, so late imports with older sender dates are included. New inbound
messages in existing conversations count as new work; read-state or label changes alone do not.
Messages arriving during a run remain eligible for a subsequent run. Other users' organization
history and inaccessible mailboxes cannot affect these counts. With no eligible new mail, Start is
disabled and direct start requests report that there is no new mail to organize.

Starting either scope snapshots its eligible accessible Inbox conversations and queues a
background run. The user starts one run and may close the browser while Sovereign Mail processes
reliable internal batches. The run reports total, processed, suggested, and per-label counts. A
paused run can be resumed without starting over. Only one unfinished inbox run may exist per user.

Completed inbox runs show an aggregate review before labels are applied. Applying the run replaces
previous AI-assigned built-in labels for conversations in the snapshot, which corrects stale or
incorrect classifications, while preserving every manual and custom-label assignment. Undo restores
the AI assignments that existed before the bulk apply and removes only assignments still owned by
that run.

The result is a preview. The user chooses which label suggestions to apply. AI organization never
sends, archives, trashes, marks read, or changes provider-side mail. Invalid, stale, inaccessible,
or unrecognized suggestions are rejected by application code.

Applying a preview records the exact assignments made by that run. Undo removes only assignments
still attributed to that run, so a later manual label choice is preserved. Usage records contain
model and token counts but no subjects, addresses, bodies, or model explanations.

With a [customer-provided API key](AI_PROVIDERS.md), organization uses the same provider
as drafting, needs no Sovereign AI subscription, and consumes no Sovereign credits. Provider
charges apply directly, including for bulk batches.

For built-in models, Fast organization costs one Sovereign AI credit per processed conversation. Quality organization
uses the existing four-times model multiplier and requires a plan that includes the Quality model.
Bulk runs reserve credits one internal batch at a time. Failed batches refund their reservation and
pause the run with its completed progress intact.

## Security and lifecycle

Email content is untrusted model input. The organization prompt has no tools, and label IDs are
validated against the signed-in user's current labels. Routes recheck current mailbox access before
preview, manual assignment, apply, and undo. Each background batch rechecks access before reading
mail. Queue messages contain only opaque run identifiers, never mail content or credentials.

Organization runs and assignments are customer data in D1. Deleting a message or thread cascades
its label assignments and pending preview items. Deleting a user removes that user's labels and
runs. Provider-import purge therefore removes organization data that refers to the purged threads.

## API behavior

- `GET /api/organization/labels` lists the user's labels and accessible conversation counts.
- `POST /api/organization/labels` creates a custom label.
- `DELETE /api/organization/labels/{labelId}` deletes a custom label.
- `POST /api/organization/labels/assign` adds or removes labels from selected conversations.
- `POST /api/organization/preview` creates an AI classification preview.
- `POST /api/organization/runs/{runId}/apply` applies selected preview items.
- `POST /api/organization/runs/{runId}/undo` undoes assignments made by that run.
- `GET /api/organization/bulk/current` returns the latest inbox organization run and progress.
- `GET /api/organization/bulk/availability` returns `{ newCount, totalCount }` for the user's
  accessible Inbox using applied organization history.
- `POST /api/organization/bulk` accepts `{ model, scope: "new" | "all" }`, defaulting to `"new"`,
  snapshots that scope, and queues background organization. A `new` request with no eligible
  conversations returns `409 ORGANIZATION_NO_NEW_MAIL` before AI use or queuing.
- `POST /api/organization/bulk/{runId}/retry` resumes a paused run from its first pending target.
- `POST /api/organization/bulk/{runId}/apply` applies every reviewed suggestion in a completed run.
- `POST /api/organization/bulk/{runId}/undo` restores the AI labels replaced by that run.

Schema changes are defined by migrations `0023_mail_organization.sql` and
`0025_bulk_mail_organization.sql`.
