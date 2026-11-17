import {defineConfig} from '@playwright/test';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const root = join(tmpdir(), 'aventics-worktrack-e2e-' + process.pid);
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  workers: 1,
  reporter: [['list']],
  use: {baseURL: 'http://127.0.0.1:4177', headless: true, viewport: {width: 1600, height: 900}},
  webServer: {
    command: 'npm start',
    url: 'http://127.0.0.1:4177/api/health',
    reuseExistingServer: false,
    timeout: 60_000,
    env: {DATA_ROOT: root, BOOTSTRAP_ADMIN_PASSWORD: 'WorkTrack-E2E-Test-Only!234', PORT: '4177', HOST: '127.0.0.1'}
  }
});