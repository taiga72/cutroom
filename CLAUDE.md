# Cutroom

Cutroom is a task tracker for one video editor's work. Their jobs are either agencies (each with several clients) or direct clients. The whole app is one self-contained file, `index.html`, with no build step and no dependencies apart from Google Fonts.

## Where it runs

It's published as a claude.ai artifact, and that page is the one the user actually uses:

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

There are two storage modes, chosen at startup in `boot()`:

- **Published artifact:** the `db` capability, with one collection per type. Pictures are uploaded through the `assets` capability, and the asset id is stored and displayed from `/_blob/<id>`.
- **Opened as a local file:** localStorage (`cutroom.data.v1`), seeded from `buildSample()`. Pictures are stored as data URLs.

Collections (document fields):

- `jobs`: `name, type ('agency'|'direct'), color, logo, order, tools{comms,tracker,upload,storage}, toolLinks{same keys}`
- `clients`: `jobId, name, logo, order` (only agency jobs have clients)
- `tasks`: `jobId, clientId, name, status, priority, start, due (YYYY-MM-DD), format, length, revision, links{task,upload,file}, thumb, notes, checklist[{id,text,done}], created, updated, doneAt, archived, archivedAt`
- `settings/app`: `name, logo, theme ('system'|'light'|'dark')`

Allowed values:

- Statuses: `not_started, in_progress, internal_review, revisions, done`. Moving a task into `revisions` adds 1 to `revision`, and moving it to `done` sets `doneAt`.
- Priorities: `urgent, high, normal, low`.
- `example: true` marks the sample data. The "Clear examples" banner deletes those records.

UI preferences (tab, view, collapsed groups, sort) are kept in localStorage (`cutroom.ui.v1`) and never synced.

## Code map (`index.html`)

- **CSS:** color tokens on `:root` for light, redefined for dark under both `prefers-color-scheme` and `[data-theme="dark"]`. Always style through the tokens. Status colors use `--st-*`.
- **Sample data:** `/*SAMPLE-START*/ … /*SAMPLE-END*/` holds the date helpers plus `buildSample()`.
- **Persistence:** `create / patch / remove / flush`. Writes are optimistic and queued per document. Text fields are debounced with `patch(col, id, p, 600)`.
- **Rendering:** `render()` calls `renderSide()` and `renderMain()`. `renderMain` branches to overview, job tab, or `renderArchive()`. The views are `listView / boardView / calendarView`. The task panel is `renderDrawer()`.
- **Modals:** jobs use `openJobModal / renderModal / saveModal` with state in `M`. Settings use `openSettings / renderSettings / closeSettings` with state in `SM`.
- **Images:** `storeImage()` resizes and uploads, `dropImage()` deletes a replaced asset, and `jobMark() / clientMark()` show a logo, or the color dot when there is none.
- **Events:** delegated `click / change / input / submit` handlers switch on `data-act`. Give re-rendered inputs a `data-fk` so `withFocus()` keeps focus while typing.

## Conventions

- Keep it a single HTML file, and keep the viewer's frame limits in mind. `alert()`, `confirm()` and `prompt()` don't work, so build confirmations in the page (click twice to delete). Use `el.hidden`, not `style.display`.
- The layout must work at phone width (about 400px, breakpoint at 820px).
- Write interface text in plain, specific wording ("Archive", "Restore", "Delete for good").

## Testing

Open the file locally with Playwright to check a change. Chromium is at `/opt/pw-browsers/chromium`, so use `executablePath` and don't run `playwright install`. Opened as a local file, the page runs in localStorage mode with the sample data. Screens redraw on the next animation frame, so wait about 150ms before checking the page. Syntax-check the script with `node --check` after pulling it out of the `<script>` tag.

## Ideas the user may ask for next

- Separate tool links per agency client.
- Rates and invoice/paid status per job, with a monthly "owed" view.
- Time tracking per task.
- Repeating tasks.
- A "Today" view.
- A checklist of assets received from the client.
- Importing tasks from ClickUp.
