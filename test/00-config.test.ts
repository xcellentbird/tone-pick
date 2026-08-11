/**
 * 배포 시점 안전장치.
 *
 * 시크릿을 빠뜨린 채 배포하는 건 흔한 실수인데, 결과가 조용하다 —
 * SESSION_SECRET 이 비면 세션 서명 키가 빈 문자열이 되어 운영자 쿠키가 위조된다.
 * 에러가 안 나는 실패라서 기계가 잡아야 한다 (ADR-8).
 */
import { describe, expect, it } from "vitest";
import { missingSecrets } from "../src/server/http.ts";

describe("시크릿", () => {
  it("둘 다 있어야 뜬다", () => {
    expect(missingSecrets({ MASTER_PIN: "1234", SESSION_SECRET: "s" })).toEqual([]);
  });

  it("빠진 것을 이름으로 알려준다", () => {
    expect(missingSecrets({})).toEqual(["MASTER_PIN", "SESSION_SECRET"]);
    expect(missingSecrets({ MASTER_PIN: "1234" })).toEqual(["SESSION_SECRET"]);
    // 빈 문자열도 없는 것으로 친다 — wrangler 는 빈 값을 그대로 넣어준다
    expect(missingSecrets({ MASTER_PIN: "1234", SESSION_SECRET: "" })).toEqual(["SESSION_SECRET"]);
  });
});
