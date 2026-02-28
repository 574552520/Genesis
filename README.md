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

## 4) API overview

- `GET /api/me`
- `POST /api/generations`
- `GET /api/generations/jobs/:jobId`
- `GET /api/generations/history`
- `DELETE /api/generations/:jobId`
- `POST /api/credits/recharge`

All business endpoints require `Authorization: Bearer <supabase_access_token>`.
