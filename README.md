# Genesis Full-Stack App

This project now runs as a full-stack app:

- Frontend: Vite + React + TypeScript
- Backend: Express + TypeScript
- Data/Auth/Storage: Supabase
- Image generation: Lingke Gemini API (`gemini-3-pro-image-preview`, server-side only)

## 1) Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill real values.

3. Run Supabase SQL migration in your Supabase project:

   - File: `supabase/migrations/202602280001_init.sql`

## 2) Run locally

```bash
npm run dev
```

This starts:

- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:8787`

Vite proxies `/api/*` to backend during development.

## 3) Build

```bash
npm run build
```

- Frontend output: `dist/`
- Backend output: `dist-server/`

## 4) Deploy (Vercel frontend + Render backend)

### Backend on Render (Web Service)

- Build command: `npm ci && npm run build`
- Start command: `npm run start:server`
- Environment variables:
  - `APP_ORIGIN="https://genesis-beryl-xi.vercel.app"` (or your real Vercel domain)
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_STORAGE_BUCKET="generated-images"`
  - `LINGKE_API_BASE_URL`
  - `LINGKE_API_KEY`
  - `GENERATION_COST=50`

After deploy, verify:

```bash
curl https://<your-render-domain>/api/health
```

### Frontend on Vercel

Set environment variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_BASE_URL="https://<your-render-domain>"`
- `VITE_TURNSTILE_SITE_KEY` (optional, leave empty to disable captcha UI)

Then redeploy Vercel production.

## 5) API overview

- `POST /api/security/turnstile/verify`
- `GET /api/me`
- `POST /api/generations`
- `GET /api/generations/jobs/:jobId`
- `GET /api/generations/history`
- `DELETE /api/generations/:jobId`
- `POST /api/credits/recharge`

All business endpoints require `Authorization: Bearer <supabase_access_token>`.
