/**
 * 슬라이스 01 — 회차 생성 + 입장 코드 (API)
 *
 * 시나리오: docs/scenarios/01-event-create-join.md
 * 공개 표면: docs/scenarios/01-surface.md
 *
 * 이 테스트는 **공개 표면에만** 붙어 있다. 내부 클래스·함수 이름을 모른다.
 * 구현을 어떻게 나누든 이 테스트가 통과하면 된다. 반대로,
 * 테스트를 고쳐서 통과시키는 건 안 된다 — 규칙이 바뀌면 시나리오 문서부터 고친다.
 */
import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { ENTRY, HOST } from "../src/shared/copy.ts";
import type { CreateEventInput, EventMeta, EventSummary, PublicEvent } from "../src/shared/types.ts";

const MASTER_PIN = "1234";
const HOUR = 3600_000;

// ─────────────────────────────────────────── 헬퍼

interface Res<T> {
  status: number;
  body: T;
  cookie: string | null;
  serverTime: number | null;
}

async function api<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; cookie?: string | null; headers?: Record<string, string> } = {},
): Promise<Res<T>> {
  const res = await SELF.fetch(`https://tone-pick.test${path}`, {
    method: init.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(init.cookie ? { cookie: init.cookie } : {}),
      ...(init.headers ?? {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  let body: unknown = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  const set = res.headers.get("set-cookie");
  const st = res.headers.get("x-server-time");
  return {
    status: res.status,
    body: body as T,
    cookie: set ? set.split(";")[0] : null,
    serverTime: st ? Number(st) : null,
  };
}

/** 공통 PIN 또는 회차 PIN 으로 로그인하고 세션 쿠키를 돌려준다 */
async function login(pin: string, eventId?: string) {
  const res = await api<{ scope: unknown }>("/api/host/pin", {
    method: "POST",
    body: eventId ? { pin, eventId } : { pin },
  });
  return res;
}

let seq = 0;
function draft(over: Partial<CreateEventInput> = {}): CreateEventInput {
  seq++;
  const now = Date.now();
  return {
    name: `${seq}회차 솔로 파티`,
    pin: String(2000 + seq),
    regOpenAt: now + HOUR,
    voteCloseAt: now + 25 * HOUR,
    config: { maxPre: 3, maxParty: 3 },
    requestId: `req-${seq}-${now}`,
    ...over,
  };
}

async function createEvent(cookie: string | null, over: Partial<CreateEventInput> = {}) {
  return api<EventMeta>("/api/host/events", { method: "POST", body: draft(over), cookie });
}

/** 테스트 전용 시간 이동. ALLOW_TEST_ENDPOINTS=1 일 때만 존재하는 라우트 */
async function travelTo(at: number) {
  const res = await api("/api/__test__/now", { method: "POST", body: { at } });
  expect(res.status, "테스트 전용 시간 이동 라우트가 필요합니다 (docs/scenarios/01-surface.md)").toBe(200);
}

let master: string | null = null;

beforeEach(async () => {
  const res = await login(MASTER_PIN);
  master = res.cookie;
});

// ─────────────────────────────────────────── A. 운영자 인증

describe("A. 운영자 인증", () => {
  it("S-A1 공통 PIN 으로 전체 권한을 얻는다", async () => {
    // Given 공통 PIN 이 "1234" 다
    // When  회차 목록 화면에서 "1234" 를 입력한다
    const res = await login(MASTER_PIN);
    // Then  scope 는 { kind: "master" } 다
    expect(res.status).toBe(200);
    expect(res.body.scope).toEqual({ kind: "master" });
    // And   회차 목록을 조회할 수 있다
    const list = await api<EventSummary[]>("/api/host/events", { cookie: res.cookie });
    expect(list.status).toBe(200);
  });

  it("S-A2 회차 PIN 으로는 그 회차만 연다", async () => {
    // Given 회차 X 의 PIN 이 "5678" 이고 공통 PIN 은 "1234" 다
    const x = await createEvent(master, { pin: "5678" });
    const y = await createEvent(master, { pin: "8765" });
    expect(x.status).toBe(200);

    // When  회차 X 화면에서 "5678" 을 입력한다
    const auth = await login("5678", x.body.id);

    // Then  scope 는 { kind: "host", eventId: X } 다
    expect(auth.status).toBe(200);
    expect(auth.body.scope).toEqual({ kind: "host", eventId: x.body.id });

    // And   회차 Y 의 콘솔은 403 이다
    const other = await api(`/api/host/events/${y.body.id}`, { cookie: auth.cookie });
    expect(other.status).toBe(403);

    // And   회차 목록도 403 이다
    const list = await api("/api/host/events", { cookie: auth.cookie });
    expect(list.status).toBe(403);
  });

  it("S-A3 ★ 두 PIN 이 같아도 회차 권한만 준다", async () => {
    // Given 회차 X 의 PIN 이 공통 PIN 과 같다
    //       (생성 시점에는 막히므로, 이미 그런 데이터가 있는 상황을 공통 PIN 변경으로 만든다)
    const x = await createEvent(master, { pin: "7777" });
    expect(x.status).toBe(200);
    const changed = await api("/api/host/defaults", {
      method: "PUT",
      cookie: master,
      body: { maxPre: 3, maxParty: 3, regOpenAfterH: 1, voteWindowH: 24, masterPin: "7777" },
    });
    // 공통 PIN 을 기존 회차 PIN 과 같게 만드는 것도 막혀야 한다
    expect(changed.status).toBe(409);

    // 그래도 검사 순서 자체가 안전해야 한다 — 회차 PIN 을 먼저 본다
    const auth = await login(MASTER_PIN, x.body.id);
    // Then master 를 얻을 수는 있지만(회차 PIN 이 아니므로) 그건 공통 PIN 이 맞았기 때문이다.
    expect(auth.body.scope).toEqual({ kind: "master" });

    // 그리고 회차 PIN 으로 들어오면 절대 master 가 아니다
    const host = await login("7777", x.body.id);
    expect(host.body.scope).toEqual({ kind: "host", eventId: x.body.id });
    const list = await api("/api/host/events", { cookie: host.cookie });
    expect(list.status).toBe(403);
  });

  it("S-A4 틀린 PIN 은 거부하고 정답을 흘리지 않는다", async () => {
    // Given 회차 X 의 PIN 이 "5678" 이다
    const x = await createEvent(master, { pin: "5678" });
    // When  "9999" 를 입력한다
    const res = await api<{ error: string; message?: string }>("/api/host/pin", {
      method: "POST",
      body: { pin: "9999", eventId: x.body.id },
    });
    // Then  401 이고 메시지는 HOST.pin.wrong 이다
    expect(res.status).toBe(401);
    expect(res.body.message).toBe(HOST.pin.wrong);
    // And   응답 어디에도 올바른 PIN 이 들어 있지 않다
    expect(JSON.stringify(res.body)).not.toContain("5678");
    expect(JSON.stringify(res.body)).not.toContain(MASTER_PIN);
  });

  it("S-A5 인증 없이 운영자 API 에 닿을 수 없다", async () => {
    // Given 세션 쿠키가 없다
    const x = await createEvent(master);
    // When  운영자 API 를 호출한다
    const res = await api(`/api/host/events/${x.body.id}`);
    // Then  401 이다
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────── B. 회차 생성

describe("B. 회차 생성", () => {
  it("S-B1 기본 설정을 물려받는다", async () => {
    // Given 기본값이 { maxPre:3, maxParty:3, regOpenAfterH:1, voteWindowH:24 } 다
    const res = await api<{ maxPre: number; maxParty: number; regOpenAfterH: number; voteWindowH: number }>(
      "/api/host/defaults",
      { cookie: master },
    );
    // Then  위저드가 채워 넣을 값을 그대로 돌려준다
    expect(res.status).toBe(200);
    expect(res.body.maxPre).toBe(3);
    expect(res.body.maxParty).toBe(3);
    expect(res.body.regOpenAfterH).toBe(1);
    expect(res.body.voteWindowH).toBe(24);
  });

  it("S-B2 ★ 회차 PIN 을 공통 PIN 과 같게 만들 수 없다", async () => {
    // When  회차 PIN 을 공통 PIN 과 같게 두고 생성한다
    const res = await createEvent(master, { pin: MASTER_PIN });
    // Then  거부되고 메시지는 HOST.pin.sameAsMaster 다
    expect(res.status).toBe(409);
    expect((res.body as unknown as { error: string }).error).toBe("pin_collision");
    expect((res.body as unknown as { message: string }).message).toBe(HOST.pin.sameAsMaster(MASTER_PIN));
  });

  it("S-B2b 자동 생성 PIN 도 공통 PIN 을 피한다", async () => {
    // 생성 응답에 PIN 이 없으므로, 공통 PIN 으로는 그 회차의 host scope 가 나오면 안 된다
    for (let i = 0; i < 10; i++) {
      const ev = await createEvent(master, { pin: undefined as unknown as string });
      // 생성이 실패하면 이 테스트는 아무것도 검증하지 못한다 — 조용히 통과시키지 않는다
      expect(ev.status, "PIN 을 생략하면 서버가 만들어야 한다").toBe(200);
      const auth = await login(MASTER_PIN, ev.body.id);
      expect(auth.body.scope).toEqual({ kind: "master" });
    }
  });

  it("S-B3 ★ 입장 코드는 회차 사이에서 유일하다", async () => {
    // Given 이미 코드가 있는 회차가 있다
    const first = await createEvent(master);
    expect(first.status).toBe(200);
    const taken = first.body.code;

    // When  새 회차를 만든다
    const second = await createEvent(master);
    // Then  같은 코드가 나오지 않는다
    expect(second.body.code).not.toBe(taken);

    // And   코드를 직접 지정하면 거부된다
    const dup = await createEvent(master, { code: taken });
    expect(dup.status).toBe(409);
    expect((dup.body as unknown as { error: string }).error).toBe("code_taken");
  });

  it("S-B4 '지금 바로' 로 만들면 그 자리에서 등록이 열린다", async () => {
    // When  등록 시작을 "now" 로 두고 생성한다
    const res = await createEvent(master, { regOpenAt: "now", voteCloseAt: Date.now() + 24 * HOUR });
    // Then  phase 는 "reg" 이고 fired.reg 가 채워져 있다
    expect(res.status).toBe(200);
    expect(res.body.phase).toBe("reg");
    expect(res.body.fired.reg).toBeGreaterThan(0);
    // And   그 코드로 즉시 입장할 수 있다
    const pub = await api<PublicEvent>(`/api/events/by-code/${res.body.code}`);
    expect(pub.body.canRegister).toBe(true);
  });

  it("S-B5 ★ 예약은 한 번만 울린다", async () => {
    // Given 등록 시작을 1시간 뒤로 예약한다
    const at = Date.now() + HOUR;
    const res = await createEvent(master, { regOpenAt: at, voteCloseAt: at + 24 * HOUR });
    // Then  phase 는 "prep" 이고 fired.reg 는 비어 있다
    expect(res.body.phase).toBe("prep");
    expect(res.body.fired.reg).toBeUndefined();

    // When  서버 시각이 예약 시각을 지난다
    await travelTo(at + 60_000);
    const after = await api<EventMeta>(`/api/host/events/${res.body.id}`, { cookie: master });
    // Then  phase 가 "reg" 로 바뀌고 전환 시각이 기록된다
    expect(after.body.phase).toBe("reg");
    const firedAt = after.body.fired.reg;
    expect(firedAt).toBeGreaterThan(0);

    // And   한 번 더 조회해도 fired.reg 는 덮어써지지 않는다
    await travelTo(at + 120_000);
    const again = await api<EventMeta>(`/api/host/events/${res.body.id}`, { cookie: master });
    expect(again.body.fired.reg).toBe(firedAt);
  });

  it("S-B6 일정 순서가 뒤집히면 거부한다", async () => {
    // Given 등록 시작이 마감보다 뒤다
    const now = Date.now();
    const res = await createEvent(master, { regOpenAt: now + 2 * HOUR, voteCloseAt: now + HOUR });
    // Then  거부된다
    expect(res.status).toBe(400);
    expect((res.body as unknown as { error: string }).error).toBe("schedule_order");
  });

  it("S-B7 ★ 같은 요청이 두 번 와도 회차는 하나만 생긴다", async () => {
    // Given 같은 입력(같은 requestId)을 준비한다
    const input = draft();
    const before = await api<EventSummary[]>("/api/host/events", { cookie: master });

    // When  연달아 두 번 보낸다
    const a = await api<EventMeta>("/api/host/events", { method: "POST", body: input, cookie: master });
    const b = await api<EventMeta>("/api/host/events", { method: "POST", body: input, cookie: master });

    // Then  둘 다 성공하고 같은 회차다
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.body.id).toBe(a.body.id);

    // And   회차는 하나만 늘었다
    const after = await api<EventSummary[]>("/api/host/events", { cookie: master });
    expect(after.body.length).toBe(before.body.length + 1);
  });

  it("S-B9 기본값 되돌리기는 PIN 과 기존 회차를 건드리지 않는다", async () => {
    // Given 기본값을 바꾸고 회차를 만들었다
    await api("/api/host/defaults", {
      method: "PUT",
      cookie: master,
      body: { maxPre: 5, maxParty: 9, regOpenAfterH: 3, voteWindowH: 48 },
    });
    const ev = await createEvent(master, { config: { maxPre: 5, maxParty: 9 } });
    expect(ev.status).toBe(200);

    // When  되돌린다
    const reset = await api<{ maxPre: number; maxParty: number }>("/api/host/defaults/reset", {
      method: "POST",
      cookie: master,
    });

    // Then  콕·일정 기본값만 초기값으로 돌아간다
    expect(reset.status).toBe(200);
    expect(reset.body.maxPre).toBe(3);
    expect(reset.body.maxParty).toBe(3);

    // And   공통 PIN 은 그대로다 (그대로여야 로그인이 계속 된다)
    const relogin = await login(MASTER_PIN);
    expect(relogin.status).toBe(200);

    // And   기존 회차 설정도 그대로다
    const kept = await api<EventMeta>(`/api/host/events/${ev.body.id}`, { cookie: master });
    expect(kept.body.config).toEqual({ maxPre: 5, maxParty: 9 });
  });
});

// ─────────────────────────────────────────── C. 입장 코드

describe("C. 입장 코드", () => {
  it("S-C1 유효한 코드로 회차를 찾는다", async () => {
    // Given 등록 중인 회차가 있다
    const ev = await createEvent(master, { regOpenAt: "now", voteCloseAt: Date.now() + 24 * HOUR });
    // When  코드로 조회한다
    const res = await api<PublicEvent>(`/api/events/by-code/${ev.body.code}`);
    // Then  200 이고 이름과 phase 를 받는다
    expect(res.status).toBe(200);
    expect(res.body.name).toBe(ev.body.name);
    expect(res.body.phase).toBe("reg");
  });

  it("S-C2 ★ 코드 조회 응답에 비밀이 없다", async () => {
    // Given 회차 PIN 이 "5678" 인 등록 중 회차가 있다
    const ev = await createEvent(master, {
      pin: "5678",
      regOpenAt: "now",
      voteCloseAt: Date.now() + 24 * HOUR,
    });
    // When  인증 없이 코드로 조회한다
    const res = await api<PublicEvent>(`/api/events/by-code/${ev.body.code}`);
    // 빈 응답이면 "비밀이 없다"가 저절로 참이 된다. 먼저 진짜 응답인지 확인한다
    expect(res.status).toBe(200);
    expect(res.body.name).toBe(ev.body.name);
    expect(res.body.phase).toBe("reg");
    const raw = JSON.stringify(res.body);

    // Then  PIN 이 없다
    expect(raw).not.toContain("5678");
    expect(raw).not.toContain(MASTER_PIN);
    // And   개인정보·콕 기록으로 이어질 필드가 없다
    for (const leak of ["pin", "phone", "insta", "realName", "players", "pokes"]) {
      expect(Object.keys(res.body as object)).not.toContain(leak);
    }
  });

  it("S-C3 없는 코드는 알려준다", async () => {
    // When  없는 코드로 조회한다
    const res = await api<{ error: string; message: string }>("/api/events/by-code/ZZZZZZ");
    // Then  404 이고 메시지는 ENTRY.notFound 다
    expect(res.status).toBe(404);
    expect(res.body.message).toBe(ENTRY.notFound);
  });

  it("S-C4 준비 중인 회차는 등록을 막고 안내한다", async () => {
    // Given 준비 중이고 등록 시작이 예약돼 있다
    const at = Date.now() + 5 * HOUR;
    const ev = await createEvent(master, { regOpenAt: at, voteCloseAt: at + 24 * HOUR });
    expect(ev.body.phase).toBe("prep");
    // When  코드로 조회한다
    const res = await api<PublicEvent>(`/api/events/by-code/${ev.body.code}`);
    // Then  등록 불가이고 ENTRY.notOpenYet 형태의 안내가 온다
    expect(res.body.canRegister).toBe(false);
    expect(res.body.message).toMatch(/부터 등록이 열립니다\.$/);
  });

  it("S-C5 종료된 회차는 닫혔다고 알려준다", async () => {
    // Given 발표까지 끝난 회차가 있다
    const ev = await createEvent(master, { regOpenAt: "now", voteCloseAt: Date.now() + HOUR });
    const done = await api(`/api/host/events/${ev.body.id}/phase`, {
      method: "POST",
      cookie: master,
      body: { to: "done" },
    });
    expect(done.status).toBe(200);
    // When  코드로 조회한다
    const res = await api<PublicEvent>(`/api/events/by-code/${ev.body.code}`);
    // Then  등록 불가이고 메시지는 ENTRY.finished 다
    expect(res.body.canRegister).toBe(false);
    expect(res.body.message).toBe(ENTRY.finished);
  });

  it("S-C6 코드는 대소문자를 가리지 않는다", async () => {
    // Given 코드가 대문자로 발급됐다
    const ev = await createEvent(master, { regOpenAt: "now", voteCloseAt: Date.now() + 24 * HOUR });
    // When  소문자로 조회한다
    const res = await api<PublicEvent>(`/api/events/by-code/${ev.body.code.toLowerCase()}`);
    // Then  같은 회차를 찾는다
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(ev.body.id);
  });
});

// ─────────────────────────────────────────── D. 서버 시각

describe("D. 서버 시각", () => {
  it("S-D1 모든 응답이 서버 시각을 싣는다", async () => {
    // When  아무 /api 응답이나 받는다
    const res = await api("/api/health");
    // Then  x-server-time 헤더가 있다
    expect(res.serverTime).toBeGreaterThan(0);
  });

  it("S-D2 ★ 클라이언트가 주장하는 시각으로는 단계가 바뀌지 않는다", async () => {
    // Given 등록 시작이 5시간 뒤로 예약돼 있다
    const at = Date.now() + 5 * HOUR;
    const ev = await createEvent(master, { regOpenAt: at, voteCloseAt: at + 24 * HOUR });
    expect(ev.body.phase).toBe("prep");

    // When  클라이언트가 자기 시각을 미래로 주장하며 조회한다
    const res = await api<PublicEvent>(`/api/events/by-code/${ev.body.code}`, {
      headers: { "x-client-now": String(at + 10 * HOUR), date: new Date(at + 10 * HOUR).toUTCString() },
    });

    // Then  phase 는 여전히 "prep" 이다
    expect(res.body.phase).toBe("prep");
    expect(res.body.canRegister).toBe(false);
  });
});
