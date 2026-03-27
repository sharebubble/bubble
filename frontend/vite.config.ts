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
    allowedHosts: ['fabian-local-dev.treibhausdonaufeld.at'],
    // Proxy API requests to Django backend
    proxy: {
      '/api/ws/': {
        target: process.env.VITE_PROXY_URL || 'http://localhost:8000',
        changeOrigin: false,
        ws: true,
        secure: false,
      },
      '^/(api|static|admin|accounts|media)/.*': {
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
