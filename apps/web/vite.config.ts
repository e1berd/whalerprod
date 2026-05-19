import { fileURLToPath, URL } from "node:url"
import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [vue()],
  define: {
    __VUE_OPTIONS_API__: JSON.stringify(true),
    __VUE_PROD_DEVTOOLS__: JSON.stringify(false),
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: JSON.stringify(false)
  },
  server: {
    port: 5173,
    proxy: {
      "/supabase": {
        target: process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54321",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/supabase/, "")
      }
    }
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  }
})
