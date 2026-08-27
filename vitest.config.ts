import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import react from "@vitejs/plugin-react";

/**
 * 테스트는 세 갈래다. **앞의 둘이 `npm test`, 셋째는 릴리스 차선이다.**
 *
 *   worker  — 실제 workerd 안에서 돈다. Durable Object 가 흉내가 아니라 진짜다
 *   client  — 화면이 조용히 죽지 않는지 본다. 에러를 남기지 않는 실패는 사람 눈으로 못 잡는다 (ADR-8)
 *   release — **배포되는 물건**에 대한 검사. `npm run test:release`, CI 에서는 main 으로 가는 길에서만 돈다
 *
 * `release` 를 가른 이유는 속도가 아니라 **어디서 값을 하는가**다. 옛 표를 만나는 일은
 * 프로덕션·QA 에만 있고, 매 feature PR 에 러너를 하나 더 세우면 정작 러너가 모자라
 * 필수 검사가 큐에 앉는다 — 그게 v2.0.0 을 bypass 로 내보내게 만든 실제 사고다 (ADR-66).
 *
 * ⚠️ 프로젝트를 더하면 **`package.json` 의 `test` 도 같이 고쳐라.** 이름을 하나씩 적는 방식이라
 * 새 프로젝트는 저절로 따라오지 않는다 — 대신 `release` 가 실수로 매 PR 에 끼지도 않는다.
 */
const workerd = () =>
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
  });

/**
 * 회차 DO 는 요청을 **한 줄로** 처리한다. 여덟 명을 등록하는 테스트는
 * 명단·입장·등록 세 왕복 × 8 이 순서대로 서므로 기본 5초를 넘길 때가 있다.
 * 느린 것이지 틀린 게 아니라, 여유를 넓힌다.
 */
const DO_TIMEOUT = 20_000;

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [workerd()],
        test: {
          name: "worker",
          include: ["test/*.test.ts"],
          testTimeout: DO_TIMEOUT,
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
      {
        plugins: [workerd()],
        test: {
          name: "release",
          // `test/*.test.ts` 는 별 하나라 이 폴더를 안 잡는다. worker 와 겹치지 않는다
          include: ["test/release/*.test.ts"],
          testTimeout: DO_TIMEOUT,
        },
      },
    ],
  },
});
