# Build stage
FROM node:24-alpine AS build

# Create non-root user for build and ensure /app is owned by it
RUN adduser -D app && mkdir -p /app && chown -R app /app
USER app

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the app
RUN npm run build

# Production stage
FROM nginxinc/nginx-unprivileged:alpine-slim

# Copy built app to nginx
COPY --from=build /app/dist /usr/share/nginx/html

# Copy nginx config
COPY nginx.default.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 8888
