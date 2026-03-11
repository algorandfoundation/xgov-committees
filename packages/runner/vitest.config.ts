import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/systemd.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
    },
  },
});
