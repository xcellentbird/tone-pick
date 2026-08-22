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
        test: {
          name: "worker",
          include: ["test/*.test.ts"],
          /**
           * 회차 DO 는 요청을 **한 줄로** 처리한다. 여덟 명을 등록하는 테스트는
           * 명단·입장·등록 세 왕복 × 8 이 순서대로 서므로 기본 5초를 넘길 때가 있다.
           * 느린 것이지 틀린 게 아니라, 여유를 넓힌다.
           */
          testTimeout: 20_000,
        },
      },
      {
        plugins: [react()],
        test: {
          name: "client",
          environment: "happy-dom",
          // happy-dom 에 없는 브라우저 API 를 채운다 (localStorage)
          setupFiles: ["test/client/setup.ts"],
          include: ["test/client/*.test.tsx"],
        },
      },
    ],
  },
});
