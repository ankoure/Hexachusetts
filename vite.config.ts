import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // Relative base so the build can be hosted under any path (S3, GitHub Pages).
  base: "./",
  plugins: [react()],
});
