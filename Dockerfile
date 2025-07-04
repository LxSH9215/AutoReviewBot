FROM openjdk:17-alpine

# Install Node.js and npm
RUN apk add --no-cache nodejs npm

# Install Probot
RUN npm install -g probot

# Set working directory
WORKDIR /app

# Copy package.json first to leverage Docker cache
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application files
COPY . .

# Start command
CMD ["probot", "run", "/app/bot.js"]
