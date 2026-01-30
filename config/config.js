require("dotenv").config();
const path = require("path");

module.exports = {
  server: {
    port: process.env.PORT || 3000,
    env: process.env.NODE_ENV || "development",
  },

  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
  },

  download: {
    dir: path.resolve(process.env.DOWNLOAD_DIR || "./downloads"),
    maxConcurrent: parseInt(process.env.MAX_CONCURRENT_DOWNLOADS) || 3,
    // Keep files for 24 hours by default
    retentionHours: parseInt(process.env.DOWNLOAD_RETENTION_HOURS) || 24,
  },

  ytdlp: {
    path: process.env.YTDLP_PATH || undefined,
    // Default options for yt-dlp
    defaultOptions: {
      // Use format that doesn't require merging if ffmpeg is not available
      format: "best[ext=mp4]/best",
      restrictFilenames: true,
      noPlaylist: true,
      noCheckCertificates: false,
      preferFreeFormats: false,
      // Add options to work around YouTube 403 errors
      extractorArgs: "youtube:player_client=android,web",
      // Add user agent to avoid blocking
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  },

  logging: {
    level: process.env.LOG_LEVEL || "info",
    dir: path.resolve(process.env.LOG_DIR || "./logs"),
  },
};
