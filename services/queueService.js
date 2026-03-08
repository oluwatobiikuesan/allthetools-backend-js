const Queue = require("bull");
const config = require("../config/config");
const logger = require("../utils/logger");
const downloadService = require("./downloadService");
const telemetryService = require("./telemetryService");

const JOB_TOOL_NAME = "video_downloader";

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

downloadQueue.process(config.download.maxConcurrent, async (job) => {
  const { url, format, quality } = job.data;

  logger.info(`Processing download job ${job.id} for URL: ${url}`);

  try {
    await job.progress(0);

    const result = await downloadService.downloadVideo(
      { url, format, quality },
      async (progressData) => {
        await job.progress(progressData.progress);
        await job.update({
          ...job.data,
          progressMessage: progressData.message,
        });
      }
    );

    await job.progress(100);

    logger.info(`Download job ${job.id} completed successfully`);

    return result;
  } catch (error) {
    logger.error(`Download job ${job.id} failed:`, error);
    throw error;
  }
});

function baseJobRecord(job) {
  return {
    job_id: job.id,
    tool: job.data.tool || JOB_TOOL_NAME,
    platform: job.data.platform,
    client_id: job.data.clientId,
    workspace_id: job.data.workspaceId,
    plan: job.data.plan,
    user_agent: job.data.userAgent,
    source_ip: job.data.sourceIp,
    format: job.data.format,
    quality: job.data.quality,
    submitted_at: job.data.timestamp,
  };
}

downloadQueue.on("active", async (job) => {
  try {
    const startedAt = new Date();
    const submittedAt = job.data.timestamp
      ? new Date(job.data.timestamp)
      : null;
    const queueWaitMs =
      submittedAt && job.processedOn
        ? job.processedOn - submittedAt.getTime()
        : submittedAt
        ? startedAt.getTime() - submittedAt.getTime()
        : null;

    await telemetryService.upsertJob({
      ...baseJobRecord(job),
      status: "active",
      started_at: new Date(job.processedOn || startedAt).toISOString(),
      queue_wait_ms: queueWaitMs,
    });
  } catch (error) {
    logger.warn(`[telemetry] failed to log active job ${job.id}`, error);
  }
});

downloadQueue.on("completed", async (job, result) => {
  logger.info(`Job ${job.id} completed with result:`, {
    filename: result.filename,
    filesize: result.filesize,
  });

  try {
    const completedAt = job.finishedOn
      ? new Date(job.finishedOn)
      : new Date();
    const processedOn = job.processedOn
      ? new Date(job.processedOn)
      : completedAt;
    const submittedAt = job.data.timestamp
      ? new Date(job.data.timestamp)
      : null;

    const queueWaitMs =
      submittedAt && job.processedOn
        ? job.processedOn - submittedAt.getTime()
        : null;
    const processingMs = job.finishedOn && job.processedOn
      ? job.finishedOn - job.processedOn
      : completedAt.getTime() - processedOn.getTime();

    await telemetryService.upsertJob({
      ...baseJobRecord(job),
      status: "completed",
      started_at: processedOn.toISOString(),
      completed_at: completedAt.toISOString(),
      queue_wait_ms: queueWaitMs,
      processing_ms: processingMs,
      filesize_bytes: result?.filesize,
      result_filename: result?.filename,
      video_duration_seconds: result?.videoInfo?.duration,
    });

    const costs = telemetryService.calculateCosts({
      filesizeBytes: result?.filesize || 0,
      processingMs,
      retentionHours: config.download.retentionHours,
    });

    await telemetryService.insertCost({
      job_id: job.id,
      tool: job.data.tool || JOB_TOOL_NAME,
      currency: "USD",
      recorded_at: completedAt.toISOString(),
      ...costs,
    });
  } catch (error) {
    logger.warn(`[telemetry] failed to log completion for job ${job.id}`, error);
  }
});

downloadQueue.on("failed", async (job, error) => {
  logger.error(`Job ${job.id} failed:`, error.message);

  try {
    const finishedAt = job.finishedOn
      ? new Date(job.finishedOn)
      : new Date();

    await telemetryService.upsertJob({
      ...baseJobRecord(job),
      status: "failed",
      started_at: job.processedOn
        ? new Date(job.processedOn).toISOString()
        : null,
      completed_at: finishedAt.toISOString(),
      error_message: error?.message,
    });
  } catch (telemetryError) {
    logger.warn(
      `[telemetry] failed to log failure for job ${job.id}`,
      telemetryError
    );
  }
});

downloadQueue.on("stalled", (job) => {
  logger.warn(`Job ${job.id} stalled`);
});

downloadQueue.on("error", (error) => {
  logger.error("Queue error:", error);
});

const SNAPSHOT_INTERVAL_MS =
  parseInt(process.env.QUEUE_SNAPSHOT_INTERVAL_MS, 10) || 60000;

async function snapshotQueueMetrics() {
  try {
    const stats = await getQueueStats();
    await telemetryService.recordQueueSnapshot({
      queue_name: "video-downloads",
      captured_at: new Date().toISOString(),
      ...stats,
    });
  } catch (error) {
    logger.debug("Failed to send queue snapshot", error.message);
  }
}

setInterval(snapshotQueueMetrics, SNAPSHOT_INTERVAL_MS);

async function addDownloadJob(params) {
  const {
    url,
    format = "best",
    quality = "best",
    platform = "unknown",
    tool = JOB_TOOL_NAME,
    clientId = null,
    workspaceId = null,
    plan = "free",
    userAgent = null,
    sourceIp = null,
  } = params;

  try {
    const job = await downloadQueue.add(
      {
        url,
        format,
        quality,
        platform,
        tool,
        clientId,
        workspaceId,
        plan,
        userAgent,
        sourceIp,
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
      }
    );

    logger.info(`Added download job ${job.id} to queue`);

    await telemetryService.upsertJob({
      ...baseJobRecord(job),
      status: "queued",
    });

    return {
      jobId: job.id,
      status: "queued",
      url,
      format,
      quality,
      platform,
      plan,
    };
  } catch (error) {
    logger.error("Failed to add job to queue:", error);
    throw error;
  }
}

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
      platform: data.platform,
      plan: data.plan,
      clientId: data.clientId,
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

async function cancelJob(jobId) {
  try {
    const job = await downloadQueue.getJob(jobId);

    if (!job) {
      return false;
    }

    const state = await job.getState();

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

async function removeJob(jobId) {
  try {
    const job = await downloadQueue.getJob(jobId);

    if (!job) {
      return false;
    }

    const state = await job.getState();

    if (state === "completed" && job.returnvalue?.filepath) {
      downloadService.deleteFile(job.returnvalue.filepath);
    }

    await job.remove();
    logger.info(`Removed job ${jobId}`);

    return true;
  } catch (error) {
    logger.error(`Failed to remove job ${jobId}:`, error);
    throw error;
  }
}

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

async function cleanQueue(grace = 3600000) {
  try {
    await downloadQueue.clean(grace, "completed");
    await downloadQueue.clean(grace, "failed");
    logger.info("Queue cleaned successfully");
  } catch (error) {
    logger.error("Failed to clean queue:", error);
  }
}

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
