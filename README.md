# Cutroom (Splice & Co.)

A task tracker for video editing work, built as one self-contained HTML file (`index.html`).

- **Jobs**: an agency (with its own clients) or a direct client. Each job records its own tools for communication, task tracking, review/upload and file storage, plus optional workspace links.
- **Tasks**: status (Not started, In progress, Internal review, Revisions, Done), priority, start and due dates, picture, format (16:9, 9:16, 1:1, 4:5), length, revision round, links (task tracker, upload/review, files), checklist and notes.
- **Views**: Overview across all jobs, a tab per job with client sub-tabs, and List, Board (drag to change status) and Calendar layouts.

Cutroom runs in three places, and picks the right storage when it starts:

- **Hosted on Vercel with Supabase:** sign in with Google or an emailed link. Data lives in Supabase and pictures in Supabase Storage. Open tasks with due dates can sync to a "Cutroom" Google Calendar. See [SETUP.md](SETUP.md) to set it up.
- **Published as a claude.ai artifact:** data is saved to the artifact's database and pictures to its asset storage.
- **Opened directly as a file:** data is saved in that browser's localStorage and the page starts with example data.

## Files

- `index.html`: the whole app.
- `api/`: Vercel functions for the Supabase settings and Google Calendar sync. There's no build step and no npm packages.
- `supabase/schema.sql`: tables, row level security and the pictures bucket.
- `vercel.json`: function timeout and the daily calendar sync.
