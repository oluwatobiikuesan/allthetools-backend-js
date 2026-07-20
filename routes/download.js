const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const queueService = require("../services/queueService");
const downloadService = require("../services/downloadService");
const logger = require("../utils/logger");
const {
  validateDownloadRequest,
  validateJobId,
  handleValidationErrors,
  detectPlatform,
} = require("../utils/validators");

/**
 * POST /api/download
 * Submit a new download request
 */
router.post(
  "/",
  validateDownloadRequest,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { url, format, quality } = req.body;
      const platform = detectPlatform(url);

      logger.info(`New download request for ${platform}: ${url}`);

      // Add job to queue
      const jobInfo = await queueService.addDownloadJob({
        url,
        format,
        quality,
      });

      res.status(202).json({
        success: true,
        message: "Download request accepted",
        data: {
          ...jobInfo,
          platform,
        },
      });
    } catch (error) {
      logger.error("Failed to process download request:", error);
      res.status(500).json({
        success: false,
        error: "Failed to process download request",
        message: error.message,
      });
    }
  },
);

/**
 * GET /api/download/:jobId
 * Get download job status
 */
router.get(
  "/:jobId",
  validateJobId,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { jobId } = req.params;

      const status = await queueService.getJobStatus(jobId);

      if (!status) {
        return res.status(404).json({
          success: false,
          error: "Job not found",
        });
      }

      res.json({
        success: true,
        data: status,
      });
    } catch (error) {
      logger.error("Failed to get job status:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get job status",
        message: error.message,
      });
    }
  },
);

/**
 * GET /api/download/:jobId/file
 * Download the completed file
 */
router.get(
  "/:jobId/file",
  validateJobId,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { jobId } = req.params;

      const status = await queueService.getJobStatus(jobId);

      if (!status) {
        return res.status(404).json({
          success: false,
          error: "Job not found",
        });
      }

      if (status.status !== "completed") {
        return res.status(400).json({
          success: false,
          error: "Download not completed",
          status: status.status,
        });
      }

      const filepath = status.result.filepath;

      if (!fs.existsSync(filepath)) {
        return res.status(404).json({
          success: false,
          error: "File not found",
        });
      }

      const filename = status.result.filename;

      logger.info(`Serving file for job ${jobId}: ${filename}`);

      res.download(filepath, filename, async (err) => {
        if (err) {
          logger.error("Error sending file:", err);
          if (!res.headersSent) {
            res.status(500).json({
              success: false,
              error: "Failed to send file",
            });
          }
        } else {
          logger.info(`File sent successfully: ${filename}`);

          // Delete file and remove job to save space
          try {
            // We can use queueService.removeJob which handles both file deletion and job removal
            // But since we just sent the file, we might want to be explicit or use the existing helper
            await queueService.removeJob(jobId);
            logger.info(`Auto-deleted job and file for ${jobId}`);
          } catch (cleanupError) {
            logger.error(`Failed to auto-delete job ${jobId}:`, cleanupError);
          }
        }
      });
    } catch (error) {
      logger.error("Failed to serve file:", error);
      res.status(500).json({
        success: false,
        error: "Failed to serve file",
        message: error.message,
      });
    }
  },
);

/**
 * DELETE /api/download/:jobId
 * Cancel or remove a download job
 */
router.delete(
  "/:jobId",
  validateJobId,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { jobId } = req.params;

      const status = await queueService.getJobStatus(jobId);

      if (!status) {
        return res.status(404).json({
          success: false,
          error: "Job not found",
        });
      }

      // Try to cancel first
      const cancelled = await queueService.cancelJob(jobId);

      if (cancelled) {
        logger.info(`Cancelled job ${jobId}`);
        return res.json({
          success: true,
          message: "Job cancelled successfully",
        });
      }

      // If not cancelled, remove it
      const removed = await queueService.removeJob(jobId);

      if (removed) {
        logger.info(`Removed job ${jobId}`);
        return res.json({
          success: true,
          message: "Job removed successfully",
        });
      }

      res.status(400).json({
        success: false,
        error: "Failed to cancel or remove job",
      });
    } catch (error) {
      logger.error("Failed to delete job:", error);
      res.status(500).json({
        success: false,
        error: "Failed to delete job",
        message: error.message,
      });
    }
  },
);

/**
 * GET /api/download/info/video
 * Get video information without downloading
 */
router.get("/info/video", async (req, res) => {
  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: "URL parameter is required",
      });
    }

    const info = await downloadService.getVideoInfo(url);

    res.json({
      success: true,
      data: info,
    });
  } catch (error) {
    logger.error("Failed to get video info:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get video info",
      message: error.message,
    });
  }
});

/**
 * GET /api/download/stats/queue
 * Get queue statistics
 */
router.get("/stats/queue", async (req, res) => {
  try {
    const stats = await queueService.getQueueStats();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error("Failed to get queue stats:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get queue stats",
      message: error.message,
    });
  }
});

module.exports = router;
