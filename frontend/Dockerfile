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

# Build info baked into /version.json at build time (see vite.config.ts and
# docs/e2e-testing/plan.md §7.2). Pass with:
#   docker build --build-arg GIT_SHA=<sha> --build-arg APP_VERSION=<version>
ARG GIT_SHA=""
ARG APP_VERSION=""
ENV GIT_SHA=${GIT_SHA}
ENV APP_VERSION=${APP_VERSION}

# Build the app
RUN npm run build

# Production stage
FROM nginxinc/nginx-unprivileged:alpine-slim

# Copy built app to nginx
COPY --from=build /app/dist /usr/share/nginx/html

# Copy nginx config
COPY nginx.default.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 8888
