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

### Local Supabase development

For daily local development, prefer running Supabase on your machine instead of using a hosted free-tier project.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start local Supabase:

   ```bash
   npm run supabase:start
   ```

3. Copy the local keys into your env file:

   - Run `npm run supabase:status`
   - Copy `.env.local.example` to `.env`
   - Paste the local `API URL`, `anon key`, and `service_role key`

4. Local defaults used by this repo:

   - API: `http://127.0.0.1:54321`
   - DB: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
   - Studio: `http://127.0.0.1:54323`
   - Inbucket: `http://127.0.0.1:54324`

5. Auth behavior for local dev:

   - Email/password sign-up stays enabled
   - Email confirmation is disabled in `supabase/config.toml`, so local test accounts can sign in immediately

6. Useful local commands:

   ```bash
   npm run supabase:status
   npm run supabase:db:reset
   npm run supabase:stop
   ```

7. Keep image generation online:

   - Leave `LINGKE_API_BASE_URL`, `LINGKE_API_KEY`, and `LINGKE_BEARER_TOKEN` pointing to Lingke
   - Only Supabase moves local in this setup

3. Run Supabase SQL migration in your Supabase project:

   - File: `supabase/migrations/202602280001_init.sql`

## 2) Run locally

```bash
npm run dev
```

This starts:

- Frontend: `http://localhost:3000`
- Backend API: `http://127.0.0.1:8877`

Vite proxies `/api/*` to backend during development.

If you are using local Supabase, start it before `npm run dev`.

On Windows, if a port is reserved by the system, update `HOST`/`PORT` in `.env` and restart both Vite and the API server.

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
  - `API_BODY_LIMIT="80mb"` (legacy JSON fallback only; image uploads now use multipart)
  - `UPLOAD_IMAGE_MAX_BYTES="15mb"`
  - `UPLOAD_TOTAL_MAX_BYTES="60mb"`

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
- `POST /api/uploads/images`
- `POST /api/generations`
- `GET /api/generations/jobs/:jobId`
- `GET /api/generations/history`
- `DELETE /api/generations/:jobId`
- `POST /api/credits/recharge`

All business endpoints require `Authorization: Bearer <supabase_access_token>`.

### Try-on behavior note

- Endpoint: `POST /api/commerce/pack/generate` with `mode="try_on"`.
- `sceneReferenceImages` is required for the main Commerce Workspace try-on submit flow.
- Generated task count is automatically `min(sceneReferenceImages.length, 6)`.
- Scene images are mapped 1:1 to output tasks (`scene[0] -> task 1`, `scene[1] -> task 2`, ...).
- In this mode, model reference images are prioritized for identity consistency, while scene references drive background/composition replication.

### Upload behavior note

- Local image uploads now go through `POST /api/uploads/images` as `multipart/form-data`.
- The response returns stable storage refs such as `storage://generated-images/<userId>/uploads/<uuid>.<ext>` plus a signed `previewUrl`.
- `/api/generations` and `/api/commerce/pack/generate` both accept `storage://`, `data:`, and `http(s):` image references.
- Large local images should now fail at the upload step with a file-size message instead of hitting `413` on `/api/commerce/pack/generate`.
