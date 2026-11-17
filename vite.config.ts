import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    // pdf.js and mammoth are lazy-loaded only when a document is uploaded.
    chunkSizeWarningLimit: 1600,
  },
});
