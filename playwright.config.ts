import { defineConfig, devices } from '@playwright/test';
import os from 'os';
import path from 'path';

// Use the locally installed chromium build if present (avoids re-download).
const localChromium = path.join(
  os.homedir(),
  '.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',
);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: localChromium,
      args: ['--no-sandbox'],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60000,
  },
});