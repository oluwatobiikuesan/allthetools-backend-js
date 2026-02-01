const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const conversionService = require("../services/conversionService");
const logger = require("../utils/logger");

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "audio/mpeg",
      "audio/mp3",
      "audio/wav",
      "audio/wave",
      "audio/x-wav",
      "audio/aac",
      "audio/flac",
      "audio/ogg",
      "audio/x-m4a",
      "audio/mp4",
    ];

    if (
      allowedTypes.includes(file.mimetype) ||
      file.originalname.match(/\.(mp3|wav|aac|flac|ogg|m4a)$/i)
    ) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only audio files are allowed."));
    }
  },
});

// In-memory job storage
const jobs = new Map();

/**
 * POST /api/enhance
 * Upload audio file for enhancement
 */
router.post("/", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "No file uploaded",
      });
    }

    const {
      noiseReduction = "false",
      normalize = "false",
      bassBoost = "0",
      trebleBoost = "0",
      compress = "false",
    } = req.body;

    const jobId = uuidv4();

    // Store job info
    jobs.set(jobId, {
      jobId,
      status: "pending",
      progress: 0,
      originalFilename: req.file.originalname,
      options: {
        noiseReduction: noiseReduction === "true",
        normalize: normalize === "true",
        bassBoost: parseInt(bassBoost) || 0,
        trebleBoost: parseInt(trebleBoost) || 0,
        compress: compress === "true",
      },
    });

    logger.info(
      `New enhancement request: ${req.file.originalname} (Job: ${jobId})`,
    );

    // Start enhancement asynchronously
    conversionService
      .enhanceAudio(
        {
          inputPath: req.file.path,
          noiseReduction: noiseReduction === "true",
          normalize: normalize === "true",
          bassBoost: parseInt(bassBoost) || 0,
          trebleBoost: parseInt(trebleBoost) || 0,
          compress: compress === "true",
        },
        (progressData) => {
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

        // Clean up uploaded file
        const fs = require("fs");
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
      })
      .catch((error) => {
        const job = jobs.get(jobId);
        if (job) {
          job.status = "failed";
          job.error = error.message;
        }

        logger.error(`Enhancement failed for job ${jobId}:`, error);

        // Clean up uploaded file
        const fs = require("fs");
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
      });

    res.status(202).json({
      success: true,
      message: "Enhancement request accepted",
      data: {
        jobId,
        status: "pending",
        originalFilename: req.file.originalname,
      },
    });
  } catch (error) {
    logger.error("Failed to process enhancement request:", error);

    res.status(500).json({
      success: false,
      error: "Failed to process enhancement request",
      message: error.message,
    });
  }
});

/**
 * GET /api/enhance/:jobId
 * Get enhancement job status
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
        originalFilename: job.originalFilename,
        options: job.options,
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
 * GET /api/enhance/:jobId/file
 * Download enhanced file
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
        error: "Enhancement not completed",
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
      `Serving enhanced file for job ${jobId}: ${job.result.filename}`,
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
 * DELETE /api/enhance/:jobId
 * Cancel or remove enhancement job
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

    // Delete enhanced file if it exists
    if (job.result && job.result.filepath) {
      conversionService.deleteFile(job.result.filepath);
    }

    // Remove job from memory
    jobs.delete(jobId);

    logger.info(`Removed enhancement job ${jobId}`);

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
