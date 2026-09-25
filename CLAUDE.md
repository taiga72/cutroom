# Cutroom (shown to users as “Splice & Co.”)

Cutroom is the project name; the app itself is branded **Splice & Co.** (`APP_NAME` and the inline SVG `APP_LOGO` in `index.html`, also the tab icon; `APP_NAME` in `api/_gcal.js` names the Google calendar). Settings can override the name and logo per account. Storage keys and the repo keep the `cutroom` name. It is a task tracker for one video editor's work. Their jobs are either agencies (each with several clients) or direct clients. The app is one file, `index.html`, with no build step. Its only outside dependencies are Google Fonts and, on the hosted copy, supabase-js from jsDelivr. A few Vercel functions in `api/` sit next to it; they use plain `fetch` and no npm packages.

## Where it runs

**Vercel + Supabase (the user's chosen home).** Vercel serves `index.html` and `api/`, and Supabase holds data, pictures and sign-in (Google or an emailed link). Anyone can sign up and gets their own empty tracker. The setup steps for the user are in `SETUP.md`, and the database setup is in `supabase/schema.sql`. Vercel env vars: `SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, CRON_SECRET` (optional `APP_URL`, `STATE_SECRET`).

**claude.ai artifact (the earlier home, still live with the user's old data).** The user asked to stop updating it: don't republish it unless they ask again. The steps below are kept for that case. The same file would still run there (`boot()` picks the `db` mode). It is:

- https://claude.ai/artifact/5F6f4sKQL5g76faB281jVg
  (the same artifact is also reachable at https://claude.ai/code/artifact/225c7408-57c3-4ab8-8bad-2a170308b077)

The user's real jobs, tasks and pictures live in that artifact's database and asset storage, not in this repo.

### Republishing (don't lose the user's data)

- Update the page in place: publish `index.html` with the Artifact tool and pass the URL above as `url`. Publishing without `url` creates a separate, empty artifact.
- Read the artifact first (`action: "read"`). Build on the live version if it differs from the repo.
- Leave `capabilities` out when republishing, so the stored `{db: {}, assets: {}}` carries forward. Never pass `{}`, because that removes the page's access to its saved data.
- Don't reseed or overwrite the database. It holds the user's real work.
- After publishing, commit the same `index.html` here so the repo matches the live page.

### Feedback via comments

The user leaves requests as comments on the artifact and sends them to Claude. Ask to watch the artifact (ArtifactComments `watch`) at the start of a session. For each request: make the change, republish, commit, then reply in the thread saying what changed and resolve it.

## Data model

There are three storage modes, chosen at startup in `boot()`, in this order:

- **Published artifact:** the `db` capability, with one collection per type. Pictures are uploaded through the `assets` capability, and the asset id is stored and displayed from `/_blob/<id>`.
- **Hosted (`cloudBoot()`):** when `/api/config` returns Supabase settings. The page shows a sign-in screen (`showAuth`) until there's a session. Each document is a row in `docs(user_id, col, id, data jsonb)`, and every write upserts the whole document (`cloudPut / cloudDel`). Changes from other devices come in through `cloudRefresh()`, which reloads every 60s and when the tab regains focus, and is skipped while writes are still on the way. Pictures are stored as `sb:<uid>/<file>` in the public `pictures` bucket.
- **Opened as a local file:** localStorage (`cutroom.data.v1`), seeded from `buildSample()`. Pictures are stored as data URLs.

Collections (document fields):

- `jobs`: `name, type ('agency'|'direct'), color, logo, order, tools{comms,tracker,upload,storage}, toolLinks{same keys}, work{days[0-6], hours, shiftStart, shiftEnd (HH:MM, the user's time), pay{amount, currency, period, payday, method}, location, tz (IANA), contact{name, reach}, since, notes}`
- `clients`: `jobId, name, logo, order, brand` (only agency jobs have clients)
- `brand` (on a client, or on a direct-client job): `colors[{hex,name}], fonts{head,body}, captions, logo, endcard, cta, music, loudness, dos, donts (one per line), tone, links{guide,assets,refs}, pdfs[{v,name,size,added}], updated, log[{date,text}]`
- `tasks`: `jobId, clientId, clickupId (legacy, from a removed ClickUp import), name, status, priority, start, due (YYYY-MM-DD), format, length, revision, links{task,upload,file}, thumb (legacy: no longer shown or set; still deleted with the task), notes, checklist[{id,text,done}], created, updated, doneAt, archived, archivedAt`
- `settings/app`: `name, logo, theme ('system'|'light'|'dark'), dayLimit`

Allowed values:

- Statuses, in this display order (user's choice): `waiting_client, not_started, in_progress, internal_review, revisions, client_review, done`. `isClosed()` marks closed tasks (done, plus the removed `dropped`, which `migrateStatuses()` moves to done on load): they don't count as open, overdue or busy, get no notifications and no calendar events, and can be archived. Moving a task into `revisions` adds 1 to `revision`, and moving it to `done` sets `doneAt`.
- Priorities: `urgent, high, normal, low`.
- `example: true` marks the sample data. The "Clear examples" banner deletes those records.

UI preferences (tab, view, collapsed groups, sort) are kept in localStorage (`cutroom.ui.v1`) and never synced.

## Google Calendar (hosted only)

- Each open, non-archived task with a `due` date becomes one all-day event in a "Cutroom" calendar created by the app (scope `calendar.app.created`). The title is `Job · Client · Task`, and the event color follows the job's color (`colorIdFor()` maps the job swatches to distinct Google event colors, other hex values to the nearest one). The event carries `extendedProperties.private.cutroomId`.
- `api/_gcal.js` → `syncUser()` reconciles the calendar with the tasks: it creates, updates and deletes events, and recreates the calendar if the user deleted it. The page calls `POST /api/calendar?action=sync` 4s after any job, client or task write (`calSoon`). `/api/cron` runs it daily for everyone.
- The refresh tokens live in `gcal_links`, which has RLS on and no policies, so only the service role can read it.
- Other routes: `api/calendar.js` (`status | connect | sync | disconnect`, which needs the Supabase bearer token), `api/calendar-callback.js` (Google redirect, with signed `state`) and `api/config.js`.
- The Settings modal shows Google Calendar and Account (sign out) sections from `accountSettingsHtml()`. They act right away, not on Save.

## Code map (`index.html`)

- **CSS:** color tokens on `:root` for light, redefined for dark under both `prefers-color-scheme` and `[data-theme="dark"]`. Always style through the tokens. Status colors use `--st-*`.
- **Sample data:** `/*SAMPLE-START*/ … /*SAMPLE-END*/` holds the date helpers plus `buildSample()`.
- **Persistence:** `create / patch / remove / flush`. Writes are optimistic and queued per document. Text fields are debounced with `patch(col, id, p, 600)`.
- **Sidebar (`renderSide`):** Overview, Archived, then a **Jobs** item that folds the job list open or closed (`S.ui.jobsOpen`, remembered). Clients aren't listed in the sidebar; they're tabs on the job page. Task search (`#q`) sits top-right of the page header (`#top-search`). The toolbar holds the List / Board / Calendar switch (`.seg`, back in the toolbar at the user's request; don't move it to the sidebar), the priority, due-date and sort filters, and New task. Settings sits in the footer on its own line under the save status. Edit buttons use `I.pencil`; `I.gear` is the Settings cog.
- **Workload:** `dueLoad()` counts open tasks due per day across all jobs; a day is busy at `dayLimit()` or more (`settings/app.dayLimit`, default 3, set in Settings). Busy days are flagged on the Calendar (`.busy-tag`), in the task panel under Dates, and in notifications.
- **Notifications (`notifications / renderBell / openNote`):** the bell top-right, next to search (`#bell`, panel `#notes`). The list is rebuilt from the tasks on every render: overdue, due today, due tomorrow (with checklist steps left), busy days in the next 7, starting today but not started, stuck in Internal review or Revisions for 3 or more days (by `updated`), revision round 3 or more, and urgent or high priority with no due date. Clicking one opens its task (a busy day opens the Calendar). Read and dismissed keys are kept per device in localStorage (`cutroom.notes.v1`). Keys include the date they refer to, so a moved deadline notifies again. The user removed the earlier Today page; don't bring it back.
- **Work details (`workOf / workForm / workCard`):** per-job schedule, pay, location and contact, edited in the job modal ("Work details", inputs use `data-mw="path"`) and shown in the job page's **Details** tab (`detailsPane`), next to Tasks and Brand guide. The Details tab also holds the job's tool boxes (`toolsHtml`), which are no longer in the header. The job header is just the name with a pencil (Edit job) and the type. The Tasks / Details / Brand guide tabs and client tabs render into `#subnav`, a full-width row below the header. Overview job cards show days, hours and the client's local time, and the Overview header totals scheduled hours per week. Time differences come from `Intl` (`tzOffset`, `tzDiff`) against this device's time zone (`MY_TZ`). A 60-second timer re-renders so the "time there" stays current. The user is paid a fixed monthly amount, so pay is information only: no invoicing or time tracking.
- **Brand guides (`brandOf / brandPanel / brandForTask / openBrand / saveBrand`, state in `BM`):** agency clients each have one, and direct-client jobs have one on the job. A task uses its client's guide, or its job's when it has no client (`brandHome`). It lives in the job page's own **Brand guide** tab (`S.ui.pane`, set by the Tasks / Brand guide tabs under the job header; `brandPane()` shows the direct client's guide, the selected client's, or one card per client on "All clients"). The user found it too busy above the task list, so keep it out of the Tasks tab. It also shows and as a collapsible section in the task panel, with "Add do's & don'ts to checklist" (`brandToChecklist`, which skips duplicates). Saving adds a change-log entry (the user's note, or a list of what changed). PDFs upload through `storeFile()`: artifact assets, Supabase `pictures` bucket (PDFs allowed since schema update), or a data URL up to 2.5 MB locally.
- **Rendering:** `render()` calls `renderSide()` and `renderMain()`. `renderMain` branches to overview, job tab, or `renderArchive()`. The views are `listView / boardView / calendarView`. The task panel is `renderDrawer()`.
- **Modals:** jobs use `openJobModal / renderModal / saveModal` with state in `M`. Settings use `openSettings / renderSettings / closeSettings` with state in `SM`.
- **Images:** logo picks (job, client, app) first go through the crop dialog (`openCrop / renderCrop / useCrop`, state in `CR`, layer `#crop` above `#modal`), which outputs a square PNG. `storeImage()` resizes and uploads, `dropImage()` deletes a replaced asset, and `jobMark() / clientMark()` show a logo, or the color dot when there is none. Tasks have no picture of their own: `taskMark()` shows the client's logo, else the job's logo, else a building icon (lists, board cards, archive and the task panel).
- **Backup (`downloadBackup / readBackup / runRestore`, in Settings):** downloads every collection as `splice-co-backup-DATE.json`. Restoring re-creates each document by id (adds missing ones, overwrites matching ones, deletes nothing). Pictures and PDFs aren't in the file; the backup keeps their references.
- **Hover labels (`showTip`):** any `[title]` (moved to `data-tip`) or icon-only button with an `aria-label` gets a styled label on hover (mouse devices only). Give new icon buttons a `title`.
- **Narrow screens (≤820px):** the sidebar becomes a slide-in panel (`openSide / closeSide`, ☰ in `#mtop`). The top bar keeps the logo, name, search and bell; `placeTopRight()` moves `.top-right` between the header and `#mtop-slot`. The phone CSS block sits at the end of the stylesheet so it wins. Keep phone layouts compact: one-row stats, sideways-scrolling job cards, and an icon-only toolbar (view icons, a Filter button that opens the `#filter-sheet` pop-up with the priority, due and sort selects, which `openFilters / closeFilters` move in and out, and a + for New task). List rows put the status beside the name, above the due date. The Calendar fits the screen with small event bars. Empty status groups show only their header and a small + Add.
- **Events:** delegated `click / change / input / submit` handlers switch on `data-act`. Give re-rendered inputs a `data-fk` so `withFocus()` keeps focus while typing.

## Conventions

- Git: the user wants every change shipped without asking. Commit to the working branch, push, open a pull request into `main` and merge it yourself (GitHub MCP tools), so Vercel deploys it. Don't republish the artifact (the user no longer wants it updated).

- Keep the app a single HTML file, and keep the artifact viewer's frame limits in mind. `alert()`, `confirm()` and `prompt()` don't work, so build confirmations in the page (click twice to delete). Use `el.hidden`, not `style.display`.
- The layout must work at phone width (about 400px, breakpoint at 820px).
- Write interface text in plain, specific wording ("Archive", "Restore", "Delete for good").

## Testing

Open the file locally with Playwright to check a change. Chromium is at `/opt/pw-browsers/chromium`, so use `executablePath` and don't run `playwright install`. Opened as a local file, the page runs in localStorage mode with the sample data. Screens redraw on the next animation frame, so wait about 150ms before checking the page. Syntax-check the script with `node --check` after pulling it out of the `<script>` tag. To test the hosted mode without real services, serve the page from a small local server that answers `/api/config`, and use Playwright `route()` to swap the jsDelivr supabase-js URL for a fake `window.supabase.createClient`. Test `api/` by stubbing `global.fetch` in Node.

## Ideas the user may ask for next

- Separate tool links per agency client.
- A checklist of assets received from the client.
