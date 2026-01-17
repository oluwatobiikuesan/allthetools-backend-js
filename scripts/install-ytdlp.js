const fs = require("fs");
const path = require("path");
const https = require("https");
const { execSync } = require("child_process");

const YTDLP_RELEASES_URL =
  "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";
const BIN_DIR = path.join(__dirname, "..", "bin");
const YTDLP_PATH = path.join(BIN_DIR, "yt-dlp");

console.log("Installing yt-dlp...");

// Create bin directory if it doesn't exist
if (!fs.existsSync(BIN_DIR)) {
  fs.mkdirSync(BIN_DIR, { recursive: true });
}

// Detect platform
const platform = process.platform;
let downloadUrl;

if (platform === "darwin" || platform === "linux") {
  downloadUrl =
    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";
} else if (platform === "win32") {
  downloadUrl =
    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
} else {
  console.error("Unsupported platform:", platform);
  process.exit(1);
}

console.log(`Downloading yt-dlp from ${downloadUrl}...`);

const file = fs.createWriteStream(YTDLP_PATH);

https
  .get(
    downloadUrl,
    {
      headers: {
        "User-Agent": "Node.js",
      },
    },
    (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        https.get(response.headers.location, (redirectResponse) => {
          redirectResponse.pipe(file);

          file.on("finish", () => {
            file.close();

            // Make executable on Unix-like systems
            if (platform !== "win32") {
              fs.chmodSync(YTDLP_PATH, "755");
            }

            console.log("yt-dlp installed successfully at:", YTDLP_PATH);
            console.log("Testing yt-dlp...");

            try {
              const version = execSync(`${YTDLP_PATH} --version`)
                .toString()
                .trim();
              console.log("yt-dlp version:", version);
            } catch (error) {
              console.error("Failed to test yt-dlp:", error.message);
            }
          });
        });
      } else {
        response.pipe(file);

        file.on("finish", () => {
          file.close();

          // Make executable on Unix-like systems
          if (platform !== "win32") {
            fs.chmodSync(YTDLP_PATH, "755");
          }

          console.log("yt-dlp installed successfully at:", YTDLP_PATH);
          console.log("Testing yt-dlp...");

          try {
            const version = execSync(`${YTDLP_PATH} --version`)
              .toString()
              .trim();
            console.log("yt-dlp version:", version);
          } catch (error) {
            console.error("Failed to test yt-dlp:", error.message);
          }
        });
      }
    }
  )
  .on("error", (error) => {
    fs.unlink(YTDLP_PATH, () => {});
    console.error("Failed to download yt-dlp:", error.message);
    process.exit(1);
  });
