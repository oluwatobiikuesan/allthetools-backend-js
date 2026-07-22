# AGENTS.md — allthetools-backend-js

Node + Express + Redis(Bull) + yt-dlp + ffmpeg. See the root `../AGENTS.md` for the
monorepo overview and `README.md` for the full API contract.

## Commands

```bash
npm run dev              # nodemon server.js (PORT default 3000; Docker exposes 3005)
npm start               # node server.js
npm run setup            # install bundled yt-dlp + ffmpeg into bin/ (scripts/install-ytdlp.js)
```
No test runner is configured.

## Module system & style

- **CommonJS** (`require`/`module.exports`), not ESM.
- Express 4, async route handlers, `express-validator` for inputs.
- Logging via `utils/logger.js` (winston) — use `logger.info/warn/error`, never `console.log`.
- Config from `config/config.js` (env via `dotenv`). Do not read `process.env` directly in
  routes/services — go through the config module.

## Layout

```
server.js                 Express app, route mounting, global error + 404 handlers
config/config.js          env-driven config (PORT, REDIS_*, DOWNLOAD_DIR, YTDLP_PATH, ...)
routes/                   one router per tool — thin HTTP layer, validation, Map/Bull plumbing
  download.js             Bull-backed (queueService) — GET /:jobId, /file, DELETE, info, stats
  convert.js              multer upload → ffmpeg (in-memory Map of jobs)
  convert-url.js          URL → yt-dlp audio extraction (in-memory Map)
  enhance.js              multer upload → ffmpeg filters (in-memory Map)
services/
  queueService.js         Bull queue (download only)
  downloadService.js     yt-dlp-wrap singleton (exec yt-dlp)
  conversionService.js   ffmpeg/ffprobe + yt-dlp audio extraction
utils/
  logger.js              winston
  validators.js          express-validator chains + detectPlatform (by hostname)
bin/yt-dlp                bundled yt-dlp binary (installed by scripts/install-ytdlp.js)
cookies/youtube.txt       YouTube cookies (passed to yt-dlp for auth-gated content)
```

## Conventions

- **Response shape** is consistent everywhere:
  - Success: `{ success: true, data: {...} }` (sometimes also `message`)
  - Error:   `{ success: false, error: "<message>" }`
- Route handlers are `async`; always wrap logic in `try/catch` and call `next(err)` or
  return a `res.status(...).json({ success: false, error })`. The global handler in
  `server.js` logs and returns 500.
- **Jobs:** `download` uses Bull/Redis and is the durable model. `convert`, `convert-url`,
  and `enhance` store jobs in a module-level `Map` keyed by `jobId` (uuid) — fine for a
  single instance, lost on restart and broken under >1 replica. When adding a new tool,
  prefer the Bull-backed pattern unless the job is short-lived.
- **Files:** downloads go to `DOWNLOAD_DIR`; completed files are **deleted on first `/file`
  fetch**. Upload-based tools stream from multer memory storage into ffmpeg.

## Adding a new tool route (e.g. clip/slice)

1. Create `routes/<tool>.js` with a router: POST creates a `jobId`, kicks off work, stores
   status in a `Map` (or Bull if durable).
2. Put the actual yt-dlp / ffmpeg invocation in a new `services/<tool>Service.js`. Shell out
   via `downloadService`'s yt-dlp-wrap for yt-dlp, and use the same `child_process`/ffmpeg
   pattern as `conversionService.js` for ffmpeg. Use `yt-dlp -g` to resolve stream URLs
   without downloading, then `ffmpeg -ss/-to` on each stream (see root AGENTS.md).
3. Mount the router in `server.js` under `/api/<tool>`.
4. **Route ordering:** register any literal sub-paths (`/info/...`, `/stats/...`) **before**
   `/:jobId` — the existing `download.js` has this bug (see root pitfalls). Use
   `router.param`/`isNumeric` guard or a regex path constraint.
5. Stream progress updates back by mutating the job entry; the frontend polls every 2s.

## Gotchas

- Redis must be running or `download` jobs fail to enqueue. Start it before `npm run dev`.
- `YTDLP_PATH` empty → uses bundled `bin/yt-dlp`; ffmpeg must be on system PATH.
- YouTube cookies file path is configured — keep `cookies/youtube.txt` present for
  age/auth-restricted videos.
- Don't read `process.env` outside `config/config.js`.