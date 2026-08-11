import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import react from "@vitejs/plugin-react";

/**
 * 테스트는 두 갈래다.
 *
 *   worker — 실제 workerd 안에서 돈다. Durable Object 가 흉내가 아니라 진짜다
 *   client — 화면이 조용히 죽지 않는지 본다. 에러를 남기지 않는 실패는 사람 눈으로 못 잡는다 (ADR-8)
 */
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              bindings: {
                MASTER_PIN: "1234",
                SESSION_SECRET: "test-secret",
                // 테스트 전용 시간 이동 라우트를 켠다. 프로덕션에는 이 값이 없다
                ALLOW_TEST_ENDPOINTS: "1",
              },
            },
          }),
        ],
        test: { name: "worker", include: ["test/*.test.ts"] },
      },
      {
        plugins: [react()],
        test: {
          name: "client",
          environment: "happy-dom",
          include: ["test/client/*.test.tsx"],
        },
      },
    ],
  },
});
