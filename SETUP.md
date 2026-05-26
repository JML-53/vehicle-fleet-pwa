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

## What's been built

### ✅ Read views
- Dashboard with inspection alerts, high-priority pending work, recent service
- Vehicle list + per-vehicle detail with 7 tabs
- Fleet-wide maintenance schedule, pending work, documents pages

### ✅ Write forms
- **Add/Edit Vehicle** — Vehicles page → "Add Vehicle" button, or vehicle detail → "Edit"
- **Add Service Record** — vehicle detail header → "Add Service"
- **Add/Edit Pending Work** — vehicle detail Pending Work tab → "Add Item" / "Edit"
  - Quick "✓ Done" button marks items complete without navigating away
- **Add/Edit Maintenance Item** — vehicle detail Maintenance tab → "Add Item" / edit pencil
- **Upload Document** — vehicle detail header → "Upload Doc"
  - On mobile: shows "Take Photo / Scan" button that opens camera directly
  - Uploads to Supabase Storage, linked to the vehicle record

### 📧 Gmail Scanner (`gmail_vehicle_scanner.py`, in Vehicles folder)
Standalone Python script that scans Gmail for vehicle-related emails and
extracts structured data using Claude AI. Produces a CSV for review.

Setup:
1. `pip install google-auth google-auth-oauthlib google-api-python-client anthropic --break-system-packages`
2. Google OAuth credentials (Desktop App) from https://console.cloud.google.com → download as `gmail_credentials.json`
3. `set ANTHROPIC_API_KEY=sk-ant-...`
4. `python gmail_vehicle_scanner.py` — browser opens for Google auth on first run
5. Review CSV output, enter new records into the app

## Future work
- Supabase Edge Function to auto-run Gmail scanner on a schedule
- Bulk import from Gmail scanner CSV
- Push notifications for upcoming inspections / maintenance due
