import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { IDEAL_ASSET_V } from "./src/shared/ideal.ts";

/*
 * 이상형 찾기의 문 (슬라이스 19, S-C5 — `src/client/lib/faces.ts`). 지금 판의 두 풀이 **있어야** 연다.
 * 있는지만 본다 — 모양은 `npm run check:faces` 가 본다(폴더가 있으면 항목마다 사진까지).
 */
const facesReady = ["f", "m"].every((p) =>
  existsSync(fileURLToPath(new URL(`./public/faces/v${IDEAL_ASSET_V}/${p}.json`, import.meta.url))),
);

// 클라이언트는 dist/client 로 빌드되고, wrangler 가 그걸 정적 자산으로 서빙한다.
// `npm run dev` 는 Vite 만 띄우고 /api 는 `wrangler dev`(8787)로 프록시한다.
export default defineConfig({
  plugins: [react()],
  define: { __IDEAL_FACES__: JSON.stringify(facesReady) },
  build: { outDir: "dist/client", emptyOutDir: true },
  server: {
    proxy: {
      "/api": { target: "http://127.0.0.1:8787", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:8787", ws: true },
    },
  },
});
