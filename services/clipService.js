const YTDlpWrap = require("yt-dlp-wrap").default;
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const config = require("../config/config");
const logger = require("../utils/logger");
const { detectPlatform } = require("../utils/validators");

// Ensure download directory exists (clips share the download dir)
if (!fs.existsSync(config.download.dir)) {
  fs.mkdirSync(config.download.dir, { recursive: true });
}

class ClipService {
  constructor() {
    this.ytDlpPath = config.ytdlp.path;
    this.ytDlp = null;
    this.initPromise = this.initYtDlp();
  }

  async initYtDlp() {
    try {
      this.ytDlp = this.ytDlpPath
        ? new YTDlpWrap(this.ytDlpPath)
        : new YTDlpWrap();
      const version = await this.ytDlp.getVersion();
      logger.info(`ClipService: yt-dlp initialized. Version: ${version}`);
    } catch (error) {
      logger.error("ClipService: failed to initialize yt-dlp:", error);
      throw new Error(
        "yt-dlp initialization failed. Please ensure yt-dlp is installed.",
      );
    }
  }

  async ensureInitialized() {
    await this.initPromise;
    if (!this.ytDlp) throw new Error("yt-dlp is not initialized");
  }

  /**
   * Resolve the direct video and audio stream URLs for a source URL using
   * `yt-dlp -g -f bestvideo+bestaudio`. Returns an array of URLs (line 1 =
   * video, line 2 = audio). Falls back to a single merged progressive stream
   * when separate streams aren't available.
   *
   * Uses child_process.spawn directly (rather than yt-dlp-wrap's exec) because
   * `-g` / `--get-url` prints the URLs to stdout and exits immediately — we
   * just need to collect stdout, not subscribe to progress events.
   *
   * @param {string} url
   * @returns {Promise<{ videoUrl: string, audioUrl: string|null }>}
   */
  async getStreamUrls(url) {
    await this.ensureInitialized();

    const platform = detectPlatform(url);
    const ytDlpBin = this.ytDlpPath || "yt-dlp";
    const args = ["-g", "-f", "bestvideo+bestaudio/best", "--no-playlist"];

    if (platform === "youtube") {
      if (fs.existsSync(config.ytdlp.cookiesPath)) {
        args.push("--cookies", config.ytdlp.cookiesPath);
      }
      if (config.ytdlp.defaultOptions.jsRuntimes) {
        args.push("--js-runtimes", config.ytdlp.defaultOptions.jsRuntimes);
      }
      if (config.ytdlp.defaultOptions.extractorArgs) {
        args.push("--extractor-args", config.ytdlp.defaultOptions.extractorArgs);
      }
      if (config.ytdlp.defaultOptions.remoteComponents) {
        args.push("--remote-components", config.ytdlp.defaultOptions.remoteComponents);
      }
      if (config.ytdlp.defaultOptions.userAgent) {
        args.push("--user-agent", config.ytdlp.defaultOptions.userAgent);
      }
    }
    args.push(url);

    logger.info(`ClipService: resolving stream URLs for ${url}`);
    logger.debug(`ClipService: yt-dlp ${args.join(" ")}`);

    return await new Promise((resolve, reject) => {
      const ytDlpProcess = spawn(ytDlpBin, args);
      let stdout = "";
      let stderr = "";

      ytDlpProcess.stdout.on("data", (data) => {
        stdout += data.toString();
      });
      ytDlpProcess.stderr.on("data", (data) => {
        stderr += data.toString();
      });
      ytDlpProcess.on("error", (err) => {
        reject(new Error(`Failed to start yt-dlp: ${err.message}`));
      });
      ytDlpProcess.on("close", (code) => {
        if (code !== 0) {
          return reject(
            new Error(
              `yt-dlp failed to resolve stream URLs (exit ${code}): ${stderr}`,
            ),
          );
        }
        const urls = stdout
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        if (urls.length === 0) {
          return reject(new Error("yt-dlp returned no stream URLs"));
        }
        resolve({
          videoUrl: urls[0],
          audioUrl: urls.length > 1 ? urls[1] : null,
        });
      });
    });
  }

  /**
   * Get video info (reused for preview / duration bound). Delegates to the
   * same yt-dlp --dump-json call as downloadService for consistency.
   * @param {string} url
   * @returns {Promise<Object>}
   */
  async getVideoInfo(url) {
    await this.ensureInitialized();
    const platform = detectPlatform(url);
    const args = [];

    if (platform === "youtube") {
      if (fs.existsSync(config.ytdlp.cookiesPath)) {
        args.push("--cookies", config.ytdlp.cookiesPath);
      }
      if (config.ytdlp.defaultOptions.jsRuntimes) {
        args.push("--js-runtimes", config.ytdlp.defaultOptions.jsRuntimes);
      }
      if (config.ytdlp.defaultOptions.extractorArgs) {
        args.push("--extractor-args", config.ytdlp.defaultOptions.extractorArgs);
      }
      if (config.ytdlp.defaultOptions.remoteComponents) {
        args.push("--remote-components", config.ytdlp.defaultOptions.remoteComponents);
      }
      if (config.ytdlp.defaultOptions.userAgent) {
        args.push("--user-agent", config.ytdlp.defaultOptions.userAgent);
      }
    }

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
  }

  /**
   * Create a clip by slicing the resolved remote streams with ffmpeg. Uses
   * the two-stream accurate-seek pattern: `-ss/-to` applied as input options
   * on both the video and audio inputs. If only a progressive (merged) stream
   * is available, slices that single stream instead.
   *
   * @param {Object} params
   * @param {string} params.url
   * @param {number} params.clipStart - Start time in seconds
   * @param {number} params.clipEnd   - End time in seconds
   * @param {(progressData: Object) => void} [progressCallback]
   * @returns {Promise<Object>} { jobId, filename, filepath, filesize }
   */
  async createClip(params, progressCallback) {
    const { url, clipStart, clipEnd } = params;
    const jobId = uuidv4();

    try {
      await this.ensureInitialized();

      if (
        typeof clipStart !== "number" ||
        typeof clipEnd !== "number" ||
        clipStart < 0 ||
        clipEnd <= clipStart
      ) {
        throw new Error(
          "Invalid clip range: clipEnd must be greater than clipStart",
        );
      }

      // Resolve stream URLs
      const { videoUrl, audioUrl } = await this.getStreamUrls(url);

      // Fetch video info for a safe title
      let safeTitle = "clip";
      try {
        const info = await this.getVideoInfo(url);
        safeTitle =
          (info.title || "clip")
            .replace(/[^\w\s-]/g, "")
            .replace(/\s+/g, "_")
            .slice(0, 50) || "clip";
      } catch (err) {
        logger.warn(`ClipService: could not fetch title, using default: ${err.message}`);
      }

      const outputFilename = `${jobId}_${safeTitle}.mp4`;
      const outputPath = path.join(config.download.dir, outputFilename);
      const totalSeconds = clipEnd - clipStart;

      // Build ffmpeg args — two-stream accurate seek
      const ffmpegArgs = [];
      if (audioUrl) {
        ffmpegArgs.push(
          "-ss",
          String(clipStart),
          "-to",
          String(clipEnd),
          "-i",
          videoUrl,
          "-ss",
          String(clipStart),
          "-to",
          String(clipEnd),
          "-i",
          audioUrl,
          "-map",
          "0:v",
          "-map",
          "1:a",
        );
      } else {
        // Progressive stream (video+audio in one)
        ffmpegArgs.push(
          "-ss",
          String(clipStart),
          "-to",
          String(clipEnd),
          "-i",
          videoUrl,
          "-c",
          "copy",
        );
      }
      ffmpegArgs.push("-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", "-y", outputPath);

      logger.info(`ClipService: ffmpeg ${ffmpegArgs.join(" ")}`);

      await new Promise((resolve, reject) => {
        const ffmpeg = spawn("ffmpeg", ffmpegArgs);
        let errorOutput = "";

        ffmpeg.stderr.on("data", (data) => {
          const output = data.toString();
          errorOutput += output;

          // Parse progress from ffmpeg stderr
          const timeMatch = output.match(/time=(\d+):(\d+):(\d+\.\d+)/);
          if (timeMatch) {
            const currentSeconds =
              parseInt(timeMatch[1]) * 3600 +
              parseInt(timeMatch[2]) * 60 +
              parseFloat(timeMatch[3]);
            const progress = Math.min(
              99,
              Math.max(0, Math.round((currentSeconds / totalSeconds) * 100)),
            );
            if (progressCallback) {
              progressCallback({ jobId, progress, status: "processing" });
            }
          }
        });

        ffmpeg.on("close", (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(
              new Error(`FFmpeg failed with exit code ${code}: ${errorOutput}`),
            );
          }
        });

        ffmpeg.on("error", (error) => {
          reject(new Error(`Failed to start ffmpeg: ${error.message}`));
        });
      });

      if (!fs.existsSync(outputPath)) {
        throw new Error("Clip creation completed but output file not found");
      }

      const fileStats = fs.statSync(outputPath);
      logger.info(
        `ClipService: clip created ${outputPath} (${fileStats.size} bytes)`,
      );

      return {
        jobId,
        success: true,
        filename: outputFilename,
        filepath: outputPath,
        filesize: fileStats.size,
        format: "mp4",
      };
    } catch (error) {
      logger.error(`ClipService: clip failed for job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Delete a clip file from disk.
   * @param {string} filepath
   */
  deleteFile(filepath) {
    try {
      if (filepath && fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
        logger.info(`ClipService: deleted file ${filepath}`);
      }
    } catch (error) {
      logger.error(`ClipService: failed to delete file ${filepath}:`, error);
    }
  }

  /**
   * Cleanup old clip files (shares download dir retention).
   */
  cleanupOldClips() {
    try {
      const dir = config.download.dir;
      const retentionHours = config.download.retentionHours;
      const now = Date.now();
      const maxAge = retentionHours * 60 * 60 * 1000;

      if (!fs.existsSync(dir)) return;

      const files = fs.readdirSync(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > maxAge) {
          fs.unlinkSync(filePath);
          logger.info(`ClipService: cleaned up old file ${filePath}`);
        }
      }
    } catch (error) {
      logger.error("ClipService: cleanup failed:", error);
    }
  }
}

module.exports = new ClipService();