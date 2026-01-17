FROM node:18-alpine

# Install Python and dependencies for yt-dlp
RUN apk add --no-cache \
    python3 \
    py3-pip \
    ffmpeg

# Install yt-dlp
RUN pip3 install --no-cache-dir yt-dlp

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install app dependencies
RUN npm ci --only=production

# Copy app source
COPY . .

# Create directories
RUN mkdir -p downloads logs

# Expose port
EXPOSE 3000

# Start the application
CMD ["node", "server.js"]
