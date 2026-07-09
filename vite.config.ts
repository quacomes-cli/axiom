import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  build: {
    rollupOptions: {
      output: {
        // Büyük vendor'ları ayrı chunk'lara böl: tarayıcı cache'i sürümler
        // arası korunur, sayfa lazy-chunk'ları küçülür, indirme paralelleşir.
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("firebase") || id.includes("@firebase")) return "vendor-firebase";
          if (id.includes("highlight.js") || id.includes("lowlight")) return "vendor-highlight";
          if (
            id.includes("react-markdown") ||
            id.includes("remark") ||
            id.includes("rehype") ||
            id.includes("micromark") ||
            id.includes("mdast") ||
            id.includes("hast") ||
            id.includes("unified") ||
            id.includes("unist") ||
            id.includes("vfile")
          )
            return "vendor-markdown";
          if (id.includes("framer-motion")) return "vendor-motion";
          return undefined;
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    // 1420/1421 Windows'ta Hyper-V/WSL/Docker tarafından reserve edilebiliyor
    // (EACCES). 5173 vite default'u, reserved range dışında.
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 5174,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
