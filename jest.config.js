module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: [
    "tests/anchor/**/*.test.ts",
    "tests/math/**/*.test.ts",
    "tests/integration/**/*.test.ts",
    "tests/shamir/**/*.test.ts",
    "tests/watcher/**/*.test.ts",
    "tests/relayer/**/*.test.ts",
    "tests/sdk/**/*.test.ts",
  ],
  testTimeout: 120000,
};
