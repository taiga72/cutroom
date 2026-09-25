# Cutroom (shown to users as “Splice & Co.”)

Cutroom is the project name; the app itself is branded **Splice & Co.** (`APP_NAME` and the inline SVG `APP_LOGO` in `index.html`, also the tab icon; `APP_NAME` in `api/_gcal.js` names the Google calendar). Settings can override the name and logo per account. Storage keys and the repo keep the `cutroom` name. It is a task tracker for one video editor's work. Their jobs are either agencies (each with several clients) or direct clients. The app is one file, `index.html`, with no build step. Its only outside dependencies are Google Fonts and, on the hosted copy, supabase-js from jsDelivr. A few Vercel functions in `api/` sit next to it; they use plain `fetch` and no npm packages.

## Where it runs

**Vercel + Supabase (the user's chosen home).** Vercel serves `index.html` and `api/`, and Supabase holds data, pictures and sign-in (Google or an emailed link). Anyone can sign up and gets their own empty tracker. The setup steps for the user are in `SETUP.md`, and the database setup is in `supabase/schema.sql`. Vercel env vars: `SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, CRON_SECRET` (optional `APP_URL`, `STATE_SECRET`).

**claude.ai artifact (the earlier home, still live with the user's old data).** The user started fresh on Supabase, but still uses the artifact to try changes and leave comments, so keep it in step: after changing `index.html`, republish it there too (steps below). The same file runs in both places; in the artifact, `boot()` picks the `db` mode and the Supabase code stays unused. It is:

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

- `jobs`: `name, type ('agency'|'direct'), color, logo, order, tools{comms,tracker,upload,storage}, toolLinks{same keys}`
- `clients`: `jobId, name, logo, order` (only agency jobs have clients)
- `tasks`: `jobId, clientId, clickupId (set by the ClickUp import), name, status, priority, start, due (YYYY-MM-DD), format, length, revision, links{task,upload,file}, thumb (legacy: no longer shown or set; still deleted with the task), notes, checklist[{id,text,done}], created, updated, doneAt, archived, archivedAt`
- `settings/app`: `name, logo, theme ('system'|'light'|'dark'), dayLimit`

Allowed values:

- Statuses: `not_started, in_progress, internal_review, revisions, done`. Moving a task into `revisions` adds 1 to `revision`, and moving it to `done` sets `doneAt`.
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
- **Sidebar (`renderSide`):** Overview, Archived, then a **Jobs** item that folds the job list open or closed (`S.ui.jobsOpen`, remembered). Clients aren't listed in the sidebar; they're tabs on the job page. The open page (Overview, or the current job) drops down List / Board / Calendar (`viewsNav()`); on phones, where the sidebar is a row, the toolbar's `#f-view` select does this instead. Task search (`#q`) sits top-right of the page header (`#top-search`); the toolbar holds the priority, due-date and sort filters plus New task. Settings sits in the footer next to the save status. Edit buttons use `I.pencil`; `I.gear` is the Settings cog.
- **Today (`renderToday`, tab `today`, the default landing page):** a 7-day strip (`weekStrip`) plus Overdue / Due today / In progress / Starting today / Due in the next 3 days, each task listed once. Rows use the shared `rowHtml()` / `ROW_HEAD`.
- **Workload:** `dueLoad()` counts open tasks due per day across all jobs; a day is busy at `dayLimit()` or more (`settings/app.dayLimit`, default 3, set in Settings). Busy days are flagged on Today, on the Calendar (`.busy-tag`), and in the task panel under Dates.
- **ClickUp import (`openImport / renderImport / readClickUp / runImport`, state in `IM`):** reads a ClickUp List CSV export in the browser (no API key). Status names are mapped by keyword (`cuStatus`), priorities 1–4 or by name (`cuPrio`), dates from epoch ms or text (`cuDate`). Imported tasks keep `clickupId` and a ClickUp link in `links.task`; re-importing skips ids already present.
- **Rendering:** `render()` calls `renderSide()` and `renderMain()`. `renderMain` branches to overview, job tab, or `renderArchive()`. The views are `listView / boardView / calendarView`. The task panel is `renderDrawer()`.
- **Modals:** jobs use `openJobModal / renderModal / saveModal` with state in `M`. Settings use `openSettings / renderSettings / closeSettings` with state in `SM`.
- **Images:** logo picks (job, client, app) first go through the crop dialog (`openCrop / renderCrop / useCrop`, state in `CR`, layer `#crop` above `#modal`), which outputs a square PNG. `storeImage()` resizes and uploads, `dropImage()` deletes a replaced asset, and `jobMark() / clientMark()` show a logo, or the color dot when there is none. Tasks have no picture of their own: `taskMark()` shows the client's logo, else the job's logo, else a building icon (lists, board cards, archive and the task panel).
- **Events:** delegated `click / change / input / submit` handlers switch on `data-act`. Give re-rendered inputs a `data-fk` so `withFocus()` keeps focus while typing.

## Conventions

- Git: the user wants every change shipped without asking. Commit to the working branch, push, open a pull request into `main` and merge it yourself (GitHub MCP tools), so Vercel deploys it. Keep the artifact in step as described above.

- Keep the app a single HTML file, and keep the artifact viewer's frame limits in mind. `alert()`, `confirm()` and `prompt()` don't work, so build confirmations in the page (click twice to delete). Use `el.hidden`, not `style.display`.
- The layout must work at phone width (about 400px, breakpoint at 820px).
- Write interface text in plain, specific wording ("Archive", "Restore", "Delete for good").

## Testing

Open the file locally with Playwright to check a change. Chromium is at `/opt/pw-browsers/chromium`, so use `executablePath` and don't run `playwright install`. Opened as a local file, the page runs in localStorage mode with the sample data. Screens redraw on the next animation frame, so wait about 150ms before checking the page. Syntax-check the script with `node --check` after pulling it out of the `<script>` tag. To test the hosted mode without real services, serve the page from a small local server that answers `/api/config`, and use Playwright `route()` to swap the jsDelivr supabase-js URL for a fake `window.supabase.createClient`. Test `api/` by stubbing `global.fetch` in Node.

## Ideas the user may ask for next

- Separate tool links per agency client.
- Rates and invoice/paid status per job, with a monthly "owed" view.
- Time tracking per task.
- Repeating tasks.
- A checklist of assets received from the client.
- Importing from ClickUp directly through its API (today's import reads a CSV export).
