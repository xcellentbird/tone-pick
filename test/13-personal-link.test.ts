/**
 * 슬라이스 13 — 참가 링크는 사람마다 다르다 (ADR-32)
 *
 * 시나리오: docs/scenarios/13-personal-link.md
 *
 * **번호를 아는 사람이 그 사람이 될 수 있었다** (ADR-15 후기 2).
 * 여기 붙는 것은 그 구멍이 닫혔는가 하나뿐이다 — 공개 표면에만 붙인다.
 */
import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { ENTRY } from "../src/shared/copy.ts";
import type {
  CreateEventInput,
  EnterResult,
  EventMeta,
  Invite,
  ParticipantState,
  PublicEvent,
  RegisterInput,
  RegisterResult,
} from "../src/shared/types.ts";

const MASTER_PIN = "1234";
const HOUR = 3600_000;
const DAY = 24 * HOUR;

interface Res<T> {
  status: number;
  body: T;
  cookie: string | null;
}

async function api<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; cookie?: string | null } = {},
): Promise<Res<T>> {
  const res = await SELF.fetch(`https://tone-pick.test${path}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", ...(init.cookie ? { cookie: init.cookie } : {}) },
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
  return { status: res.status, body: body as T, cookie: set ? set.split(";")[0] : null };
}

let master: string | null = null;
let seq = 0;

beforeEach(async () => {
  master = (await api<{ scope: unknown }>("/api/host/pin", { method: "POST", body: { pin: MASTER_PIN } })).cookie;
});

async function freshEvent(over: Partial<CreateEventInput> = {}): Promise<EventMeta> {
  seq++;
  const now = Date.now();
  const res = await api<EventMeta>("/api/host/events", {
    method: "POST",
    cookie: master,
    body: {
      name: `${seq}회차`,
      partyAt: now + 7 * DAY,
      prevoteAt: now + 25 * HOUR,
      config: { maxPre: 3, maxParty: 3 },
      requestId: `r13-${seq}-${now}`,
      ...over,
    } satisfies CreateEventInput,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

let phoneSeq = 0;
const nextPhone = () => `0101000${String(1000 + phoneSeq++).slice(-4)}`;

/** 명단에 넣고 **그 줄의 토큰**을 돌려준다. 토큰은 넣는 순간 생긴다 */
async function invite(eventId: string, phone: string): Promise<Invite> {
  const res = await api<Invite[]>(`/api/host/events/${eventId}/invites`, {
    method: "POST",
    cookie: master,
    body: { phones: [phone] },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const row = res.body.find((i) => i.phone === phone);
  expect(row, "명단 행에 토큰이 있어야 한다").toBeTruthy();
  return row as Invite;
}

/** 명단은 운영자 회차 상태에 실려 온다 — 별도 조회 API 를 만들지 않았다 */
async function hostInvites(eventId: string): Promise<Invite[]> {
  const res = await api<{ invites: Invite[] }>(`/api/host/events/${eventId}/state`, { cookie: master });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.invites;
}

async function enter(eventId: string, token: string) {
  return api<EnterResult>(`/api/events/${eventId}/enter`, { method: "POST", body: { token } });
}

function person(over: Partial<RegisterInput> = {}): RegisterInput {
  seq++;
  return {
    nickname: `사람${String.fromCharCode(0xac00 + (seq % 1000))}`,
    realName: "홍길동",
    age: 30,
    gender: "M",
    instagram: `ig${seq}`,
    mbti: "INFP",
    charms: ["요리를 잘해요", "잘 웃어요", "노래를 좋아해요"],
    ...over,
  };
}

// ─────────────────────────────────────────── A. 문

describe("A. 문", () => {
  it("S-A1 ★ 토큰이 없으면 열리지 않는다 — 회차 정보도 함께 닫힌다", async () => {
    const ev = await freshEvent();

    // When  토큰 없이 회차 정보를 조회한다
    const info = await api<{ message?: string }>(`/api/events/by-id/${ev.id}`);
    // Then  열리지 않는다. 회차 아이디만으로 파티가 열리면 토큰을 만든 의미가 없다
    expect(info.status).not.toBe(200);

    // And   토큰 없이 입장할 수도 없다
    const gate = await api<EnterResult>(`/api/events/${ev.id}/enter`, { method: "POST", body: {} });
    expect(gate.status).not.toBe(200);
    expect(gate.cookie).toBeNull();
  });

  it("S-A2 ★ 토큰이 곧 그 사람이다 — 남의 토큰으로 등록하면 그 사람의 번호가 저장된다", async () => {
    const ev = await freshEvent();
    const phoneA = nextPhone();
    const phoneB = nextPhone();
    await invite(ev.id, phoneA);
    const b = await invite(ev.id, phoneB);

    // When  B 의 토큰으로 들어가 등록한다
    const gate = await enter(ev.id, b.token);
    expect(gate.status, JSON.stringify(gate.body)).toBe(200);
    const reg = await api<RegisterResult>("/api/register", {
      method: "POST",
      cookie: gate.cookie,
      body: person(),
    });
    expect(reg.status, JSON.stringify(reg.body)).toBe(200);

    // Then  그 사람은 B 다. 명단에서 B 의 줄에 닉네임이 붙는다
    const list = await hostInvites(ev.id);
    expect(list.find((i) => i.phone === phoneB)?.nickname).toBe(reg.body.state.me.nickname);
    expect(list.find((i) => i.phone === phoneA)?.nickname).toBeUndefined();
  });

  it("S-A3 ★ 등록에 phone 을 밀어넣어도 토큰이 이긴다", async () => {
    const ev = await freshEvent();
    const mine = nextPhone();
    const other = nextPhone();
    const me = await invite(ev.id, mine);
    await invite(ev.id, other);

    // When  내 토큰으로 들어가서, 등록 API 에 남의 번호를 함께 보낸다
    const gate = await enter(ev.id, me.token);
    const reg = await api<RegisterResult>("/api/register", {
      method: "POST",
      cookie: gate.cookie,
      body: { ...person(), phone: other } as RegisterInput,
    });
    expect(reg.status, JSON.stringify(reg.body)).toBe(200);

    // Then  저장된 번호는 토큰의 번호다. 밀어넣은 값은 자리가 없다
    const list = await hostInvites(ev.id);
    expect(list.find((i) => i.phone === mine)?.nickname).toBe(reg.body.state.me.nickname);
    expect(list.find((i) => i.phone === other)?.nickname).toBeUndefined();
  });

  it("S-A4 ★ 실패 문구는 하나뿐이다", async () => {
    const ev = await freshEvent();
    const said = new Set<string>();

    // 없는 토큰 / 다른 회차의 토큰 / 없는 회차
    const otherEv = await freshEvent();
    const otherToken = (await invite(otherEv.id, nextPhone())).token;

    for (const [id, token] of [
      [ev.id, "0".repeat(32)],
      [ev.id, otherToken],
      ["ffffffffffffffff", "0".repeat(32)],
    ] as const) {
      const res = await api<{ message?: string }>(`/api/events/${id}/enter`, {
        method: "POST",
        body: { token },
      });
      expect(res.status).not.toBe(200);
      said.add(res.body.message ?? "");
    }

    // Then  셋이 같은 문장이다. 구분해 주면 그 구분이 곧 답이 된다
    expect([...said]).toEqual([ENTRY.notInvited]);
  });

  it("S-A5 ★ 명단에서 지워도 등록한 사람은 자기 링크로 들어온다", async () => {
    const ev = await freshEvent();
    const phone = nextPhone();
    const row = await invite(ev.id, phone);
    const gate = await enter(ev.id, row.token);
    const reg = await api<RegisterResult>("/api/register", {
      method: "POST",
      cookie: gate.cookie,
      body: person(),
    });
    expect(reg.status).toBe(200);

    // When  운영자가 명단에서 그 번호를 지운다
    const del = await api(`/api/host/events/${ev.id}/invites/${phone}`, { method: "DELETE", cookie: master });
    expect(del.status).toBe(200);

    // Then  그는 자기 링크로 계속 들어온다. 명단은 문이지 자격이 아니다
    const again = await enter(ev.id, row.token);
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body.registered).toBe(true);
  });

  it("S-A8 ★ 세션 쿠키 어디에도 전화번호가 없다", async () => {
    /*
     * 세션은 **서명만 하고 암호화하지 않는다** (auth.ts). HttpOnly 라 JS 로는 못 읽지만
     * 개발자 도구 Application 탭에서는 페이로드가 그대로 읽힌다.
     * 참가자가 번호를 치지 않기로 했으면(ADR-32) 번호가 브라우저에 남을 이유도 없다.
     */
    const ev = await freshEvent();
    const phone = nextPhone();
    const row = await invite(ev.id, phone);

    const read = (cookie: string | null) => {
      expect(cookie, "쿠키가 있어야 이 테스트가 의미를 가진다").toBeTruthy();
      const value = cookie!.slice(cookie!.indexOf("=") + 1);
      const payload = value.split(".")[0];
      return atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    };

    // 등록 전 — 초대 쿠키
    const gate = await enter(ev.id, row.token);
    expect(gate.status, JSON.stringify(gate.body)).toBe(200);
    expect(read(gate.cookie)).not.toContain(phone);

    // 등록 후 — 참가자 쿠키
    const reg = await api<RegisterResult>("/api/register", {
      method: "POST",
      cookie: gate.cookie,
      body: person(),
    });
    expect(reg.status, JSON.stringify(reg.body)).toBe(200);
    expect(read(reg.cookie)).not.toContain(phone);

    // 그래도 등록은 그 번호로 됐다 — 번호는 회차 DO 안에서만 풀린다
    const list = await hostInvites(ev.id);
    expect(list.find((i) => i.phone === phone)?.nickname).toBe(reg.body.state.me.nickname);
  });

  it("S-A7 이미 등록한 사람은 곧바로 자기 화면으로 간다", async () => {
    const ev = await freshEvent();
    const row = await invite(ev.id, nextPhone());
    const first = await enter(ev.id, row.token);
    await api<RegisterResult>("/api/register", { method: "POST", cookie: first.cookie, body: person() });

    const again = await enter(ev.id, row.token);
    expect(again.body.registered).toBe(true);
    expect(again.body.code).toBe(ev.code);
  });
});

// ─────────────────────────────────────────── A2. 한 기기, 여러 회차

describe("A2. 한 기기로 여러 회차", () => {
  /*
   * 같은 사람이 여러 회차에 온다. **참가자 세션은 브라우저에 하나뿐**이라
   * 다음 회차에 들어가면 앞의 세션이 덮인다 — 그래도 각자의 링크만 있으면 오갈 수 있어야 한다.
   * 링크가 그 사람의 신원이라(ADR-32) 되찾는 데 다른 재료가 필요하지 않다.
   */
  it("S-A9 ★ 회차를 오가도 각자의 링크로 자기 화면에 돌아온다", async () => {
    const a = await freshEvent();
    const b = await freshEvent();
    const phone = nextPhone();   // 같은 사람이 두 회차에 초대됐다
    const linkA = (await invite(a.id, phone)).token;
    const linkB = (await invite(b.id, phone)).token;

    // A 에 등록한다
    const gateA = await enter(a.id, linkA);
    const regA = await api<RegisterResult>("/api/register", {
      method: "POST",
      cookie: gateA.cookie,
      body: person(),
    });
    expect(regA.status, JSON.stringify(regA.body)).toBe(200);
    expect((await api(`/api/me?event=${a.id}`, { cookie: regA.cookie })).status).toBe(200);

    // B 에 등록한다 — 앞 세션을 들고 가도 B 의 링크가 이긴다
    const gateB = await enter(b.id, linkB);
    expect(gateB.status, JSON.stringify(gateB.body)).toBe(200);
    const regB = await api<RegisterResult>("/api/register", {
      method: "POST",
      cookie: gateB.cookie,
      body: person(),
    });
    expect(regB.status, JSON.stringify(regB.body)).toBe(200);

    // 이제 B 의 세션이다. A 는 그 세션으로 열리지 않는다 — 자료가 섞이면 안 된다
    expect((await api(`/api/me?event=${b.id}`, { cookie: regB.cookie })).status).toBe(200);
    expect((await api(`/api/me?event=${a.id}`, { cookie: regB.cookie })).status).toBe(401);

    // A 의 링크를 다시 열면 곧바로 A 로 돌아온다. 등록을 다시 하지 않는다
    const backA = await enter(a.id, linkA);
    expect(backA.body.registered).toBe(true);
    expect(backA.body.code).toBe(a.code);
    expect((await api(`/api/me?event=${a.id}`, { cookie: backA.cookie })).status).toBe(200);
  });

  it("S-A11 링크를 다시 연 사람에게 화면이 등록을 다시 시키지 않는다", async () => {
    const ev = await freshEvent();
    const link = (await invite(ev.id, nextPhone())).token;

    // 아직 등록 전
    const before = await api<PublicEvent>(`/api/events/by-id/${ev.id}?t=${link}`);
    expect(before.body.registered).toBeFalsy();

    const gate = await enter(ev.id, link);
    await api<RegisterResult>("/api/register", { method: "POST", cookie: gate.cookie, body: person() });

    // 등록한 뒤 — 화면이 `등록하기` 대신 `다시 입장하기` 를 고를 수 있어야 한다
    const after = await api<PublicEvent>(`/api/events/by-id/${ev.id}?t=${link}`);
    expect(after.body.registered).toBe(true);
  });

  it("S-A10 ★ 세션이 없어도 링크만 열면 자기 화면으로 돌아온다", async () => {
    // 세션 만료와 같은 상태다 — 쿠키를 아예 들고 가지 않는다
    const ev = await freshEvent();
    const link = (await invite(ev.id, nextPhone())).token;
    const gate = await enter(ev.id, link);
    await api<RegisterResult>("/api/register", { method: "POST", cookie: gate.cookie, body: person() });

    const back = await enter(ev.id, link);   // 쿠키 없음
    expect(back.status).toBe(200);
    expect(back.body.registered).toBe(true);
    expect((await api(`/api/me?event=${ev.id}`, { cookie: back.cookie })).status).toBe(200);
  });
});

// ─────────────────────────────────────────── B. 안내문

describe("B. 안내문", () => {
  it("S-B1 ★ 명단에 번호를 넣으면 토큰이 생긴다 — 그리고 그뿐이다", async () => {
    const ev = await freshEvent();
    const row = await invite(ev.id, nextPhone());

    // Then  토큰이 있고, 추측할 수 없을 만큼 길다
    expect(row.token).toMatch(/^[0-9a-f]{32}$/);
    // And   보낸 적이 없다 — 명단에 넣는 것은 발송이 아니다
    expect(row.sentAt).toBeUndefined();
  });

  it("S-B1b ★ 토큰은 사람마다 다르다", async () => {
    const ev = await freshEvent();
    const tokens = new Set<string>();
    for (let i = 0; i < 5; i++) tokens.add((await invite(ev.id, nextPhone())).token);
    expect(tokens.size).toBe(5);
  });

  it("S-B3 ★ 보냄 표시는 남는다", async () => {
    const ev = await freshEvent();
    const phone = nextPhone();
    await invite(ev.id, phone);

    // When  운영자가 보냄을 체크한다
    const mark = await api<Invite[]>(`/api/host/events/${ev.id}/invites/${phone}/sent`, {
      method: "POST",
      cookie: master,
      body: { sent: true },
    });
    expect(mark.status, JSON.stringify(mark.body)).toBe(200);

    // Then  다시 읽어도 남아 있다
    const list = await hostInvites(ev.id);
    expect(list.find((i) => i.phone === phone)?.sentAt).toBeTypeOf("number");

    // And   되돌릴 수 있다
    await api(`/api/host/events/${ev.id}/invites/${phone}/sent`, {
      method: "POST",
      cookie: master,
      body: { sent: false },
    });
    const after = await hostInvites(ev.id);
    expect(after.find((i) => i.phone === phone)?.sentAt).toBeUndefined();
  });
});

// ─────────────────────────────────────────── C. 장소

describe("C. 장소", () => {
  it("S-C2 ★ 참가자 응답 어디에도 장소가 없다", async () => {
    const place = "홍대 어느가게";
    const ev = await freshEvent({ place } as Partial<CreateEventInput>);
    const row = await invite(ev.id, nextPhone());

    // 링크를 연 화면
    const info = await api<PublicEvent>(`/api/events/by-id/${ev.id}?t=${row.token}`);
    expect(info.status, JSON.stringify(info.body)).toBe(200);
    expect(JSON.stringify(info.body)).not.toContain(place);

    // 등록을 마친 뒤의 참가자 상태
    const gate = await enter(ev.id, row.token);
    const reg = await api<RegisterResult>("/api/register", {
      method: "POST",
      cookie: gate.cookie,
      body: person(),
    });
    expect(reg.status).toBe(200);
    const state = await api<ParticipantState>(`/api/me?event=${ev.id}`, { cookie: reg.cookie });
    expect(state.status).toBe(200);
    expect(JSON.stringify(state.body)).not.toContain(place);
  });
});
