import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: { DATABASE_PATH: ":memory:", JWT_SECRET: "test-secret", BASE_URL: "http://sho.rt", NODE_ENV: "test" },
  },
});
