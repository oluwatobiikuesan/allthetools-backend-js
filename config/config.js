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

  supabase: {
    url: process.env.SUPABASE_URL || "",
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    projectRef: process.env.SUPABASE_PROJECT_REF || "",
    tables: {
      jobs: process.env.SUPABASE_TABLE_JOBS || "jobs",
      costLedger: process.env.SUPABASE_TABLE_COST_LEDGER || "cost_ledger",
      queueMetrics: process.env.SUPABASE_TABLE_QUEUE_METRICS || "queue_metrics",
    },
  },

  costs: {
    egressPerGb: parseFloat(process.env.COST_EGRESS_PER_GB) || 0.05,
    computePerMinute: parseFloat(process.env.COST_COMPUTE_PER_MINUTE) || 0.02,
    storagePerGbHour: parseFloat(process.env.COST_STORAGE_PER_GB_HOUR) || 0.0007,
  },
};
