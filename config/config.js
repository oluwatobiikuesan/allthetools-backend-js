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
      format: "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
      mergeOutputFormat: "mp4",
      restrictFilenames: true,
      noPlaylist: true,
      noCheckCertificates: false,
      preferFreeFormats: false,
      youtubeSkipDashManifest: false,
    },
  },

  logging: {
    level: process.env.LOG_LEVEL || "info",
    dir: path.resolve(process.env.LOG_DIR || "./logs"),
  },
};
