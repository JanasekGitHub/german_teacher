# German Teacher - Project Links & Documentation

## Application

- **Production URL:** https://germanteacher-production.up.railway.app/
- **Admin files endpoint:** https://germanteacher-production.up.railway.app/api/admin/files
- **Health check:** https://germanteacher-production.up.railway.app/api/ping

## Hosting & Deployment

- **Railway Dashboard:** https://railway.app/dashboard
- **GitHub Repository:** https://github.com/JanasekGitHub/german_teacher

## Google Cloud (OAuth)

- **Google Cloud Console (Credentials):** https://console.cloud.google.com/apis/credentials
- **OAuth Consent Screen (Audience/Test Users):** Google Cloud Console → APIs & Services → OAuth consent screen → Audience
- **Client ID:** 416133497730-aosobtjp5ak8msq15u9fh3n0okr4nlj3.apps.googleusercontent.com
- **Authorized redirect URIs:**
  - Production: `https://germanteacher-production.up.railway.app/auth/google/callback`
  - Local dev: `http://localhost:3000/auth/google/callback`

## Railway Configuration

- **Environment variables (set in Railway → Service → Variables):**
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
  - `SESSION_SECRET`
  - `DATA_DIR` = `/data`
- **Volume:** `german_teacher-volume` mounted at `/data` (500 MB, US West)

## Local Development

1. Edit `dev.bat` with your Google credentials (already done)
2. Double-click `dev.bat` to start the server
3. Open http://localhost:3000
4. Data is stored locally in `./data/` folder

## Deployment Workflow

1. Make changes locally
2. Test at http://localhost:3000
3. `git add . && git commit -m "message" && git push`
4. Railway auto-deploys from GitHub (takes ~1-2 minutes)
5. Verify at production URL

## Tech Stack

- **Backend:** Node.js, Express, Passport.js (Google OAuth), multer, pdf-parse
- **Frontend:** Vanilla HTML/JS/CSS (no framework)
- **Storage:** Per-user JSON files on persistent volume
- **Auth:** Google OAuth 2.0 via Passport.js
