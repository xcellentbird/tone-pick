/**
 * 슬라이스 29 — **연락처를 얼마나 열지는 본인이 미리 고른다** (ADR-37).
 *
 * ADR-19 는 조건 셋으로 연락처를 지켰다 — 발표 단계일 것 · 서로 찔렀을 것 · 그 상대의 것일 것.
 * 여기서 **넷째**가 붙는다: 두 사람이 고른 것을 **칸마다 겹쳐, 둘 다 허락한 것만.**
 *
 * **이름은 고르는 값이 아니다 — 늘 열린다.** 고르는 건 전화번호와 인스타 둘이고 서로 독립이라,
 * `이름만` · `이름+전화번호` · `이름+인스타` · `이름+둘 다` 넷이 나온다.
 *
 * 이 파일이 지키는 것은 넷이다.
 *
 *   1. 안 연 칸은 응답에 **키째로** 없다 — 이름은 늘 있다
 *   2. **대칭이다.** 한쪽이 닫으면 두 사람 다 그 칸을 못 받는다
 *   3. 둘 중 하나라도 안 고르면 등록이 막힌다 — 기본값이 없다
 *   4. 프로필과 **같은 때 굳는다** — 사전 투표가 열리면 못 바꾼다
 *
 * ⚠️ **발표 뒤에 고치는 길을 만들면 여기가 통째로 무의미해진다.** 그 순간 이 값은
 * "이 사람에게 열까" 가 되고, 안 여는 것이 **이름 붙은 거절**이 된다 (ADR-37).
 * 4번이 그걸 막는 자리다.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { ContactShare, ParticipantState } from "../src/shared/types.ts";
import { minShare, parseShare } from "../src/shared/constants.ts";
import { signInMaster, api, enter, freshEvent, invite, join, nextPhone, person, setPhase } from "./helpers/party.ts";

beforeAll(signInMaster);

const SHARE = {
  both: { phone: true, instagram: true },
  phoneOnly: { phone: true, instagram: false },
  igOnly: { phone: false, instagram: true },
  neither: { phone: false, instagram: false },
} satisfies Record<string, ContactShare>;

/**
 * 서로 찌른 한 쌍을 만들고 **양쪽이 본 것**을 돌려준다.
 *
 * 양쪽을 다 보는 게 요점이다 — 한쪽만 재면 "연 사람은 받고 안 연 사람은 못 받는"
 * 비대칭 구현이 그대로 통과한다. 그건 ADR-37 이 일부러 고르지 않은 설계다.
 */
async function pair(mine: ContactShare, theirs: ContactShare) {
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
    // 매칭 자체는 어느 경우에도 성립한다 — 좁아지는 건 연락 수단뿐이다
    expect(matches.length, "매칭이 사라지면 안 된다").toBe(1);
    // 화면이 아니라 **응답 원문**을 본다. 개발자 도구를 여는 참가자가 있다
    return { match: matches[0], raw: JSON.stringify(res.body) };
  };
  return { ev, a, b, aSaw: await seen(a.cookie), bSaw: await seen(b.cookie) };
}

describe("연락처를 얼마나 열지", () => {
  /*
   * **기준선이다.** 이게 없으면 아래 것들이 "그냥 아무것도 안 나감" 이어도 다 통과한다 —
   * 연락처를 통째로 끊어버린 구현과 제대로 고른 구현을 이 테스트만이 가른다.
   */
  it("★ 둘 다 열면 이름·전화번호·인스타가 다 온다", async () => {
    const { b, aSaw } = await pair(SHARE.both, SHARE.both);
    expect(aSaw.match.contact.realName).toBe("박비이");
    expect(aSaw.match.contact.phone).toBe(b.phone);
    expect(aSaw.match.contact.instagram).toBe(b.input.instagram);
  });

  /*
   * **사다리가 못 하던 조합이다.** 예전 3단(`전화번호까지`·`인스타까지`·`안 열기`)은
   * "인스타는 열고 번호는 닫는다" 만 됐고 그 반대가 안 됐다. 둘이 독립인 게 이 슬라이스의
   * 요점이라, 이 조합이 실제로 되는지가 곧 규칙이다.
   */
  it("★ 전화번호만 열고 인스타는 닫을 수 있다", async () => {
    const { b, aSaw } = await pair(SHARE.both, SHARE.phoneOnly);
    expect(aSaw.match.contact.phone).toBe(b.phone);
    expect(aSaw.match.contact.instagram, "닫은 칸은 키째로 없다").toBeUndefined();
    expect(aSaw.raw, "인스타가 응답에 남아 있다").not.toContain(b.input.instagram);
  });

  it("★ 인스타만 열고 전화번호는 닫을 수 있다", async () => {
    const { b, aSaw } = await pair(SHARE.both, SHARE.igOnly);
    expect(aSaw.match.contact.instagram).toBe(b.input.instagram);
    expect(aSaw.match.contact.phone, "닫은 칸은 키째로 없다").toBeUndefined();
    expect(aSaw.raw, "번호가 응답에 남아 있다").not.toContain(b.phone);
  });

  it("★ 한쪽이 닫으면 두 사람 다 그 칸을 못 받는다", async () => {
    const { a, b, aSaw, bSaw } = await pair(SHARE.both, SHARE.igOnly);

    /*
     * **대칭이다.** 넓게 연 A 도 상대의 번호를 못 받고, 좁힌 B 도 A 의 번호를 못 받는다.
     * 비대칭이면 "나는 열었는데 못 받았다" 가 생기고, 그건 곧 상대의 선택을 가리키는 정보다.
     */
    expect(aSaw.match.contact.phone, "좁힌 쪽의 번호는 안 나간다").toBeUndefined();
    expect(bSaw.match.contact.phone, "넓게 연 쪽의 번호도 안 나간다").toBeUndefined();
    for (const [who, raw, phone] of [
      ["A 가 본 것", aSaw.raw, b.phone],
      ["B 가 본 것", bSaw.raw, a.phone],
    ] as const) {
      expect(raw, `${who} 에 번호가 남아 있다`).not.toContain(phone);
    }

    // 인스타는 둘 다 열었으니 양쪽 다 온다 — 칸마다 따로 겹친다
    expect(aSaw.match.contact.instagram).toBe(b.input.instagram);
    expect(bSaw.match.contact.instagram).toBe(a.input.instagram);
  });

  it("★ 둘 다 닫아도 이름은 온다 — 이름은 고르는 값이 아니다", async () => {
    const { b, aSaw } = await pair(SHARE.both, SHARE.neither);

    expect(aSaw.match.contact.realName, "이름까지 사라지면 안 된다").toBe("박비이");
    expect(aSaw.match.contact.phone).toBeUndefined();
    expect(aSaw.match.contact.instagram).toBeUndefined();
    expect(aSaw.raw).not.toContain(b.phone);
    expect(aSaw.raw).not.toContain(b.input.instagram);
  });

  it("★ 한쪽만 찔렀으면 둘 다 열어놨어도 아무것도 없다 (ADR-19 는 그대로다)", async () => {
    const ev = await freshEvent();
    const a = await join(ev, { gender: "M", nickname: "에이", contactShare: SHARE.both });
    const b = await join(ev, { gender: "F", nickname: "비이", realName: "박비이", contactShare: SHARE.both });
    await setPhase(ev.id, "party");
    // A 만 찌른다
    await api("/api/poke", { method: "POST", cookie: a.cookie, body: { toId: b.id } });
    await setPhase(ev.id, "done");

    const res = await api<ParticipantState>("/api/me", { cookie: a.cookie });
    expect(res.body.poke.matches.length).toBe(0);
    // 이름이 늘 열린다는 게 **매칭 안 된 사람에게까지** 새는 구멍이 되면 안 된다
    for (const needle of [b.phone, "박비이"]) {
      expect(JSON.stringify(res.body), `${needle} 가 남아 있다`).not.toContain(needle);
    }
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

  /*
   * 안 보낸 것을 열림으로 읽으면 그건 동의가 아니라 동의를 지어낸 것이다.
   * 서버가 스스로 막아야 한다 — 화면만 막으면 개발자 도구로 그냥 지나간다.
   */
  it("★ 둘 중 하나라도 안 고르면 등록이 막힌다", async () => {
    for (const [what, value] of [
      ["아예 없음", undefined],
      ["전화번호만 고름", { phone: true }],
      ["인스타만 고름", { instagram: false }],
      ["빈 객체", {}],
    ] as const) {
      const res = await registerWith(value);
      expect(res.status, `${what}: ${JSON.stringify(res.body)}`).toBe(400);
    }
  });

  it("★ 참·거짓이 아닌 값은 거절한다", async () => {
    // `"all"` 은 사다리 시절의 값이다. **저장된 것은 읽되, 새로 받지는 않는다**
    for (const value of ["all", { phone: "yes", instagram: true }, { phone: 1, instagram: 0 }]) {
      const res = await registerWith(value);
      expect(res.status, JSON.stringify(value)).toBe(400);
    }
  });

  it("★ 사전 투표가 열리면 프로필과 함께 굳는다", async () => {
    const ev = await freshEvent();
    const a = await join(ev, { contactShare: SHARE.both });

    // 등록 중에는 바꿀 수 있다
    const open = await api("/api/me", {
      method: "PUT",
      cookie: a.cookie,
      body: { ...a.input, contactShare: SHARE.neither },
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
      body: { ...a.input, contactShare: SHARE.both },
    });
    expect(shut.status, "사전 투표가 열린 뒤에는 못 바꾼다").not.toBe(200);
  });
});

/**
 * 저장된 값을 읽는 자리. **테스트 DO 는 언제나 새것이라** 옛 행을 못 만든다 —
 * 그래서 판단하는 함수만 따로 본다 (QA 에서 실제 행으로 확인한다).
 */
describe("옛 값 읽기", () => {
  it("★ 칸이 없던 회차는 둘 다 열림이다 — 그때 한 약속이 그것이었다", () => {
    expect(parseShare(null)).toEqual(SHARE.both);
    expect(parseShare(undefined)).toEqual(SHARE.both);
    expect(minShare(null, null)).toEqual(SHARE.both);
  });

  /*
   * 사다리 3단이던 시절(ADR-37 첫 판)의 값이 QA 에 남아 있다.
   * **못 읽어서 기본값으로 떨어뜨리면 그 사람이 좁혀 둔 것이 도로 열린다.**
   */
  it("★ 사다리 시절 값을 뜻대로 옮긴다", () => {
    expect(parseShare("all")).toEqual(SHARE.both);
    expect(parseShare("instagram")).toEqual(SHARE.igOnly);
    // `안 열기` 였어도 이름은 이제 열린다 — 그건 고르는 값이 아니게 됐다
    expect(parseShare("none")).toEqual(SHARE.neither);
  });

  it("★ 지금 모양은 그대로 읽는다", () => {
    for (const v of Object.values(SHARE)) {
      expect(parseShare(JSON.stringify(v))).toEqual(v);
    }
    // 빠진 칸은 닫힘으로 — 여기서 넓히면 저장된 적 없는 동의를 지어내는 것이다
    expect(parseShare('{"phone":true}')).toEqual(SHARE.phoneOnly);
  });

  it("★ 읽을 수 없는 값은 넓게 잡는다 — 좁히는 쪽이 약속을 어기는 쪽이다", () => {
    expect(parseShare("{망가진")).toEqual(SHARE.both);
  });

  it("★ 칸마다 따로 겹친다 — 순서가 뒤바뀌어도 같다", () => {
    for (const [x, y, want] of [
      [SHARE.both, SHARE.igOnly, SHARE.igOnly],
      [SHARE.phoneOnly, SHARE.igOnly, SHARE.neither],
      [SHARE.both, SHARE.neither, SHARE.neither],
      [SHARE.both, SHARE.both, SHARE.both],
    ] as const) {
      expect(minShare(x, y), JSON.stringify([x, y])).toEqual(want);
      expect(minShare(y, x), "뒤집어도 같다").toEqual(want);
    }
  });
});
