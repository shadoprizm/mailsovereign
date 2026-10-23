# Mail filtering

Sovereign Mail provides server-side conversation filtering for every mail view. Filters narrow only
the messages and mailboxes the signed-in user is already allowed to read; they never broaden mailbox
access and they do not change message or provider state.

## Filter experience

The conversation header exposes one filter control. It opens a responsive filter panel with quick
presets and composable criteria for:

- sender, recipient, subject, included text, and excluded text;
- received or sent direction;
- read or unread state;
- starred or unstarred state;
- conversations with or without attachments;
- an inclusive local-calendar date range; and
- one private user label.

All populated criteria are combined with **AND**. Free-text search in the top bar remains available
and is combined with the structured filter. The panel validates date ranges before applying them.
Active criteria appear above the conversation list as removable chips, with a single action to clear
the complete filter.

Quick presets set common combinations without hiding their underlying criteria: **Unread**,
**Starred**, **Has attachments**, **Today**, **Last 7 days**, and **Last 30 days**. A user can adjust
any field after choosing a preset.

Filters are intentionally non-destructive and session-scoped. Applying or clearing a filter does not
mark mail read, move mail, assign labels, invoke AI, or synchronize filter state back to an IMAP
provider.

## Matching semantics

A conversation is returned when at least one accessible message satisfies all message-level text,
participant, direction, and date criteria. Read, starred, attachment, and label criteria are evaluated
across the accessible conversation:

- **Unread** means at least one accessible inbound message is unread; **Read** means none are unread.
- **Starred** means at least one accessible message is starred.
- **Has attachments** means at least one accessible message has an attachment.
- A label match uses only assignments owned by the signed-in user.

Text matching is case-insensitive under D1's `LIKE` behavior and treats `%`, `_`, and `\` as literal
characters. The general search field checks subject, sender, recipients, snippet, and plain-text body.
The recipient field checks To, Cc, and Bcc. Excluded text rejects a matching message when the text
appears in any general-search field.

Date inputs represent inclusive local calendar days in the browser. The client sends normalized UTC
boundaries; the API applies the start boundary inclusively and the end boundary exclusively. This
keeps date filtering stable across daylight-saving transitions.

## API behavior

`GET /api/conversations` accepts the existing `folder`, `mailboxId`, `labelId`, `search`, and `cursor`
parameters plus:

- `from`, `to`, `subject`, and `exclude` for bounded text criteria;
- `direction=inbound|outbound`;
- `read=read|unread`;
- `starred=starred|unstarred`;
- `attachments=with|without`; and
- `after` and `before` as ISO timestamps, where `before` is exclusive.

Malformed, oversized, or inverted date filters are rejected with a validation error. Pagination
cursors remain opaque and continue to order matching conversations by latest activity.

## Selecting all matches

The list's selection banner can expand the loaded selection to all matching conversations. Bulk
read/unread uses the same server-side predicates as the list, including mailbox permissions,
search, filters, and private labels. It does not iterate over pages or lose matches as an unread
filter changes during the update. Selection resets whenever this query scope changes.
