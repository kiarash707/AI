import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
const workerProxy = {
  "/api": {
    target: "http://127.0.0.1:8789",
    changeOrigin: true,
  },
};

export default defineConfig({
  plugins: [react()],
  server: { host: "0.0.0.0", allowedHosts: true, proxy: workerProxy },
  preview: { host: "0.0.0.0", proxy: workerProxy },
  build: { outDir: "dist" },
});
