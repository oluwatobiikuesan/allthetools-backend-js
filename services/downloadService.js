const YTDlpWrap = require("yt-dlp-wrap").default;
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const config = require("../config/config");
const logger = require("../utils/logger");
const { detectPlatform } = require("../utils/validators");

// Ensure download directory exists
if (!fs.existsSync(config.download.dir)) {
  fs.mkdirSync(config.download.dir, { recursive: true });
}

// Ensure cookies directory exists
const cookiesDir = path.dirname(config.ytdlp.cookiesPath);
if (!fs.existsSync(cookiesDir)) {
  fs.mkdirSync(cookiesDir, { recursive: true });
}

class DownloadService {
  constructor() {
    this.ytDlpPath = config.ytdlp.path;
    this.ytDlp = null;
    this.initPromise = this.initYtDlp();
  }

  /**
   * Initialize yt-dlp wrapper
   */
  async initYtDlp() {
    try {
      if (this.ytDlpPath) {
        this.ytDlp = new YTDlpWrap(this.ytDlpPath);
      } else {
        // Use the bundled binary
        this.ytDlp = new YTDlpWrap();
      }

      // Test if yt-dlp is available
      const version = await this.ytDlp.getVersion();
      logger.info(`yt-dlp initialized successfully. Version: ${version}`);
    } catch (error) {
      logger.error("Failed to initialize yt-dlp:", error);
      throw new Error(
        "yt-dlp initialization failed. Please ensure yt-dlp is installed.",
      );
    }
  }

  /**
   * Ensure yt-dlp is initialized before use
   */
  async ensureInitialized() {
    await this.initPromise;
    if (!this.ytDlp) {
      throw new Error("yt-dlp is not initialized");
    }
  }

  /**
   * Get yt-dlp version
   */
  async getVersion() {
    try {
      await this.ensureInitialized();
      return await this.ytDlp.getVersion();
    } catch (error) {
      logger.error("Failed to get yt-dlp version:", error);
      return null;
    }
  }

  /**
   * Get video info without downloading
   * @param {string} url - Video URL
   * @returns {Promise<Object>} Video metadata
   */
  async getVideoInfo(url) {
    try {
      await this.ensureInitialized();

      const platform = detectPlatform(url);
      const args = [];

      // YouTube-specific args: cookies + JS runtime + EJS solver + proxy
      if (platform === "youtube") {
        if (fs.existsSync(config.ytdlp.cookiesPath)) {
          args.push("--cookies", config.ytdlp.cookiesPath);
        }
        if (config.ytdlp.defaultOptions.remoteComponents) {
          args.push("--remote-components", config.ytdlp.defaultOptions.remoteComponents);
        }
        if (config.ytdlp.proxy) {
          args.push("--proxy", config.ytdlp.proxy);
        }
        if (config.ytdlp.defaultOptions.jsRuntimes) {
          args.push("--js-runtimes", config.ytdlp.defaultOptions.jsRuntimes);
        }
        if (config.ytdlp.defaultOptions.extractorArgs) {
          args.push("--extractor-args", config.ytdlp.defaultOptions.extractorArgs);
        }
        if (config.ytdlp.defaultOptions.userAgent) {
          args.push("--user-agent", config.ytdlp.defaultOptions.userAgent);
        }
      }

      logger.debug(`getVideoInfo args for ${url}: ${JSON.stringify(args)}`);

      const info = await this.ytDlp.getVideoInfo([url, ...args]);
      return {
        title: info.title,
        duration: info.duration,
        uploader: info.uploader,
        thumbnail: info.thumbnail,
        description: info.description,
        formats: info.formats?.map((f) => ({
          formatId: f.format_id,
          ext: f.ext,
          quality: f.quality,
          filesize: f.filesize,
        })),
      };
    } catch (error) {
      logger.error(`Failed to get video info for ${url}:`, error);
      throw error;
    }
  }

  /**
   * Build yt-dlp options based on request parameters
   * @param {Object} params - Download parameters
   * @returns {Array} yt-dlp options
   */
  buildDownloadOptions(params) {
    const { format, quality, url } = params;
    const platform = detectPlatform(url);
    const options = { ...config.ytdlp.defaultOptions };

    // Skip format/quality selection for YouTube - let yt-dlp handle it
    if (platform !== "youtube") {
      // Format selection
      if (format && format !== "best") {
        options.format = `bestvideo[ext=${format}]+bestaudio/best[ext=${format}]/best`;
        options.mergeOutputFormat = format;
      }

      // Quality selection
      if (quality && quality !== "best") {
        if (quality === "worst") {
          options.format = "worst";
        } else {
          // Extract height from quality (e.g., '1080p' -> '1080')
          const height = quality.replace("p", "");
          options.format = `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`;
        }
      }
    }

    // Platform-specific options
    if (platform === "youtube") {
      // Add cookies for YouTube if the file exists
      if (fs.existsSync(config.ytdlp.cookiesPath)) {
        options.cookies = config.ytdlp.cookiesPath;
        logger.debug(`Using cookies for YouTube: ${config.ytdlp.cookiesPath}`);
      }
    } else if (platform === "tiktok") {
      // TikTok-specific options
      options.noCheckCertificates = true;
    } else if (platform === "twitch") {
      // Twitch-specific options
      options.format = "best";
    } else if (platform === "instagram") {
      // Instagram-specific options
      options.noCheckCertificates = true;
    } else if (platform === "twitter") {
      // Twitter-specific options
      options.noCheckCertificates = true;
    }

    return options;
  }

  /**
   * Download video
   * @param {Object} params - Download parameters
   * @param {Function} progressCallback - Progress callback function
   * @returns {Promise<Object>} Download result
   */
  async downloadVideo(params, progressCallback) {
    const { url } = params;
    const jobId = uuidv4();
    const platform = detectPlatform(url);

    logger.info(
      `Starting download for ${platform} video: ${url} (Job: ${jobId})`,
    );

    try {
      // Get video info first
      const videoInfo = await this.getVideoInfo(url);

      // Generate safe filename
      const safeTitle = videoInfo.title
        .replace(/[^a-z0-9]/gi, "_")
        .toLowerCase()
        .substring(0, 100);

      const outputTemplate = path.join(
        config.download.dir,
        `${jobId}_${safeTitle}.%(ext)s`,
      );

      // Build download options
      const options = this.buildDownloadOptions(params);
      options.output = outputTemplate;

      // Convert options to arguments
      const args = this.optionsToArgs(options);

      // Start download using exec which returns a YTDlpEventEmitter
      const ytDlpEmitter = this.ytDlp.exec([url, ...args]);

      if (!ytDlpEmitter) {
        throw new Error("Failed to start yt-dlp process");
      }

      let downloadedFile = null;
      let errorMessages = [];

      // Wait for download to complete using the event emitter
      await new Promise((resolve, reject) => {
        // Handle progress events
        ytDlpEmitter.on("progress", (progress) => {
          if (progressCallback) {
            progressCallback({
              jobId,
              progress: progress.percent || 0,
              status: "downloading",
              message: `${progress.percent}% - ${progress.currentSpeed || "N/A"} - ETA: ${progress.eta || "N/A"}`,
            });
          }
        });

        // Handle yt-dlp events (for capturing output filename)
        ytDlpEmitter.on("ytDlpEvent", (eventType, eventData) => {
          logger.debug(`yt-dlp event [${eventType}]: ${eventData}`);

          // Try to capture the output filename from various events
          const mergeMatch = eventData.match(
            /\[Merger\] Merging formats into "(.+)"/,
          );
          const destMatch = eventData.match(/\[download\] Destination: (.+)/);

          if (mergeMatch) {
            downloadedFile = mergeMatch[1];
          } else if (destMatch && !downloadedFile) {
            downloadedFile = destMatch[1];
          }
        });

        // Handle close event (process exit)
        ytDlpEmitter.on("close", (exitCode) => {
          if (exitCode === 0) {
            resolve();
          } else {
            const errorMsg =
              errorMessages.length > 0
                ? errorMessages.join("\n")
                : `yt-dlp exited with code ${exitCode}`;
            reject(new Error(errorMsg));
          }
        });

        // Handle error events
        ytDlpEmitter.on("error", (error) => {
          errorMessages.push(error.message);
          reject(error);
        });
      });

      // Find the downloaded file if not captured from output
      if (!downloadedFile) {
        const files = fs.readdirSync(config.download.dir);
        const matchingFile = files.find((f) => f.startsWith(jobId));
        if (matchingFile) {
          downloadedFile = path.join(config.download.dir, matchingFile);
        }
      }

      if (!downloadedFile || !fs.existsSync(downloadedFile)) {
        throw new Error("Download completed but file not found");
      }

      const fileStats = fs.statSync(downloadedFile);

      logger.info(
        `Download completed: ${downloadedFile} (${fileStats.size} bytes)`,
      );

      return {
        jobId,
        success: true,
        filename: path.basename(downloadedFile),
        filepath: downloadedFile,
        filesize: fileStats.size,
        videoInfo,
      };
    } catch (error) {
      logger.error(`Download failed for ${url}:`, error);
      throw error;
    }
  }

  /**
   * Convert options object to command line arguments
   * @param {Object} options - Options object
   * @returns {Array} Command line arguments
   */
  optionsToArgs(options) {
    const args = [];

    for (const [key, value] of Object.entries(options)) {
      const argName = key.replace(/([A-Z])/g, "-$1").toLowerCase();

      if (typeof value === "boolean") {
        if (value) {
          args.push(`--${argName}`);
        }
      } else if (value !== undefined && value !== null) {
        args.push(`--${argName}`, String(value));
      }
    }

    return args;
  }

  /**
   * Delete downloaded file
   * @param {string} filepath - Path to file
   */
  deleteFile(filepath) {
    try {
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
        logger.info(`Deleted file: ${filepath}`);
        return true;
      }
      return false;
    } catch (error) {
      logger.error(`Failed to delete file ${filepath}:`, error);
      return false;
    }
  }

  /**
   * Clean up old downloads based on retention policy
   */
  cleanupOldDownloads() {
    try {
      const now = Date.now();
      const retentionMs = config.download.retentionHours * 60 * 60 * 1000;

      const files = fs.readdirSync(config.download.dir);
      let deletedCount = 0;

      files.forEach((file) => {
        const filepath = path.join(config.download.dir, file);
        const stats = fs.statSync(filepath);
        const age = now - stats.mtimeMs;

        if (age > retentionMs) {
          this.deleteFile(filepath);
          deletedCount++;
        }
      });

      if (deletedCount > 0) {
        logger.info(`Cleaned up ${deletedCount} old download(s)`);
      }
    } catch (error) {
      logger.error("Failed to cleanup old downloads:", error);
    }
  }
}

module.exports = new DownloadService();
