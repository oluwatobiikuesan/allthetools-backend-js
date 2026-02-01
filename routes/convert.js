const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const conversionService = require("../services/conversionService");
const logger = require("../utils/logger");

// Configure multer for file uploads
const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept audio and video files
    const allowedMimes = [
      // Audio formats
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
      // Video formats
      "video/mp4",
      "video/mpeg",
      "video/quicktime",
      "video/x-msvideo",
      "video/x-matroska",
      "video/webm",
      "video/x-flv",
      "video/x-ms-wmv",
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error("Invalid file type. Only audio and video files are allowed."),
      );
    }
  },
});

// In-memory job storage (in production, use Redis or database)
const jobs = new Map();

/**
 * POST /api/convert
 * Submit audio file for conversion
 */
router.post("/", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "No file uploaded",
      });
    }

    const { targetFormat = "mp3", quality = "192" } = req.body;

    // Validate target format
    const allowedFormats = ["mp3", "wav", "aac", "flac", "ogg"];
    if (!allowedFormats.includes(targetFormat)) {
      // Clean up uploaded file
      fs.unlinkSync(req.file.path);
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
      originalFilename: req.file.originalname,
      targetFormat,
      quality,
    });

    logger.info(
      `New conversion request: ${req.file.originalname} -> ${targetFormat}`,
    );

    // Start conversion asynchronously
    conversionService
      .convertAudio(
        {
          inputPath: req.file.path,
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

        // Clean up input file
        fs.unlinkSync(req.file.path);
      })
      .catch((error) => {
        const job = jobs.get(jobId);
        if (job) {
          job.status = "failed";
          job.error = error.message;
        }

        // Clean up input file
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }

        logger.error(`Conversion failed for job ${jobId}:`, error);
      });

    res.status(202).json({
      success: true,
      message: "Conversion request accepted",
      data: {
        jobId,
        status: "pending",
        originalFilename: req.file.originalname,
        targetFormat,
      },
    });
  } catch (error) {
    logger.error("Failed to process conversion request:", error);

    // Clean up uploaded file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      success: false,
      error: "Failed to process conversion request",
      message: error.message,
    });
  }
});

/**
 * GET /api/convert/:jobId
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
        originalFilename: job.originalFilename,
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
 * GET /api/convert/:jobId/file
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
 * DELETE /api/convert/:jobId
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

    logger.info(`Removed conversion job ${jobId}`);

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
