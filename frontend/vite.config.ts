import { sentryVitePlugin } from '@sentry/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react-swc';
import { readFileSync } from 'fs';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';

// Read package versions at config time (Node.js context) and inject as build-time constants
const barcodeDetectorVersion = JSON.parse(
  readFileSync(
    path.resolve(import.meta.dirname, 'node_modules/barcode-detector/package.json'),
    'utf-8',
  ),
).version as string;
const zxingWasmVersion = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, 'node_modules/zxing-wasm/package.json'), 'utf-8'),
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

// Static files the app shell needs offline, independent of the JS bundle.
const SW_STATIC_PRECACHE = [
  '/index.html',
  '/offline.html',
  '/manifest.json',
  '/favicon.ico',
  '/logo.png',
  '/icon-192.png',
  '/icon-512.png',
];

// Served at /sw.js by the dev server: an inert worker that tears down any
// registration left behind by a production visit to the same origin (a developer
// hitting localhost after using the deployed app would otherwise be served the
// stale precached shell instead of Vite's).
const DEV_SERVICE_WORKER = `// Development stub — see frontend/vite.config.ts
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter(name => name.startsWith('bubble-')).map(name => caches.delete(name)),
      );
      await self.registration.unregister();
    })(),
  );
});
`;

/**
 * Emit dist/sw.js from src/sw/service-worker.js, injecting the build id and the
 * hashed URLs of the entry chunk's static import graph.
 *
 * The worker used to live in public/ with a hand-written precache list, which
 * named Create-React-App paths (/static/js/bundle.js) that this build has never
 * produced. Because cache.addAll() is atomic, every install rejected and the app
 * shipped a service worker that could not activate — hence generating the list
 * from the bundle Vite actually wrote.
 */
function serviceWorkerPlugin(): Plugin {
  const source = path.resolve(import.meta.dirname, 'src/sw/service-worker.js');

  // GIT_SHA/APP_VERSION are set for container builds (see Dockerfile); local
  // builds fall back to the build timestamp. The value only has to change
  // whenever the shell does, so that the old shell cache is dropped on activate.
  const buildId = process.env.GIT_SHA || process.env.APP_VERSION || String(Date.now());

  return {
    name: 'pwa-service-worker',
    // After vite:build-html, so the entry chunk's metadata is final.
    enforce: 'post',

    configureServer(server) {
      server.middlewares.use('/sw.js', (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript');
        res.setHeader('Cache-Control', 'no-store');
        res.end(DEV_SERVICE_WORKER);
      });
    },

    generateBundle(_options, bundle) {
      // Walk the entry chunks' static imports: that is exactly what a cold load
      // of index.html needs. Route-level dynamic chunks are picked up by the
      // worker's cache-first rule the first time they are actually requested,
      // which keeps the install payload to the shell.
      const shellAssets = new Set<string>();
      const visit = (fileName: string) => {
        const chunk = bundle[fileName];
        if (!chunk || chunk.type !== 'chunk' || shellAssets.has(chunk.fileName)) return;
        shellAssets.add(chunk.fileName);
        for (const css of chunk.viteMetadata?.importedCss ?? []) shellAssets.add(css);
        for (const imported of chunk.imports) visit(imported);
      };
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'chunk' && chunk.isEntry) visit(chunk.fileName);
      }

      const precacheUrls = [
        ...SW_STATIC_PRECACHE,
        ...[...shellAssets].sort().map(fileName => `/${fileName}`),
      ];

      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: readFileSync(source, 'utf-8')
          .replace('__BUILD_ID__', buildId)
          .replace('__PRECACHE_URLS__', JSON.stringify(precacheUrls)),
      });
    },
  };
}

function zxingWasmPlugin(): Plugin {
  const wasmSrc = path.resolve(
    import.meta.dirname,
    'node_modules/zxing-wasm/dist/reader/zxing_reader.wasm',
  );

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
    serviceWorkerPlugin(),
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
      '@': path.resolve(import.meta.dirname, './src'),
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
