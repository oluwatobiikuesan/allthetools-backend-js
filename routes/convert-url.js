const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const conversionService = require("../services/conversionService");
const logger = require("../utils/logger");

// In-memory job storage (shared with file upload conversions)
const jobs = new Map();

/**
 * POST /api/convert-url
 * Submit URL for download and conversion
 */
router.post("/", async (req, res) => {
  try {
    const { url, targetFormat = "mp3", quality = "192" } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: "URL is required",
      });
    }

    // Validate target format
    const allowedFormats = ["mp3", "wav", "aac", "flac", "ogg"];
    if (!allowedFormats.includes(targetFormat)) {
      return res.status(400).json({
        success: false,
        error: `Invalid target format. Allowed: ${allowedFormats.join(", ")}`,
      });
    }

    const jobId = uuidv4();

    // Store job info
    jobs.set(jobId, {
      jobId,
      status: "pending",
      progress: 0,
      url,
      targetFormat,
      quality,
    });

    logger.info(`New URL conversion request: ${url} -> ${targetFormat}`);

    // Start conversion asynchronously
    conversionService
      .convertFromUrl(
        {
          url,
          targetFormat,
          quality,
        },
        (progressData) => {
          // Update job progress
          const job = jobs.get(jobId);
          if (job) {
            job.progress = progressData.progress;
            job.status = progressData.status;
          }
        },
      )
      .then((result) => {
        const job = jobs.get(jobId);
        if (job) {
          job.status = "completed";
          job.progress = 100;
          job.result = result;
        }
      })
      .catch((error) => {
        const job = jobs.get(jobId);
        if (job) {
          job.status = "failed";
          job.error = error.message;
        }

        logger.error(`URL conversion failed for job ${jobId}:`, error);
      });

    res.status(202).json({
      success: true,
      message: "Conversion request accepted",
      data: {
        jobId,
        status: "pending",
        url,
        targetFormat,
      },
    });
  } catch (error) {
    logger.error("Failed to process URL conversion request:", error);

    res.status(500).json({
      success: false,
      error: "Failed to process conversion request",
      message: error.message,
    });
  }
});

/**
 * GET /api/convert-url/:jobId
 * Get conversion job status
 */
router.get("/:jobId", (req, res) => {
  try {
    const { jobId } = req.params;
    const job = jobs.get(jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        error: "Job not found",
      });
    }

    res.json({
      success: true,
      data: {
        jobId: job.jobId,
        status: job.status,
        progress: job.progress,
        url: job.url,
        targetFormat: job.targetFormat,
        error: job.error,
        result: job.result
          ? {
              filename: job.result.filename,
              filesize: job.result.filesize,
              format: job.result.format,
            }
          : undefined,
      },
    });
  } catch (error) {
    logger.error("Failed to get job status:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get job status",
      message: error.message,
    });
  }
});

/**
 * GET /api/convert-url/:jobId/file
 * Download converted file
 */
router.get("/:jobId/file", (req, res) => {
  try {
    const { jobId } = req.params;
    const job = jobs.get(jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        error: "Job not found",
      });
    }

    if (job.status !== "completed") {
      return res.status(400).json({
        success: false,
        error: "Conversion not completed",
        status: job.status,
      });
    }

    const filepath = job.result.filepath;
    const fs = require("fs");

    if (!fs.existsSync(filepath)) {
      return res.status(404).json({
        success: false,
        error: "File not found",
      });
    }

    logger.info(
      `Serving converted file for job ${jobId}: ${job.result.filename}`,
    );

    res.download(filepath, job.result.filename, (err) => {
      if (err) {
        logger.error("Error sending file:", err);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: "Failed to send file",
          });
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
});

/**
 * DELETE /api/convert-url/:jobId
 * Cancel or remove conversion job
 */
router.delete("/:jobId", (req, res) => {
  try {
    const { jobId } = req.params;
    const job = jobs.get(jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        error: "Job not found",
      });
    }

    // Delete converted file if it exists
    if (job.result && job.result.filepath) {
      conversionService.deleteFile(job.result.filepath);
    }

    // Remove job from memory
    jobs.delete(jobId);

    logger.info(`Removed URL conversion job ${jobId}`);

    res.json({
      success: true,
      message: "Job removed successfully",
    });
  } catch (error) {
    logger.error("Failed to delete job:", error);
    res.status(500).json({
      success: false,
      error: "Failed to delete job",
      message: error.message,
    });
  }
});

module.exports = router;
module.exports.jobs = jobs; // Export jobs for sharing with file upload route
