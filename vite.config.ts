import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Project pages on GitHub Pages need a base path; local dev stays '/'.
  base: process.env.BASE_URL ?? '/',
  server: {
    port: 5173,
    host: true, // Enable network access via IP
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});