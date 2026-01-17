const express = require("express");
const cors = require("cors");
const config = require("./config/config");
const logger = require("./utils/logger");

// Import routes
const downloadRoutes = require("./routes/download");
const healthRoutes = require("./routes/health");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get("user-agent"),
  });
  next();
});

// Routes
app.use("/api/health", healthRoutes);
app.use("/api/download", downloadRoutes);

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    name: "Video Downloader Service",
    version: "1.0.0",
    description:
      "Backend service for downloading videos from YouTube, TikTok, and Twitch",
    endpoints: {
      health: "/api/health",
      download: {
        submit: "POST /api/download",
        status: "GET /api/download/:jobId",
        file: "GET /api/download/:jobId/file",
        cancel: "DELETE /api/download/:jobId",
        info: "GET /api/download/info/video?url=<video_url>",
        stats: "GET /api/download/stats/queue",
      },
    },
    supportedPlatforms: ["YouTube", "TikTok", "Twitch"],
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Not found",
    path: req.path,
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error("Unhandled error:", err);

  res.status(err.status || 500).json({
    success: false,
    error: err.message || "Internal server error",
    ...(config.server.env === "development" && { stack: err.stack }),
  });
});

// Start server
const PORT = config.server.port;

app.listen(PORT, () => {
  logger.info(`Server started on port ${PORT}`);
  logger.info(`Environment: ${config.server.env}`);
  logger.info(`Download directory: ${config.download.dir}`);
  logger.info(`Max concurrent downloads: ${config.download.maxConcurrent}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down gracefully...");
  process.exit(0);
});

process.on("SIGINT", () => {
  logger.info("SIGINT received, shutting down gracefully...");
  process.exit(0);
});

module.exports = app;
