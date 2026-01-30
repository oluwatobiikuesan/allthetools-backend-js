const fs = require("fs");
const path = require("path");
const https = require("https");
const { execSync } = require("child_process");

const YTDLP_RELEASES_URL =
  "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";
const BIN_DIR = path.join(__dirname, "..", "bin");
const YTDLP_PATH = path.join(BIN_DIR, "yt-dlp");

// Detect platform
const platform = process.platform;

console.log("=".repeat(60));
console.log("Installing yt-dlp and ffmpeg...");
console.log("=".repeat(60));

// Create bin directory if it doesn't exist
if (!fs.existsSync(BIN_DIR)) {
  fs.mkdirSync(BIN_DIR, { recursive: true });
}

/**
 * Install ffmpeg based on platform
 */
function installFFmpeg() {
  console.log("\n📦 Installing ffmpeg...");

  try {
    if (platform === "darwin") {
      // macOS - check if Homebrew is installed
      try {
        execSync("which brew", { stdio: "ignore" });
        console.log("Installing ffmpeg via Homebrew...");
        execSync("brew install ffmpeg", { stdio: "inherit" });
        console.log("✅ ffmpeg installed successfully via Homebrew");
      } catch (error) {
        console.warn("⚠️  Homebrew not found. Please install ffmpeg manually:");
        console.warn("   1. Install Homebrew: https://brew.sh");
        console.warn("   2. Run: brew install ffmpeg");
      }
    } else if (platform === "linux") {
      // Linux - try different package managers
      console.log("Detecting Linux package manager...");

      // Try apt (Debian/Ubuntu)
      try {
        execSync("which apt-get", { stdio: "ignore" });
        console.log("Installing ffmpeg via apt...");
        execSync("sudo apt-get update && sudo apt-get install -y ffmpeg", {
          stdio: "inherit",
        });
        console.log("✅ ffmpeg installed successfully via apt");
        return;
      } catch (error) {
        // apt not available
      }

      // Try yum (RHEL/CentOS/Fedora)
      try {
        execSync("which yum", { stdio: "ignore" });
        console.log("Installing ffmpeg via yum...");
        execSync("sudo yum install -y ffmpeg", { stdio: "inherit" });
        console.log("✅ ffmpeg installed successfully via yum");
        return;
      } catch (error) {
        // yum not available
      }

      // Try dnf (Fedora)
      try {
        execSync("which dnf", { stdio: "ignore" });
        console.log("Installing ffmpeg via dnf...");
        execSync("sudo dnf install -y ffmpeg", { stdio: "inherit" });
        console.log("✅ ffmpeg installed successfully via dnf");
        return;
      } catch (error) {
        // dnf not available
      }

      console.warn("⚠️  Could not detect package manager.");
      console.warn("   Please install ffmpeg manually for your distribution.");
    } else if (platform === "win32") {
      console.warn("⚠️  Windows detected.");
      console.warn("   Please install ffmpeg manually:");
      console.warn("   1. Download from: https://ffmpeg.org/download.html");
      console.warn(
        "   2. Extract and add to PATH, or use a package manager like Chocolatey:",
      );
      console.warn("      choco install ffmpeg");
    } else {
      console.warn(
        "⚠️  Unsupported platform for automatic ffmpeg installation.",
      );
      console.warn("   Please install ffmpeg manually.");
    }
  } catch (error) {
    console.error("❌ Failed to install ffmpeg:", error.message);
    console.warn("   The service will work but with limited quality options.");
  }
}

/**
 * Install yt-dlp
 */
function installYtDlp() {
  return new Promise((resolve, reject) => {
    console.log("\n📦 Installing yt-dlp...");

    let downloadUrl;

    if (platform === "darwin" || platform === "linux") {
      downloadUrl =
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";
    } else if (platform === "win32") {
      downloadUrl =
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
    } else {
      reject(new Error("Unsupported platform: " + platform));
      return;
    }

    console.log(`Downloading yt-dlp from ${downloadUrl}...`);

    const file = fs.createWriteStream(YTDLP_PATH);

    const handleFinish = () => {
      file.close();

      // Make executable on Unix-like systems
      if (platform !== "win32") {
        fs.chmodSync(YTDLP_PATH, "755");
      }

      console.log("✅ yt-dlp installed successfully at:", YTDLP_PATH);
      console.log("Testing yt-dlp...");

      try {
        const version = execSync(`${YTDLP_PATH} --version`).toString().trim();
        console.log("✅ yt-dlp version:", version);
        resolve();
      } catch (error) {
        console.error("❌ Failed to test yt-dlp:", error.message);
        reject(error);
      }
    };

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
              file.on("finish", handleFinish);
            });
          } else {
            response.pipe(file);
            file.on("finish", handleFinish);
          }
        },
      )
      .on("error", (error) => {
        fs.unlink(YTDLP_PATH, () => {});
        console.error("❌ Failed to download yt-dlp:", error.message);
        reject(error);
      });
  });
}

/**
 * Check if ffmpeg is already installed
 */
function checkFFmpeg() {
  try {
    const version = execSync("ffmpeg -version", { stdio: "pipe" })
      .toString()
      .split("\n")[0];
    console.log("✅ ffmpeg is already installed:", version);
    return true;
  } catch (error) {
    return false;
  }
}

// Main installation flow
async function main() {
  try {
    // Install yt-dlp
    await installYtDlp();

    // Check and install ffmpeg
    console.log("\n" + "=".repeat(60));
    if (!checkFFmpeg()) {
      installFFmpeg();
    }

    console.log("\n" + "=".repeat(60));
    console.log("✅ Installation complete!");
    console.log("=".repeat(60));
    console.log("\nYou can now start the server with: npm start");
  } catch (error) {
    console.error("\n❌ Installation failed:", error.message);
    process.exit(1);
  }
}

main();
