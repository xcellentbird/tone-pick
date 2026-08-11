/**
 * 슬라이스 02·03·06 — 등록 · 콕 · 발표
 *
 * 이 파일은 **규칙이 지켜지는가**만 본다. 함수 하나하나가 아니라
 * "참가자에게 나가는 응답에 무엇이 들어 있는가"를 공개 표면에서 확인한다.
 *
 * 이 앱이 없애려는 건 거절당하는 경험이다. 그래서 아래 셋은 기능이 아니라 정체성이다.
 *   · 일방적으로 받은 콕은 끝까지 익명이다
 *   · 실명·전화번호·인스타는 매칭돼도 상대에게 가지 않는다
 *   · 발표 전에는 발신자(fromId)가 응답에 아예 없다
 */
import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { POKE, REGISTER } from "../src/shared/copy.ts";
import type { EventMeta, ParticipantState, RegisterInput, RegisterResult } from "../src/shared/types.ts";

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

beforeAll(async () => {
  master = (await api("/api/host/pin", { method: "POST", body: { pin: MASTER_PIN } })).cookie;
});

/** 등록이 열린 회차를 하나 만든다. 테스트끼리 상태를 나눠 쓰지 않기 위해 매번 새로 만든다 */
async function freshEvent(): Promise<EventMeta> {
  seq++;
  const res = await api<EventMeta>("/api/host/events", {
    method: "POST",
    cookie: master,
    body: {
      name: `${seq}회차`,
      pin: String(3000 + seq),
      regOpenAt: "now",
      voteCloseAt: Date.now() + 24 * HOUR,
      config: { maxPre: 2, maxParty: 3 },
      requestId: `p-${seq}-${Date.now()}`,
    },
  });
  expect(res.status).toBe(200);
  return res.body;
}

let phoneSeq = 0;
function person(over: Partial<RegisterInput> = {}): RegisterInput {
  phoneSeq++;
  return {
    nickname: `사람${phoneSeq}`,
    realName: `김실명${phoneSeq}`,
    age: 28,
    gender: "M",
    phone: `0101234${String(1000 + phoneSeq)}`,
    instagram: `insta_${phoneSeq}`,
    mbti: "ENFP",
    charms: ["요리를 잘해요", "잘 웃어요", "노래를 좋아해요"],
    ...over,
  };
}

async function join(code: string, over: Partial<RegisterInput> = {}) {
  const input = person(over);
  const res = await api<RegisterResult>(`/api/events/${code}/register`, { method: "POST", body: input });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { cookie: res.cookie, id: res.body.state.me.id, input, resumed: res.body.resumed };
}

async function setPhase(id: string, to: string) {
  const res = await api(`/api/host/events/${id}/phase`, { method: "POST", cookie: master, body: { to } });
  expect(res.status).toBe(200);
}

// ─────────────────────────────────────────── 등록

describe("등록", () => {
  it("닉네임은 회차 안에서 유일하다", async () => {
    const ev = await freshEvent();
    await join(ev.code, { nickname: "겹치는닉" });
    const res = await api<{ error: string; message: string }>(`/api/events/${ev.code}/register`, {
      method: "POST",
      body: person({ nickname: "겹치는닉", gender: "F" }),
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("nick_taken");
    // 에러는 그 값을 입력한 자리로 되돌릴 수 있게 닉네임을 담아 알려준다
    expect(res.body.message).toBe(REGISTER.err.nickTaken("겹치는닉"));
  });

  it("다른 회차의 같은 닉네임은 상관없다", async () => {
    const a = await freshEvent();
    const b = await freshEvent();
    await join(a.code, { nickname: "같은닉" });
    const second = await join(b.code, { nickname: "같은닉" });
    expect(second.id).toBeTruthy();
  });

  it("같은 전화번호로 다시 오면 그 사람으로 재접속한다", async () => {
    const ev = await freshEvent();
    const first = await join(ev.code, { nickname: "처음닉" });
    const again = await api<RegisterResult>(`/api/events/${ev.code}/register`, {
      method: "POST",
      body: { ...first.input, nickname: "바꾼닉" },
    });
    expect(again.status).toBe(200);
    expect(again.body.resumed).toBe(true);
    expect(again.body.state.me.id).toBe(first.id);
    // 인원이 늘지 않는다
    expect(again.body.state.event.playerCount).toBe(1);
  });
});

// ─────────────────────────────────────────── 공개 범위

describe("공개 범위", () => {
  it("★ 참가자 명단에 실명·전화번호·인스타가 없다", async () => {
    const ev = await freshEvent();
    const me = await join(ev.code);
    await join(ev.code, { gender: "F", realName: "박비밀", phone: "01099998888", instagram: "secret_gram" });

    const state = await api<ParticipantState>("/api/me", { cookie: me.cookie });
    expect(state.status).toBe(200);
    expect(state.body.roster.length).toBe(1);

    const raw = JSON.stringify(state.body.roster);
    expect(raw).not.toContain("박비밀");
    expect(raw).not.toContain("01099998888");
    expect(raw).not.toContain("secret_gram");
    for (const leak of ["realName", "phone", "instagram"]) {
      expect(Object.keys(state.body.roster[0])).not.toContain(leak);
    }
  });

  it("★ 발표 전에는 누가 찔렀는지 응답에 없다", async () => {
    const ev = await freshEvent();
    const me = await join(ev.code);
    const her = await join(ev.code, { gender: "F" });
    await setPhase(ev.id, "prevote");

    await api("/api/poke", { method: "POST", cookie: her.cookie, body: { toId: me.id } });

    const state = await api<ParticipantState>("/api/me", { cookie: me.cookie });
    expect(state.body.poke.receivedCount).toBe(1);
    // 받은 콕은 횟수만 있다. 명단에는 그녀가 있지만(찌를 수 있어야 하니까),
    // 콕 쪽에는 발신자로 이어질 값이 하나도 없어야 한다
    const raw = JSON.stringify(state.body.poke);
    expect(raw).not.toContain("fromId");
    expect(raw).not.toContain(her.id);
    expect(state.body.poke.matches).toEqual([]);
  });

  it("★ 발표 후에도 일방적인 콕은 익명이다", async () => {
    const ev = await freshEvent();
    const me = await join(ev.code);
    const her = await join(ev.code, { gender: "F" });
    const other = await join(ev.code, { gender: "F" });
    await setPhase(ev.id, "prevote");

    // her → me 만. 나는 아무도 찌르지 않았다
    await api("/api/poke", { method: "POST", cookie: her.cookie, body: { toId: me.id } });
    await setPhase(ev.id, "party");
    await setPhase(ev.id, "done");

    const state = await api<ParticipantState>("/api/me", { cookie: me.cookie });
    expect(state.body.poke.receivedCount).toBe(1);
    expect(state.body.poke.matches).toEqual([]);
    const raw = JSON.stringify(state.body.poke);
    expect(raw).not.toContain(her.id);
    expect(raw).not.toContain(other.id);
  });

  it("★ 발표 후 상호 매칭만 닉네임까지 공개된다 (연락처는 여전히 아니다)", async () => {
    const ev = await freshEvent();
    const me = await join(ev.code, { nickname: "나야나" });
    const her = await join(ev.code, { gender: "F", nickname: "그녀", realName: "이실명", instagram: "her_gram" });
    await setPhase(ev.id, "prevote");

    await api("/api/poke", { method: "POST", cookie: me.cookie, body: { toId: her.id } });
    await api("/api/poke", { method: "POST", cookie: her.cookie, body: { toId: me.id } });
    await setPhase(ev.id, "party");
    await setPhase(ev.id, "done");

    const state = await api<ParticipantState>("/api/me", { cookie: me.cookie });
    expect(state.body.poke.matches.length).toBe(1);
    expect(state.body.poke.matches[0].player.nickname).toBe("그녀");
    const raw = JSON.stringify(state.body.poke.matches);
    expect(raw).not.toContain("이실명");
    expect(raw).not.toContain("her_gram");
  });

  it("★ 다른 회차의 세션으로는 이 회차 화면을 볼 수 없다", async () => {
    // 한 브라우저에 참가자 세션은 하나뿐이라, 다른 회차에 등록하면 앞의 세션이 덮인다.
    // 그때 앞 회차 주소를 열면 **다른 회차 자료가 그 주소로** 보이면 안 된다
    const first = await freshEvent();
    const second = await freshEvent();
    await join(first.code, { nickname: "앞회차" });
    const later = await join(second.code, { nickname: "뒷회차" });

    const wrong = await api(`/api/me?code=${first.code}`, { cookie: later.cookie });
    expect(wrong.status).toBe(401);

    const right = await api<ParticipantState>(`/api/me?code=${second.code}`, { cookie: later.cookie });
    expect(right.status).toBe(200);
    expect(right.body.event.code).toBe(second.code);
  });

  it("세션 없이는 참가자 API 에 닿을 수 없다", async () => {
    const ev = await freshEvent();
    const her = await join(ev.code, { gender: "F" });
    expect((await api("/api/me")).status).toBe(401);
    expect((await api("/api/poke", { method: "POST", body: { toId: her.id } })).status).toBe(401);
  });
});

// ─────────────────────────────────────────── 콕

describe("콕", () => {
  it("예산은 라운드별로 나뉘고, 같은 사람에게 중복해서 찌를 수 있다", async () => {
    const ev = await freshEvent();   // maxPre 2 · maxParty 3
    const me = await join(ev.code);
    const her = await join(ev.code, { gender: "F" });
    await setPhase(ev.id, "prevote");

    const first = await api<{ budget: Record<string, { max: number; used: number }> }>("/api/poke", {
      method: "POST",
      cookie: me.cookie,
      body: { toId: her.id },
    });
    expect(first.status).toBe(200);
    // 같은 사람에게 한 번 더
    const second = await api("/api/poke", { method: "POST", cookie: me.cookie, body: { toId: her.id } });
    expect(second.status).toBe(200);

    // 세 번째는 사전 투표 예산을 넘는다
    const third = await api<{ error: string; message: string }>("/api/poke", {
      method: "POST",
      cookie: me.cookie,
      body: { toId: her.id },
    });
    expect(third.status).toBe(409);
    expect(third.body.error).toBe("no_budget");
    expect(third.body.message).toBe(POKE.blocked.noBudget(2));

    // 파티 라운드로 넘어가면 새 예산이 지급되고, 사전 투표에서 찌른 건 그대로 남는다
    await setPhase(ev.id, "party");
    const afterPhase = await api<ParticipantState>("/api/me", { cookie: me.cookie });
    expect(afterPhase.body.poke.budget.pre.used).toBe(2);
    expect(afterPhase.body.poke.budget.party.used).toBe(0);
    expect(afterPhase.body.poke.sentTo[her.id]).toBe(2);

    const inParty = await api("/api/poke", { method: "POST", cookie: me.cookie, body: { toId: her.id } });
    expect(inParty.status).toBe(200);
  });

  it("되돌리면 예산이 돌아오고, 다시 찌르면 복구된다", async () => {
    const ev = await freshEvent();
    const me = await join(ev.code);
    const her = await join(ev.code, { gender: "F" });
    await setPhase(ev.id, "prevote");

    await api("/api/poke", { method: "POST", cookie: me.cookie, body: { toId: her.id } });
    const undone = await api<ParticipantState["poke"]>(`/api/poke/${her.id}`, {
      method: "DELETE",
      cookie: me.cookie,
    });
    expect(undone.status).toBe(200);
    expect(undone.body.budget.pre.used).toBe(0);
    expect(undone.body.sentTo[her.id] ?? 0).toBe(0);

    const again = await api<ParticipantState["poke"]>("/api/poke", {
      method: "POST",
      cookie: me.cookie,
      body: { toId: her.id },
    });
    expect(again.body.sentTo[her.id]).toBe(1);
  });

  it("★ 이번 라운드에 보낸 콕만 되돌릴 수 있다", async () => {
    const ev = await freshEvent();
    const me = await join(ev.code);
    const her = await join(ev.code, { gender: "F" });
    await setPhase(ev.id, "prevote");
    await api("/api/poke", { method: "POST", cookie: me.cookie, body: { toId: her.id } });

    // 파티 라운드로 넘어가면 사전 투표에서 보낸 건 그대로 남지만 되돌릴 수는 없다
    await setPhase(ev.id, "party");
    const state = await api<ParticipantState>("/api/me", { cookie: me.cookie });
    expect(state.body.poke.sentTo[her.id]).toBe(1);
    expect(state.body.poke.sentThisRound[her.id] ?? 0).toBe(0);

    const undo = await api(`/api/poke/${her.id}`, { method: "DELETE", cookie: me.cookie });
    expect(undo.status).toBe(404);
  });

  it("이성에게만 찌를 수 있다", async () => {
    const ev = await freshEvent();
    const me = await join(ev.code);
    const him = await join(ev.code);
    await setPhase(ev.id, "prevote");

    const res = await api<{ error: string; message: string }>("/api/poke", {
      method: "POST",
      cookie: me.cookie,
      body: { toId: him.id },
    });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(POKE.blocked.sameGender);
  });

  it("등록 중에는 아직, 발표 후에는 더 이상 찌를 수 없다", async () => {
    const ev = await freshEvent();
    const me = await join(ev.code);
    const her = await join(ev.code, { gender: "F" });

    const early = await api<{ message: string }>("/api/poke", {
      method: "POST",
      cookie: me.cookie,
      body: { toId: her.id },
    });
    expect(early.status).toBe(409);
    expect(early.body.message).toBe(POKE.blocked.closed);

    await setPhase(ev.id, "prevote");
    await setPhase(ev.id, "party");
    await setPhase(ev.id, "done");

    // 결과를 보고 나서 뒤늦게 찌르는 일이 없어야 한다
    const late = await api("/api/poke", { method: "POST", cookie: me.cookie, body: { toId: her.id } });
    expect(late.status).toBe(409);
  });
});

// ─────────────────────────────────────────── 되돌리기

describe("발표 되돌리기", () => {
  it("★ 되돌려도 예약 때문에 즉시 다시 발표되지 않는다", async () => {
    const ev = await freshEvent();
    await setPhase(ev.id, "prevote");
    await setPhase(ev.id, "party");

    // 발표 시각을 이미 지난 시점으로 걸어둔 채 발표했다가 되돌린다
    const past = Date.now() - 60_000;
    await api(`/api/host/events/${ev.id}/schedule`, {
      method: "PUT",
      cookie: master,
      body: { revealAt: past },
    });
    await setPhase(ev.id, "done");
    await setPhase(ev.id, "party");

    const after = await api<EventMeta>(`/api/host/events/${ev.id}`, { cookie: master });
    expect(after.body.phase).toBe("party");
    // 예약 값은 지우지 않는다 — 기록으로 남아야 한다
    expect(after.body.schedule.revealAt).toBe(past);
    expect(after.body.fired.done).toBeGreaterThan(0);
  });
});
