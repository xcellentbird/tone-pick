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
import { INVITE_TEMPLATE, LEGACY_INVITE_TEMPLATE } from "../src/shared/copy.ts";
import { renderInvite } from "../src/shared/invite.ts";

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
    // 옛 모양: regOpenAfterH · voteWindowH · regOpenBeforeD 를 쓰던 시절
    const old = { maxPre: 5, maxParty: 9, regOpenAfterH: 3, voteWindowH: 48, regOpenBeforeD: 6 } as never;
    const now = withDefaults(old);

    expect(now.prevoteBeforeH).toBe(DEFAULTS.prevoteBeforeH);
    // 등록 시작 오프셋은 사라졌다 (ADR-38). 옛 키를 들고 다니지 않는다
    expect(Object.keys(now)).not.toContain("regOpenBeforeD");
    // 장소는 없으면 빈 값 — "회차마다 다른 곳에서 연다" 는 뜻이다
    expect(now.place).toBe("");
    // 운영자가 정해둔 값은 살린다 — 모양이 바뀌었다고 설정을 지우면 그것도 사고다
    expect(now.maxPre).toBe(5);
    expect(now.maxParty).toBe(9);

    // 숫자 칸에 NaN 이 없다
    for (const v of Object.values(now)) {
      if (typeof v === "number") expect(Number.isFinite(v)).toBe(true);
    }
    // 안내문도 같은 이유로 비어 있으면 안 된다 — 빈 문구는 링크 없는 안내문이 된다 (ADR-32)
    expect(now.inviteTemplate.trim().length).toBeGreaterThan(0);
  });

  it("모르는 항목은 버린다 — 옛 키를 들고 다니면 다음 사람이 쓰이는 줄 안다", () => {
    const now = withDefaults({ regOpenAfterH: 3 } as never);
    expect(Object.keys(now).sort()).toEqual(Object.keys(DEFAULTS).sort());
  });

  /**
   * ★ **ADR-32 시절의 기본 안내문이 저장돼 있으면 새 기본 안내문으로 읽는다** (ADR-75).
   *
   * 기본값은 저장할 때 문구를 통째로 담는다 — 그때 저장한 운영자에게는 `함께 보내드린 링크로…` 가
   * 그대로 남아 있고, 그 글에는 링크 자리가 없다. 운영자가 직접 고친 글은 건드리지 않는다.
   */
  it("★ 옛 기본 안내문은 새 기본 안내문으로 읽는다 — 직접 고친 글은 그대로다", () => {
    expect(withDefaults({ inviteTemplate: LEGACY_INVITE_TEMPLATE }).inviteTemplate).toBe(INVITE_TEMPLATE);
    expect(withDefaults({ inviteTemplate: LEGACY_INVITE_TEMPLATE + "\n" }).inviteTemplate).toBe(INVITE_TEMPLATE);
    const mine = "우리 파티는 {일시}에 {장소}에서! {링크}";
    expect(withDefaults({ inviteTemplate: mine }).inviteTemplate).toBe(mine);
  });

  it("저장된 게 아예 없어도 기본값이 나온다", () => {
    expect(withDefaults(undefined)).toEqual(DEFAULTS);
    expect(withDefaults(null)).toEqual(DEFAULTS);
  });
});

/**
 * 안내문 하나가 완결된 초대장이다 (ADR-75). **링크 없는 안내문은 나가지 않는다** —
 * `{링크}` 자리가 있으면 거기, 없으면 맨 끝 줄에 붙는다. 자리를 빼먹은 운영자도,
 * 옛 문구가 남은 회차도 링크가 빠진 채 보내지 않는다.
 */
describe("안내문", () => {
  const vars = { place: "홍대 어딘가", when: "9월 6일 오후 6시", link: "https://tone.party/j/abc" };

  it("★ {링크} 자리가 있으면 그 자리에만 들어간다", () => {
    const note = renderInvite(INVITE_TEMPLATE, vars);
    expect(note.split(vars.link).length - 1).toBe(1);
    expect(note.endsWith(vars.link)).toBe(true);
    expect(note).toContain("홍대 어딘가");
  });

  it("★ {링크} 자리가 없으면 맨 끝 줄에 붙는다", () => {
    const note = renderInvite(LEGACY_INVITE_TEMPLATE, vars);
    expect(note.split("\n").at(-1)).toBe(vars.link);
    expect(note.split(vars.link).length - 1).toBe(1);
  });
});
