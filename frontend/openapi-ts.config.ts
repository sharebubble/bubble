import { defineConfig } from '@hey-api/openapi-ts';

const apiBase = process.env.OPENAPI_URL || process.env.VITE_API_URL || 'http://localhost:8080';

export default defineConfig({
  input: `${apiBase.replace(/\/$/, '')}/api/schema/`,
  output: 'src/services/django',
  plugins: [
    {
      name: '@hey-api/client-fetch',
      throwOnError: true,
    },
  ],
});
