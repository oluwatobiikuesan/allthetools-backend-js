const { body, param, validationResult } = require("express-validator");

const allowedPlans = ["free", "pro", "agency", "enterprise"];

function detectPlatform(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    if (hostname.includes("youtube.com") || hostname.includes("youtu.be")) {
      return "youtube";
    }

    if (hostname.includes("tiktok.com")) {
      return "tiktok";
    }

    if (hostname.includes("twitch.tv")) {
      return "twitch";
    }

    return null;
  } catch (error) {
    return null;
  }
}

function isSupportedPlatform(url) {
  return detectPlatform(url) !== null;
}

const validateDownloadRequest = [
  body("url")
    .trim()
    .notEmpty()
    .withMessage("URL is required")
    .isURL({ protocols: ["http", "https"] })
    .withMessage("Invalid URL format")
    .custom((value) => {
      if (!isSupportedPlatform(value)) {
        throw new Error("URL must be from YouTube, TikTok, or Twitch");
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
      "Invalid quality. Allowed: best, worst, 720p, 1080p, 1440p, 2160p"
    ),
  body("clientId")
    .optional()
    .isString()
    .isLength({ min: 8, max: 64 })
    .withMessage("clientId must be 8-64 characters"),
  body("workspaceId")
    .optional()
    .isString()
    .isLength({ min: 8, max: 64 })
    .withMessage("workspaceId must be 8-64 characters"),
  body("plan")
    .optional()
    .isIn(allowedPlans)
    .withMessage(`Plan must be one of: ${allowedPlans.join(", ")}`),
];

const validateJobId = [
  param("jobId")
    .trim()
    .notEmpty()
    .withMessage("Job ID is required")
    .isUUID()
    .withMessage("Invalid job ID format"),
];

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
  allowedPlans,
};
