import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = process.env.VITE_API_PROXY ?? "http://localhost:4000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { chunkSizeWarningLimit: 1000 },
  server: {
    port: 5173,
    // In dev the dashboard runs on Vite and forwards API calls to the Express server.
    proxy: { "/api": { target: api, changeOrigin: true } },
  },
});
