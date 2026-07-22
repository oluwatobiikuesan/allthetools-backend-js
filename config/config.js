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
    // Treat empty string as undefined to allow auto-detection
    path:
      process.env.YTDLP_PATH && process.env.YTDLP_PATH.trim() !== ""
        ? process.env.YTDLP_PATH
        : undefined,
    // Default options for yt-dlp
    defaultOptions: {
      // Let yt-dlp choose the best format automatically
      restrictFilenames: true,
      noPlaylist: true,
      noCheckCertificates: false,
      preferFreeFormats: false,
      // Download the EJS challenge solver script from GitHub on first
      // use. yt-dlp 2026.7+ requires this to solve YouTube's nsig/
      // signature challenges via Deno. Without it, YouTube returns
      // "Sign in to confirm you're not a bot" even with valid cookies.
      remoteComponents: "ejs:github",
    },
    // Path to global cookies file for YouTube authentication
    cookiesPath: path.resolve(
      process.env.YOUTUBE_COOKIES_PATH || "./cookies/youtube.txt",
    ),
  },

  logging: {
    level: process.env.LOG_LEVEL || "info",
    dir: path.resolve(process.env.LOG_DIR || "./logs"),
  },
};
