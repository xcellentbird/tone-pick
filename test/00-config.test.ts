/**
 * 배포 시점 안전장치.
 *
 * 시크릿을 빠뜨린 채 배포하는 건 흔한 실수인데, 결과가 조용하다 —
 * SESSION_SECRET 이 비면 세션 서명 키가 빈 문자열이 되어 운영자 쿠키가 위조된다.
 * 에러가 안 나는 실패라서 기계가 잡아야 한다 (ADR-8).
 */
import { describe, expect, it } from "vitest";
import { missingSecrets } from "../src/server/http.ts";
import { DEFAULTS, withDefaults } from "../src/shared/constants.ts";

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

/**
 * 저장된 자료는 코드보다 오래 산다.
 *
 * 일정 기준을 "만든 지 N시간 뒤"에서 "파티 N일 전"으로 바꿨더니, 이미 저장돼 있던
 * 옛 모양이 그대로 화면에 올라와 숫자 칸이 **NaN** 이 됐다. 운영자가 기본 설정을
 * 열 때마다 보이는 자리였다.
 */
describe("옛 모양으로 저장된 기본값", () => {
  it("★ 없는 항목은 기본값으로 채운다 — 화면에 NaN 이 뜨지 않는다", () => {
    // 옛 모양: regOpenAfterH · voteWindowH 를 쓰던 시절
    const old = { maxPre: 5, maxParty: 9, regOpenAfterH: 3, voteWindowH: 48 } as never;
    const now = withDefaults(old);

    expect(now.regOpenBeforeD).toBe(DEFAULTS.regOpenBeforeD);
    expect(now.prevoteBeforeH).toBe(DEFAULTS.prevoteBeforeH);
    // 운영자가 정해둔 값은 살린다 — 모양이 바뀌었다고 설정을 지우면 그것도 사고다
    expect(now.maxPre).toBe(5);
    expect(now.maxParty).toBe(9);

    for (const v of Object.values(now)) expect(Number.isFinite(v)).toBe(true);
  });

  it("모르는 항목은 버린다 — 옛 키를 들고 다니면 다음 사람이 쓰이는 줄 안다", () => {
    const now = withDefaults({ regOpenAfterH: 3 } as never);
    expect(Object.keys(now).sort()).toEqual(Object.keys(DEFAULTS).sort());
  });

  it("저장된 게 아예 없어도 기본값이 나온다", () => {
    expect(withDefaults(undefined)).toEqual(DEFAULTS);
    expect(withDefaults(null)).toEqual(DEFAULTS);
  });
});
