import { defineConfig } from "@playwright/test";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

const PORT = 8765;
const data = fs.mkdtempSync(path.join(os.tmpdir(), "machat-e2e-"));

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: "list",
  outputDir: "./test-results",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    // PW_CHROME: use an already installed Chrome instead of `playwright install chromium`.
    launchOptions: process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {},
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: process.env.MACHAT_SERVER_BIN || "../bin/machat-server",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { MACHAT_FAKE: "1", MACHAT_DATA_DIR: data, WAILS_SERVER_PORT: String(PORT) },
  },
});
