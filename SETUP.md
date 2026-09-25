# Putting Cutroom online (Vercel + Supabase + Google)

This takes about 30 minutes. You'll use four websites: Vercel, Supabase, Google Cloud and GitHub. Nothing here costs money on the free plans.

Where it says `YOUR-SITE`, use your Vercel address without `https://`, e.g. `cutroom-kim.vercel.app`.

## 1. Vercel: get the site address

1. Sign in at [vercel.com](https://vercel.com) with your GitHub account.
2. **Add New… → Project**, then import the **cutroom** repository.
3. Framework Preset: **Other**. Leave Build Command and Output Directory empty. Click **Deploy**.
4. When it's done, copy the address it shows (e.g. `cutroom-kim.vercel.app`). That's `YOUR-SITE`.

The page opens now, but it saves only in your browser until the steps below are done.

## 2. Supabase: the database

1. Sign in at [supabase.com](https://supabase.com) and click **New project**. Pick a name, a database password (save it somewhere) and the region closest to you.
2. When the project is ready, open **SQL Editor**, paste the whole of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**. It should say "Success. No rows returned".
3. Open **Project Settings → API** (or **API Keys**) and keep this tab open. You'll need:
   - **Project URL**, e.g. `https://abcd1234.supabase.co`
   - **anon / public** key
   - **service_role** key. This one is secret: never paste it anywhere but Vercel.

## 3. Google Cloud: sign-in and Calendar access

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a project called **Cutroom**.
2. **APIs & Services → Library**: search for **Google Calendar API** and click **Enable**.
3. **Google Auth Platform → Branding** (older screens: *OAuth consent screen*): app name **Cutroom**, your email as support and developer contact. User type: **External**.
4. **Data Access → Add or remove scopes**: add `https://www.googleapis.com/auth/calendar.app.created` and save.
5. **Audience**: click **Publish app** so it's "In production". If you skip this, Google disconnects the calendar every 7 days. You don't need to submit it for verification.
6. **Clients → Create client** (older screens: *Credentials → Create credentials → OAuth client ID*). Type: **Web application**. Under **Authorized redirect URIs**, add both:
   - `https://abcd1234.supabase.co/auth/v1/callback` (your Supabase Project URL + `/auth/v1/callback`)
   - `https://YOUR-SITE/api/calendar-callback`
7. Save, then copy the **Client ID** and **Client secret**.

## 4. Supabase: turn on sign-in

1. **Authentication → Sign In / Providers → Google**: switch it on, paste the Client ID and Client secret, and save.
2. **Email** is on already. It's what sends the sign-in links.
3. **Authentication → URL Configuration**:
   - Site URL: `https://YOUR-SITE`
   - Redirect URLs: add `https://YOUR-SITE/**`

Supabase's built-in email only sends a few sign-in emails an hour. That's fine for you. If more people sign up, add your own email service under **Authentication → Emails → SMTP Settings**.

## 5. Vercel: add the keys

In your Vercel project, open **Settings → Environment Variables** and add each of these for all environments:

| Name | Value |
| --- | --- |
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_ANON_KEY` | Supabase anon / public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role key |
| `GOOGLE_CLIENT_ID` | Google Client ID |
| `GOOGLE_CLIENT_SECRET` | Google Client secret |
| `CRON_SECRET` | Any long random text, e.g. from [a password generator](https://1password.com/password-generator) |

Then go to **Deployments**, open the menu (**⋯**) on the latest deployment and choose **Redeploy**.

## 6. Try it

1. Open `https://YOUR-SITE`. You should see the Cutroom sign-in screen.
2. Sign in with Google, or enter your email and click the link it sends you.
3. Open **Settings → Connect Google Calendar**. Google warns that it "hasn't verified this app". That's expected for a personal app. Click **Advanced → Go to Cutroom**, then **Continue**.
4. Add a task with a due date. After a few seconds it appears in a calendar called **Cutroom** in Google Calendar.

## How it works

- **The page** is `index.html`, served by Vercel. It loads the Supabase library from jsDelivr.
- **Data:** each job, client, task and your settings is one row in the `docs` table. Row level security makes sure each account only sees its own rows.
- **Pictures** go in the `pictures` storage bucket, in a folder named after your account. Each file has a long random name.
- **Calendar:** the functions in `api/` handle it. Your Google access is kept in the `gcal_links` table, which the browser can't read. Every change you make asks the server to bring the "Cutroom" calendar in line with your tasks: one all-day event on each open task's due date, and nothing for Done or archived tasks. A daily job (`vercel.json` → `/api/cron`) does the same as a safety net.
- **Accounts:** anyone can sign up and gets their own empty tracker. Google limits an unverified app's Calendar access to 100 people. If you ever need more, submit the app for verification in Google Cloud.

## Things to know

- The Vercel site is a new, separate copy with its own empty tracker. The claude.ai artifact and the data saved in it are not changed.
- Vercel publishes the `main` branch as the live site. Other branches get their own preview addresses.
- Anything you type into the calendar events is overwritten, because Cutroom is the source of truth. Make changes in Cutroom.
