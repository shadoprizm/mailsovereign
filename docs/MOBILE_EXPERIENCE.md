# Mobile experience

Sovereign Mail supports daily mail, contacts, setup, and every settings category in
mobile browsers and installed web apps. The same permissions and mail actions apply
on every device. Native applications and offline inbox synchronization are outside
this release.

## Navigation and layout

Compact screens use Mail, Search, and More bottom navigation. Mail restores the last
mail view; Search opens a focused search surface in the current mailbox scope; More
exposes folders, contacts, settings, account controls, appearance, and MCP. A prominent
Compose action is available from mail lists. Readers replace the list and use a
contextual action footer. Back preserves list position, loaded mail, and filters.
Temporary surfaces participate in browser Back without changing existing public URLs.

The desktop split layout requires a fine pointer and at least 1024 pixels of width
and 600 pixels of height. Smaller windows and touch devices use the compact layout.
Controls account for safe areas and the visible keyboard. Editable text is at least
16 pixels; compact interactive controls have targets of at least 44 by 44 pixels.
Long forms and dialogs scroll within the available viewport, with actions reachable.

## Inbox and touch actions

More exposes an explicit Theme picker with Light and Dark options above the folder
list. Light uses warm off-white surfaces, dark text, and visible borders throughout
mail, composition, contacts, and settings. Theme changes apply immediately and are
remembered on this device across navigation, reloads, and browser tabs. The desktop
sidebar retains its theme control. Dark remains the default when no preference exists.

Inbox appearance is Comfortable by default. A Compact option removes message previews
and reduces row spacing without reducing touch targets. The preference is stored on
this device separately for each signed-in account; unavailable browser storage falls
back to the default. Rows show sender, subject, timestamp, unread state, attachments,
and labels. The app never requires horizontal scrolling to reach an action.

On compact screens, messages are separated into softly bordered cards with visible
space between them. Comfortable rows use 16-pixel internal padding, 17-pixel subjects,
and 15-pixel previews with relaxed line spacing. Subjects and previews may each use
two lines rather than squeezing everything into one truncated line. Mail-state icons
distinguish unread, read, and sent messages without fetching sender images. Compact
rows retain the same readable text sizes while reducing padding and hiding previews.
Filters, Organize, and Select show icons with text labels; the conversation count sits
on its own line. Bottom navigation uses larger labels and a filled active background.
These improvements apply in Light and Dark themes; desktop list density is unchanged.

Swiping left reveals Archive in Inbox and Catch-all. Swiping right reveals Mark read
or Mark unread. A tap is required to apply the revealed action; a swipe alone never
mutates mail. Buttons and menus expose the same actions without a gesture. Selection
disables row swipes. Vertical scrolling, pinch zoom, and browser edge navigation take
priority. Failed actions retain the row and offer retry through the same control.

## Reading and composing

Messages retain isolated HTML rendering and remote-image privacy controls. Wide
sender-authored content scrolls within its content area rather than widening the app.
Quoted history and address details expand on demand. Attachments remain accessible.
New messages, replies, and forwards use the complete compact viewport. Optional
recipient fields and composition tools expand on demand. Closing preserves a draft;
discard remains a separate confirmed action.

Draft status distinguishes server saves, unsaved device recovery, and failed saves.
Existing unscoped recovery is migrated only when its draft has been returned by the
authenticated drafts API as belonging to the current person. The newer recovery wins;
the legacy entry is removed only after the account-scoped copy succeeds.
Temporary recovery belongs to the signed-in account and is removed after successful
save, send, discard, or sign-out. Browser storage failures must not interrupt typing.
No inbox bodies or attachments are cached for offline reading, and sends are never
queued for automatic delivery after reconnection. Offline and retry states are visible.

## Product coverage and verification

Login, password setup, workspace setup, contacts and import, drafts, signatures,
organization, AI, MCP, and all settings categories must remain usable on phones.
Compact settings use a category picker; administration records show labelled values
and actions as cards rather than requiring a wide table. Desktop tables remain.

Use synthetic data to check 320, 375, 390, and 430 pixel widths, tablets, landscape,
large text, both themes, restricted roles, keyboard visibility, and background/resume.
Run behavioral browser tests, the required quality gates, and manifest-backed staging
E2E. Real Safari/Chrome and installed iPhone/Android verification are release gates;
emulation alone does not establish that the physical keyboard and safe areas work.

## Development checks

Run `pnpm exec playwright test --config playwright.mobile.config.ts` for synthetic
mobile browser coverage without customer accounts. Set
`SOVEREIGN_MAIL_MOBILE_BROWSER=webkit` to exercise the same suite with WebKit.
The suite uses a local development server; it intercepts API calls and never sends mail.

For a manifest-backed disposable installation, run
`pnpm exec playwright test --config playwright.config.ts app-shell-smoke.spec.ts mobile.spec.ts`
with the existing staging URL, OAuth client ID, and ephemeral owner environment.
The mobile staging test creates and removes only a synthetic draft and attachment;
it does not send mail or change DNS. Required quality gates remain `pnpm check`,
`pnpm deploy:dry-run`, and `pnpm test:pwa`.
