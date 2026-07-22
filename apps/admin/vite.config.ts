import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// COP admin/review-queue app. Runs on 5175 (not the default 5173, which is
// used by the public-facing app being built in parallel — see the top-level
// task notes / README).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    strictPort: true,
  },
  preview: {
    port: 5175,
    strictPort: true,
  },
});
