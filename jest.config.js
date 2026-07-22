module.exports = {
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.test.js"],
  collectCoverageFrom: [
    "services/**/*.js",
    "routes/**/*.js",
    "utils/**/*.js",
    "!**/node_modules/**",
  ],
  coverageDirectory: "coverage",
  testTimeout: 30000,
  // Prevent the singleton services from hitting real yt-dlp / Redis during tests.
  // Tests should mock those dependencies explicitly.
  clearMocks: true,
  restoreMocks: true,
};