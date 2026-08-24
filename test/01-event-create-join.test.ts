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
import { RETENTION_DAYS } from "../src/shared/constants.ts";
import type { CreateEventInput, EventMeta, EventSummary, PublicEvent } from "../src/shared/types.ts";

const MASTER_PIN = "1234";
const HOUR = 3600_000;
const DAY = 24 * HOUR;

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

/** 운영자 PIN 으로 로그인하고 세션 쿠키를 돌려준다. PIN 은 하나뿐이다 (ADR-12) */
async function login(pin: string, eventId?: string) {
  // eventId 는 옛 회차 PIN 시절의 입력이다. 지금은 서버가 무시해야 한다 — 그걸 확인하려고 남겨둔다
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
    partyAt: now + 7 * DAY,
    regOpenAt: now + HOUR,
    prevoteAt: now + 25 * HOUR,
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
  it("S-A1 운영자 PIN 으로 전체 권한을 얻는다", async () => {
    // Given 운영자 PIN 이 "1234" 다
    // When  회차 목록 화면에서 "1234" 를 입력한다
    const res = await login(MASTER_PIN);
    // Then  scope 는 { kind: "master" } 다
    expect(res.status).toBe(200);
    expect(res.body.scope).toEqual({ kind: "master" });
    // And   회차 목록을 조회할 수 있다
    const list = await api<EventSummary[]>("/api/host/events", { cookie: res.cookie });
    expect(list.status).toBe(200);
  });

  it("S-A2 ★ 회차별 PIN 은 없다 — 운영자 PIN 하나로 모든 회차를 연다", async () => {
    // Given 회차가 둘 있다
    const x = await createEvent(master);
    const y = await createEvent(master);
    expect(x.status).toBe(200);

    // When  회차 X 화면에서 운영자 PIN 을 넣는다 (옛 회차 PIN 자리에 eventId 를 함께 보내도)
    const auth = await login(MASTER_PIN, x.body.id);

    // Then  얻는 권한은 언제나 master 뿐이다. eventId 는 권한에 영향을 주지 않는다
    expect(auth.status).toBe(200);
    expect(auth.body.scope).toEqual({ kind: "master" });

    // And   두 회차 모두 열리고 목록도 열린다
    expect((await api(`/api/host/events/${x.body.id}`, { cookie: auth.cookie })).status).toBe(200);
    expect((await api(`/api/host/events/${y.body.id}`, { cookie: auth.cookie })).status).toBe(200);
    expect((await api("/api/host/events", { cookie: auth.cookie })).status).toBe(200);
  });

  it("S-A3 ★ 회차 아이디를 안다고 권한이 생기지 않는다", async () => {
    // Given 회차가 있고, 그 아이디를 아는 사람이 있다
    const x = await createEvent(master);

    // When  아무 번호나 그 회차 아이디와 함께 보낸다
    for (const guess of ["0000", "7777", "9999"]) {
      const auth = await login(guess, x.body.id);
      // Then  운영자 PIN 이 아니면 401 이다. 회차 단위의 뒷문은 없다
      expect(auth.status).toBe(401);
      expect(auth.cookie).toBeNull();
    }
  });

  it("S-A4 틀린 PIN 은 거부하고 정답을 흘리지 않는다", async () => {
    // When  틀린 번호를 입력한다
    const res = await api<{ error: string; message?: string }>("/api/host/pin", {
      method: "POST",
      body: { pin: "9999" },
    });
    // Then  401 이고 메시지는 HOST.pin.wrong 이다
    expect(res.status).toBe(401);
    expect(res.body.message).toBe(HOST.pin.wrong);
    // And   응답 어디에도 올바른 PIN 이 들어 있지 않다
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
    // Given 기본값이 { maxPre:1, maxParty:2, regOpenBeforeD:6, prevoteBeforeH:20 } 다
    const res = await api<{ maxPre: number; maxParty: number; regOpenBeforeD: number; prevoteBeforeH: number }>(
      "/api/host/defaults",
      { cookie: master },
    );
    // Then  위저드가 채워 넣을 값을 그대로 돌려준다 — 등록은 파티 6일 전에 연다
    expect(res.status).toBe(200);
    expect(res.body.maxPre).toBe(1);
    expect(res.body.maxParty).toBe(2);
    expect(res.body.regOpenBeforeD).toBe(6);
    expect(res.body.prevoteBeforeH).toBe(20);
  });

  it("S-B2 ★ 회차를 만들 때 회차 PIN 을 받지 않는다", async () => {
    // When  옛 입력대로 회차 PIN 을 함께 보낸다
    const legacy = { ...draft(), pin: "5678" };
    const res = await api<EventMeta>("/api/host/events", { method: "POST", body: legacy, cookie: master });
    // Then  회차는 만들어지되, 그 번호로는 아무 문도 열리지 않는다
    expect(res.status).toBe(200);
    expect((await login("5678", res.body.id)).status).toBe(401);
    // And   응답에 PIN 이 남지 않는다
    expect(JSON.stringify(res.body)).not.toContain("5678");
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
    const res = await createEvent(master, { regOpenAt: "now", prevoteAt: Date.now() + 24 * HOUR });
    // Then  phase 는 "reg" 이고 fired.reg 가 채워져 있다
    expect(res.status).toBe(200);
    expect(res.body.phase).toBe("reg");
    expect(res.body.fired.reg).toBeGreaterThan(0);
    // And   그 코드로 즉시 입장할 수 있다
    const pub = await api<PublicEvent>(`/api/events/by-id/${res.body.id}`);
    expect(pub.body.canRegister).toBe(true);
  });

  it("S-B5 ★ 예약은 한 번만 울린다", async () => {
    // Given 등록 시작을 1시간 뒤로 예약한다
    const at = Date.now() + HOUR;
    const res = await createEvent(master, { regOpenAt: at, prevoteAt: at + 24 * HOUR });
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
    // Given 등록 시작이 사전 투표 시작보다 뒤다
    const now = Date.now();
    const res = await createEvent(master, { regOpenAt: now + 2 * HOUR, prevoteAt: now + HOUR });
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

  it("S-B9 기본값 되돌리기는 기존 회차를 건드리지 않는다", async () => {
    // Given 기본값을 바꾸고 회차를 만들었다
    await api("/api/host/defaults", {
      method: "PUT",
      cookie: master,
      body: { maxPre: 5, maxParty: 9, regOpenBeforeD: 3, prevoteBeforeH: 48 },
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
    expect(reset.body.maxPre).toBe(1);
    expect(reset.body.maxParty).toBe(2);

    // And   로그인은 그대로 된다 — PIN 은 기본 설정이 아니라 배포 시크릿이다
    const relogin = await login(MASTER_PIN);
    expect(relogin.status).toBe(200);

    // And   기존 회차 설정도 그대로다
    const kept = await api<EventMeta>(`/api/host/events/${ev.body.id}`, { cookie: master });
    expect(kept.body.config).toEqual({ maxPre: 5, maxParty: 9 });
  });

  /**
   * 만들 때 고른 설정은 **버려지지 않는다.**
   *
   * 파기 대기 일수는 참가자에게 한 약속이다 — 등록 화면이 이 숫자를 읽는다.
   * 7일로 골라 놓은 회차가 조용히 3일짜리가 되면, 그 사실은 회차가 사라진 뒤에야 드러난다.
   * 콕 대상도 같다. 등록이 열린 뒤에 고치면 이미 명단을 훑은 사람의 전제가 바뀐다.
   */
  it("★ 만들 때 고른 콕 대상·파기 대기 일수가 그대로 저장된다", async () => {
    const ev = await createEvent(master, {
      config: { maxPre: 3, maxParty: 3, allowSameGender: false, retentionDays: 7 },
    });
    expect(ev.status).toBe(200);

    const got = await api<EventMeta>(`/api/host/events/${ev.body.id}`, { cookie: master });
    expect(got.body.config.allowSameGender).toBe(false);
    expect(got.body.config.retentionDays).toBe(7);
  });

  it("기본값과 같으면 적지 않는다 — 설정 모양이 회차마다 달라지지 않게", async () => {
    const ev = await createEvent(master, {
      config: { maxPre: 3, maxParty: 3, allowSameGender: true, retentionDays: RETENTION_DAYS },
    });
    const got = await api<EventMeta>(`/api/host/events/${ev.body.id}`, { cookie: master });
    expect(got.body.config).toEqual({ maxPre: 3, maxParty: 3 });
  });

  it("파기 대기 일수가 범위 밖이면 회차를 만들지 않는다", async () => {
    for (const retentionDays of [0, 15, 1.5]) {
      const res = await createEvent(master, { config: { maxPre: 3, maxParty: 3, retentionDays } });
      expect(res.status, `retentionDays=${retentionDays}`).toBe(400);
    }
  });
});

// ─────────────────────────────────────────── C. 입장 코드

describe("C. 입장 코드", () => {
  it("S-C1 유효한 코드로 회차를 찾는다", async () => {
    // Given 등록 중인 회차가 있다
    const ev = await createEvent(master, { regOpenAt: "now", prevoteAt: Date.now() + 24 * HOUR });
    // When  코드로 조회한다
    const res = await api<PublicEvent>(`/api/events/by-id/${ev.body.id}`);
    // Then  200 이고 이름과 phase 를 받는다
    expect(res.status).toBe(200);
    expect(res.body.name).toBe(ev.body.name);
    expect(res.body.phase).toBe("reg");
  });

  it("S-C2 ★ 코드 조회 응답에 비밀이 없다", async () => {
    // Given 등록 중인 회차가 있다
    const ev = await createEvent(master, { regOpenAt: "now", prevoteAt: Date.now() + 24 * HOUR });
    // When  인증 없이 코드로 조회한다
    const res = await api<PublicEvent>(`/api/events/by-id/${ev.body.id}`);
    // 빈 응답이면 "비밀이 없다"가 저절로 참이 된다. 먼저 진짜 응답인지 확인한다
    expect(res.status).toBe(200);
    expect(res.body.name).toBe(ev.body.name);
    expect(res.body.phase).toBe("reg");
    const raw = JSON.stringify(res.body);

    // Then  PIN 이 없다
    expect(raw).not.toContain(MASTER_PIN);
    // And   개인정보·콕 기록으로 이어질 필드가 없다
    for (const leak of ["pin", "phone", "insta", "realName", "players", "pokes"]) {
      expect(Object.keys(res.body as object)).not.toContain(leak);
    }
  });

  it("S-C2b ★ 참가 링크 응답에 입장 코드가 없다", async () => {
    // Given 등록 중인 회차가 있다. 참가 링크는 회차 아이디만 담는다 (ADR-13)
    const ev = await createEvent(master, { regOpenAt: "now", prevoteAt: Date.now() + 24 * HOUR });

    // When  링크를 받은 사람이 인증 없이 그 회차를 연다
    const res = await api<PublicEvent>(`/api/events/by-id/${ev.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe(ev.body.name);

    // Then  코드가 응답 어디에도 없다 — 있으면 링크 하나로 문이 열린다
    expect(JSON.stringify(res.body)).not.toContain(ev.body.code);
    expect(Object.keys(res.body as object)).not.toContain("code");
  });

  it("★ S-C3 코드로 회차를 찾는 길이 없다", async () => {
    /*
     * 그 응답에는 **회차 아이디**가 들어 있었다 — 30비트 코드(32^6)를 뚫으면
     * 64비트 링크가 그대로 나왔다. 링크의 강도가 코드까지 내려가 있던 셈이다.
     * 이제 문은 참가 링크 하나뿐이다 (ADR-13·15).
     */
    const ev = await createEvent(master, { regOpenAt: "now", prevoteAt: Date.now() + 24 * HOUR });
    // 실재하는 회차의 **진짜 코드**로도 찾을 수 없다 — 코드가 틀려서가 아니라 길이 없어서다
    expect((await api(`/api/events/by-code/${ev.body.code}`)).status).toBe(404);
  });

  it("S-C4 준비 중인 회차는 등록을 막고 안내한다", async () => {
    // Given 준비 중이고 등록 시작이 예약돼 있다
    const at = Date.now() + 5 * HOUR;
    const ev = await createEvent(master, { regOpenAt: at, prevoteAt: at + 24 * HOUR });
    expect(ev.body.phase).toBe("prep");
    // When  코드로 조회한다
    const res = await api<PublicEvent>(`/api/events/by-id/${ev.body.id}`);
    // Then  등록 불가이고 ENTRY.notOpenYet 형태의 안내가 온다
    expect(res.body.canRegister).toBe(false);
    expect(res.body.message).toMatch(/부터 등록이 열려요\.$/);
  });

  it("S-C5 종료된 회차는 닫혔다고 알려준다", async () => {
    // Given 발표까지 끝난 회차가 있다
    const ev = await createEvent(master, { regOpenAt: "now", prevoteAt: Date.now() + HOUR });
    const done = await api(`/api/host/events/${ev.body.id}/phase`, {
      method: "POST",
      cookie: master,
      body: { to: "done" },
    });
    expect(done.status).toBe(200);
    // When  코드로 조회한다
    const res = await api<PublicEvent>(`/api/events/by-id/${ev.body.id}`);
    // Then  등록 불가이고 메시지는 ENTRY.finished 다
    expect(res.body.canRegister).toBe(false);
    expect(res.body.message).toBe(ENTRY.finished);
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
    const ev = await createEvent(master, { regOpenAt: at, prevoteAt: at + 24 * HOUR });
    expect(ev.body.phase).toBe("prep");

    // When  클라이언트가 자기 시각을 미래로 주장하며 조회한다
    const res = await api<PublicEvent>(`/api/events/by-id/${ev.body.id}`, {
      headers: { "x-client-now": String(at + 10 * HOUR), date: new Date(at + 10 * HOUR).toUTCString() },
    });

    // Then  phase 는 여전히 "prep" 이다
    expect(res.body.phase).toBe("prep");
    expect(res.body.canRegister).toBe(false);
  });
});
