const express = require("express");
const router = express.Router();
const downloadService = require("../services/downloadService");
const queueService = require("../services/queueService");
const logger = require("../utils/logger");

/**
 * GET /api/health
 * Health check endpoint
 */
router.get("/", async (req, res) => {
  const health = {
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {},
  };

  try {
    // Check yt-dlp
    const ytdlpVersion = await downloadService.getVersion();
    health.services.ytdlp = {
      status: ytdlpVersion ? "ok" : "error",
      version: ytdlpVersion,
    };
  } catch (error) {
    health.services.ytdlp = {
      status: "error",
      error: error.message,
    };
    health.status = "degraded";
  }

  try {
    // Check Redis/Queue
    const queueStats = await queueService.getQueueStats();
    health.services.queue = {
      status: "ok",
      stats: queueStats,
    };
  } catch (error) {
    health.services.queue = {
      status: "error",
      error: error.message,
    };
    health.status = "degraded";
  }

  const statusCode = health.status === "ok" ? 200 : 503;
  res.status(statusCode).json(health);
});

module.exports = router;
