import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/e2e/mobile",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    browserName: process.env.SOVEREIGN_MAIL_MOBILE_BROWSER === "webkit" ? "webkit" : "chromium",
    baseURL: "http://127.0.0.1:5178",
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    screenshot: "only-on-failure",
    trace: "off",
    video: "off"
  },
  webServer: {
    command: "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5178",
    url: "http://127.0.0.1:5178",
    reuseExistingServer: !process.env.CI
  }
});
