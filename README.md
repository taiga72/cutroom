# Cutroom

A task tracker for video editing work, built as one self-contained HTML file (`index.html`).

- **Jobs**: an agency (with its own clients) or a direct client. Each job records its own tools for communication, task tracking, review/upload and file storage, plus optional workspace links.
- **Tasks**: status (Not started, In progress, Internal review, Revisions, Done), priority, start and due dates, picture, format (16:9, 9:16, 1:1, 4:5), length, revision round, links (task tracker, upload/review, files), checklist and notes.
- **Views**: Overview across all jobs, a tab per job with client sub-tabs, and List, Board (drag to change status) and Calendar layouts.

When it's published as a claude.ai artifact, data is saved to the artifact's database and pictures are saved to its asset storage. When you open the file directly in a browser, data is saved in that browser's localStorage and the page starts with example data.
