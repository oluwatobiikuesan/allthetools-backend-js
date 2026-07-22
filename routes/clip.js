const express = require("express");
const router = express.Router();
const fs = require("fs");
const queueService = require("../services/queueService");
const clipService = require("../services/clipService");
const logger = require("../utils/logger");
const {
  validateClipRequest,
  validateJobId,
  handleValidationErrors,
  detectPlatform,
} = require("../utils/validators");

// ───────────────────────────────────────────────────────────
// Static routes — registered BEFORE /:jobId to avoid the
// route-shadowing bug that exists in routes/download.js.
// ───────────────────────────────────────────────────────────

/**
 * GET /api/clip/info/video?url=<url>
 * Reuses clipService.getVideoInfo to provide title/duration/thumbnail
 * for the preview UI.
 */
router.get("/info/video", async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res
        .status(400)
        .json({ success: false, error: "URL parameter is required" });
    }
    const info = await clipService.getVideoInfo(url);
    res.json({ success: true, data: info });
  } catch (error) {
    logger.error("Failed to get clip video info:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get video info",
      message: error.message,
    });
  }
});

/**
 * GET /api/clip/stats/queue
 */
router.get("/stats/queue", async (req, res) => {
  try {
    const stats = await queueService.getClipQueueStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    logger.error("Failed to get clip queue stats:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get clip queue stats",
      message: error.message,
    });
  }
});

// ───────────────────────────────────────────────────────────
// Dynamic :jobId routes — registered after static routes.
// ───────────────────────────────────────────────────────────

/**
 * POST /api/clip
 * Body: { url, clipStart, clipEnd }
 * Response: { success, data: { jobId, status, url, clipStart, clipEnd, platform } }
 */
router.post(
  "/",
  validateClipRequest,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { url, clipStart, clipEnd } = req.body;
      const platform = detectPlatform(url);

      logger.info(
        `New clip request for ${platform}: ${url} [${clipStart}s -> ${clipEnd}s]`,
      );

      const jobInfo = await queueService.addClipJob({
        url,
        clipStart: parseFloat(clipStart),
        clipEnd: parseFloat(clipEnd),
      });

      res.status(202).json({
        success: true,
        message: "Clip request accepted",
        data: { ...jobInfo, platform },
      });
    } catch (error) {
      logger.error("Failed to process clip request:", error);
      res.status(500).json({
        success: false,
        error: "Failed to process clip request",
        message: error.message,
      });
    }
  },
);

/**
 * GET /api/clip/:jobId
 * Poll-able status endpoint.
 */
router.get("/:jobId", validateJobId, handleValidationErrors, async (req, res) => {
  try {
    const { jobId } = req.params;
    const status = await queueService.getClipStatus(jobId);
    if (!status) {
      return res.status(404).json({ success: false, error: "Clip job not found" });
    }
    res.json({ success: true, data: status });
  } catch (error) {
    logger.error("Failed to get clip status:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get clip status",
      message: error.message,
    });
  }
});

/**
 * GET /api/clip/:jobId/file
 * Streams the clip file and auto-deletes it + the job on first fetch
 * (same one-shot pattern as /api/download).
 */
router.get(
  "/:jobId/file",
  validateJobId,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { jobId } = req.params;
      const status = await queueService.getClipStatus(jobId);
      if (!status) {
        return res.status(404).json({ success: false, error: "Clip job not found" });
      }
      if (status.status !== "completed") {
        return res.status(400).json({
          success: false,
          error: "Clip not completed",
          status: status.status,
        });
      }

      const filepath = status.result.filepath;
      if (!fs.existsSync(filepath)) {
        return res.status(404).json({ success: false, error: "File not found" });
      }
      const filename = status.result.filename;

      logger.info(`Serving clip file for job ${jobId}: ${filename}`);
      res.download(filepath, filename, async (err) => {
        if (err) {
          logger.error("Error sending clip file:", err);
          if (!res.headersSent) {
            res.status(500).json({ success: false, error: "Failed to send file" });
          }
        } else {
          logger.info(`Clip file sent successfully: ${filename}`);
          try {
            await queueService.removeClipJob(jobId);
            logger.info(`Auto-deleted clip job and file for ${jobId}`);
          } catch (cleanupError) {
            logger.error(
              `Failed to auto-delete clip job ${jobId}:`,
              cleanupError,
            );
          }
        }
      });
    } catch (error) {
      logger.error("Failed to serve clip file:", error);
      res.status(500).json({
        success: false,
        error: "Failed to serve clip file",
        message: error.message,
      });
    }
  },
);

/**
 * DELETE /api/clip/:jobId
 * Cancels an active clip job or removes a completed one (and its file).
 */
router.delete(
  "/:jobId",
  validateJobId,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { jobId } = req.params;
      const status = await queueService.getClipStatus(jobId);
      if (!status) {
        return res.status(404).json({ success: false, error: "Clip job not found" });
      }
      const cancelled = await queueService.cancelClipJob(jobId);
      if (cancelled) {
        return res.json({ success: true, message: "Clip job cancelled successfully" });
      }
      const removed = await queueService.removeClipJob(jobId);
      if (removed) {
        return res.json({ success: true, message: "Clip job removed successfully" });
      }
      res.status(400).json({ success: false, error: "Failed to cancel or remove clip job" });
    } catch (error) {
      logger.error("Failed to delete clip job:", error);
      res.status(500).json({
        success: false,
        error: "Failed to delete clip job",
        message: error.message,
      });
    }
  },
);

module.exports = router;