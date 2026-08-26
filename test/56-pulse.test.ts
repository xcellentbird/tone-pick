/**
 * 집계 지표가 사람을 가리키지 않는다 (ADR-56).
 *
 * 이 파일이 지키는 것은 하나다 — **회차 DO 밖으로 나가는 자료에 사람이 없다.**
 * `metrics.ts` 가 이미 그 선을 세웠고(*운영 카운터는 넣고 결과 통계는 넣지 않는다*),
 * 사용성·성능을 재기 시작하면 그 선이 조용히 넓어지기 쉽다.
 *
 * 넓어지는 방식이 셋이라 셋을 다 잰다:
 *   ① 회차를 인덱스로 달기 — 인원이 적으면 회차 하나가 곧 사람이다
 *   ② 화면이 보낸 문자열을 그대로 담기 — 언젠가 닉네임이 든 변수가 그 자리에 온다
 *   ③ 원값을 담기 — 초 단위 체류 시간은 그 자체로 한 사람의 습관이다
 */
import { beforeAll, describe, expect, it } from "vitest";
import { pulse, type Pulse } from "../src/server/metrics.ts";
import { NAV_KEYS, PULSE_MAX, TAP_KEYS, WS_KEYS, allowedKey, msBucket, stayBucket } from "../src/shared/pulse.ts";
import { api, freshEvent, join, signInMaster } from "./helpers/party.ts";

beforeAll(signInMaster);

/** 쓰인 데이터포인트를 그대로 붙잡는 가짜 바인딩 */
function spy() {
  const wrote: Array<{ blobs?: unknown[]; doubles?: number[]; indexes?: string[] }> = [];
  return {
    wrote,
    env: { METRICS: { writeDataPoint: (p: never) => void wrote.push(p) } } as never,
  };
}

describe("집계 지표는 사람을 가리키지 않는다", () => {
  /**
   * ★ **인덱스를 쓰지 않는다.**
   *
   * Analytics Engine 에서 인덱스는 묶어 세는 축이다. 회차를 축으로 달면
   * `회차 X · 등록 2단계 이탈 1건` 이 되는데, 둘이 등록한 회차에서 그건 **그 한 사람**이다.
   * 그리고 회차를 지운 뒤에도 90일 남는다 — 파기가 DO 하나 지우는 일로 끝나야 한다는
   * 보장이 거기서 깨진다.
   */
  it("★ 어떤 집계도 인덱스를 달지 않는다", () => {
    const s = spy();
    const all: Pulse[] = [
      { kind: "api", route: "/events/:id/enter", outcome: "200", ms: 12 },
      { kind: "nav", key: "register2", who: "player" },
      { kind: "tap", key: "poke", who: "player" },
      { kind: "ws", key: "drop", who: "player" },
      { kind: "stay", bucket: "<5m", who: "host" },
    ];
    for (const p of all) pulse(s.env, p);

    expect(s.wrote).toHaveLength(all.length);
    for (const w of s.wrote) expect(w.indexes).toBeUndefined();
  });

  /**
   * ★ **`pulse()` 는 회차를 받을 자리가 없다.**
   *
   * 이건 관례가 아니라 타입이다 — `count(env, eventId, m)` 과 갈라둔 이유가 이것 하나다.
   * 넘길 자리가 없으면 실수로 넘길 수도 없다. 이 테스트는 그 자리가 다시 생기면 깨진다.
   */
  it("★ pulse 는 인자가 둘이다 — 회차를 넘길 자리가 없다", () => {
    expect(pulse.length).toBe(2);
  });

  /**
   * ★ 체류 시간은 **버킷만** 나간다.
   *
   * 원값(밀리초)은 한 사람의 습관이라 모이면 사람을 가리키기 시작한다.
   * 알고 싶은 건 *얼마나 머무나* 이고, 그 답에는 버킷이면 충분하다.
   */
  it("★ 체류 시간은 원값이 아니라 버킷이다", () => {
    const s = spy();
    pulse(s.env, { kind: "stay", bucket: stayBucket(247_913), who: "player" });

    const [w] = s.wrote;
    expect(w.blobs).toEqual(["stay", "<5m", "player"]);
    // 원값이 어디에도 없다 — doubles 는 "한 건" 을 세는 1 뿐이다
    expect(w.doubles).toEqual([1]);
    expect(JSON.stringify(w)).not.toContain("247913");
  });

  /** 버킷 경계. 잘게 나눌수록 사람을 가리키므로 넷으로 족하다 */
  it("체류 시간 버킷은 넷이다", () => {
    expect(stayBucket(30_000)).toBe("<1m");
    expect(stayBucket(120_000)).toBe("<5m");
    expect(stayBucket(600_000)).toBe("<30m");
    expect(stayBucket(3_600_000)).toBe(">30m");
    // 말이 안 되는 값도 버킷이 받는다. 지표가 요청을 깨뜨리지 않는 것과 같은 이유다
    expect(stayBucket(Number.NaN)).toBe("?");
    expect(stayBucket(-1)).toBe("?");
  });

  it("응답 시간 버킷", () => {
    expect(msBucket(10)).toBe("<50");
    expect(msBucket(150)).toBe("<200");
    expect(msBucket(900)).toBe("<1s");
    expect(msBucket(2_000)).toBe("<3s");
    expect(msBucket(9_000)).toBe(">3s");
  });
});

describe("허용 목록", () => {
  /**
   * ★ **목록에 없으면 담지 않는다.**
   *
   * 화면이 보낸 문자열을 그대로 담는 순간, 언젠가 닉네임이 든 변수가 그 자리에 온다.
   * 목록을 좁혀두면 그 사고가 **일어날 자리가 없다** — 막는 게 아니라 없애는 쪽이다.
   */
  it("★ 목록 밖의 키는 통과하지 못한다", () => {
    expect(allowedKey("nav", "home")).toBe(true);
    expect(allowedKey("tap", "poke")).toBe(true);
    expect(allowedKey("ws", "drop")).toBe(true);

    // 사람이 담길 법한 모양들
    expect(allowedKey("tap", "poke_그녀")).toBe(false);
    expect(allowedKey("nav", "/e/ABC234/people")).toBe(false);
    expect(allowedKey("tap", "player_a1b2c3")).toBe(false);
    expect(allowedKey("nav", "")).toBe(false);
    expect(allowedKey("nav", undefined)).toBe(false);
    // 종류를 섞어도 안 된다
    expect(allowedKey("nav", "poke")).toBe(false);
    expect(allowedKey("ws", "home")).toBe(false);
  });

  /**
   * ★ 목록 자체에 사람이 없다.
   *
   * 키를 더하는 사람이 물어야 할 것은 하나다 — *이 값이 한 사람을 가리킬 수 있나?*
   * 자유 문자열이 섞여 들어오면 여기서 걸린다.
   */
  it("★ 목록의 모든 키가 고정된 낱말이다", () => {
    for (const k of [...NAV_KEYS, ...TAP_KEYS, ...WS_KEYS]) {
      expect(k, k).toMatch(/^[a-z][a-z0-9_]{0,23}$/);
    }
  });
});

describe("라우트 이름", () => {
  /**
   * ★ 원본 경로에는 **회차 아이디와 참가 토큰**이 있다 (ADR-32).
   *
   * 그래서 담는 건 Hono 에 등록된 **패턴**이다 — 자리마다 `:id` 가 들어가 있고
   * 실제 값이 아니다. 이 테스트는 그 패턴이 값처럼 보이지 않는지를 잰다.
   */
  it("★ 라우트 이름에 아이디도 토큰도 실리지 않는다", () => {
    const s = spy();
    pulse(s.env, { kind: "api", route: "api/events/:id/enter", outcome: "200", ms: 8 });

    const raw = JSON.stringify(s.wrote[0]);
    expect(raw).toContain(":id");
    // 실제 값이 들어갈 자리가 없다
    expect(raw).not.toMatch(/[0-9a-f]{16}/);
  });
});

// ─────────────────────────────────────────── 문

/**
 * 비콘도 문이다. 인증 없이 열어두면 **누구나 두드릴 수 있는 쓰기 경로**가 되고,
 * 무료 한도(10만 요청/일)는 참가자가 쓰라고 있는 것이다.
 *
 * 다만 세션을 보는 이유는 거기까지다 — **통과한 뒤에 누구인지는 기록하지 않는다.**
 */
describe("집계 비콘", () => {
  it("★ 세션이 없으면 아무것도 받지 않는다", async () => {
    const res = await api("/api/pulse", {
      method: "POST",
      body: { events: [{ kind: "nav", key: "home" }] },
    });
    // 오류를 돌려주지 않는다 — 지표 때문에 화면이 할 일이 생기면 본말이 뒤바뀐다
    expect(res.status).toBe(204);
  });

  it("★ 참가자 세션이면 받고, 응답에 아무것도 담지 않는다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);

    const res = await api("/api/pulse", {
      method: "POST",
      cookie: me.cookie,
      body: {
        events: [
          { kind: "nav", key: "people" },
          { kind: "tap", key: "poke" },
          { kind: "ws", key: "drop" },
          { kind: "stay", ms: 61_000 },
          // 목록 밖 — 서버가 조용히 버린다
          { kind: "tap", key: me.input.nickname },
          { kind: "nav", key: me.id },
        ],
      },
    });

    expect(res.status).toBe(204);
    /*
     * 몸통이 비어 있다. **되돌려줄 것이 없는 것이 이 문의 계약이다** —
     * 무엇이 담겼고 무엇이 버려졌는지 알려주면, 그 답이 곧 목록을 훑는 창구가 된다.
     */
    const raw = JSON.stringify(res.body ?? {});
    expect(raw).toBe("{}");
    expect(raw).not.toContain(me.input.nickname);
    expect(raw).not.toContain(me.id);
  });

  it("한 번에 받는 건수에 상한이 있다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    const many = Array.from({ length: PULSE_MAX * 3 }, () => ({ kind: "nav" as const, key: "home" }));

    const res = await api("/api/pulse", { method: "POST", cookie: me.cookie, body: { events: many } });
    expect(res.status).toBe(204);
  });

  it("모양이 이상해도 깨지지 않는다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    for (const body of [{}, { events: null }, { events: "nope" }, { events: [null, 1, "x"] }]) {
      const res = await api("/api/pulse", { method: "POST", cookie: me.cookie, body });
      expect(res.status, JSON.stringify(body)).toBe(204);
    }
  });
});
