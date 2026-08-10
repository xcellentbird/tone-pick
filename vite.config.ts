import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 클라이언트는 dist/client 로 빌드되고, wrangler 가 그걸 정적 자산으로 서빙한다.
// `npm run dev` 는 Vite 만 띄우고 /api 는 `wrangler dev`(8787)로 프록시한다.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist/client", emptyOutDir: true },
  server: {
    proxy: {
      "/api": { target: "http://127.0.0.1:8787", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:8787", ws: true },
    },
  },
});
