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
import { ENTRY, ME, POKE, REGISTER, hangulSeq } from "../src/shared/copy.ts";
import { ENTRY_TRIES } from "../src/shared/constants.ts";
import type { EventMeta, ParticipantState, Player, RegisterInput, RegisterResult } from "../src/shared/types.ts";

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
      partyAt: Date.now() + 3 * 24 * HOUR,
      prevoteAt: Date.now() + 24 * HOUR,
      config: { maxPre: 2, maxParty: 3 },
      requestId: `p-${seq}-${Date.now()}`,
    },
  });
  expect(res.status).toBe(200);
  return res.body;
}

let phoneSeq = 0;
const nextPhone = () => `0101234${String(1000 + ++phoneSeq)}`;

function person(over: Partial<RegisterInput> = {}): RegisterInput {
  return {
    nickname: `사람${hangulSeq(phoneSeq)}`,
    realName: "김실명",
    age: 28,
    gender: "M",
    instagram: `insta_${phoneSeq}`,
    mbti: "ENFP",
    charms: ["요리를 잘해요", "잘 웃어요", "노래를 좋아해요"],
    ...over,
  };
}

/** 초대 명단은 **더하고 빼기만** 있다. 통째로 갈아치우는 길은 두지 않았다 */
async function invite(eventId: string, phone: string) {
  const res = await api(`/api/host/events/${eventId}/invites`, {
    method: "POST",
    cookie: master,
    body: { phones: [phone] },
  });
  expect(res.status).toBe(200);
}

/** 문을 두드려 통과한다. 통과하면 서버가 쿠키를 준다 */
async function enter(eventId: string, phone: string) {
  return api<{ registered: boolean; code?: string }>(`/api/events/${eventId}/enter`, {
    method: "POST",
    body: { phone },
  });
}

/** 명단에 넣고 → 입장하고 → 등록한다. 실제 참가자가 지나는 길 그대로다 */
async function join(ev: EventMeta, over: Partial<RegisterInput> = {}) {
  const phone = nextPhone();
  const input = person(over);
  await invite(ev.id, phone);

  const gate = await enter(ev.id, phone);
  expect(gate.status, JSON.stringify(gate.body)).toBe(200);

  const res = await api<RegisterResult>("/api/register", {
    method: "POST",
    cookie: gate.cookie,
    body: input,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { cookie: res.cookie, id: res.body.state.me.id, input, phone, resumed: res.body.resumed };
}

async function setPhase(id: string, to: string) {
  const res = await api(`/api/host/events/${id}/phase`, { method: "POST", cookie: master, body: { to } });
  expect(res.status).toBe(200);
}

// ─────────────────────────────────────────── 등록

describe("등록", () => {
  it("닉네임은 회차 안에서 유일하다", async () => {
    const ev = await freshEvent();
    await join(ev, { nickname: "겹치는닉" });
    const phone = nextPhone();
    await invite(ev.id, phone);
    const gate = await enter(ev.id, phone);
    const res = await api<{ error: string; message: string }>("/api/register", {
      method: "POST",
      cookie: gate.cookie,
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
    await join(a, { nickname: "같은닉" });
    const second = await join(b, { nickname: "같은닉" });
    expect(second.id).toBeTruthy();
  });

  it("★ 인스타 없이는 등록되지 않는다", async () => {
    // 매칭되면 서로에게 공개되는 연락 수단이라 (ADR-19) 없이는 매칭이 반쪽이 된다
    const ev = await freshEvent();
    const phone = nextPhone();
    await invite(ev.id, phone);
    const gate = await enter(ev.id, phone);

    for (const instagram of [undefined, "", "  ", "한글아이디", "no spaces!"]) {
      const res = await api("/api/register", {
        method: "POST",
        cookie: gate.cookie,
        body: { ...person(), instagram },
      });
      expect(res.status, `instagram=${JSON.stringify(instagram)}`).toBe(400);
    }
  });

  it("붙여넣은 @아이디·프로필 URL 은 오류가 아니다 — 벗겨서 받는다", async () => {
    // 가장 흔한 '유효하지 않은 값'은 오타가 아니라 붙여넣기다. 의도가 명백하면 고쳐준다
    const ev = await freshEvent();
    for (const pasted of ["@my.id", "https://www.instagram.com/my.id?igsh=abc", "instagram.com/my.id/"]) {
      const phone = nextPhone();
      await invite(ev.id, phone);
      const gate = await enter(ev.id, phone);
      const res = await api<RegisterResult>("/api/register", {
        method: "POST",
        cookie: gate.cookie,
        body: { ...person(), instagram: pasted },
      });
      expect(res.status, `instagram=${pasted} → ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body.state.me.instagram).toBe("my.id");
    }
  });

  it("★ 게시물·릴스 URL 의 예약 경로는 아이디로 저장되지 않는다", async () => {
    // instagram.com/p/... 에서 "p" 를 아이디로 저장하면, 발표 때 매칭 상대의
    // 연락 카드에 존재하지 않는 계정이 뜬다 — 조용히 틀리느니 오류가 낫다
    const ev = await freshEvent();
    const phone = nextPhone();
    await invite(ev.id, phone);
    const gate = await enter(ev.id, phone);
    for (const pasted of [
      "https://www.instagram.com/p/DAbC123xyz/",
      "https://www.instagram.com/reel/xyz987/",
      "instagram.com/stories/my.id/123456",
    ]) {
      const res = await api("/api/register", {
        method: "POST",
        cookie: gate.cookie,
        body: { ...person(), instagram: pasted },
      });
      expect(res.status, `instagram=${pasted}`).toBe(400);
    }
  });

  it("인스타 30자·실명 20자·매력 100자 상한을 서버가 지킨다", async () => {
    // 화면 검증을 우회해 API 로 바로 쏘는 참가자가 있다
    const ev = await freshEvent();
    const over = [
      { instagram: "a".repeat(31) },
      { realName: "가".repeat(21) },
      { charms: ["요리를 잘해요", "잘 웃어요", "가".repeat(101)] as [string, string, string] },
    ];
    for (const bad of over) {
      const phone = nextPhone();
      await invite(ev.id, phone);
      const gate = await enter(ev.id, phone);
      const res = await api("/api/register", {
        method: "POST",
        cookie: gate.cookie,
        body: { ...person(), ...bad },
      });
      expect(res.status, JSON.stringify(Object.keys(bad))).toBe(400);
    }
  });

  it("닉네임은 2글자 이상, 한글·영문만 받는다", async () => {
    const ev = await freshEvent();
    const phone = nextPhone();
    await invite(ev.id, phone);
    const gate = await enter(ev.id, phone);

    for (const nickname of ["나", "닉!네임", "닉 네임", "nick_name", "★별빛", "달빛3", "2세"]) {
      const res = await api("/api/register", {
        method: "POST",
        cookie: gate.cookie,
        body: person({ nickname }),
      });
      expect(res.status, `nickname=${JSON.stringify(nickname)}`).toBe(400);
    }

    // 한글·영문을 섞은 건 통과한다
    const ok = await api("/api/register", {
      method: "POST",
      cookie: gate.cookie,
      body: person({ nickname: "달빛moon" }),
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it("실명에는 숫자를 넣을 수 없다", async () => {
    const ev = await freshEvent();
    const phone = nextPhone();
    await invite(ev.id, phone);
    const gate = await enter(ev.id, phone);

    const res = await api("/api/register", {
      method: "POST",
      cookie: gate.cookie,
      body: person({ realName: "김실명2" }),
    });
    expect(res.status).toBe(400);
  });

  it("자소 분리형(NFD) 한글도 받는다", async () => {
    // macOS·iOS 의 일부 경로는 한글을 NFD 로 준다 — 눈에는 같은 "달빛"인데 코드포인트가 다르다
    const ev = await freshEvent();
    const phone = nextPhone();
    await invite(ev.id, phone);
    const gate = await enter(ev.id, phone);

    const res = await api<RegisterResult>("/api/register", {
      method: "POST",
      cookie: gate.cookie,
      body: person({ nickname: "달빛".normalize("NFD"), realName: "김달빛".normalize("NFD") }),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // 저장은 NFC 한 벌로 — 나중에 NFC 로 온 같은 닉네임과 유일성 비교가 어긋나면 안 된다
    expect(res.body.state.me.nickname).toBe("달빛");
  });

  it("문자열이 아닌 값을 보내면 500이 아니라 400이다", async () => {
    // 폼을 우회해 API 로 바로 쏘는 참가자 — 검증이 크래시 통로가 되면 안 된다
    const ev = await freshEvent();
    const phone = nextPhone();
    await invite(ev.id, phone);
    const gate = await enter(ev.id, phone);

    for (const bad of [
      { nickname: ["달빛"] },
      { realName: true },
      { charms: "셋 아님" },
      { charms: ["하나", "둘", 3] },
      { mbti: ["E", "N", "F", "P"] },
    ]) {
      const res = await api("/api/register", {
        method: "POST",
        cookie: gate.cookie,
        body: { ...person(), ...bad },
      });
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("같은 전화번호로 다시 오면 그 사람으로 재접속한다", async () => {
    const ev = await freshEvent();
    const first = await join(ev, { nickname: "처음닉" });
    // 같은 번호로 문을 다시 두드리면 곧바로 참가자 세션이 나온다 — 등록 폼을 다시 채우지 않는다
    const back = await enter(ev.id, first.phone);
    expect(back.status).toBe(200);
    expect(back.body.registered).toBe(true);
    expect(back.body.code).toBe(ev.code);

    const again = await api<ParticipantState>("/api/me", { cookie: back.cookie });
    expect(again.status).toBe(200);
    expect(again.body.me.id).toBe(first.id);
    expect(again.body.me.nickname).toBe("처음닉");
    // 인원이 늘지 않는다
    expect(again.body.event.playerCount).toBe(1);
  });
});

// ─────────────────────────────────────────── 입장 명단

/**
 * 파티에 들어오는 문은 **운영자가 미리 넣어둔 전화번호**다 (ADR-15).
 *
 * 코드 여섯 자리는 옮겨 적을 수 있지만 남의 번호로는 들어올 수 없다.
 * 그리고 이 문은 인증 없이 열려 있어서, 제한이 없으면
 * "이 번호가 이 파티에 있나"를 되묻는 창구가 된다.
 */
describe("입장 명단", () => {
  it("★ 명단에 없는 번호는 들어올 수 없다", async () => {
    const ev = await freshEvent();
    await invite(ev.id, "01011112222");

    const res = await enter(ev.id, "01099998888");
    expect(res.status).toBe(403);
    expect(res.cookie).toBeNull();
    expect((res.body as unknown as { message: string }).message).toBe(ENTRY.notInvited);

    // 쿠키가 없으니 등록도 되지 않는다
    const reg = await api("/api/register", { method: "POST", body: person() });
    expect(reg.status).toBe(401);
  });

  it("★ 명단에 있으면 통과하고, 등록 폼은 번호를 다시 묻지 않는다", async () => {
    const ev = await freshEvent();
    const phone = nextPhone();
    await invite(ev.id, phone);

    const gate = await enter(ev.id, phone);
    expect(gate.status).toBe(200);
    expect(gate.body.registered).toBe(false);

    // 폼에 번호가 없어도 등록된다 — 서버가 통과한 번호를 들고 있다
    const reg = await api<RegisterResult>("/api/register", {
      method: "POST",
      cookie: gate.cookie,
      body: person({ nickname: "번호없이" }),
    });
    expect(reg.status, JSON.stringify(reg.body)).toBe(200);
    expect(reg.body.state.me.nickname).toBe("번호없이");
  });

  it("★ 폼으로 다른 번호를 밀어 넣어도 통과한 번호로 등록된다", async () => {
    const ev = await freshEvent();
    const phone = nextPhone();
    await invite(ev.id, phone);
    const gate = await enter(ev.id, phone);

    await api("/api/register", {
      method: "POST",
      cookie: gate.cookie,
      // 명단에 없는 번호를 폼에 실어 보낸다
      body: { ...person({ nickname: "바꿔치기" }), phone: "01099998888" },
    });

    // 운영자 눈에는 통과한 번호로 보인다
    const state = await api<{ players: Array<{ nickname: string; phone: string }> }>(
      `/api/host/events/${ev.id}/state`,
      { cookie: master },
    );
    const made = state.body.players.find((p) => p.nickname === "바꿔치기");
    expect(made?.phone).toBe(phone);
  });

  it("★ 이미 등록한 사람은 명단에서 빠져도 다시 들어온다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    // 운영자가 명단에서 그 사람을 뺀다
    const out = await api(`/api/host/events/${ev.id}/invites/${me.phone}`, { method: "DELETE", cookie: master });
    expect(out.status).toBe(200);

    const back = await enter(ev.id, me.phone);
    expect(back.status).toBe(200);
    expect(back.body.registered).toBe(true);
  });

  it("★ 문을 계속 두드리면 막힌다 — 주소록을 넣어보는 창구가 되면 안 된다", async () => {
    const ev = await freshEvent();
    await invite(ev.id, nextPhone());

    let blocked = 0;
    for (let i = 0; i < ENTRY_TRIES.max + 2; i++) {
      const res = await enter(ev.id, `0102000${String(1000 + i)}`);
      if (res.status === 429) blocked++;
    }
    expect(blocked).toBeGreaterThan(0);
  });

  it("★ 명단은 참가자 응답 어디에도 없다", async () => {
    const ev = await freshEvent();
    const secret = "01077776666";
    await invite(ev.id, secret);
    const me = await join(ev);

    const state = await api<ParticipantState>("/api/me", { cookie: me.cookie });
    expect(state.status).toBe(200);
    expect(JSON.stringify(state.body)).not.toContain(secret);
    expect(Object.keys(state.body)).not.toContain("invites");
  });

  it("★ 명단을 통째로 갈아치우는 길은 없다 — 더하기만 있다", async () => {
    const ev = await freshEvent();
    await invite(ev.id, "01011112222");
    await invite(ev.id, "01033334444");

    // 한 명을 더해도 앞의 둘이 남아 있어야 한다
    const res = await api<Array<{ phone: string }>>(`/api/host/events/${ev.id}/invites`, {
      method: "POST",
      cookie: master,
      body: { phones: ["01055556666"] },
    });
    expect(res.status).toBe(200);
    expect(res.body.map((i) => i.phone).sort()).toEqual(["01011112222", "01033334444", "01055556666"]);

    // 같은 번호를 다시 넣어도 늘지 않는다
    const again = await api<Array<{ phone: string }>>(`/api/host/events/${ev.id}/invites`, {
      method: "POST",
      cookie: master,
      body: { phones: ["01011112222"] },
    });
    expect(again.body.length).toBe(3);
  });

  it("명단 조회·수정은 운영자만 한다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    for (const cookie of [null, me.cookie]) {
      const res = await api(`/api/host/events/${ev.id}/invites`, {
        method: "POST",
        cookie,
        body: { phones: ["01011112222"] },
      });
      expect(res.status).toBe(401);
    }
  });
});

// ─────────────────────────────────────────── 공개 범위

describe("공개 범위", () => {
  it("★ 참가자 명단에 실명·전화번호·인스타가 없다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    const her = await join(ev, { gender: "F", realName: "박비밀", instagram: "secret_gram" });
    await setPhase(ev.id, "prevote");   // 명단은 사전 투표부터 열린다 (ADR-21)

    const state = await api<ParticipantState>("/api/me", { cookie: me.cookie });
    expect(state.status).toBe(200);
    expect(state.body.roster.length).toBe(1);

    const raw = JSON.stringify(state.body.roster);
    expect(raw).not.toContain("박비밀");
    expect(raw).not.toContain(her.phone);
    expect(raw).not.toContain("secret_gram");
    for (const leak of ["realName", "phone", "instagram"]) {
      expect(Object.keys(state.body.roster[0])).not.toContain(leak);
    }
  });

  it("★ 발표 전에는 누가 찔렀는지 응답에 없다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    const her = await join(ev, { gender: "F" });
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
    const me = await join(ev);
    const her = await join(ev, { gender: "F" });
    const other = await join(ev, { gender: "F" });
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

  /**
   * 연락처가 참가자에게 나가는 **유일한 통로**다 (ADR-19).
   * 세 조건이 모두 맞아야 한다 — 발표 단계 · 서로 찌름 · 그 상대의 것.
   */
  it("★ 발표 후 서로 찌른 상대의 연락처가 열린다", async () => {
    const ev = await freshEvent();
    const me = await join(ev, { nickname: "나야나" });
    const her = await join(ev, { gender: "F", nickname: "그녀", realName: "이실명", instagram: "her_gram" });
    await setPhase(ev.id, "prevote");

    await api("/api/poke", { method: "POST", cookie: me.cookie, body: { toId: her.id } });
    await api("/api/poke", { method: "POST", cookie: her.cookie, body: { toId: me.id } });
    await setPhase(ev.id, "party");
    await setPhase(ev.id, "done");

    const state = await api<ParticipantState>("/api/me", { cookie: me.cookie });
    expect(state.body.poke.matches.length).toBe(1);
    expect(state.body.poke.matches[0].player.nickname).toBe("그녀");
    expect(state.body.poke.matches[0].contact).toEqual({
      realName: "이실명",
      phone: her.phone,
      instagram: "her_gram",
    });

    // 명단(roster)은 여전히 깨끗하다. 연락처는 매칭 안에만 있다
    const roster = JSON.stringify(state.body.roster);
    expect(roster).not.toContain("이실명");
    expect(roster).not.toContain(her.phone);
  });

  it("★ 발표 전에는 서로 찔렀어도 연락처가 없다", async () => {
    const ev = await freshEvent();
    const me = await join(ev, { nickname: "나야" });
    const her = await join(ev, { gender: "F", realName: "박비밀", instagram: "her_gram" });
    await setPhase(ev.id, "prevote");

    await api("/api/poke", { method: "POST", cookie: me.cookie, body: { toId: her.id } });
    await api("/api/poke", { method: "POST", cookie: her.cookie, body: { toId: me.id } });

    // 아직 사전 투표 중이다
    const during = await api<ParticipantState>("/api/me", { cookie: me.cookie });
    expect(during.body.poke.matches).toEqual([]);
    const raw = JSON.stringify(during.body);
    expect(raw).not.toContain("박비밀");
    expect(raw).not.toContain(her.phone);
  });

  it("★ 한쪽만 찌른 상대의 연락처는 발표 뒤에도 나가지 않는다", async () => {
    const ev = await freshEvent();
    const me = await join(ev, { nickname: "나야" });
    const her = await join(ev, { gender: "F", realName: "박비밀", instagram: "one_way" });
    await setPhase(ev.id, "prevote");

    // 나만 찔렀다
    await api("/api/poke", { method: "POST", cookie: me.cookie, body: { toId: her.id } });
    await setPhase(ev.id, "party");
    await setPhase(ev.id, "done");

    const state = await api<ParticipantState>("/api/me", { cookie: me.cookie });
    expect(state.body.poke.matches).toEqual([]);
    const raw = JSON.stringify(state.body);
    expect(raw).not.toContain("박비밀");
    expect(raw).not.toContain("one_way");
    expect(raw).not.toContain(her.phone);
  });

  it("★ 다른 회차의 세션으로는 이 회차 화면을 볼 수 없다", async () => {
    // 한 브라우저에 참가자 세션은 하나뿐이라, 다른 회차에 등록하면 앞의 세션이 덮인다.
    // 그때 앞 회차 주소를 열면 **다른 회차 자료가 그 주소로** 보이면 안 된다
    const first = await freshEvent();
    const second = await freshEvent();
    await join(first, { nickname: "앞회차" });
    const later = await join(second, { nickname: "뒷회차" });

    const wrong = await api(`/api/me?code=${first.code}`, { cookie: later.cookie });
    expect(wrong.status).toBe(401);

    const right = await api<ParticipantState>(`/api/me?code=${second.code}`, { cookie: later.cookie });
    expect(right.status).toBe(200);
    expect(right.body.event.code).toBe(second.code);
  });

  it("세션 없이는 참가자 API 에 닿을 수 없다", async () => {
    const ev = await freshEvent();
    const her = await join(ev, { gender: "F" });
    expect((await api("/api/me")).status).toBe(401);
    expect((await api("/api/poke", { method: "POST", body: { toId: her.id } })).status).toBe(401);
  });
});

// ─────────────────────────────────────────── 콕

describe("콕", () => {
  it("예산은 라운드별로 나뉘고, 같은 사람에게 중복해서 찌를 수 있다", async () => {
    const ev = await freshEvent();   // maxPre 2 · maxParty 3
    const me = await join(ev);
    const her = await join(ev, { gender: "F" });
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

  it("★ 기본은 성별을 가리지 않는다", async () => {
    // 누구에게 마음이 가는지는 앱이 정할 일이 아니다 (ADR-17)
    const ev = await freshEvent();
    const me = await join(ev);
    const him = await join(ev);
    await setPhase(ev.id, "prevote");

    const res = await api("/api/poke", { method: "POST", cookie: me.cookie, body: { toId: him.id } });
    expect(res.status).toBe(200);
  });

  it("운영자가 좁히면 이성에게만 찌를 수 있다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    const him = await join(ev);

    const narrowed = await api(`/api/host/events/${ev.id}`, {
      method: "PUT",
      cookie: master,
      body: { config: { maxPre: 2, maxParty: 3, allowSameGender: false } },
    });
    expect(narrowed.status).toBe(200);
    await setPhase(ev.id, "prevote");

    const res = await api<{ error: string; message: string }>("/api/poke", {
      method: "POST",
      cookie: me.cookie,
      body: { toId: him.id },
    });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(POKE.blocked.sameGender);
  });

  it("★ 자기 자신은 어떤 설정에서도 찌를 수 없다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    await join(ev, { gender: "F" });
    await setPhase(ev.id, "prevote");

    const res = await api("/api/poke", { method: "POST", cookie: me.cookie, body: { toId: me.id } });
    expect(res.status).toBe(409);
  });

  it("등록 중에는 아직, 발표 후에는 더 이상 찌를 수 없다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    const her = await join(ev, { gender: "F" });

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

// ─────────────────────────────────────────── 명단 공개 범위

/**
 * 명단은 **한 번에 다 열리지 않는다** (ADR-21).
 *
 *   등록 중       명단 자체가 없다 — 몇 명이 왔는지만 안다
 *   사전 투표     닉네임과 매력. 사람을 고를 때 필요한 건 그 둘이다
 *   파티 시작 후  나이와 MBTI 까지
 */
describe("명단 공개 범위", () => {
  it("★ 등록 중에는 명단이 없다 — 인원 수만 안다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    await join(ev, { gender: "F" });

    const state = await api<ParticipantState>("/api/me", { cookie: me.cookie });
    expect(state.body.roster).toEqual([]);
    // 몇 명이 모였는지는 보인다. 기다리는 사람에게 그건 필요한 정보다
    expect(state.body.event.playerCount).toBe(2);
  });

  it("★ 사전 투표에서는 닉네임과 매력만 — 나이·MBTI 는 아직이다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    await join(ev, { gender: "F", nickname: "그녀" });
    await setPhase(ev.id, "prevote");

    const state = await api<ParticipantState>("/api/me", { cookie: me.cookie });
    const her = state.body.roster[0];
    expect(her.nickname).toBe("그녀");
    expect(her.charms.length).toBe(3);
    expect(her.age).toBeUndefined();
    expect(her.mbti).toBeUndefined();
    // 나이가 응답 어디에도 없다 — 화면에서만 감추는 게 아니다
    expect(Object.keys(her)).not.toContain("age");
    expect(Object.keys(her)).not.toContain("mbti");
  });

  it("★ 파티가 시작되면 나이와 MBTI 가 열린다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    await join(ev, { gender: "F", nickname: "그녀" });
    await setPhase(ev.id, "prevote");
    await setPhase(ev.id, "party");

    const her = (await api<ParticipantState>("/api/me", { cookie: me.cookie })).body.roster[0];
    expect(her.age).toBe(28);
    expect(her.mbti).toBe("ENFP");
  });

  it("어느 단계에서도 실명·전화번호·인스타는 없다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    const her = await join(ev, { gender: "F", realName: "박비밀", instagram: "secret_gram" });

    for (const to of ["prevote", "party"]) {
      await setPhase(ev.id, to);
      const raw = JSON.stringify((await api<ParticipantState>("/api/me", { cookie: me.cookie })).body.roster);
      expect(raw).not.toContain("박비밀");
      expect(raw).not.toContain("secret_gram");
      expect(raw).not.toContain(her.phone);
    }
  });
});

// ─────────────────────────────────────────── 참가자를 지웠을 때

/**
 * 라운드 중에 참가자를 지우는 일이 있다. 그때 **남는 것과 사라지는 것**이 분명해야 한다.
 */
describe("참가자를 지웠을 때", () => {
  async function pair() {
    const ev = await freshEvent();
    const a = await join(ev, { gender: "M", nickname: "남을이" });
    const b = await join(ev, { gender: "F", nickname: "지워질이" });
    await setPhase(ev.id, "prevote");
    await api("/api/poke", { method: "POST", cookie: a.cookie, body: { toId: b.id } });
    await api("/api/poke", { method: "POST", cookie: b.cookie, body: { toId: a.id } });
    return { ev, a, b };
  }

  it("★ 지워진 사람에게는 '회차가 없다' 가 아니라 '참가가 취소됐다' 고 말한다", async () => {
    const { ev, b } = await pair();
    await api(`/api/host/events/${ev.id}/players/${b.id}`, { method: "DELETE", cookie: master });

    const res = await api<{ message: string }>("/api/me", { cookie: b.cookie });
    expect(res.status).toBe(404);
    // 회차는 멀쩡하다. 링크를 의심하게 만들면 운영자에게 엉뚱한 걸 묻는다
    expect(res.body.message).toBe(ENTRY.removed);
    expect(res.body.message).not.toBe(ENTRY.notFound);
  });

  it("★ 지운 사람의 운세가 남지 않는다 — 그 문장에 닉네임이 들어 있다", async () => {
    const { ev, b } = await pair();
    await setPhase(ev.id, "party");
    const made = await api<{ headline: string }>("/api/fortune", { method: "POST", cookie: b.cookie });
    expect(made.status).toBe(200);

    await api(`/api/host/events/${ev.id}/players/${b.id}`, { method: "DELETE", cookie: master });
    // 같은 번호로 다시 들어오면 새 사람이다. 앞사람의 운세를 물려받지 않는다
    const back = await enter(ev.id, b.phone);
    expect(back.body.registered).toBe(false);
  });

  it("★ 명단에는 남아 있어서 같은 번호로 다시 들어올 수 있다", async () => {
    const { ev, b } = await pair();
    await api(`/api/host/events/${ev.id}/players/${b.id}`, { method: "DELETE", cookie: master });

    const back = await enter(ev.id, b.phone);
    expect(back.status).toBe(200);
    expect(back.body.registered).toBe(false);   // 등록 폼부터 다시
  });

  it("명단에서도 빼면 그때는 못 들어온다", async () => {
    const { ev, b } = await pair();
    await api(`/api/host/events/${ev.id}/players/${b.id}`, { method: "DELETE", cookie: master });
    await api(`/api/host/events/${ev.id}/invites/${b.phone}`, { method: "DELETE", cookie: master });

    expect((await enter(ev.id, b.phone)).status).toBe(403);
  });

  it("★ 남은 사람의 받은 콕이 줄지 않는다 — 줄면 누가 찔렀는지 드러난다", async () => {
    // 참가자 탭에서 누가 사라졌는지가 동시에 보인다.
    // 받은 콕이 함께 줄면 그 둘을 맞춰 발신자를 특정할 수 있다 (ADR-29)
    const { ev, a, b } = await pair();
    const before = await api<ParticipantState>("/api/me", { cookie: a.cookie });
    expect(before.body.poke.receivedCount).toBe(1);

    await api(`/api/host/events/${ev.id}/players/${b.id}`, { method: "DELETE", cookie: master });
    const after = await api<ParticipantState>("/api/me", { cookie: a.cookie });
    expect(after.body.poke.receivedCount).toBe(1);
    // 명단에서는 사라진다. 남는 건 아무것도 가리키지 않는 숫자뿐이다
    expect(after.body.roster).toEqual([]);
    expect(JSON.stringify(after.body.poke)).not.toContain(b.id);
  });

  it("★ 지운 사람에게 쓴 콕은 예산이 돌아온다", async () => {
    const { ev, a, b } = await pair();
    const before = await api<ParticipantState>("/api/me", { cookie: a.cookie });
    expect(before.body.poke.budget.pre.used).toBe(1);

    await api(`/api/host/events/${ev.id}/players/${b.id}`, { method: "DELETE", cookie: master });
    const after = await api<ParticipantState>("/api/me", { cookie: a.cookie });
    // 없는 사람에게 쓴 횟수를 물릴 이유가 없다
    expect(after.body.poke.budget.pre.used).toBe(0);
  });

  it("★ 운영자 화면에는 지워진 사람이 남지 않는다", async () => {
    const { ev, a, b } = await pair();
    await api(`/api/host/events/${ev.id}/players/${b.id}`, { method: "DELETE", cookie: master });

    const state = await api<{ mutual: Array<[string, string]>; sent: Record<string, number>; pokeUsedMax: Record<string, number> }>(
      `/api/host/events/${ev.id}/state`,
      { cookie: master },
    );
    // 빈 이름의 커플이 뜨거나, 없는 사람 때문에 콕 상한이 묶이면 안 된다
    expect(state.body.mutual).toEqual([]);
    expect(Object.keys(state.body.sent)).toEqual([a.id]);
    expect(state.body.pokeUsedMax.pre).toBe(0);
  });

  it("★ 발행한 자리에서도 빠진다", async () => {
    const ev = await freshEvent();
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push((await join(ev, { gender: i % 2 === 0 ? "M" : "F" })).id);
    await api(`/api/host/events/${ev.id}/seating`, {
      method: "POST", cookie: master, body: { tableCount: 2, final: false },
    });
    await api(`/api/host/events/${ev.id}/seating/publish`, { method: "POST", cookie: master });

    await api(`/api/host/events/${ev.id}/players/${ids[0]}`, { method: "DELETE", cookie: master });
    const state = await api<{ seatings: Array<{ seats: Array<{ playerId: string }> }> }>(
      `/api/host/events/${ev.id}/state`,
      { cookie: master },
    );
    const seated = state.body.seatings.flatMap((r) => r.seats.map((s) => s.playerId));
    expect(seated).not.toContain(ids[0]);
    expect(seated.length).toBe(3);
  });
});

// ─────────────────────────────────────────── 매력 고치기

/**
 * 등록 폼에서 급히 쓴 세 줄을 다듬을 시간은 준다.
 * 다만 **사전 투표가 열리면 닫힌다** (ADR-27) — 그 뒤에는 사람들이 이 세 줄을 보고 콕을 찌르고,
 * 바꾸면 누군가 나를 고른 근거가 조용히 사라진다.
 */
describe("오늘의 연애운", () => {
  it("★ 생년월일은 운세를 여는 데만 쓰이고 어디에도 저장되지 않는다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    await setPhase(ev.id, "party");

    const opened = await api("/api/fortune", { method: "POST", cookie: me.cookie, body: { birth: "19960314" } });
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    // 응답에도, 이후의 내 상태에도, 운영자 화면에도 생년월일이 없다
    expect(JSON.stringify(opened.body)).not.toContain("19960314");
    const mine = await api("/api/me", { cookie: me.cookie });
    expect(JSON.stringify(mine.body)).not.toContain("19960314");
    const host = await api(`/api/host/events/${ev.id}`, { cookie: master });
    expect(JSON.stringify(host.body)).not.toContain("19960314");

    // 한 번 연 운세는 생년월일 없이 다시 물어도 같은 것이 온다
    const again = await api("/api/fortune", { method: "POST", cookie: me.cookie, body: {} });
    expect(again.body).toEqual(opened.body);
  });

  it("달력에 없는 생년월일은 열리지 않는다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    await setPhase(ev.id, "party");
    const res = await api("/api/fortune", { method: "POST", cookie: me.cookie, body: { birth: "19960230" } });
    expect(res.status).toBe(400);
  });
});

describe("나의 매력", () => {
  it("★ 등록 중에는 고칠 수 있다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);

    const res = await api<Player>("/api/me/charms", {
      method: "PUT",
      cookie: me.cookie,
      body: { charms: ["새 매력 하나", "새 매력 둘", "새 매력 셋"] },
    });
    expect(res.status).toBe(200);
    expect(res.body.charms).toEqual(["새 매력 하나", "새 매력 둘", "새 매력 셋"]);

    // 다시 읽어도 바뀐 채로 온다
    const state = await api<ParticipantState>("/api/me", { cookie: me.cookie });
    expect(state.body.me.charms[0]).toBe("새 매력 하나");
  });

  it("★ 사전 투표가 시작되면 닫힌다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    await setPhase(ev.id, "prevote");

    const res = await api<{ message: string }>("/api/me/charms", {
      method: "PUT",
      cookie: me.cookie,
      body: { charms: ["가", "나", "다"] },
    });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(ME.charmsLocked);
  });

  it("빈 줄로는 저장되지 않는다 — 세 가지 모두 필요하다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    for (const charms of [["가", "나"], ["가", "나", "  "], ["가", "나", "다", "라"]]) {
      const res = await api("/api/me/charms", { method: "PUT", cookie: me.cookie, body: { charms } });
      expect(res.status).toBe(400);
    }
  });

  it("남의 매력은 고칠 수 없다", async () => {
    const ev = await freshEvent();
    await join(ev);
    const res = await api("/api/me/charms", { method: "PUT", body: { charms: ["가", "나", "다"] } });
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────── 한 사람이 여러 명과 이어질 때

/**
 * 콕은 1인당 여러 번이라 A–B, A–C 가 동시에 성립한다 (ADR-24).
 * 여기서 지켜야 할 건 둘이다.
 *   · B 는 A 와 이어졌다는 것만 안다. **A 가 C 와도 이어진 건 모른다**
 *   · 쌍은 사라지지 않는다 — 짝을 하나만 들고 있으면 나중 것이 앞의 것을 덮는다
 */
describe("한 사람이 여러 명과 이어질 때", () => {
  async function triangle() {
    const ev = await freshEvent();
    const a = await join(ev, { gender: "M", nickname: "에이" });
    const b = await join(ev, { gender: "F", nickname: "비이", realName: "박비이" });
    const c = await join(ev, { gender: "F", nickname: "씨이", realName: "박씨이" });
    await setPhase(ev.id, "prevote");

    // A 가 둘을 찌르고, 둘 다 A 를 찌른다
    for (const target of [b, c]) {
      await api("/api/poke", { method: "POST", cookie: a.cookie, body: { toId: target.id } });
      await api("/api/poke", { method: "POST", cookie: target.cookie, body: { toId: a.id } });
    }
    return { ev, a, b, c };
  }

  it("★ 쌍이 둘 다 남는다 — 하나가 다른 하나를 덮지 않는다", async () => {
    const { ev, a, b, c } = await triangle();
    const state = await api<{ mutual: Array<[string, string]> }>(`/api/host/events/${ev.id}/state`, {
      cookie: master,
    });
    const pairs = state.body.mutual.map(([x, y]) => [x, y].sort().join("+")).sort();
    expect(pairs).toEqual([[a.id, b.id].sort().join("+"), [a.id, c.id].sort().join("+")].sort());
  });

  it("★ B 는 A 가 C 와도 이어진 걸 모른다", async () => {
    const { ev, a, b, c } = await triangle();
    await setPhase(ev.id, "party");
    await setPhase(ev.id, "done");

    const mine = await api<ParticipantState>("/api/me", { cookie: b.cookie });
    expect(mine.body.poke.matches.length).toBe(1);
    expect(mine.body.poke.matches[0].player.id).toBe(a.id);
    // C 의 흔적이 응답 어디에도 없다
    const raw = JSON.stringify(mine.body.poke);
    expect(raw).not.toContain(c.id);
    expect(raw).not.toContain("박씨이");
  });

  it("A 에게는 둘 다 보이고, 각자의 연락처가 온다", async () => {
    const { ev, a, b, c } = await triangle();
    await setPhase(ev.id, "party");
    await setPhase(ev.id, "done");

    const mine = await api<ParticipantState>("/api/me", { cookie: a.cookie });
    expect(mine.body.poke.matches.map((m) => m.player.id).sort()).toEqual([b.id, c.id].sort());
    for (const m of mine.body.poke.matches) expect(m.contact.phone.length).toBeGreaterThan(0);
  });

  it("★ 커플 자리에서 셋이 같은 테이블이면 두 쌍 다 성공이다", async () => {
    const { ev, a, b, c } = await triangle();
    // 한 테이블이면 A·B·C 가 모두 함께 앉는다
    const made = await api<{ seats: Array<{ playerId: string; table: number }> }>(
      `/api/host/events/${ev.id}/seating`,
      { method: "POST", cookie: master, body: { tableCount: 1, final: true } },
    );
    expect(made.status).toBe(200);
    const table = new Map(made.body.seats.map((s) => [s.playerId, s.table]));
    expect(table.get(a.id)).toBe(table.get(b.id));
    expect(table.get(a.id)).toBe(table.get(c.id));
  });
});

// ─────────────────────────────────────────── 자리 섞기

describe("자리 섞기", () => {
  it("★ 남녀 비율은 그대로 두고 사람만 바뀐다", async () => {
    const ev = await freshEvent();
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      ids.push((await join(ev, { gender: i % 2 === 0 ? "M" : "F" })).id);
    }
    const made = await api<{ seats: Array<{ playerId: string; table: number }> }>(
      `/api/host/events/${ev.id}/seating`,
      { method: "POST", cookie: master, body: { tableCount: 2, final: false } },
    );
    expect(made.status).toBe(200);

    const shaped = (seats: Array<{ playerId: string; table: number }>, byGender: Map<string, string>) => {
      const out = new Map<number, { m: number; f: number }>();
      for (const s of seats) {
        const cell = out.get(s.table) ?? { m: 0, f: 0 };
        byGender.get(s.playerId) === "M" ? cell.m++ : cell.f++;
        out.set(s.table, cell);
      }
      return [...out.entries()].sort().map(([t, c]) => `${t}:${c.m}/${c.f}`).join(" ");
    };
    const genders = new Map(ids.map((id, i) => [id, i % 2 === 0 ? "M" : "F"]));
    const before = shaped(made.body.seats, genders);

    const after = await api<{ seats: Array<{ playerId: string; table: number }> }>(
      `/api/host/events/${ev.id}/seating/shuffle`,
      { method: "POST", cookie: master },
    );
    expect(after.status).toBe(200);

    // 테이블마다 남 몇·여 몇인지가 그대로다
    expect(shaped(after.body.seats, genders)).toBe(before);
    // 사람이 사라지거나 늘지 않는다
    expect(after.body.seats.map((s) => s.playerId).sort()).toEqual(ids.slice().sort());
  });

  it("★ 커플 자리에서는 이어진 쌍이 자리를 지킨다", async () => {
    // 그 배정의 목적이 쌍을 같은 테이블에 앉히는 것인데, 섞기가 흩어놓으면
    // 버튼 하나로 그 라운드가 무의미해진다 (ADR-23)
    const ev = await freshEvent();
    const men = [await join(ev, { gender: "M" }), await join(ev, { gender: "M" })];
    const women = [await join(ev, { gender: "F" }), await join(ev, { gender: "F" })];
    await setPhase(ev.id, "prevote");

    // 첫 남자와 첫 여자가 서로 찌른다
    await api("/api/poke", { method: "POST", cookie: men[0].cookie, body: { toId: women[0].id } });
    await api("/api/poke", { method: "POST", cookie: women[0].cookie, body: { toId: men[0].id } });

    const made = await api<{ seats: Array<{ playerId: string; table: number }> }>(
      `/api/host/events/${ev.id}/seating`,
      { method: "POST", cookie: master, body: { tableCount: 2, final: true } },
    );
    expect(made.status).toBe(200);
    const tableOf = (seats: Array<{ playerId: string; table: number }>, id: string) =>
      seats.find((s) => s.playerId === id)?.table;
    // 커플 자리는 쌍을 같은 테이블에 앉힌다
    expect(tableOf(made.body.seats, men[0].id)).toBe(tableOf(made.body.seats, women[0].id));

    // 열 번을 섞어도 쌍은 붙어 있다
    for (let i = 0; i < 10; i++) {
      const after = await api<{ seats: Array<{ playerId: string; table: number }> }>(
        `/api/host/events/${ev.id}/seating/shuffle`,
        { method: "POST", cookie: master },
      );
      expect(tableOf(after.body.seats, men[0].id)).toBe(tableOf(after.body.seats, women[0].id));
    }
  });

  it("★ 커플 자리를 확정해도 배정이 닫히지 않는다", async () => {
    // 한 번 더 자리를 바꿀 일이 있다. '다시 열기' 같은 단계를 사이에 두지 않는다
    const ev = await freshEvent();
    for (let i = 0; i < 4; i++) await join(ev, { gender: i % 2 === 0 ? "M" : "F" });

    await api(`/api/host/events/${ev.id}/seating`, {
      method: "POST", cookie: master, body: { tableCount: 2, final: true },
    });
    const published = await api(`/api/host/events/${ev.id}/seating/publish`, { method: "POST", cookie: master });
    expect(published.status).toBe(200);

    // 곧바로 다시 배정할 수 있다
    const again = await api(`/api/host/events/${ev.id}/seating`, {
      method: "POST", cookie: master, body: { tableCount: 2, final: false },
    });
    expect(again.status).toBe(200);
  });

  it("만든 자리가 없으면 섞을 것도 없다", async () => {
    const ev = await freshEvent();
    const res = await api(`/api/host/events/${ev.id}/seating/shuffle`, { method: "POST", cookie: master });
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────── 콕 상한

describe("콕 상한", () => {
  it("★ 이미 쓴 횟수보다 낮게 내릴 수 없다", async () => {
    const ev = await freshEvent();   // maxPre 2
    const me = await join(ev);
    const her = await join(ev, { gender: "F" });
    const other = await join(ev, { gender: "F" });
    await setPhase(ev.id, "prevote");

    await api("/api/poke", { method: "POST", cookie: me.cookie, body: { toId: her.id } });
    await api("/api/poke", { method: "POST", cookie: me.cookie, body: { toId: other.id } });

    // 2회 쓴 사람이 있는데 1회로 내리면, 그 사람의 남은 횟수가 음수가 된다
    const res = await api<{ error: string; message: string }>(`/api/host/events/${ev.id}`, {
      method: "PUT",
      cookie: master,
      body: { config: { maxPre: 1, maxParty: 3 } },
    });
    expect(res.status).toBe(409);
    expect(res.body.message).toContain("2");

    // 같은 횟수나 그 위로는 된다
    const ok = await api(`/api/host/events/${ev.id}`, {
      method: "PUT",
      cookie: master,
      body: { config: { maxPre: 2, maxParty: 3 } },
    });
    expect(ok.status).toBe(200);
  });

  it("★ 입장 코드는 바꿀 수 없다 — 보내와도 무시한다", async () => {
    const ev = await freshEvent();
    const res = await api<EventMeta>(`/api/host/events/${ev.id}`, {
      method: "PUT",
      cookie: master,
      body: { name: "이름만 바뀐다", code: "ZZZZZZ", config: { maxPre: 2, maxParty: 3 } },
    });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("이름만 바뀐다");
    expect(res.body.code).toBe(ev.code);
  });

  it("★ 받은 콕은 현황 탭 순위로만 쓴다", async () => {
    // 운영자에게 아예 감췄다가(ADR-22), 현황 탭의 순위로만 되살렸다 (ADR-30).
    // 참가자 탭의 개인 행에는 여전히 넣지 않는다 — 명단을 훑으며 한 사람씩 볼 숫자가 아니다
    const ev = await freshEvent();
    const me = await join(ev);
    const her = await join(ev, { gender: "F" });
    await setPhase(ev.id, "prevote");
    await api("/api/poke", { method: "POST", cookie: me.cookie, body: { toId: her.id } });

    const state = await api<{ received: Record<string, number>; prevoteRank: unknown }>(
      `/api/host/events/${ev.id}/state`,
      { cookie: master },
    );
    expect(state.body.received[her.id]).toBe(1);
    expect(state.body.received[me.id]).toBe(0);
    expect(state.body.prevoteRank).toBeTruthy();

    // 참가자에게는 여전히 남의 받은 콕이 가지 않는다
    const mine = await api<ParticipantState>("/api/me", { cookie: me.cookie });
    expect(JSON.stringify(mine.body.roster)).not.toContain("received");
  });
});

// ─────────────────────────────────────────── 오늘의 연애운

describe("오늘의 연애운", () => {
  it("★ 파티가 시작돼야 열린다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);

    const early = await api("/api/fortune", { method: "POST", cookie: me.cookie });
    expect(early.status).toBe(409);

    await setPhase(ev.id, "prevote");
    expect((await api("/api/fortune", { method: "POST", cookie: me.cookie })).status).toBe(409);

    await setPhase(ev.id, "party");
    expect((await api("/api/fortune", { method: "POST", cookie: me.cookie })).status).toBe(200);
  });

  it("★ 한 번 연 운세는 다시 열어도 그대로다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    await setPhase(ev.id, "prevote");
    await setPhase(ev.id, "party");

    const first = await api<{ headline: string; mission: string; color: string }>("/api/fortune", {
      method: "POST",
      cookie: me.cookie,
    });
    const again = await api<{ headline: string; mission: string; color: string }>("/api/fortune", {
      method: "POST",
      cookie: me.cookie,
    });
    expect(again.body).toEqual(first.body);

    // 화면을 새로 열어도 같은 것이 실려 온다
    const state = await api<ParticipantState>("/api/me", { cookie: me.cookie });
    expect(state.body.fortune?.headline).toBe(first.body.headline);
  });

  it("★ 키가 없어도 화면에 들어갈 것이 다 온다", async () => {
    // 테스트 환경에는 LLM_API_KEY 가 없다. 규칙 문구로 떨어져야 한다
    const ev = await freshEvent();
    const me = await join(ev);
    await setPhase(ev.id, "prevote");
    await setPhase(ev.id, "party");

    const res = await api<{ headline: string; body: string; mission: string; fallback?: boolean }>(
      "/api/fortune",
      { method: "POST", cookie: me.cookie },
    );
    expect(res.status).toBe(200);
    expect(res.body.fallback).toBe(true);
    for (const line of [res.body.headline, res.body.body, res.body.mission]) {
      expect(line.length).toBeGreaterThan(0);
    }
    // 오늘의 기운은 세 문단이다
    expect(res.body.body.split(/\n\s*\n/).length).toBe(3);
  });

  it("남의 운세는 볼 수 없다", async () => {
    const ev = await freshEvent();
    await join(ev);
    await setPhase(ev.id, "prevote");
    await setPhase(ev.id, "party");

    const res = await api("/api/fortune", { method: "POST" });
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────── 되돌리기

describe("되돌리기", () => {
  it("★ 되돌려도 예약 때문에 즉시 다시 앞으로 밀리지 않는다", async () => {
    const ev = await freshEvent();

    // 사전 투표 시작을 이미 지난 시각으로 걸어둔 채, 시작했다가 등록으로 되돌린다
    const past = Date.now() - 60_000;
    const sched = await api(`/api/host/events/${ev.id}/schedule`, {
      method: "PUT",
      cookie: master,
      body: { regOpenAt: past - 60_000, prevoteAt: past },
    });
    expect(sched.status).toBe(200);
    await setPhase(ev.id, "prevote");
    await setPhase(ev.id, "reg");

    const after = await api<EventMeta>(`/api/host/events/${ev.id}`, { cookie: master });
    // 예약 시각이 지났는데도 다시 사전 투표로 끌려가지 않는다 (ADR-2)
    expect(after.body.phase).toBe("reg");
    // 예약 값은 지우지 않는다 — 기록으로 남아야 한다
    expect(after.body.schedule.prevoteAt).toBe(past);
    expect(after.body.fired.prevote).toBeGreaterThan(0);
  });

  it("발표를 되돌리면 파티 진행으로 돌아간다", async () => {
    const ev = await freshEvent();
    await setPhase(ev.id, "prevote");
    await setPhase(ev.id, "party");
    await setPhase(ev.id, "done");
    await setPhase(ev.id, "party");

    const after = await api<EventMeta>(`/api/host/events/${ev.id}`, { cookie: master });
    expect(after.body.phase).toBe("party");
    // 되돌려도 "발표했었다"는 사실은 남는다
    expect(after.body.fired.done).toBeGreaterThan(0);
  });
});
