import { sentryVitePlugin } from '@sentry/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react-swc';
import { readFileSync } from 'fs';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';

// Read package versions at config time (Node.js context) and inject as build-time constants
const barcodeDetectorVersion = JSON.parse(
  readFileSync(path.resolve(__dirname, 'node_modules/barcode-detector/package.json'), 'utf-8'),
).version as string;
const zxingWasmVersion = JSON.parse(
  readFileSync(path.resolve(__dirname, 'node_modules/zxing-wasm/package.json'), 'utf-8'),
).version as string;

// Emit a static /version.json carrying the build's git SHA + version so the E2E
// release-gate pipeline can confirm the frontend rolled over to the commit under
// test (see docs/e2e-testing/plan.md §7.2). Values are baked in at build time via
// GIT_SHA / APP_VERSION env (see frontend/Dockerfile).
function versionJsonPlugin(): Plugin {
  const payload = JSON.stringify({
    git_sha: process.env.GIT_SHA ?? '',
    version: process.env.APP_VERSION ?? '',
  });

  return {
    name: 'version-json',

    // Dev server: serve the same payload at /version.json
    configureServer(server) {
      server.middlewares.use('/version.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(payload);
      });
    },

    // Build: emit dist/version.json
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: payload });
    },
  };
}

function zxingWasmPlugin(): Plugin {
  const wasmSrc = path.resolve(__dirname, 'node_modules/zxing-wasm/dist/reader/zxing_reader.wasm');

  return {
    name: 'zxing-wasm',

    // Dev server: serve the WASM file at /lib/wasm/zxing_reader.wasm
    configureServer(server) {
      server.middlewares.use('/lib/wasm/zxing_reader.wasm', (_req, res) => {
        res.setHeader('Content-Type', 'application/wasm');
        res.end(readFileSync(wasmSrc));
      });
    },

    // Build: emit the WASM file into dist/lib/wasm/
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'lib/wasm/zxing_reader.wasm',
        source: readFileSync(wasmSrc),
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: '::',
    port: 8080,
    allowedHosts: ['local-dev.sharebubble.org'],
    // Proxy API requests to Django backend
    proxy: {
      '/api/ws/': {
        target: process.env.VITE_PROXY_URL || 'http://localhost:8000',
        changeOrigin: false,
        ws: true,
        secure: false,
      },
      '^/(api|static|admin|accounts|media|caldav)/.*': {
        target: process.env.VITE_PROXY_URL || 'http://localhost:8000',
        changeOrigin: false,
        secure: false,
      },
    },

    // Prevent watching Docker-mounted DB/storage volumes that can’t be watched (EINVAL)
    watch:
      process.env.VITE_USE_POLLING === 'true'
        ? {
            ignored: ['**/volumes/**'],
            usePolling: true,
            interval: 1000,
          }
        : {
            ignored: ['**/volumes/**'],
          },
  },
  plugins: [
    versionJsonPlugin(),
    zxingWasmPlugin(),
    tailwindcss(),
    react(),
    sentryVitePlugin({
      authToken: process.env.SENTRY_AUTH_TOKEN,
      org: 'treibhaus',
      project: 'bubble-frontend',
      sourcemaps: {
        // As you're enabling client source maps, you probably want to delete them after they're uploaded to Sentry.
        // Set the appropriate glob pattern for your output folder - some glob examples below:
        filesToDeleteAfterUpload: [
          './**/*.map',
          '.*/**/public/**/*.map',
          './dist/**/client/**/*.map',
        ],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    sourcemap: true, // Source map generation must be turned on
  },
  define: {
    __BARCODE_DETECTOR_VERSION__: JSON.stringify(barcodeDetectorVersion),
    __ZXING_WASM_VERSION__: JSON.stringify(zxingWasmVersion),
  },
}));
