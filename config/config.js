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
      // yt-dlp 2026.7+ requires a JS runtime to parse YouTube's nsig
      // challenge. yt-dlp's EJS system needs Deno (Node.js doesn't work).
      // Deno is installed in the Dockerfile. Without this, YouTube returns
      // "Sign in to confirm you're not a bot" even with valid cookies.
      jsRuntimes: "deno",
      // Use the mweb client which works with PO Tokens (auto-generated
      // by the bgutil-ytdlp-pot-provider plugin). This client is the
      // yt-dlp maintainers' recommended fix for the "Sign in to confirm
      // you're not a bot" error on datacenter IPs.
      // Also set the PO Token server base URL explicitly (the plugin
      // defaults to http://127.0.0.1:4416 which works in-container).
      extractorArgs: "youtube:player_client=mweb;youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416",
      // Enable remote EJS challenge solver (needed for nsig/signature
      // solving with the mweb client). Downloads the solver script
      // from GitHub on first use.
      remoteComponents: "ejs:github",
      // NOTE: Do NOT set extractorArgs or userAgent here.
      // The previous `youtube:player_client=android,web` + hardcoded
      // Chrome 120 user-agent caused "Sign in to confirm you're not a bot"
      // errors because YouTube's SABR experiment broke the android client
      // and the stale user-agent triggered bot detection.
      // yt-dlp's built-in defaults work correctly with the cookies file.
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
