/**
 * 슬라이스 14 — 운영자가 보내는 알림 (텍스트 + A/B 투표)
 *
 * 이 파일이 보는 건 하나로 줄일 수 있다 —
 * **표는 저장되지만 사람과 함께는 어디에도 나가지 않는다.**
 *
 * 한 사람 한 표를 지키려면 `playerId → choice` 를 저장할 수밖에 없다.
 * 그 짝이 응답에 실리면 화면이 언젠가 그걸 보여준다. 그래서 참가자 응답도,
 * **운영자 응답도** 뒤진다 — 운영자는 전체를 보지만 *누가 9시를 골랐나* 를 알 이유가 없다.
 */
import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { hangulSeq } from "../src/shared/copy.ts";
import type {
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
      pin: String(4000 + seq),
      regOpenAt: "now",
      partyAt: Date.now() + 3 * 24 * HOUR,
      prevoteAt: Date.now() + 24 * HOUR,
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
  await api(`/api/host/events/${ev.id}/invites`, { method: "POST", cookie: master, body: { phones: [phone] } });
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

describe("A/B 투표", () => {
  it("★ 표는 사람과 함께 어디에도 나가지 않는다 — 운영자 응답에도", async () => {
    /*
     * 이 슬라이스의 유일한 불변식이다. 저장은 하되(한 사람 한 표를 지켜야 하므로)
     * 그 짝이 응답에 실리면 화면이 언젠가 보여준다.
     *
     * 그래서 참가자 아이디가 응답 어디에도 없는지를 **문자열째로** 뒤진다 —
     * 필드 이름을 짐작해서 보면 새 필드가 생겼을 때 그냥 지나친다.
     */
    const ev = await freshEvent();
    const p = await join(ev);
    const made = await send(ev, { text: "2부 언제?", poll: { a: "9시", b: "9시 30분" } });
    await vote(p.cookie, made.body.id, "a");

    const host = await hostState(ev);
    const ann = JSON.stringify(host.body.announcements);
    expect(ann).not.toContain(p.id);
    expect(ann).toContain('"a":1');

    const mine = JSON.stringify((await me(p.cookie, ev)).body.announcements);
    expect(mine).not.toContain(p.id);
  });

  it("★ 한 사람은 한 표다 — 다시 고르면 옮겨간다", async () => {
    const ev = await freshEvent();
    const p = await join(ev);
    const made = await send(ev, { text: "2부 언제?", poll: { a: "9시", b: "9시 30분" } });

    await vote(p.cookie, made.body.id, "a");
    const again = await vote(p.cookie, made.body.id, "b");

    // 마음을 바꾸는 건 실패가 아니다 — 409 가 아니라 200 이다
    expect(again.status).toBe(200);
    expect(again.body.poll?.count).toEqual({ a: 0, b: 1 });
    expect(again.body.poll?.mine).toBe("b");
  });

  it("★ 여러 사람의 표가 합쳐진다", async () => {
    const ev = await freshEvent();
    const [x, y, z] = [await join(ev), await join(ev), await join(ev)];
    const made = await send(ev, { text: "음악 줄일까요?", poll: { a: "네", b: "아니요" } });

    await vote(x.cookie, made.body.id, "a");
    await vote(y.cookie, made.body.id, "a");
    const last = await vote(z.cookie, made.body.id, "b");
    expect(last.body.poll?.count).toEqual({ a: 2, b: 1 });

    // 남의 선택은 내 응답에 없다. 숫자만 같다
    const seen = (await me(x.cookie, ev)).body.announcements[0];
    expect(seen.poll?.count).toEqual({ a: 2, b: 1 });
    expect(seen.poll?.mine).toBe("a");
  });

  it("★ 닫으면 더 못 고른다. 숫자는 남는다", async () => {
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
    expect(seen.poll?.count).toEqual({ a: 1, b: 0 });
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

  it("★ 새 투표를 올리면 앞엣것이 닫힌다 — 열린 투표는 한 번에 하나다", async () => {
    /*
     * 둘이 동시에 열려 있으면 참가자는 무엇에 답해야 하는지,
     * 운영자는 어느 집계를 보는지 헷갈린다.
     */
    const ev = await freshEvent();
    const p = await join(ev);
    const first = await send(ev, { text: "먼저", poll: { a: "A", b: "B" } });
    await send(ev, { text: "나중", poll: { a: "C", b: "D" } });

    expect((await vote(p.cookie, first.body.id, "a")).status).toBe(409);

    const open = (await me(p.cookie, ev)).body.announcements.filter((a) => a.poll && !a.poll.closed);
    expect(open).toHaveLength(1);
    expect(open[0].text).toBe("나중");
  });

  it("텍스트 알림은 투표를 닫지 않는다", async () => {
    // 글 하나 보냈다고 열린 투표가 끝나면 운영자가 놀란다
    const ev = await freshEvent();
    const p = await join(ev);
    const poll = await send(ev, { text: "투표", poll: { a: "A", b: "B" } });
    await send(ev, { text: "그냥 알림" });
    expect((await vote(p.cookie, poll.body.id, "a")).status).toBe(200);
  });

  it("없는 알림에 표를 보내면 404 다", async () => {
    /*
     * 운영자가 방금 지웠는데 참가자 화면이 아직 옛 목록일 때 실제로 생긴다.
     *
     * ⚠️ **먼저 진짜 표를 한 번 넣는다.** 안 그러면 `/api/vote` 가 아예 없을 때도
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

    // 같은 아이디로 다시 만들 수는 없지만, 표가 남아 새 투표에 섞이면 안 된다
    const next = await send(ev, { text: "질문", poll: { a: "A", b: "B" } });
    const seen = (await me(p.cookie, ev)).body.announcements[0];
    expect(seen.id).toBe(next.body.id);
    expect(seen.poll?.count).toEqual({ a: 0, b: 0 });
    expect(seen.poll?.mine).toBeUndefined();
  });
});
