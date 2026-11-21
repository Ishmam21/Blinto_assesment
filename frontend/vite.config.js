import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "FASTAPI_URL");
  const proxy = {
    "/api": { target: env.FASTAPI_URL || "http://127.0.0.1:8000" },
  };

  return {
    server: { proxy },
    preview: { proxy },
  };
});
