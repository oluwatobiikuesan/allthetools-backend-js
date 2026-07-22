FROM node:18-alpine

# Install Python and dependencies for yt-dlp
RUN apk add --no-cache \
    python3 \
    py3-pip \
    ffmpeg

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
