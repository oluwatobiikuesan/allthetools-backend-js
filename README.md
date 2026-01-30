# Video Downloader Service

A robust backend service for downloading videos from YouTube, TikTok, and Twitch using yt-dlp. Built with Node.js, Express, and Redis-backed job queues.

## Features

- 🎥 **Multi-Platform Support**: Download videos from YouTube, TikTok, and Twitch
- 🚀 **Queue Management**: Redis-backed job queue with Bull for concurrent downloads
- 📊 **Progress Tracking**: Real-time download progress updates
- 🔄 **Retry Logic**: Automatic retry with exponential backoff
- 🗂️ **Format Selection**: Choose video format and quality
- 🧹 **Auto Cleanup**: Automatic cleanup of old downloads
- 🐳 **Docker Support**: Easy deployment with Docker Compose
- 📝 **Comprehensive Logging**: Winston-based logging system
- 🏥 **Health Checks**: Service health monitoring endpoint

## Prerequisites

- Node.js 16+ (18+ recommended)
- Redis 6+
- Python 3.7+ (for yt-dlp)
- ffmpeg (for video merging)

## Installation

### Local Development

1. **Clone the repository**

   ```bash
   cd /path/to/project
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Install yt-dlp and ffmpeg**

   Option A: Use the automated installation script (recommended)

   ```bash
   npm run setup
   # or
   npm run install-ytdlp
   ```

   This will automatically install both yt-dlp and ffmpeg for your platform.

   Option B: Install manually

   ```bash
   # macOS
   brew install yt-dlp ffmpeg

   # Linux (Ubuntu/Debian)
   sudo apt install ffmpeg
   pip3 install yt-dlp

   # Or download yt-dlp binary from https://github.com/yt-dlp/yt-dlp/releases
   ```

4. **Start Redis**

   ```bash
   # Using Docker
   docker run -d -p 6379:6379 redis:7-alpine

   # Or using Homebrew (macOS)
   brew services start redis
   ```

5. **Configure environment**

   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

6. **Start the server**
   ```bash
   npm start
   # Or for development with auto-reload
   npm run dev
   ```

### Docker Deployment

1. **Start all services**

   ```bash
   docker-compose up -d
   ```

2. **View logs**

   ```bash
   docker-compose logs -f app
   ```

3. **Stop services**
   ```bash
   docker-compose down
   ```

## API Documentation

### Base URL

```
http://localhost:3000
```

### Endpoints

#### 1. Submit Download Request

```http
POST /api/download
Content-Type: application/json

{
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "format": "mp4",      // optional: mp4, webm, mkv, best
  "quality": "1080p"    // optional: best, worst, 720p, 1080p, 1440p, 2160p
}
```

**Response:**

```json
{
  "success": true,
  "message": "Download request accepted",
  "data": {
    "jobId": "123e4567-e89b-12d3-a456-426614174000",
    "status": "queued",
    "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "format": "mp4",
    "quality": "1080p",
    "platform": "youtube"
  }
}
```

#### 2. Check Download Status

```http
GET /api/download/:jobId
```

**Response:**

```json
{
  "success": true,
  "data": {
    "jobId": "123e4567-e89b-12d3-a456-426614174000",
    "status": "completed",
    "progress": 100,
    "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "result": {
      "filename": "video.mp4",
      "filesize": 15728640,
      "videoInfo": {
        "title": "Video Title",
        "duration": 213,
        "uploader": "Channel Name"
      }
    }
  }
}
```

**Status values:** `queued`, `waiting`, `active`, `completed`, `failed`

#### 3. Download File

```http
GET /api/download/:jobId/file
```

Downloads the completed video file.

#### 4. Cancel/Delete Download

```http
DELETE /api/download/:jobId
```

Cancels an active download or removes a completed job.

#### 5. Get Video Info

```http
GET /api/download/info/video?url=<video_url>
```

Get video metadata without downloading.

#### 6. Queue Statistics

```http
GET /api/download/stats/queue
```

**Response:**

```json
{
  "success": true,
  "data": {
    "waiting": 2,
    "active": 1,
    "completed": 15,
    "failed": 0,
    "delayed": 0,
    "total": 18
  }
}
```

#### 7. Health Check

```http
GET /api/health
```

**Response:**

```json
{
  "status": "ok",
  "timestamp": "2026-01-13T15:30:00.000Z",
  "uptime": 3600,
  "services": {
    "ytdlp": {
      "status": "ok",
      "version": "2024.01.01"
    },
    "queue": {
      "status": "ok",
      "stats": { ... }
    }
  }
}
```

## Configuration

Environment variables (`.env`):

```bash
# Server
PORT=3000
NODE_ENV=development

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Downloads
DOWNLOAD_DIR=./downloads
MAX_CONCURRENT_DOWNLOADS=3
DOWNLOAD_RETENTION_HOURS=24

# yt-dlp
YTDLP_PATH=  # Leave empty to use system yt-dlp

# Logging
LOG_LEVEL=info
LOG_DIR=./logs
```

## Usage Examples

### Using cURL

```bash
# Submit download
curl -X POST http://localhost:3000/api/download \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'

# Check status
curl http://localhost:3000/api/download/YOUR_JOB_ID

# Download file
curl -O -J http://localhost:3000/api/download/YOUR_JOB_ID/file
```

### Using JavaScript/Fetch

```javascript
// Submit download
const response = await fetch("http://localhost:3000/api/download", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    format: "mp4",
    quality: "1080p",
  }),
});

const { data } = await response.json();
const jobId = data.jobId;

// Poll for status
const checkStatus = async () => {
  const statusResponse = await fetch(
    `http://localhost:3000/api/download/${jobId}`,
  );
  const { data: status } = await statusResponse.json();

  if (status.status === "completed") {
    // Download the file
    window.location.href = `http://localhost:3000/api/download/${jobId}/file`;
  } else if (status.status === "failed") {
    console.error("Download failed:", status.error);
  } else {
    console.log(`Progress: ${status.progress}%`);
    setTimeout(checkStatus, 2000);
  }
};

checkStatus();
```

## Supported Platforms

- **YouTube**: Videos, playlists (single video), shorts
- **TikTok**: Videos
- **Twitch**: VODs, clips

## Error Handling

The service includes comprehensive error handling:

- Invalid URLs return 400 Bad Request
- Unsupported platforms return 400 Bad Request
- Download failures trigger automatic retries (up to 3 attempts)
- Failed jobs can be inspected via the status endpoint

## Performance

- Concurrent downloads: Configurable (default: 3)
- Queue processing: Redis-backed Bull queue
- File cleanup: Automatic cleanup after 24 hours (configurable)
- Progress tracking: Real-time updates via job status

## Troubleshooting

### yt-dlp not found

```bash
# Install yt-dlp
npm run install-ytdlp
# Or set YTDLP_PATH in .env
```

### Redis connection failed

```bash
# Start Redis
docker run -d -p 6379:6379 redis:7-alpine
```

### Download fails

- Check yt-dlp version: `yt-dlp --version`
- Update yt-dlp: `pip3 install -U yt-dlp`
- Check logs in `./logs/error.log`

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.
