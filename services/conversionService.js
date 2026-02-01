const YTDlpWrap = require("yt-dlp-wrap").default;
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const config = require("../config/config");
const logger = require("../utils/logger");

// Ensure conversion directory exists
const conversionDir = path.join(config.download.dir, "conversions");
if (!fs.existsSync(conversionDir)) {
  fs.mkdirSync(conversionDir, { recursive: true });
}

class ConversionService {
  constructor() {
    this.ytDlpPath = config.ytdlp.path;
    this.ytDlp = null;
    this.initPromise = this.initYtDlp();
  }

  /**
   * Initialize yt-dlp wrapper (for ffmpeg access)
   */
  async initYtDlp() {
    try {
      if (this.ytDlpPath) {
        this.ytDlp = new YTDlpWrap(this.ytDlpPath);
      } else {
        this.ytDlp = new YTDlpWrap();
      }
      logger.info("Conversion service initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize conversion service:", error);
      throw new Error("Conversion service initialization failed");
    }
  }

  /**
   * Ensure service is initialized
   */
  async ensureInitialized() {
    await this.initPromise;
    if (!this.ytDlp) {
      throw new Error("Conversion service is not initialized");
    }
  }

  /**
   * Convert audio file to target format
   * @param {Object} params - Conversion parameters
   * @returns {Promise<Object>} Conversion result
   */
  async convertAudio(params, progressCallback) {
    const { inputPath, targetFormat, quality = "192" } = params;
    const jobId = uuidv4();

    logger.info(`Starting audio conversion (Job: ${jobId})`);

    try {
      await this.ensureInitialized();

      // Validate input file exists
      if (!fs.existsSync(inputPath)) {
        throw new Error("Input file not found");
      }

      // Generate output filename
      const inputFilename = path.basename(inputPath, path.extname(inputPath));
      const outputFilename = `${jobId}_${inputFilename}.${targetFormat}`;
      const outputPath = path.join(conversionDir, outputFilename);

      // Check if input file has an audio stream
      const { spawn } = require("child_process");

      const hasAudio = await new Promise((resolve, reject) => {
        const ffprobe = spawn("ffprobe", [
          "-v",
          "error",
          "-select_streams",
          "a:0",
          "-show_entries",
          "stream=codec_type",
          "-of",
          "default=noprint_wrappers=1:nokey=1",
          inputPath,
        ]);

        let output = "";
        ffprobe.stdout.on("data", (data) => {
          output += data.toString();
        });

        ffprobe.on("close", (code) => {
          resolve(output.trim() === "audio");
        });

        ffprobe.on("error", (error) => {
          reject(error);
        });
      });

      if (!hasAudio) {
        throw new Error(
          "This video file does not contain an audio stream. Please upload a video with audio.",
        );
      }

      // Build ffmpeg command
      const ffmpegArgs = [
        "-i",
        inputPath,
        "-vn", // No video
        "-acodec",
        this.getAudioCodec(targetFormat),
        "-b:a",
        `${quality}k`,
        "-y", // Overwrite output file
        outputPath,
      ];

      logger.info(`FFmpeg command: ffmpeg ${ffmpegArgs.join(" ")}`);

      // Execute ffmpeg
      await new Promise((resolve, reject) => {
        const ffmpeg = spawn("ffmpeg", ffmpegArgs);
        let errorOutput = "";

        ffmpeg.stderr.on("data", (data) => {
          const output = data.toString();
          errorOutput += output;

          // Parse progress from ffmpeg output
          const timeMatch = output.match(/time=(\d+):(\d+):(\d+\.\d+)/);
          const durationMatch = output.match(
            /Duration: (\d+):(\d+):(\d+\.\d+)/,
          );

          if (timeMatch && durationMatch) {
            const currentSeconds =
              parseInt(timeMatch[1]) * 3600 +
              parseInt(timeMatch[2]) * 60 +
              parseFloat(timeMatch[3]);
            const totalSeconds =
              parseInt(durationMatch[1]) * 3600 +
              parseInt(durationMatch[2]) * 60 +
              parseFloat(durationMatch[3]);
            const progress = Math.min(
              99,
              Math.round((currentSeconds / totalSeconds) * 100),
            );

            if (progressCallback) {
              progressCallback({
                jobId,
                progress,
                status: "converting",
              });
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

      // Verify output file exists
      if (!fs.existsSync(outputPath)) {
        throw new Error("Conversion completed but output file not found");
      }

      const fileStats = fs.statSync(outputPath);

      logger.info(
        `Conversion completed: ${outputPath} (${fileStats.size} bytes)`,
      );

      return {
        jobId,
        success: true,
        filename: outputFilename,
        filepath: outputPath,
        filesize: fileStats.size,
        format: targetFormat,
      };
    } catch (error) {
      logger.error(`Conversion failed for job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Convert audio from URL
   * @param {Object} params - Conversion parameters
   * @returns {Promise<Object>} Conversion result
   */
  async convertFromUrl(params, progressCallback) {
    const { url, targetFormat, quality = "192" } = params;
    const jobId = uuidv4();

    logger.info(`Starting URL conversion (Job: ${jobId}): ${url}`);

    try {
      await this.ensureInitialized();

      // Generate output filename
      const outputFilename = `${jobId}_audio.${targetFormat}`;
      const outputPath = path.join(conversionDir, outputFilename);

      // Use yt-dlp to download and extract audio
      const args = [
        url,
        "--extract-audio",
        "--audio-format",
        targetFormat,
        "--audio-quality",
        quality,
        "-o",
        outputPath.replace(`.${targetFormat}`, ".%(ext)s"),
        "--no-playlist", // Don't download playlists
      ];

      logger.info(`yt-dlp command: ${args.join(" ")}`);

      // Execute yt-dlp
      const ytDlpEmitter = this.ytDlp.exec(args);

      if (!ytDlpEmitter) {
        throw new Error("Failed to start conversion process");
      }

      let errorMessages = [];

      // Wait for conversion to complete
      await new Promise((resolve, reject) => {
        ytDlpEmitter.on("progress", (progress) => {
          if (progressCallback) {
            progressCallback({
              jobId,
              progress: progress.percent || 0,
              status: "converting",
            });
          }
        });

        ytDlpEmitter.on("ytDlpEvent", (eventType, eventData) => {
          logger.debug(`Conversion event [${eventType}]: ${eventData}`);
        });

        ytDlpEmitter.on("close", (exitCode) => {
          if (exitCode === 0) {
            resolve();
          } else {
            const errorMsg =
              errorMessages.length > 0
                ? errorMessages.join("\n")
                : `Conversion failed with exit code ${exitCode}`;
            reject(new Error(errorMsg));
          }
        });

        ytDlpEmitter.on("error", (error) => {
          errorMessages.push(error.message);
          reject(error);
        });
      });

      // Verify output file exists
      if (!fs.existsSync(outputPath)) {
        throw new Error("Conversion completed but output file not found");
      }

      const fileStats = fs.statSync(outputPath);

      logger.info(
        `URL conversion completed: ${outputPath} (${fileStats.size} bytes)`,
      );

      return {
        jobId,
        success: true,
        filename: outputFilename,
        filepath: outputPath,
        filesize: fileStats.size,
        format: targetFormat,
      };
    } catch (error) {
      logger.error(`URL conversion failed for job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Enhance audio file with various filters
   * @param {Object} params - Enhancement parameters
   * @returns {Promise<Object>} Enhancement result
   */
  async enhanceAudio(params, progressCallback) {
    const {
      inputPath,
      noiseReduction = false,
      normalize = false,
      bassBoost = 0,
      trebleBoost = 0,
      compress = false,
    } = params;
    const jobId = uuidv4();

    logger.info(`Starting audio enhancement (Job: ${jobId})`);

    try {
      // Validate input file exists
      if (!fs.existsSync(inputPath)) {
        throw new Error("Input file not found");
      }

      // Generate output filename
      const inputFilename = path.basename(inputPath, path.extname(inputPath));
      const outputFormat = path.extname(inputPath).slice(1) || "mp3";
      const outputFilename = `${jobId}_${inputFilename}_enhanced.${outputFormat}`;
      const outputPath = path.join(conversionDir, outputFilename);

      // Build ffmpeg filter chain
      const filters = [];

      // Noise reduction
      if (noiseReduction) {
        filters.push("afftdn=nf=-25");
      }

      // Bass boost (increase low frequencies)
      if (bassBoost > 0) {
        filters.push(`bass=g=${bassBoost}`);
      }

      // Treble boost (increase high frequencies)
      if (trebleBoost > 0) {
        filters.push(`treble=g=${trebleBoost}`);
      }

      // Dynamic range compression
      if (compress) {
        filters.push("acompressor=threshold=-20dB:ratio=4:attack=5:release=50");
      }

      // Volume normalization (apply last)
      if (normalize) {
        filters.push("loudnorm=I=-16:TP=-1.5:LRA=11");
      }

      const { spawn } = require("child_process");

      // Build ffmpeg command
      const ffmpegArgs = ["-i", inputPath];

      if (filters.length > 0) {
        ffmpegArgs.push("-af", filters.join(","));
      }

      ffmpegArgs.push(
        "-acodec",
        this.getAudioCodec(outputFormat),
        "-y",
        outputPath,
      );

      logger.info(`FFmpeg enhancement command: ffmpeg ${ffmpegArgs.join(" ")}`);

      // Execute ffmpeg
      await new Promise((resolve, reject) => {
        const ffmpeg = spawn("ffmpeg", ffmpegArgs);
        let errorOutput = "";

        ffmpeg.stderr.on("data", (data) => {
          const output = data.toString();
          errorOutput += output;

          // Parse progress from ffmpeg output
          const timeMatch = output.match(/time=(\d+):(\d+):(\d+\.\d+)/);
          const durationMatch = output.match(
            /Duration: (\d+):(\d+):(\d+\.\d+)/,
          );

          if (timeMatch && durationMatch) {
            const currentSeconds =
              parseInt(timeMatch[1]) * 3600 +
              parseInt(timeMatch[2]) * 60 +
              parseFloat(timeMatch[3]);
            const totalSeconds =
              parseInt(durationMatch[1]) * 3600 +
              parseInt(durationMatch[2]) * 60 +
              parseFloat(durationMatch[3]);
            const progress = Math.min(
              99,
              Math.round((currentSeconds / totalSeconds) * 100),
            );

            if (progressCallback) {
              progressCallback({
                jobId,
                progress,
                status: "enhancing",
              });
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

      // Verify output file exists
      if (!fs.existsSync(outputPath)) {
        throw new Error("Enhancement completed but output file not found");
      }

      const fileStats = fs.statSync(outputPath);

      logger.info(
        `Enhancement completed: ${outputPath} (${fileStats.size} bytes)`,
      );

      return {
        jobId,
        success: true,
        filename: outputFilename,
        filepath: outputPath,
        filesize: fileStats.size,
        format: outputFormat,
      };
    } catch (error) {
      logger.error(`Enhancement failed for job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Get audio codec for target format
   * @param {string} format - Target audio format
   * @returns {string} FFmpeg audio codec
   */
  getAudioCodec(format) {
    const codecMap = {
      mp3: "libmp3lame",
      wav: "pcm_s16le",
      aac: "aac",
      flac: "flac",
      ogg: "libvorbis",
    };
    return codecMap[format] || "libmp3lame";
  }

  /**
   * Delete converted file
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
   * Clean up old conversions
   */
  cleanupOldConversions() {
    try {
      const now = Date.now();
      const retentionMs = config.download.retentionHours * 60 * 60 * 1000;

      if (!fs.existsSync(conversionDir)) {
        return;
      }

      const files = fs.readdirSync(conversionDir);
      let deletedCount = 0;

      files.forEach((file) => {
        const filepath = path.join(conversionDir, file);
        const stats = fs.statSync(filepath);
        const age = now - stats.mtimeMs;

        if (age > retentionMs) {
          this.deleteFile(filepath);
          deletedCount++;
        }
      });

      if (deletedCount > 0) {
        logger.info(`Cleaned up ${deletedCount} old conversion(s)`);
      }
    } catch (error) {
      logger.error("Failed to cleanup old conversions:", error);
    }
  }
}

module.exports = new ConversionService();
