# Use the official Deno image to extract the binary (it's glibc-linked,
# so we need a glibc base image, not Alpine/musl).
FROM denoland/deno:latest AS deno-source

# Switched from node:18-alpine to node:18 (Debian/glibc) because
# Deno's binary is dynamically linked against glibc and won't run
# on Alpine's musl libc. yt-dlp 2026.7+ requires Deno to parse
# YouTube's nsig challenge — without it, YouTube returns
# "Sign in to confirm you're not a bot" even with valid cookies.
FROM node:18

# Copy the Deno binary from the official image
COPY --from=deno-source /usr/bin/deno /usr/local/bin/deno

# Install Python, ffmpeg, and dependencies for yt-dlp
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        ffmpeg \
    && rm -rf /var/lib/apt/lists/* && \
    deno --version

# Install yt-dlp using pip (pin to latest stable for YouTube compatibility)
RUN python3 -m pip install --break-system-packages --no-cache-dir "yt-dlp>=2026.7" && \
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
