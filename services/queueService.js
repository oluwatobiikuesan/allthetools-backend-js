const Queue = require("bull");
const config = require("../config/config");
const logger = require("../utils/logger");
const downloadService = require("./downloadService");

// Create download queue
const downloadQueue = new Queue("video-downloads", {
  redis: {
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
  },
  settings: {
    maxStalledCount: 1,
    stalledInterval: 30000,
  },
});

// Configure queue concurrency
downloadQueue.process(config.download.maxConcurrent, async (job) => {
  const { url, format, quality } = job.data;

  logger.info(`Processing download job ${job.id} for URL: ${url}`);

  try {
    // Update job progress
    await job.progress(0);

    // Download video with progress callback
    const result = await downloadService.downloadVideo(
      { url, format, quality },
      async (progressData) => {
        // Update job progress
        await job.progress(progressData.progress);

        // Update job data with progress info
        await job.update({
          ...job.data,
          progressMessage: progressData.message,
        });
      },
    );

    // Mark as complete
    await job.progress(100);

    logger.info(`Download job ${job.id} completed successfully`);

    return result;
  } catch (error) {
    logger.error(`Download job ${job.id} failed:`, error);
    throw error;
  }
});

// Queue event handlers
downloadQueue.on("completed", (job, result) => {
  logger.info(`Job ${job.id} completed with result:`, {
    filename: result.filename,
    filesize: result.filesize,
  });
});

downloadQueue.on("failed", (job, error) => {
  logger.error(`Job ${job.id} failed:`, error.message);
});

downloadQueue.on("stalled", (job) => {
  logger.warn(`Job ${job.id} stalled`);
});

downloadQueue.on("error", (error) => {
  logger.error("Queue error:", error);
});

/**
 * Add a download job to the queue
 * @param {Object} params - Download parameters
 * @returns {Promise<Object>} Job information
 */
async function addDownloadJob(params) {
  const { url, format = "best", quality = "best" } = params;

  try {
    const job = await downloadQueue.add(
      {
        url,
        format,
        quality,
        timestamp: new Date().toISOString(),
      },
      {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 5000,
        },
        removeOnComplete: false,
        removeOnFail: false,
      },
    );

    logger.info(`Added download job ${job.id} to queue`);

    return {
      jobId: job.id,
      status: "queued",
      url,
      format,
      quality,
    };
  } catch (error) {
    logger.error("Failed to add job to queue:", error);
    throw error;
  }
}

/**
 * Get job status
 * @param {string} jobId - Job ID
 * @returns {Promise<Object>} Job status
 */
async function getJobStatus(jobId) {
  try {
    const job = await downloadQueue.getJob(jobId);

    if (!job) {
      return null;
    }

    const state = await job.getState();
    const progress = job._progress;
    const data = job.data;

    let result = null;
    if (state === "completed") {
      result = job.returnvalue;
    }

    let error = null;
    if (state === "failed") {
      error = job.failedReason;
    }

    return {
      jobId: job.id,
      status: state,
      progress,
      url: data.url,
      format: data.format,
      quality: data.quality,
      progressMessage: data.progressMessage,
      result,
      error,
      createdAt: data.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
    };
  } catch (error) {
    logger.error(`Failed to get job status for ${jobId}:`, error);
    throw error;
  }
}

/**
 * Cancel a job
 * @param {string} jobId - Job ID
 * @returns {Promise<boolean>} Success status
 */
async function cancelJob(jobId) {
  try {
    const job = await downloadQueue.getJob(jobId);

    if (!job) {
      return false;
    }

    const state = await job.getState();

    // Can only cancel jobs that are waiting or active
    if (state === "waiting" || state === "active") {
      await job.remove();
      logger.info(`Cancelled job ${jobId}`);
      return true;
    }

    return false;
  } catch (error) {
    logger.error(`Failed to cancel job ${jobId}:`, error);
    throw error;
  }
}

/**
 * Remove a job and its downloaded file
 * @param {string} jobId - Job ID
 * @returns {Promise<boolean>} Success status
 */
async function removeJob(jobId) {
  try {
    const job = await downloadQueue.getJob(jobId);

    if (!job) {
      return false;
    }

    const state = await job.getState();

    // If completed, delete the file
    if (state === "completed" && job.returnvalue?.filepath) {
      downloadService.deleteFile(job.returnvalue.filepath);
    }

    // Remove job from queue
    await job.remove();
    logger.info(`Removed job ${jobId}`);

    return true;
  } catch (error) {
    logger.error(`Failed to remove job ${jobId}:`, error);
    throw error;
  }
}

/**
 * Get queue statistics
 * @returns {Promise<Object>} Queue stats
 */
async function getQueueStats() {
  try {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      downloadQueue.getWaitingCount(),
      downloadQueue.getActiveCount(),
      downloadQueue.getCompletedCount(),
      downloadQueue.getFailedCount(),
      downloadQueue.getDelayedCount(),
    ]);

    return {
      waiting,
      active,
      completed,
      failed,
      delayed,
      total: waiting + active + completed + failed + delayed,
    };
  } catch (error) {
    logger.error("Failed to get queue stats:", error);
    throw error;
  }
}

/**
 * Clean completed and failed jobs
 * @param {number} grace - Grace period in milliseconds
 */
async function cleanQueue(grace = 3600000) {
  try {
    await downloadQueue.clean(grace, "completed");
    await downloadQueue.clean(grace, "failed");
    logger.info("Queue cleaned successfully");
  } catch (error) {
    logger.error("Failed to clean queue:", error);
  }
}

// Cleanup old jobs periodically (every hour)
setInterval(() => {
  cleanQueue();
  downloadService.cleanupOldDownloads();
}, 3600000);

module.exports = {
  downloadQueue,
  addDownloadJob,
  getJobStatus,
  cancelJob,
  removeJob,
  getQueueStats,
  cleanQueue,
};
