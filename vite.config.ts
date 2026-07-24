import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [vue()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("@codemirror") || id.includes("codemirror"))
              return "vendor-codemirror";
            if (id.includes("highlight.js")) return "vendor-hljs";
            if (id.includes("markdown-it") || id.includes("dompurify"))
              return "vendor-markdown";
            if (id.includes("@tauri-apps")) return "vendor-tauri";
            if (id.includes("vue")) return "vendor-vue";
          }
        },
      },
    },
  },
}));