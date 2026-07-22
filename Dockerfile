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
# Also install the bgutil PO Token provider plugin — YouTube now requires
# a PO Token for video streaming on most clients. Without it, YouTube
# returns "Sign in to confirm you're not a bot" even with valid cookies.
# The plugin auto-generates PO Tokens via BgUtils.
RUN python3 -m pip install --break-system-packages --no-cache-dir \
    "yt-dlp>=2026.7" \
    "bgutil-ytdlp-pot-provider" && \
    YTDLP_LOCATION=$(which yt-dlp) && \
    echo "yt-dlp installed at: $YTDLP_LOCATION" && \
    if [ "$YTDLP_LOCATION" != "/usr/local/bin/yt-dlp" ]; then \
      ln -sf "$YTDLP_LOCATION" /usr/local/bin/yt-dlp; \
    fi && \
    yt-dlp --version

# Set up the bgutil PO Token HTTP server (for Render single-container deploys).
# In docker-compose, a separate pot-provider service handles this instead.
# The server runs on port 4416 and generates PO Tokens for yt-dlp.
RUN git clone --single-branch --branch 1.3.1 \
    https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/pot-server && \
    cd /opt/pot-server/server && \
    deno install --allow-scripts=npm:canvas --frozen 2>/dev/null || true

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

# Start both the PO Token server and the Node.js backend.
# For docker-compose, the pot-provider service runs the PO Token server
# separately, but having it in start.sh too is harmless (it'll just
# fail to bind port 4416 and the plugin will use the compose service instead).
CMD ["bash", "start.sh"]
