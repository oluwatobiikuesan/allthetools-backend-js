FROM node:18-slim

# Install Python, ffmpeg, curl, unzip, and git
# Switched from node:18-alpine to node:18-slim (Debian/glibc) because
# yt-dlp 2026.7+ requires Deno as a JS runtime to parse YouTube's nsig
# challenge, and Deno's binary requires glibc (not available in Alpine).
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        ffmpeg \
        curl \
        unzip \
    && rm -rf /var/lib/apt/lists/*

# Install Deno — yt-dlp 2026.7+ requires a JS runtime for YouTube nsig
# parsing. Without it, YouTube returns "Sign in to confirm you're not a
# bot" even with valid cookies. Deno's binary is glibc-linked so we need
# the Debian-based image above.
RUN ARCH=$(uname -m) && \
    case "$ARCH" in \
      x86_64)  DENO_ARCH="x86_64-unknown-linux-gnu" ;; \
      aarch64) DENO_ARCH="aarch64-unknown-linux-gnu" ;; \
      *) echo "Unsupported arch: $ARCH" && exit 1 ;; \
    esac && \
    curl -fsSL "https://github.com/denoland/deno/releases/latest/download/deno-${DENO_ARCH}.zip" -o /tmp/deno.zip && \
    unzip /tmp/deno.zip -d /tmp && \
    mv /tmp/deno /usr/local/bin/deno && \
    chmod +x /usr/local/bin/deno && \
    rm /tmp/deno.zip && \
    deno --version

# Install yt-dlp using pip — always pull the latest stable release
# (equivalent to `yt-dlp -U`). YouTube frequently changes its API, so
# pinning to a specific version can break cookie-based auth.
RUN python3 -m pip install --break-system-packages --no-cache-dir --upgrade yt-dlp && \
    YTDLP_LOCATION=$(which yt-dlp) && \
    echo "yt-dlp installed at: $YTDLP_LOCATION" && \
    if [ "$YTDLP_LOCATION" != "/usr/local/bin/yt-dlp" ]; then \
      ln -sf "$YTDLP_LOCATION" /usr/local/bin/yt-dlp; \
    fi && \
    yt-dlp --version

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install app dependencies
RUN npm ci --only=production

# Copy app source
COPY . .

# Create directories with proper permissions
RUN mkdir -p downloads logs bin cookies && chmod -R 755 bin
COPY ./cookies/youtube.txt ./cookies/youtube.txt

# Expose port
EXPOSE 3005

# Default port for the app (overridable via env at runtime)
ENV PORT=3005

# Start the application (yt-dlp already installed via pip)
CMD ["node", "server.js"]
