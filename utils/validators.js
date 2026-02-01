const { body, param, validationResult } = require("express-validator");

/**
 * Detect the platform from a URL
 * @param {string} url - The URL to check
 * @returns {string|null} - Platform name or null if not supported
 */
function detectPlatform(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    // YouTube
    if (hostname.includes("youtube.com") || hostname.includes("youtu.be")) {
      return "youtube";
    }

    // TikTok
    if (hostname.includes("tiktok.com")) {
      return "tiktok";
    }

    // Twitch
    if (hostname.includes("twitch.tv")) {
      return "twitch";
    }

    // Instagram
    if (hostname.includes("instagram.com")) {
      return "instagram";
    }

    // Twitter/X
    if (hostname.includes("twitter.com") || hostname.includes("x.com")) {
      return "twitter";
    }

    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Validate if URL is from a supported platform
 * @param {string} url - The URL to validate
 * @returns {boolean}
 */
function isSupportedPlatform(url) {
  return detectPlatform(url) !== null;
}

/**
 * Express validator middleware for download request
 */
const validateDownloadRequest = [
  body("url")
    .trim()
    .notEmpty()
    .withMessage("URL is required")
    .isURL({ protocols: ["http", "https"] })
    .withMessage("Invalid URL format")
    .custom((value) => {
      if (!isSupportedPlatform(value)) {
        throw new Error(
          "URL must be from YouTube, TikTok, Twitch, Instagram, or Twitter",
        );
      }
      return true;
    }),
  body("format")
    .optional()
    .isIn(["mp4", "webm", "mkv", "best"])
    .withMessage("Invalid format. Allowed: mp4, webm, mkv, best"),
  body("quality")
    .optional()
    .isIn(["best", "worst", "720p", "1080p", "1440p", "2160p"])
    .withMessage(
      "Invalid quality. Allowed: best, worst, 720p, 1080p, 1440p, 2160p",
    ),
];

/**
 * Express validator middleware for job ID parameter
 */
const validateJobId = [
  param("jobId")
    .trim()
    .notEmpty()
    .withMessage("Job ID is required")
    .isNumeric()
    .withMessage("Invalid job ID format"),
];

/**
 * Middleware to handle validation errors
 */
function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array().map((err) => ({
        field: err.path,
        message: err.msg,
      })),
    });
  }
  next();
}

module.exports = {
  detectPlatform,
  isSupportedPlatform,
  validateDownloadRequest,
  validateJobId,
  handleValidationErrors,
};
