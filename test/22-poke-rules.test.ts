/**
 * 콕 되돌리기와 알림 (ADR-34). 둘 다 **회차 설정**을 따른다.
 *
 * 여기 붙는 것은 둘이다 —
 *   · 알림을 끈 회차에서는 **발표 전까지 받은 수가 응답에 없다**
 *   · 되돌리면 **받지 않았던 상태로 돌아간다** (알림은 파생값이라 저절로 사라진다)
 */
import { SELF } from "cloudflare:test";
import { canPoke } from "../src/shared/phase.ts";
import { beforeEach, describe, expect, it } from "vitest";
import type { EventConfig, EventMeta, Invite, MyPokeState, ParticipantState, RegisterInput, RegisterResult } from "../src/shared/types.ts";

const MASTER_PIN = "1234";
const HOUR = 3600_000;

interface Res<T> { status: number; body: T; cookie: string | null }

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
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  return { status: res.status, body: body as T, cookie: baseCookie(res) };
}

let master: string | null = null;
let seq = 0;

beforeEach(async () => {
  master = (await api<{ scope: unknown }>("/api/host/pin", { method: "POST", body: { pin: MASTER_PIN } })).cookie;
});

async function freshEvent(
  config: Partial<EventConfig> = {},
  schedule: Partial<{ prevoteAt: number; voteEndAt: number }> = {},
): Promise<EventMeta> {
  seq++;
  const now = Date.now();
  const res = await api<EventMeta>("/api/host/events", {
    method: "POST",
    cookie: master,
    body: {
      name: `${seq}회차`,
      partyAt: now + 3 * 24 * HOUR,
      prevoteAt: now + 24 * HOUR,
      voteEndAt: now + 3 * 24 * HOUR - HOUR,
      revealAt: now + 3 * 24 * HOUR + 3 * HOUR,
      ...schedule,
      config: { maxPre: 2, maxParty: 3, ...config },
      requestId: `pr-${seq}-${now}`,
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

let phoneSeq = 0;

async function join(ev: EventMeta, gender: "M" | "F" = "M") {
  const phone = `0104000${String(1000 + phoneSeq++).slice(-4)}`;
  const added = await api<Invite[]>(`/api/host/events/${ev.id}/invites`, {
    method: "POST", cookie: master, body: { phones: [phone] },
  });
  const token = added.body.find((i) => i.phone === phone)!.token;
  const gate = await api(`/api/events/${ev.id}/enter`, { method: "POST", body: { token } });
  seq++;
  const input: RegisterInput = {
    nickname: `콕${String.fromCharCode(0xac00 + (seq % 1000))}`,
    realName: "김실명", age: 28, gender,
    instagram: `pk_${seq}`, mbti: "ENFP",
    charms: ["요리를 잘해요", "잘 웃어요", "노래를 좋아해요"],
  };
  const res = await api<RegisterResult>("/api/register", { method: "POST", cookie: gate.cookie, body: input });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { cookie: res.cookie, id: res.body.state.me.id };
}

const setPhase = (id: string, to: string) =>
  api(`/api/host/events/${id}/phase`, { method: "POST", cookie: master, body: { to } });
const poke = (cookie: string | null, toId: string) =>
  api<MyPokeState>("/api/poke", { method: "POST", cookie, body: { toId } });
const unpoke = (cookie: string | null, toId: string) =>
  api<MyPokeState>("/api/unpoke", { method: "POST", cookie, body: { toId } });
const meOf = (cookie: string | null) => api<ParticipantState>("/api/me", { cookie });
/** 받은 수는 라운드마다 따로다 (ADR-46 후기). 총합을 재는 자리에서는 여기서 더한다 */
const totalReceived = (res: { body: ParticipantState }) =>
  res.body.poke.received.pre + res.body.poke.received.party;

describe("알림 설정", () => {
  it("★ 알림을 끈 회차에서는 발표 전까지 받은 수가 응답에 없다", async () => {
    /*
     * 화면에서 감추는 것으로는 부족하다 — 개발자 도구를 여는 참가자가 있고,
     * 이 숫자 하나가 곧 "지금까지 몇 명이 나를 골랐나" 다.
     */
    const ev = await freshEvent();                 // 기본은 꺼짐
    const me = await join(ev);
    const her = await join(ev, "F");
    await setPhase(ev.id, "party");
    await poke(her.cookie, me.id);

    expect(totalReceived(await meOf(me.cookie))).toBe(0);
  });

  it("★ 발표되면 나간다 — 그래야 '몇 번 받았는지' 를 말할 수 있다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    const her = await join(ev, "F");
    await setPhase(ev.id, "party");
    await poke(her.cookie, me.id);
    await setPhase(ev.id, "done");

    expect(totalReceived(await meOf(me.cookie))).toBe(1);
  });

  it("★ 켠 회차에서는 그때그때 보인다", async () => {
    const ev = await freshEvent({ pokeNotify: true });
    const me = await join(ev);
    const her = await join(ev, "F");
    await setPhase(ev.id, "party");
    await poke(her.cookie, me.id);

    expect(totalReceived(await meOf(me.cookie))).toBe(1);
  });
});

describe("콕 되돌리기", () => {
  it("★ 되돌리면 받지 않았던 상태로 돌아간다", async () => {
    // 알림은 저장되지 않고 받은 수에서 파생된다 (`noticesOf`) — 그래서 줄이면 그 줄이 사라진다
    const ev = await freshEvent({ pokeNotify: true });
    const me = await join(ev);
    const her = await join(ev, "F");
    await setPhase(ev.id, "party");

    await poke(her.cookie, me.id);
    expect(totalReceived(await meOf(me.cookie))).toBe(1);

    const back = await unpoke(her.cookie, me.id);
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(totalReceived(await meOf(me.cookie))).toBe(0);
    // 예산도 돌아온다
    expect(back.body.budget.party.used).toBe(0);
  });

  it("★ 하나씩 무른다 — 두 번 찔렀으면 한 번만 돌아온다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    const her = await join(ev, "F");
    await setPhase(ev.id, "party");

    await poke(her.cookie, me.id);
    await poke(her.cookie, me.id);
    const back = await unpoke(her.cookie, me.id);
    expect(back.body.budget.party.used).toBe(1);
    expect(back.body.sentTo[me.id]).toBe(1);
  });

  /**
   * ★ **매력 투표는 파티 콕으로 새지 않는다** (ADR-34).
   *
   * 실제로 겪은 것: 매력 투표에서 한 사람을 고르고 파티가 시작되자,
   * 그 사람 카드에 `1` 이 붙어 **콕을 이미 찌른 것처럼** 보였다.
   * 남은 콕은 그대로였으니 화면이 스스로와 어긋나 있었던 셈이다.
   */
  it("★ 매력 투표에서 고른 것이 파티 콕 횟수로 세지 않는다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    const her = await join(ev, "F");
    await setPhase(ev.id, "prevote");
    await poke(me.cookie, her.id);

    await setPhase(ev.id, "party");
    const seen = await api<ParticipantState>(`/api/me?event=${ev.id}`, { cookie: me.cookie });
    // 그 사람 옆 숫자는 0 이다 — 파티에서는 아직 아무도 안 찔렀다
    expect(seen.body.poke.sentTo[her.id] ?? 0).toBe(0);
    // 예산은 라운드마다 따로 남는다. 매력 투표에서 쓴 건 거기 그대로 있다
    expect(seen.body.poke.budget.pre.used).toBe(1);
    expect(seen.body.poke.budget.party.used).toBe(0);
  });

  /**
   * ★ **되돌리기가 지울 것이 없는 채로 뜨면 안 된다.**
   *
   * 서버는 이번 라운드의 콕만 지운다. 화면이 합계를 보고 되돌리기를 내주면
   * 눌러도 아무 일이 없다 — 위 버그의 다른 얼굴이다.
   */
  it("★ 매력 투표에서 고른 것은 파티에서 되돌릴 수 없다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    const her = await join(ev, "F");
    await setPhase(ev.id, "prevote");
    await poke(me.cookie, her.id);
    await setPhase(ev.id, "party");

    const back = await unpoke(me.cookie, her.id);
    expect(back.status).toBe(404);
    // 매력 투표에서 고른 것은 그대로 남는다 — 자리의 재료다
    const seen = await api<ParticipantState>(`/api/me?event=${ev.id}`, { cookie: me.cookie });
    expect(seen.body.poke.budget.pre.used).toBe(1);
  });

  it("★ 못 무르게 한 회차에서는 파티 콕이 되돌려지지 않는다", async () => {
    const ev = await freshEvent({ allowUndo: false });
    const me = await join(ev);
    const her = await join(ev, "F");
    await setPhase(ev.id, "party");
    await poke(her.cookie, me.id);

    const back = await unpoke(her.cookie, me.id);
    expect(back.status).not.toBe(200);
    const state = await api<ParticipantState>("/api/me", { cookie: her.cookie });
    expect(state.body.poke.budget.party.used).toBe(1);
  });

  it("★ 되돌리기는 라운드마다 따로 정한다", async () => {
    // 파티 콕만 막은 회차에서 매력 투표는 그대로 무를 수 있다 (ADR-34)
    const ev = await freshEvent({ allowUndo: false });
    const me = await join(ev);
    const her = await join(ev, "F");
    await setPhase(ev.id, "prevote");
    await poke(her.cookie, me.id);

    const back = await unpoke(her.cookie, me.id);
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(back.body.budget.pre.used).toBe(0);
  });

  it("★ 매력 투표만 막을 수도 있다", async () => {
    const ev = await freshEvent({ allowUndoPre: false });
    const me = await join(ev);
    const her = await join(ev, "F");

    await setPhase(ev.id, "prevote");
    await poke(her.cookie, me.id);
    expect((await unpoke(her.cookie, me.id)).status).not.toBe(200);

    // 파티 콕은 그대로 무를 수 있다 — 설정이 갈려 있다
    await setPhase(ev.id, "party");
    await poke(her.cookie, me.id);
    expect((await unpoke(her.cookie, me.id)).status).toBe(200);
  });

  it("찌른 적 없는 사람은 무를 것이 없다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    const her = await join(ev, "F");
    await setPhase(ev.id, "party");
    expect((await unpoke(her.cookie, me.id)).status).not.toBe(200);
  });
});

/**
 * 파티 도중에 규칙이 갈리지 않는다 (ADR-35).
 *
 * 굳는 것은 넷 — 콕 대상 · 되돌리기 둘 · 알림 — 과 일정 셋이다.
 * 특히 알림은 파생값이라(`noticesOf`) 도중에 켜면 그때까지 쌓인 콕이 **한꺼번에** 나타난다.
 * "받은 콕은 한 번에 하나씩" 이 그 순간 통째로 깨진다.
 *
 * **콕 횟수는 일부러 굳지 않는다** — 파티 중에 올리는 것이 매칭이 모자랄 때의 손잡이다.
 */
describe("굳는 설정", () => {
  const fullConfig = (over: Partial<EventConfig> = {}): EventConfig =>
    ({ maxPre: 2, maxParty: 3, ...over }) as EventConfig;

  const putConfig = (id: string, config: EventConfig, name = "그대로") =>
    api<EventMeta>(`/api/host/events/${id}`, { method: "PUT", cookie: master, body: { name, config } });

  const putSchedule = (id: string, schedule: Record<string, number>) =>
    api(`/api/host/events/${id}/schedule`, { method: "PUT", cookie: master, body: schedule });

  it("★ 콕이 오가기 시작하면 되돌리기·알림·대상을 못 바꾼다", async () => {
    const ev = await freshEvent();
    await setPhase(ev.id, "prevote");

    for (const over of [
      { pokeNotify: true },
      { allowUndo: false },
      { allowUndoPre: false },
      { allowSameGender: false },
    ]) {
      const res = await putConfig(ev.id, fullConfig(over));
      expect(res.status, JSON.stringify(over)).toBe(409);
    }
  });

  it("★ 일정은 지나온 것씩 굳는다 (ADR-39)", async () => {
    /*
     * ADR-35 는 일정을 통째로 묶었는데, 매력 투표 마감에 시각이 생기면서 갈라야 했다 —
     * **파티가 늦어지면 마감도 미뤄야 한다.** 지나온 것만 잠근다.
     */
    const ev = await freshEvent();
    await setPhase(ev.id, "prevote");

    // 매력 투표는 이미 시작됐다 — 그 시각은 잠긴다
    expect((await putSchedule(ev.id, { prevoteAt: ev.schedule.prevoteAt! + HOUR })).status).toBe(409);
    // 파티 일시와 투표 마감은 아직 앞에 있다 — 미룰 수 있어야 한다
    expect((await putSchedule(ev.id, { partyAt: ev.schedule.partyAt! + HOUR })).status).toBe(200);
    expect((await putSchedule(ev.id, { voteEndAt: ev.schedule.voteEndAt! + HOUR })).status).toBe(200);

    // 파티가 시작되면 남은 일정이 없다 — 전부 잠긴다
    await setPhase(ev.id, "party");
    expect((await putSchedule(ev.id, { partyAt: ev.schedule.partyAt! + 2 * HOUR })).status).toBe(409);
    expect((await putSchedule(ev.id, { voteEndAt: ev.schedule.voteEndAt! + 2 * HOUR })).status).toBe(409);
  });

  it("★ 그 전에는 바꿀 수 있다 — 굳는 것은 콕이 오간 뒤부터다", async () => {
    const ev = await freshEvent();                 // 등록 단계
    expect((await putConfig(ev.id, fullConfig({ pokeNotify: true }))).status).toBe(200);
    expect((await putSchedule(ev.id, { prevoteAt: ev.schedule.prevoteAt! + HOUR })).status).toBe(200);
  });

  it("★ 같은 값을 다시 보내는 건 통과한다 — 이름만 고쳐도 저장돼야 한다", async () => {
    /*
     * 설정 탭은 저장할 때마다 설정과 일정을 **통째로** 다시 보낸다.
     * 막는 기준이 '보냈나' 였다면 굳은 회차에서는 이름조차 못 고친다.
     */
    const ev = await freshEvent({ pokeNotify: true, allowUndo: false });
    await setPhase(ev.id, "party");

    const res = await putConfig(ev.id, fullConfig({ pokeNotify: true, allowUndo: false }), "새 이름");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.name).toBe("새 이름");
    expect((await putSchedule(ev.id, ev.schedule as Record<string, number>)).status).toBe(200);
  });

  it("★ 콕 횟수는 굳은 뒤에도 올릴 수 있다 — 매칭이 모자랄 때의 손잡이다", async () => {
    const ev = await freshEvent();
    await setPhase(ev.id, "party");
    const res = await putConfig(ev.id, fullConfig({ maxParty: 5 }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.config.maxParty).toBe(5);
  });

  it("★ 단계를 되돌려도 잠금은 풀리지 않는다 — 오간 콕은 남아 있다", async () => {
    const ev = await freshEvent();
    await setPhase(ev.id, "prevote");
    await setPhase(ev.id, "reg");                  // 뒤로 물렸다. fired 는 남는다
    expect((await putConfig(ev.id, fullConfig({ pokeNotify: true }))).status).toBe(409);
  });
});

/**
 * 매력 투표는 **시각으로 닫힌다** (ADR-39).
 *
 * 전환이 아니라 판정이다 — 단계는 `prevote` 그대로고 알람도 울리지 않는다.
 * 이 시각과 파티 시작 사이가 운영자가 첫 자리를 짜는 시간이다.
 */
describe("매력 투표 마감", () => {
  it("★ 마감 시각이 지나면 투표가 닫힌다", async () => {
    const ev = await freshEvent({}, { voteEndAt: Date.now() - HOUR });
    const me = await join(ev);
    const her = await join(ev, "F");
    await setPhase(ev.id, "prevote");

    const res = await poke(her.cookie, me.id);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
  });

  it("★ 닫혀도 단계는 그대로다 — 명단과 프로필은 계속 보인다", async () => {
    /*
     * 마감은 **투표만** 닫는다. 단계까지 넘겨버리면 나이·MBTI 가 함께 열리고(ADR-21)
     * 콕이 열려서, 아직 아무도 안 온 자리에서 파티가 시작된 것이 된다.
     */
    const ev = await freshEvent({}, { voteEndAt: Date.now() - HOUR });
    const me = await join(ev);
    await join(ev, "F");
    await setPhase(ev.id, "prevote");

    const state = await meOf(me.cookie);
    expect(state.body.event.phase).toBe("prevote");
    // 명단은 나를 뺀 나머지다
    expect(state.body.roster.length).toBe(1);
  });

  it("★ 파티 콕은 마감 시각을 보지 않는다", async () => {
    // 파티 시작과 발표는 운영자가 누르는 것이라 그 사이에 마감할 시각이 없다 (ADR-14)
    const ev = await freshEvent({}, { voteEndAt: Date.now() - HOUR });
    const me = await join(ev);
    const her = await join(ev, "F");
    await setPhase(ev.id, "party");

    expect((await poke(her.cookie, me.id)).status).toBe(200);
  });

  it("마감 전에는 평소대로 찌른다", async () => {
    const ev = await freshEvent({}, { voteEndAt: Date.now() + HOUR });
    const me = await join(ev);
    const her = await join(ev, "F");
    await setPhase(ev.id, "prevote");

    expect((await poke(her.cookie, me.id)).status).toBe(200);
  });

  it("★ 마감 시각이 없는 옛 회차는 닫히지 않는다", () => {
    // 없는 마감을 만들어 조용히 막지 않는다. 이 결정 전에 만든 회차가 프로덕션에 있다
    expect(canPoke("prevote", Date.now(), {})).toBe(true);
    expect(canPoke("prevote", Date.now(), { voteEndAt: Date.now() - 1 })).toBe(false);
    // 운영자가 앞당겨 닫은 것도 같은 값이다 (ADR-39 후기)
    expect(canPoke("prevote", Date.now(), {}, { voteEnd: Date.now() - 1 })).toBe(false);
  });

  /**
   * 운영자가 마감을 **앞당겨도 단계는 그대로다** (ADR-39 후기).
   *
   * 넘기면 나이·MBTI(ADR-21)와 파티 콕이 함께 열려, **아직 아무도 안 온 자리에서
   * 파티가 시작된 것**이 된다. 마감이 닫는 건 표를 더 낼 수 있는가 하나뿐이다.
   */
  it("★ 마감을 앞당겨도 단계는 매력 투표 그대로다", async () => {
    const ev = await freshEvent({}, { voteEndAt: Date.now() + HOUR });
    const me = await join(ev);
    const her = await join(ev, "F");
    await setPhase(ev.id, "prevote");
    expect((await poke(her.cookie, me.id)).status).toBe(200);

    const closed = await api<EventMeta>(`/api/host/events/${ev.id}/vote-end`, { method: "POST", cookie: master });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);

    // 단계는 그대로 — 나이·MBTI 도 파티 콕도 아직 열리지 않았다
    expect(closed.body.phase).toBe("prevote");
    expect(closed.body.fired.party).toBeUndefined();
    // 표만 닫혔다
    expect((await poke(her.cookie, me.id)).status).toBe(409);
    // **예약은 기록으로 남는다** — 덮어쓰면 "예약은 몇 시였는데 언제 닫았다" 를 말할 수 없다
    expect(closed.body.schedule.voteEndAt).toBeTypeOf("number");
    expect(closed.body.fired.voteEnd).toBeTypeOf("number");
    expect(closed.body.fired.voteEnd).not.toBe(closed.body.schedule.voteEndAt);
  });

  it("두 번 눌러도 처음 닫은 시각이 남는다", async () => {
    const ev = await freshEvent({}, { voteEndAt: Date.now() + HOUR });
    await setPhase(ev.id, "prevote");
    const first = await api<EventMeta>(`/api/host/events/${ev.id}/vote-end`, { method: "POST", cookie: master });
    const again = await api<EventMeta>(`/api/host/events/${ev.id}/vote-end`, { method: "POST", cookie: master });
    expect(again.status).toBe(200);
    expect(again.body.fired.voteEnd).toBe(first.body.fired.voteEnd);
  });
});
