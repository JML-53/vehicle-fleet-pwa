# Fleet Manager PWA — Setup & Deployment Guide

## What this is
A Progressive Web App (React + Supabase) for managing the Limber family vehicle fleet.
Runs on desktop and can be installed on an Android phone as a home-screen app.

---

## Step 1 — Install dependencies

You need Node.js installed. If you don't have it: https://nodejs.org (download LTS version).

Open a terminal (PowerShell or Command Prompt), navigate to this folder, and run:

```
cd "C:\Users\jmlma\OneDrive\Documents\Vehicles\vehicle-fleet-pwa"
npm install
```

This installs React, Vite, Tailwind, Supabase client, and all other dependencies.

---

## Step 2 — Configure Supabase credentials

1. Open your Supabase project at https://supabase.com
2. Go to **Settings → API**
3. Copy:
   - **Project URL** (looks like: https://abcdefgh.supabase.co)
   - **anon/public key** (long string starting with "eyJ...")

4. In the `vehicle-fleet-pwa` folder, create a file named `.env.local`:

```
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_PUBLIC_KEY
```

Replace the placeholders with your actual values. This file is gitignored — never commit it.

---

## Step 3 — Run locally

```
npm run dev
```

Open http://localhost:5173 in your browser. Log in with your Supabase user account.

**To create your first user in Supabase:**
1. Supabase dashboard → **Authentication → Users → Invite user**
2. Enter your email (jmlmail53@gmail.com), send invite
3. Check email, set password
4. Do the same for Teresa (limberbills@gmail.com)
5. Then manually insert rows into the `profiles` table:
   ```sql
   INSERT INTO profiles (id, display_name, email, role)
   VALUES
     ('<Joe user UUID from Auth page>', 'Joe Limber', 'jmlmail53@gmail.com', 'admin'),
     ('<Teresa user UUID from Auth page>', 'Teresa Limber', 'limberbills@gmail.com', 'member');
   ```

---

## Step 4 — Create Supabase Storage bucket

1. Supabase dashboard → **Storage → New bucket**
2. Name: `documents`
3. Public: **OFF** (private)
4. Max file size: 50 MB
5. Allowed MIME types: leave blank (or add image/*, application/pdf)
6. Click Create

Then add a storage policy so authenticated users can upload:
- **Storage → Policies → New policy** on the `documents` bucket
- Name: "Authenticated users can manage documents"
- Target roles: authenticated
- Operations: SELECT, INSERT, UPDATE, DELETE
- Policy definition: `true`

---

## Step 5 — Deploy to Vercel (free hosting)

### Option A: Via GitHub (recommended — enables auto-deploy on push)

1. Create a free account at https://github.com and https://vercel.com
2. Create a new GitHub repository (name it `vehicle-fleet-pwa`)
3. Push this folder to GitHub:
   ```
   cd vehicle-fleet-pwa
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/vehicle-fleet-pwa.git
   git push -u origin main
   ```
4. In Vercel: **New Project → Import from GitHub** → select the repo
5. Framework preset: **Vite**
6. Add environment variables (same as your .env.local):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
7. Click **Deploy**

Vercel gives you a URL like: `https://vehicle-fleet-pwa.vercel.app`

### Option B: Via Vercel CLI (no GitHub needed)

```
npm install -g vercel
vercel login
vercel --prod
```

Follow the prompts. Add your env vars when asked.

---

## Step 6 — Install on Android phone

1. Open your Vercel URL in Chrome on your Android phone
2. Log in
3. Chrome shows a banner: **"Add to Home Screen"** — tap it
4. The app installs as a standalone app (no browser chrome, full screen)

If the banner doesn't appear:
- Tap Chrome menu (3 dots) → **Add to Home Screen**

The PWA works offline for recently-viewed data (service worker caches it).

---

## Step 7 — Add Supabase URL to allowed origins

In Supabase → **Authentication → URL Configuration:**
- **Site URL**: your Vercel URL (e.g. https://vehicle-fleet-pwa.vercel.app)
- **Redirect URLs**: add the same URL

---

## Development workflow going forward

- Make changes to files in `src/`
- Run `npm run dev` to test locally
- Push to GitHub → Vercel auto-deploys in ~30 seconds

---

## Project structure

```
src/
  lib/supabase.js          — Supabase client (reads .env.local)
  contexts/AuthContext.jsx — Login state, profile
  App.jsx                  — Routes (all pages)
  pages/
    Login.jsx              — Sign-in screen
    Dashboard.jsx          — Fleet overview + alerts
    VehicleList.jsx        — All 6 vehicles
    VehicleDetail.jsx      — Per-vehicle (7 tabs)
    AddServiceRecord.jsx   — Add service + parts form
    PendingWorkPage.jsx    — All open pending items
    MaintenanceSchedulePage.jsx
    DocumentsPage.jsx
  components/
    layout/Layout.jsx      — Desktop sidebar + mobile bottom nav
```

---

## Next steps (planned)

- [ ] Add/Edit vehicle form
- [ ] Add pending work item form
- [ ] Maintenance schedule entry form
- [ ] Document upload from phone camera
- [ ] Automated Gmail scanning (scheduled task)
- [ ] Data migration from Excel tracker to Supabase
