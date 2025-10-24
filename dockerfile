# ============================================
# STAGE 1: Build Stage
# ============================================
# Use Node.js 18 Alpine (lightweight version)
FROM node:18-alpine AS builder

# Set working directory inside container
WORKDIR /app

# Copy package files first (for layer caching)
# If package.json doesn't change, npm install layer is cached
COPY package*.json ./

# Install ALL dependencies (including devDependencies)
# Need TypeScript and types for compilation
RUN npm ci

# Copy source code
COPY . .

# Compile TypeScript to JavaScript
# Output goes to ./dist folder
RUN npm run build

# ============================================
# STAGE 2: Production Stage
# ============================================
# Start fresh with clean Node.js image
FROM node:18-alpine

# Install curl for healthcheck
RUN apk add --no-cache curl

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ONLY production dependencies
# --omit=dev skips devDependencies (TypeScript, etc.)
# Smaller image size
RUN npm ci --omit=dev

# Copy compiled JavaScript from builder stage
# Only copy dist folder (no source code needed)
COPY --from=builder /app/dist ./dist

# Copy migration script and SQL files
COPY scripts ./scripts

# Create non-root user for security
# Don't run as root in production
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership of files to non-root user
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port 3000 for API
EXPOSE 3000

# Health check - verify app is responding
# Docker will mark container as unhealthy if this fails
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/notifications/health || exit 1

# Default command: run API server
# Can be overridden in docker-compose.yml
CMD ["node", "dist/server.ts"]