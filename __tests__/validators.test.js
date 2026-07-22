const {
  detectPlatform,
  isSupportedPlatform,
  validateClipRequest,
  handleValidationErrors,
} = require("../utils/validators");

describe("detectPlatform", () => {
  it("detects YouTube", () => {
    expect(detectPlatform("https://www.youtube.com/watch?v=abc")).toBe("youtube");
    expect(detectPlatform("https://youtu.be/abc")).toBe("youtube");
  });

  it("detects TikTok, Twitch, Instagram, Twitter/X", () => {
    expect(detectPlatform("https://www.tiktok.com/@user/video/1")).toBe("tiktok");
    expect(detectPlatform("https://www.twitch.tv/videos/123")).toBe("twitch");
    expect(detectPlatform("https://www.instagram.com/p/abc/")).toBe("instagram");
    expect(detectPlatform("https://twitter.com/user/status/1")).toBe("twitter");
    expect(detectPlatform("https://x.com/user/status/1")).toBe("twitter");
  });

  it("returns null for unsupported or invalid URLs", () => {
    expect(detectPlatform("https://example.com")).toBeNull();
    expect(detectPlatform("not a url")).toBeNull();
  });
});

describe("isSupportedPlatform", () => {
  it("returns true for supported, false otherwise", () => {
    expect(isSupportedPlatform("https://www.youtube.com/watch?v=abc")).toBe(true);
    expect(isSupportedPlatform("https://example.com")).toBe(false);
  });
});

// Helper to run the express-validator chain against a fake request
async function runValidation(body) {
  const req = { body };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const next = jest.fn();

  // express-validator validators are async middleware functions
  for (const middleware of validateClipRequest) {
    await middleware(req, res, next);
  }
  handleValidationErrors(req, res, next);
  return { req, res, next };
}

describe("validateClipRequest", () => {
  it("passes with valid url + clipStart + clipEnd", async () => {
    const { res, next } = await runValidation({
      url: "https://www.youtube.com/watch?v=abc",
      clipStart: 10,
      clipEnd: 30,
    });
    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it("rejects missing url", async () => {
    const { res } = await runValidation({ clipStart: 0, clipEnd: 5 });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false }),
    );
  });

  it("rejects unsupported platform", async () => {
    const { res } = await runValidation({
      url: "https://example.com",
      clipStart: 0,
      clipEnd: 5,
    });
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects clipEnd <= clipStart", async () => {
    const { res } = await runValidation({
      url: "https://www.youtube.com/watch?v=abc",
      clipStart: 30,
      clipEnd: 30,
    });
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects negative clipStart", async () => {
    const { res } = await runValidation({
      url: "https://www.youtube.com/watch?v=abc",
      clipStart: -5,
      clipEnd: 10,
    });
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("accepts string-form numeric clipStart/clipEnd", async () => {
    const { res, next } = await runValidation({
      url: "https://www.youtube.com/watch?v=abc",
      clipStart: "5",
      clipEnd: "15",
    });
    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});