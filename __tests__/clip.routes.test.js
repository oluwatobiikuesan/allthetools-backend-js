// Integration tests for /api/clip routes.
// We mount the clip router on a minimal Express app and mock the
// queueService + clipService so no yt-dlp / ffmpeg / Redis is required.

jest.mock("../services/queueService", () => ({
  addClipJob: jest.fn(),
  getClipStatus: jest.fn(),
  cancelClipJob: jest.fn(),
  removeClipJob: jest.fn(),
  getClipQueueStats: jest.fn(),
  cleanClipQueue: jest.fn(),
}));
jest.mock("../services/clipService", () => ({
  getVideoInfo: jest.fn(),
  createClip: jest.fn(),
  deleteFile: jest.fn(),
  cleanupOldClips: jest.fn(),
}));
// Prevent the singleton from running yt-dlp init at require time
jest.mock("../utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const express = require("express");
const request = require("supertest");
const clipRoutes = require("../routes/clip");
const queueService = require("../services/queueService");
const clipService = require("../services/clipService");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/clip", clipRoutes);
  // Simple error handler to surface 500s
  app.use((err, _req, res, _next) => {
    res.status(500).json({ success: false, error: err.message });
  });
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("POST /api/clip", () => {
  it("accepts a valid clip request and returns 202 with jobId", async () => {
    queueService.addClipJob.mockResolvedValue({
      jobId: "1",
      status: "queued",
      url: "https://www.youtube.com/watch?v=abc",
      clipStart: 5,
      clipEnd: 15,
    });

    const res = await request(buildApp())
      .post("/api/clip")
      .send({
        url: "https://www.youtube.com/watch?v=abc",
        clipStart: 5,
        clipEnd: 15,
      })
      .set("Content-Type", "application/json");

    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(res.body.data.jobId).toBe("1");
    expect(res.body.data.platform).toBe("youtube");
    expect(queueService.addClipJob).toHaveBeenCalledWith({
      url: "https://www.youtube.com/watch?v=abc",
      clipStart: 5,
      clipEnd: 15,
    });
  });

  it("rejects when clipEnd <= clipStart with 400", async () => {
    const res = await request(buildApp())
      .post("/api/clip")
      .send({
        url: "https://www.youtube.com/watch?v=abc",
        clipStart: 20,
        clipEnd: 20,
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(queueService.addClipJob).not.toHaveBeenCalled();
  });

  it("rejects unsupported platform with 400", async () => {
    const res = await request(buildApp())
      .post("/api/clip")
      .send({
        url: "https://example.com",
        clipStart: 0,
        clipEnd: 10,
      });

    expect(res.status).toBe(400);
    expect(queueService.addClipJob).not.toHaveBeenCalled();
  });

  it("returns 500 when the queue throws", async () => {
    queueService.addClipJob.mockRejectedValue(new Error("redis down"));
    const res = await request(buildApp())
      .post("/api/clip")
      .send({
        url: "https://www.youtube.com/watch?v=abc",
        clipStart: 0,
        clipEnd: 5,
      });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

describe("GET /api/clip/:jobId", () => {
  it("returns job status when found", async () => {
    queueService.getClipStatus.mockResolvedValue({
      jobId: "7",
      status: "processing",
      progress: 42,
    });
    const res = await request(buildApp()).get("/api/clip/7");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("processing");
  });

  it("returns 404 when job not found", async () => {
    queueService.getClipStatus.mockResolvedValue(null);
    const res = await request(buildApp()).get("/api/clip/999");
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it("rejects non-numeric jobId with 400 (validateJobId)", async () => {
    const res = await request(buildApp()).get("/api/clip/notanumber");
    expect(res.status).toBe(400);
  });
});

describe("GET /api/clip/info/video (static route — must not be shadowed)", () => {
  it("responds 200 and calls clipService.getVideoInfo", async () => {
    clipService.getVideoInfo.mockResolvedValue({
      title: "Sample",
      duration: 120,
      uploader: " Someone",
      thumbnail: "https://img/x.jpg",
    });
    const res = await request(buildApp()).get(
      "/api/clip/info/video?url=https://www.youtube.com/watch?v=abc",
    );
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.title).toBe("Sample");
    // Critical: the static /info/video route must NOT be shadowed by /:jobId.
    // If it were, getClipStatus would have been called with "info" and 404'd.
    expect(queueService.getClipStatus).not.toHaveBeenCalled();
  });

  it("returns 400 when url param is missing", async () => {
    const res = await request(buildApp()).get("/api/clip/info/video");
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe("GET /api/clip/stats/queue (static route — must not be shadowed)", () => {
  it("responds 200 and calls getClipQueueStats (not getClipStatus)", async () => {
    queueService.getClipQueueStats.mockResolvedValue({
      waiting: 0,
      active: 0,
      completed: 1,
      failed: 0,
      delayed: 0,
      total: 1,
    });
    const res = await request(buildApp()).get("/api/clip/stats/queue");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(queueService.getClipQueueStats).toHaveBeenCalled();
    expect(queueService.getClipStatus).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/clip/:jobId", () => {
  it("cancels an active job", async () => {
    queueService.getClipStatus.mockResolvedValue({ jobId: "3", status: "active" });
    queueService.cancelClipJob.mockResolvedValue(true);
    const res = await request(buildApp()).delete("/api/clip/3");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("removes a completed job when cancel returns false", async () => {
    queueService.getClipStatus.mockResolvedValue({ jobId: "4", status: "completed" });
    queueService.cancelClipJob.mockResolvedValue(false);
    queueService.removeClipJob.mockResolvedValue(true);
    const res = await request(buildApp()).delete("/api/clip/4");
    expect(res.status).toBe(200);
    expect(queueService.removeClipJob).toHaveBeenCalled();
  });

  it("returns 404 when job not found", async () => {
    queueService.getClipStatus.mockResolvedValue(null);
    const res = await request(buildApp()).delete("/api/clip/404");
    expect(res.status).toBe(404);
  });
});