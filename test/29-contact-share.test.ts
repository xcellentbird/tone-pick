/**
 * 슬라이스 29 — **연락처를 얼마나 열지는 본인이 미리 고른다** (ADR-37).
 *
 * ADR-19 는 조건 셋으로 연락처를 지켰다 — 발표 단계일 것 · 서로 찔렀을 것 · 그 상대의 것일 것.
 * 여기서 **넷째**가 붙는다: 두 사람이 등록할 때 고른 것 중 **조심스러운 쪽이 허락할 것.**
 *
 * 이 파일이 지키는 것은 넷이다.
 *
 *   1. `안 열기` 를 고르면 발표 뒤에도 아무것도 안 나간다 — `contact` 키 자체가 없다
 *   2. **대칭이다.** 한쪽이 좁히면 두 사람 다 같은 만큼만 받는다
 *   3. 안 고르면 등록이 막힌다 — 기본값이 없다
 *   4. 프로필과 **같은 때 굳는다** — 사전 투표가 열리면 못 바꾼다
 *
 * ⚠️ **발표 뒤에 고치는 길을 만들면 여기가 통째로 무의미해진다.** 그 순간 이 값은
 * "이 사람에게 열까" 가 되고, 안 여는 것이 **이름 붙은 거절**이 된다 (ADR-37).
 * 4번이 그걸 막는 자리다.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { ParticipantState } from "../src/shared/types.ts";
import { minShare } from "../src/shared/constants.ts";
import { signInMaster, api, enter, freshEvent, invite, join, nextPhone, person, setPhase } from "./helpers/party.ts";

beforeAll(signInMaster);

/**
 * 서로 찌른 한 쌍을 만들고 **양쪽이 본 것**을 돌려준다.
 *
 * 양쪽을 다 보는 게 요점이다 — 한쪽만 재면 "연 사람은 받고 안 연 사람은 못 받는"
 * 비대칭 구현이 그대로 통과한다. 그건 ADR-37 이 일부러 고르지 않은 설계다.
 */
async function pair(mine: "all" | "instagram" | "none", theirs: "all" | "instagram" | "none") {
  const ev = await freshEvent();
  const a = await join(ev, { gender: "M", nickname: "에이", realName: "김에이", contactShare: mine });
  const b = await join(ev, { gender: "F", nickname: "비이", realName: "박비이", contactShare: theirs });

  // 매칭은 **파티 콕만** 센다 (ADR-34)
  await setPhase(ev.id, "party");
  await api("/api/poke", { method: "POST", cookie: a.cookie, body: { toId: b.id } });
  await api("/api/poke", { method: "POST", cookie: b.cookie, body: { toId: a.id } });
  await setPhase(ev.id, "done");

  const seen = async (cookie: string | null) => {
    const res = await api<ParticipantState>("/api/me", { cookie });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const matches = res.body.poke.matches;
    // 매칭 자체는 어느 경우에도 성립한다 — 좁아지는 건 연락처뿐이다
    expect(matches.length, "매칭이 사라지면 안 된다").toBe(1);
    // 화면이 아니라 **응답 원문**을 본다. 개발자 도구를 여는 참가자가 있다
    return { match: matches[0], raw: JSON.stringify(res.body) };
  };
  return { ev, a, b, aSaw: await seen(a.cookie), bSaw: await seen(b.cookie) };
}

describe("연락처를 얼마나 열지", () => {
  /*
   * **기준선이다.** 이게 없으면 아래 셋이 "그냥 아무것도 안 나감" 이어도 다 통과한다 —
   * 연락처를 통째로 끊어버린 구현과 제대로 고른 구현을 이 테스트만이 가른다.
   */
  it("★ 둘 다 전체 공개면 이름·인스타·전화번호가 다 온다", async () => {
    const { b, aSaw } = await pair("all", "all");
    expect(aSaw.match.contact?.realName).toBe("박비이");
    expect(aSaw.match.contact?.instagram).toBe(b.input.instagram);
    expect(aSaw.match.contact?.phone).toBe(b.phone);
  });

  it("★ 한쪽이 '안 열기' 면 응답에 연락처가 아예 없다", async () => {
    const { a, b, aSaw, bSaw } = await pair("all", "none");

    // 키가 **없어야** 한다. 빈 객체면 "열려 있는데 비었다" 로 읽히고 그 구분이 곧 상대의 선택이다
    expect(aSaw.match.contact, "안 연 쪽의 것은 키째로 없다").toBeUndefined();

    // 화면에서 감추는 걸로는 부족하다 — 원문에 흔적이 없어야 한다
    for (const [what, needle] of [
      ["전화번호", b.phone],
      ["인스타", b.input.instagram],
      ["실명", "박비이"],
    ] as const) {
      expect(aSaw.raw, `${what} 가 응답에 남아 있다`).not.toContain(needle);
    }

    /*
     * **대칭이다.** `안 열기` 를 고른 B 도 A 의 것을 못 받는다.
     * 비대칭이면 "나는 열었는데 못 받았다" 가 생기고, 그건 곧 상대를 지목하는 정보다.
     */
    expect(bSaw.match.contact, "안 연 쪽도 상대 것을 못 받는다").toBeUndefined();
    expect(bSaw.raw).not.toContain(a.phone);
  });

  it("★ 한쪽이 '인스타까지' 면 두 사람 다 전화번호가 없다", async () => {
    const { a, b, aSaw, bSaw } = await pair("all", "instagram");

    // 인스타는 양쪽 다 열린다 — 좁아진 건 번호뿐이다
    expect(aSaw.match.contact?.instagram).toBe(b.input.instagram);
    expect(bSaw.match.contact?.instagram).toBe(a.input.instagram);

    expect(aSaw.match.contact?.phone, "좁힌 쪽의 번호는 안 나간다").toBeUndefined();
    expect(bSaw.match.contact?.phone, "넓게 연 쪽의 번호도 안 나간다 — 조심스러운 쪽을 따른다").toBeUndefined();
    for (const [who, raw, phone] of [
      ["A 가 본 것", aSaw.raw, b.phone],
      ["B 가 본 것", bSaw.raw, a.phone],
    ] as const) {
      expect(raw, `${who} 에 번호가 남아 있다`).not.toContain(phone);
    }
  });

  it("★ 한쪽만 찔렀으면 둘 다 전체 공개여도 아무것도 없다 (ADR-19 는 그대로다)", async () => {
    const ev = await freshEvent();
    const a = await join(ev, { gender: "M", nickname: "에이", contactShare: "all" });
    const b = await join(ev, { gender: "F", nickname: "비이", realName: "박비이", contactShare: "all" });
    await setPhase(ev.id, "party");
    // A 만 찌른다
    await api("/api/poke", { method: "POST", cookie: a.cookie, body: { toId: b.id } });
    await setPhase(ev.id, "done");

    const res = await api<ParticipantState>("/api/me", { cookie: a.cookie });
    expect(res.body.poke.matches.length).toBe(0);
    expect(JSON.stringify(res.body)).not.toContain(b.phone);
  });
});

describe("고르는 때", () => {
  /**
   * **응답을 직접 본다.** `join` 은 안에서 200 을 기대하므로 `rejects.toThrow()` 로 재면
   * 등록이 다른 이유로 실패해도 초록으로 통과한다 — 그러면 이 규칙을 안 지켜도 모른다.
   */
  async function registerWith(share: unknown) {
    const ev = await freshEvent();
    const phone = nextPhone();
    const token = await invite(ev.id, phone);
    const gate = await enter(ev.id, token);
    expect(gate.status, JSON.stringify(gate.body)).toBe(200);
    return api("/api/register", {
      method: "POST",
      cookie: gate.cookie,
      body: { ...person(), contactShare: share },
    });
  }

  it("★ 안 고르면 등록이 막힌다 — 기본값이 없다", async () => {
    /*
     * 안 보낸 것을 `전체 공개` 로 읽으면 그건 동의가 아니라 동의를 지어낸 것이다.
     * 서버가 스스로 막아야 한다 — 화면만 막으면 개발자 도구로 그냥 지나간다.
     */
    const res = await registerWith(undefined);
    expect(res.status, JSON.stringify(res.body)).toBe(400);
  });

  it("★ 값이 목록에 없으면 거절한다", async () => {
    const res = await registerWith("phone");
    expect(res.status, JSON.stringify(res.body)).toBe(400);
  });

  it("★ 사전 투표가 열리면 프로필과 함께 굳는다", async () => {
    const ev = await freshEvent();
    const a = await join(ev, { contactShare: "all" });

    // 등록 중에는 바꿀 수 있다
    const open = await api("/api/me", {
      method: "PUT",
      cookie: a.cookie,
      body: { ...a.input, contactShare: "none" },
    });
    expect(open.status, JSON.stringify(open.body)).toBe(200);

    /*
     * 사전 투표부터는 잠긴다 (ADR-31). **이 잠금이 ADR-37 의 방패다** —
     * 발표를 보고 나서 고칠 수 있으면 안 여는 것이 이름 붙은 거절이 된다.
     */
    await setPhase(ev.id, "prevote");
    const shut = await api("/api/me", {
      method: "PUT",
      cookie: a.cookie,
      body: { ...a.input, contactShare: "all" },
    });
    expect(shut.status, "사전 투표가 열린 뒤에는 못 바꾼다").not.toBe(200);
  });
});

/**
 * 옛 회차에는 이 칸이 아예 없다 (`ALTER TABLE ... ADD COLUMN`).
 * **테스트 DO 는 언제나 새것이라 그 상황을 못 만든다** — 그래서 판단하는 함수만 따로 본다.
 */
describe("칸이 없던 회차", () => {
  it("★ 값이 없으면 '전체 공개' 로 읽는다 — 그때 한 약속이 그것이었다", () => {
    expect(minShare(null, "all")).toBe("all");
    expect(minShare(undefined, undefined)).toBe("all");
    // 없는 쪽이 상대를 넓히지는 않는다
    expect(minShare(null, "none")).toBe("none");
    expect(minShare(null, "instagram")).toBe("instagram");
  });

  it("★ 조심스러운 쪽을 고른다 — 순서가 뒤바뀌어도 같다", () => {
    for (const [x, y, want] of [
      ["all", "instagram", "instagram"],
      ["instagram", "none", "none"],
      ["all", "none", "none"],
      ["all", "all", "all"],
    ] as const) {
      expect(minShare(x, y), `${x}+${y}`).toBe(want);
      expect(minShare(y, x), `${y}+${x} (뒤집어도)`).toBe(want);
    }
  });
});
