/**
 * 참석 상태 (ADR-33). 슬라이스 번호는 아직 없다 — `노쇼 체크` 를 연 것이다.
 *
 * 여기 붙는 것은 하나뿐이다: **이 값은 운영자만 본다.**
 * 참가자에게 나가면 "누가 왔나" 가 명단 밖으로 새고, 그건 이 앱이 정한 공개 범위가 아니다.
 */
import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  CreateEventInput,
  EnterResult,
  EventMeta,
  HostState,
  Invite,
  ParticipantState,
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

/**
 * 세션 쿠키는 **두 벌** 나간다 (ADR-44) — `tp_play_<이름표>` 와 이름표 없는 `tp_play`.
 * 테스트는 이름표를 보내지 않으므로 **기본 쿠키**를 집는다. 탭이 갈리는 경우는
 * `x-tp-ref` 를 직접 실어 따로 확인한다 (`test/44-tab-sessions.test.ts`).
 */
function baseCookie(res: Response): string | null {
  const all = res.headers.getSetCookie?.() ?? [];
  const one = all.map((c) => c.split(";")[0]).find((c) => /^tp_(host|play|inv)=./.test(c));
  return one ?? res.headers.get("set-cookie")?.split(";")[0] ?? null;
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
  return { status: res.status, body: body as T, cookie: baseCookie(res) };
}

let master: string | null = null;
let seq = 0;

beforeEach(async () => {
  master = (await api<{ scope: unknown }>("/api/host/pin", { method: "POST", body: { pin: MASTER_PIN } })).cookie;
});

async function freshEvent(): Promise<EventMeta> {
  seq++;
  const now = Date.now();
  const res = await api<EventMeta>("/api/host/events", {
    method: "POST",
    cookie: master,
    body: {
      name: `${seq}회차`,
      partyAt: now + 7 * DAY,
      prevoteAt: now + 25 * HOUR,
      voteEndAt: now + 7 * 24 * HOUR - HOUR,
      revealAt: now + 7 * 24 * HOUR + 3 * HOUR,
      config: { maxPre: 3, maxParty: 3 },
      requestId: `att-${seq}-${now}`,
    } satisfies CreateEventInput,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

let phoneSeq = 0;

/** 명단에 넣고 → 링크로 들어가고 → 등록한다 */
async function join(ev: EventMeta) {
  const phone = `0103000${String(1000 + phoneSeq++).slice(-4)}`;
  const added = await api<Invite[]>(`/api/host/events/${ev.id}/invites`, {
    method: "POST",
    cookie: master,
    body: { phones: [phone] },
  });
  const token = added.body.find((i) => i.phone === phone)!.token;
  const gate = await api<EnterResult>(`/api/events/${ev.id}/enter`, { method: "POST", body: { token } });
  seq++;
  const input: RegisterInput = {
    nickname: `참석${String.fromCharCode(0xac00 + (seq % 1000))}`,
    realName: "김실명",
    age: 28,
    gender: "M",
    instagram: `att_${seq}`,
    mbti: "ENFP",
    charms: ["요리를 잘해요", "잘 웃어요", "노래를 좋아해요"],
  };
  const res = await api<RegisterResult>("/api/register", { method: "POST", cookie: gate.cookie, body: input });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { cookie: res.cookie, id: res.body.state.me.id };
}

const setAttendance = (ev: EventMeta, pid: string, to: unknown) =>
  api(`/api/host/events/${ev.id}/players/${pid}/attendance`, { method: "POST", cookie: master, body: { to } });

const hostState = async (ev: EventMeta) =>
  (await api<HostState>(`/api/host/events/${ev.id}/state`, { cookie: master })).body;

describe("참석 상태", () => {
  it("★ 참가자 응답 어디에도 참석 상태가 없다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    const other = await join(ev);
    await setAttendance(ev, me.id, "arrived");
    await setAttendance(ev, other.id, "left");

    // 본인 화면 — 자기 것도 남의 것도 없다. 참가자가 그 값으로 할 일이 없다
    const state = await api<ParticipantState>(`/api/me?event=${ev.id}`, { cookie: me.cookie });
    expect(state.status).toBe(200);
    const raw = JSON.stringify(state.body);
    expect(raw).not.toContain("arrived");
    expect(raw).not.toContain("left");
    expect(raw).not.toContain("attendance");
  });

  it("★ 운영자는 본다", async () => {
    const ev = await freshEvent();
    const a = await join(ev);
    const b = await join(ev);
    await setAttendance(ev, a.id, "arrived");

    const st = await hostState(ev);
    expect(st.attendance[a.id]).toBe("arrived");
    // 안 찍힌 사람은 키가 없다 — "없음" 이 곧 안 옴이다
    expect(st.attendance[b.id]).toBeUndefined();
  });

  it("★ 세 가지 말고는 저장되지 않는다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);

    for (const bad of ["도착", "ARRIVED", true, 1, { to: "arrived" }]) {
      await setAttendance(ev, me.id, bad);
      expect((await hostState(ev)).attendance[me.id], `${JSON.stringify(bad)} 가 저장되면 안 된다`).toBeUndefined();
    }
  });

  it("되돌릴 수 있다 — 잘못 눌러도 잃는 게 없다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);

    await setAttendance(ev, me.id, "arrived");
    expect((await hostState(ev)).attendance[me.id]).toBe("arrived");
    await setAttendance(ev, me.id, "left");
    expect((await hostState(ev)).attendance[me.id]).toBe("left");
    await setAttendance(ev, me.id, null);
    expect((await hostState(ev)).attendance[me.id]).toBeUndefined();
  });

  it("★ 인증 없이 남의 참석 상태를 바꿀 수 없다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    const res = await api(`/api/host/events/${ev.id}/players/${me.id}/attendance`, {
      method: "POST",
      body: { to: "arrived" },
    });
    expect(res.status).toBe(401);
    expect((await hostState(ev)).attendance[me.id]).toBeUndefined();
  });
});
