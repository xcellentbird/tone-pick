/**
 * 슬라이스 14·27 — 운영자가 보내는 알림과 설문 (ADR-88)
 *
 * 이 파일이 지키는 건 셋이다.
 *
 *   · **누가 무엇을 골랐는지는 운영자만 본다.** 뒤풀이 인원을 세려면 이름이 필요하다 — 운영자의
 *     공개 범위는 원래 전체다(원칙 2). 참가자 응답에는 남의 답도, 몇 명인지도 없다
 *   · 한 사람은 한 표다 — 다시 고르면 옮겨간다
 *   · 설문 여러 개가 함께 열려 있을 수 있다. 닫는 건 운영자가 누른다
 */
import { fetchApp } from "./helpers/app.ts";
import { beforeAll, describe, expect, it } from "vitest";
import { hangulSeq } from "../src/shared/copy.ts";
import type {
  Invite,
  EventMeta,
  HostState,
  ParticipantState,
  PublicAnnouncement,
  RegisterInput,
  RegisterResult,
} from "../src/shared/types.ts";

const MASTER_PIN = "1234";
const HOUR = 3600_000;

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
  const res = await fetchApp(`https://tone-pick.test${path}`, {
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
let phoneSeq = 0;

beforeAll(async () => {
  master = (await api("/api/host/pin", { method: "POST", body: { pin: MASTER_PIN } })).cookie;
});

async function freshEvent(): Promise<EventMeta> {
  seq++;
  const res = await api<EventMeta>("/api/host/events", {
    method: "POST",
    cookie: master,
    body: {
      name: `알림${seq}회차`,
      partyAt: Date.now() + 3 * 24 * HOUR,
      prevoteAt: Date.now() + 24 * HOUR,
      revealAt: Date.now() + 3 * 24 * HOUR + 3 * HOUR,
      config: { maxPre: 2, maxParty: 3 },
      requestId: `a-${seq}-${Date.now()}`,
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

/** 명단에 넣고 → 입장하고 → 등록한다. 실제 참가자가 지나는 길 그대로다 */
async function join(ev: EventMeta): Promise<{ cookie: string | null; id: string }> {
  const phone = `0102000${String(1000 + ++phoneSeq)}`;
  // 명단에 넣고 번호로 문을 두드린다 (ADR-75)
  const added = await api<Invite[]>(`/api/host/events/${ev.id}/invites`, {
    method: "POST",
    cookie: master,
    body: { phones: [phone] },
  });
  expect(added.body.find((i) => i.phone === phone)).toBeTruthy();
  const gate = await api(`/api/events/${ev.id}/enter`, { method: "POST", body: { phone } });
  expect(gate.status, JSON.stringify(gate.body)).toBe(200);
  const input: RegisterInput = {
    nickname: `투표${hangulSeq(phoneSeq)}`,
    realName: "김실명",
    age: 28,
    gender: "M",
    instagram: `insta_${phoneSeq}`,
    mbti: "ENFP",
    charms: ["요리를 잘해요", "잘 웃어요", "노래를 좋아해요"],
    pin: "2468",
  };
  const res = await api<RegisterResult>("/api/register", { method: "POST", cookie: gate.cookie, body: input });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  // **등록이 새 쿠키를 준다.** 입장 쿠키를 계속 쓰면 /api/me 가 401 이고,
  // 그러면 응답에 필드가 통째로 없어서 테스트가 엉뚱한 곳을 가리킨다
  return { cookie: res.cookie ?? gate.cookie, id: res.body.state.me.id };
}

const send = (ev: EventMeta, body: unknown) =>
  api<{ id: string }>(`/api/host/events/${ev.id}/announcements`, { method: "POST", cookie: master, body });

const me = (cookie: string | null, ev: EventMeta) =>
  api<ParticipantState>(`/api/me?code=${ev.code}`, { cookie });

const hostState = (ev: EventMeta) => api<HostState>(`/api/host/events/${ev.id}/state`, { cookie: master });

const vote = (cookie: string | null, id: string, choice: "a" | "b") =>
  api<PublicAnnouncement>("/api/vote", { method: "POST", cookie, body: { id, choice } });

/**
 * 소켓 하나를 열고 받은 신호를 모은다. 쿠키가 있으면 그 참가자의 소켓이고,
 * 없으면 운영자 콘솔 쪽이다 — Worker 가 세션 쿠키를 보고 가른다.
 */
async function listen(ev: EventMeta, cookie?: string | null) {
  const res = await fetchApp(`https://tone-pick.test/ws/${ev.code}`, {
    headers: { Upgrade: "websocket", ...(cookie ? { cookie } : {}) },
  });
  const ws = res.webSocket;
  expect(ws, `소켓이 안 열렸다 (${res.status})`).toBeTruthy();
  const got: string[] = [];
  ws!.accept();
  ws!.addEventListener("message", (e) => got.push(String(e.data)));
  return got;
}

/** 소켓 신호는 응답보다 늦게 닿는다. 한 박자 기다린다 */
const settle = () => new Promise((r) => setTimeout(r, 50));

// ─────────────────────────────────────────── 텍스트

describe("텍스트 알림", () => {
  it("★ 보내면 참가자 상태에 실려 온다", async () => {
    const ev = await freshEvent();
    const p = await join(ev);
    await send(ev, { text: "와이파이 TONE\n비번 12341234" });

    const state = await me(p.cookie, ev);
    expect(state.body.announcements).toHaveLength(1);
    // 줄바꿈이 살아 있어야 한다 — 와이파이 비번은 줄을 나누는 게 읽힌다
    expect(state.body.announcements[0].text).toBe("와이파이 TONE\n비번 12341234");
    expect(state.body.announcements[0].poll).toBeUndefined();
  });

  it("★ 지우면 참가자 상태에서도 사라진다", async () => {
    // 틀린 비번이 파티 끝까지 남으면 안 된다. 파생이라 지우기만 하면 화면이 따라온다
    const ev = await freshEvent();
    const p = await join(ev);
    const made = await send(ev, { text: "틀린 비번 0000" });

    const del = await api(`/api/host/events/${ev.id}/announcements/${made.body.id}`, {
      method: "DELETE",
      cookie: master,
    });
    expect(del.status).toBe(204);
    expect((await me(p.cookie, ev)).body.announcements).toHaveLength(0);
  });

  it("빈 글은 받지 않는다", async () => {
    const ev = await freshEvent();
    expect((await send(ev, { text: "   " })).status).toBe(400);
  });

  it("최신이 먼저 온다", async () => {
    const ev = await freshEvent();
    const p = await join(ev);
    await send(ev, { text: "첫째" });
    await send(ev, { text: "둘째" });
    const list = (await me(p.cookie, ev)).body.announcements;
    expect(list.map((a) => a.text)).toEqual(["둘째", "첫째"]);
  });
});

// ─────────────────────────────────────────── 투표

describe("설문 — 두 선택지", () => {
  it("★ 누가 무엇을 골랐는지는 운영자만 본다 — 참가자 응답에는 남의 답도 숫자도 없다", async () => {
    /*
     * ADR-88 의 결정이다. 한동안 운영자 응답에서도 표의 주인을 뺐는데(슬라이스 14),
     * 뒤풀이 인원을 세려면 **누가** 간다고 했는지 알아야 한다. 참가자 쪽은 그대로다 —
     * 남의 아이디가 응답 어디에도 없는지를 **문자열째로** 뒤진다.
     */
    const ev = await freshEvent();
    const [p, q] = [await join(ev), await join(ev)];
    const made = await send(ev, { text: "2차 갈래요?", poll: { a: "갈래요", b: "못 가요" } });
    await vote(p.cookie, made.body.id, "a");
    await vote(q.cookie, made.body.id, "b");

    const host = (await hostState(ev)).body.announcements[0];
    expect(host.choices).toEqual({ [p.id]: "a", [q.id]: "b" });

    const mine = (await me(p.cookie, ev)).body.announcements[0];
    expect(mine.poll?.mine).toBe("a");
    const text = JSON.stringify(mine);
    expect(text).not.toContain(q.id);
    expect(text).not.toContain("count");
    expect(text).not.toContain("choices");
  });

  it("★ 답은 운영자에게만 알린다 — 남의 답으로 바뀌는 참가자 화면이 없다", async () => {
    /*
     * 참가자 응답에는 남의 답도 숫자도 없다 (위). 그러니 한 사람의 답에 전원이 다시 읽을 까닭이 없다 —
     * 신호 하나가 곧 인원수만큼의 재조회이고 (ADR-26), 그 읽기는 한 DO 에 줄을 선다.
     * 50명이 한꺼번에 답하면 2,500번이 콕보다 앞에 선다.
     */
    const ev = await freshEvent();
    const [p, q] = [await join(ev), await join(ev)];
    const made = await send(ev, { text: "2차 갈래요?", poll: { a: "갈래요", b: "못 가요" } });
    const host = await listen(ev);
    const other = await listen(ev, q.cookie);
    await settle();
    const [h0, o0] = [host.length, other.length];

    expect((await vote(p.cookie, made.body.id, "a")).status).toBe(200);
    await settle();

    expect(host.length, "운영자 콘솔은 누가 골랐는지 다시 읽어야 한다").toBeGreaterThan(h0);
    expect(other.slice(o0), "다른 참가자에게 신호가 갔다").toEqual([]);
  });

  it("★ 한 사람은 한 표다 — 다시 고르면 옮겨간다", async () => {
    const ev = await freshEvent();
    const p = await join(ev);
    const made = await send(ev, { text: "2부 언제?", poll: { a: "9시", b: "9시 30분" } });

    await vote(p.cookie, made.body.id, "a");
    const again = await vote(p.cookie, made.body.id, "b");

    // 마음을 바꾸는 건 실패가 아니다 — 409 가 아니라 200 이다
    expect(again.status).toBe(200);
    expect(again.body.poll?.mine).toBe("b");
    const host = (await hostState(ev)).body.announcements[0];
    expect(host.choices).toEqual({ [p.id]: "b" });
  });

  it("★ 닫으면 더 못 고른다. 답은 남는다", async () => {
    const ev = await freshEvent();
    const p = await join(ev);
    const made = await send(ev, { text: "2부 언제?", poll: { a: "9시", b: "9시 30분" } });
    await vote(p.cookie, made.body.id, "a");

    const closed = await api(`/api/host/events/${ev.id}/announcements/${made.body.id}`, {
      method: "PUT",
      cookie: master,
      body: { open: false },
    });
    expect(closed.status).toBe(200);

    const late = await vote(p.cookie, made.body.id, "b");
    expect(late.status).toBe(409);

    const seen = (await me(p.cookie, ev)).body.announcements[0];
    expect(seen.poll?.closed).toBe(true);
    expect(seen.poll?.mine).toBe("a");
    expect((await hostState(ev)).body.announcements[0].choices).toEqual({ [p.id]: "a" });
  });

  it("★ 닫은 것을 다시 열 수 있다 — 되돌릴 수 있어야 확인창이 없다", async () => {
    const ev = await freshEvent();
    const p = await join(ev);
    const made = await send(ev, { text: "게임 뭐 할까요?", poll: { a: "A", b: "B" } });
    const path = `/api/host/events/${ev.id}/announcements/${made.body.id}`;

    await api(path, { method: "PUT", cookie: master, body: { open: false } });
    await api(path, { method: "PUT", cookie: master, body: { open: true } });
    expect((await vote(p.cookie, made.body.id, "a")).status).toBe(200);
  });

  it("★ 설문 여러 개가 함께 열려 있다 — 새 설문이 앞엣것을 닫지 않는다", async () => {
    /*
     * 슬라이스 14 는 열린 설문을 하나로 묶었는데, 운영자는 파티 중에 한두 개를 나란히 묻는다
     * (다음 게임과 뒤풀이). 닫는 건 운영자가 누른다 (ADR-88).
     */
    const ev = await freshEvent();
    const p = await join(ev);
    const first = await send(ev, { text: "먼저", poll: { a: "A", b: "B" } });
    await send(ev, { text: "나중", poll: { a: "C", b: "D" } });

    expect((await vote(p.cookie, first.body.id, "a")).status).toBe(200);

    const open = (await me(p.cookie, ev)).body.announcements.filter((a) => a.poll && !a.poll.closed);
    expect(open.map((a) => a.text)).toEqual(["나중", "먼저"]);
  });

  it("텍스트 알림은 설문을 닫지 않는다", async () => {
    const ev = await freshEvent();
    const p = await join(ev);
    const poll = await send(ev, { text: "설문", poll: { a: "A", b: "B" } });
    await send(ev, { text: "그냥 알림" });
    expect((await vote(p.cookie, poll.body.id, "a")).status).toBe(200);
  });

  it("없는 설문에 답을 보내면 404 다", async () => {
    /*
     * 운영자가 방금 지웠는데 참가자 화면이 아직 옛 목록일 때 실제로 생긴다.
     *
     * ⚠️ **먼저 진짜 답을 한 번 넣는다.** 안 그러면 `/api/vote` 가 아예 없을 때도
     * 통째 404 로 통과해서, 구현이 하나도 없는데 초록불이 켜진다 (ADR-8).
     */
    const ev = await freshEvent();
    const p = await join(ev);
    const made = await send(ev, { text: "질문", poll: { a: "A", b: "B" } });
    expect((await vote(p.cookie, made.body.id, "a")).status).toBe(200);

    expect((await vote(p.cookie, "없는아이디", "a")).status).toBe(404);
  });

  it("선택지가 한쪽만 오면 받지 않는다", async () => {
    const ev = await freshEvent();
    expect((await send(ev, { text: "질문", poll: { a: "A", b: "  " } })).status).toBe(400);
  });

  it("나간 사람의 답은 세지 않는다", async () => {
    // 명단에 없는 아이디가 운영자 화면에 빈 카드로 서면 안 된다 (ADR-29 와 같은 정리)
    const ev = await freshEvent();
    const [p, q] = [await join(ev), await join(ev)];
    const made = await send(ev, { text: "2차 갈래요?", poll: { a: "갈래요", b: "못 가요" } });
    await vote(p.cookie, made.body.id, "a");
    await vote(q.cookie, made.body.id, "a");
    await api(`/api/host/events/${ev.id}/players/${q.id}`, { method: "DELETE", cookie: master });

    const host = (await hostState(ev)).body.announcements[0];
    expect(host.choices).toEqual({ [p.id]: "a" });
  });
});

// ─────────────────────────────────────────── 경계

describe("경계", () => {
  it("★ 운영자 알림은 다른 회차로 새지 않는다", async () => {
    const [one, two] = [await freshEvent(), await freshEvent()];
    const p = await join(two);
    await send(one, { text: "1번 회차 공지" });
    expect((await me(p.cookie, two)).body.announcements).toHaveLength(0);
  });

  it("★ 참가자는 알림을 보낼 수 없다", async () => {
    /*
     * ⚠️ **같은 길로 운영자가 되는 것부터 확인한다.** 라우트가 없으면 누가 두드려도
     * 404 라서, "참가자가 막혔다" 가 **아무것도 안 만든 상태에서 참이 된다** (ADR-8).
     */
    const ev = await freshEvent();
    const p = await join(ev);
    const path = `/api/host/events/${ev.id}/announcements`;
    expect((await api(path, { method: "POST", cookie: master, body: { text: "운영자 글" } })).status).toBe(200);

    const res = await api(path, { method: "POST", cookie: p.cookie, body: { text: "내가 쓰는 공지" } });
    expect([401, 403]).toContain(res.status);
  });

  it("★ 지우면 표도 함께 사라진다", async () => {
    const ev = await freshEvent();
    const p = await join(ev);
    const made = await send(ev, { text: "질문", poll: { a: "A", b: "B" } });
    await vote(p.cookie, made.body.id, "a");
    await api(`/api/host/events/${ev.id}/announcements/${made.body.id}`, { method: "DELETE", cookie: master });

    // 같은 아이디로 다시 만들 수는 없지만, 표가 남아 새 설문에 섞이면 안 된다
    const next = await send(ev, { text: "질문", poll: { a: "A", b: "B" } });
    const seen = (await me(p.cookie, ev)).body.announcements[0];
    expect(seen.id).toBe(next.body.id);
    expect(seen.poll?.mine).toBeUndefined();
    expect((await hostState(ev)).body.announcements[0].choices).toEqual({});
  });
});
