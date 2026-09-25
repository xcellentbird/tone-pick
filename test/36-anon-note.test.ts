/**
 * 슬라이스 36 — 익명 쪽지 (ADR-98). **서버 쪽 규칙만** 본다.
 *
 * 화면의 규칙(가리기·덮개·시트를 연 순간의 값으로 굳는 배지)은 `test/client/` 가 본다.
 * 여기서 지키는 것은 셋이다 —
 *
 *   1. **발신자는 어느 응답에도 없다.** 발표 뒤에도, 서로 콕 찌른 쌍에게도
 *   2. **본문은 두 사람만 본다.** 운영자 응답에는 보낸 장 수 하나뿐이다
 *   3. **받는 사람이 고르는 것은 발신자에게 돌아가지 않는다** — 지워도 발신자 화면이 한 칸도 안 바뀐다
 *
 * 재료는 `helpers/party.ts`. 파일이 마흔 개에 가까워지면 나눈다 (CLAUDE.md).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { LIMITS } from "../src/shared/constants.ts";
import { HOST_UI } from "../src/shared/copy.ts";
import type { Defaults, EventConfig, EventMeta, HostState, MyNoteState, ParticipantState } from "../src/shared/types.ts";
import { api, freshEvent, join, master, setPhase, signInMaster } from "./helpers/party.ts";

beforeAll(signInMaster);

const MIN = 60_000;

const send = (cookie: string | null, toId: string, text = "아까 웃는 모습이 좋았어요") =>
  api<MyNoteState>("/api/note", { method: "POST", cookie, body: { toId, text } });
const seen = (cookie: string | null) => api<MyNoteState>("/api/note/seen", { method: "POST", cookie });
const remove = (cookie: string | null, id: string) =>
  api<MyNoteState>("/api/note/remove", { method: "POST", cookie, body: { id } });
const me = (cookie: string | null, code: string) => api<ParticipantState>(`/api/me?code=${code}`, { cookie });
const hostState = (ev: EventMeta) => api<HostState>(`/api/host/events/${ev.id}/state`, { cookie: master });

/** 테스트 전용 시간 이동. 읽음이 5분 뒤에야 보인다는 규칙(S-B6)을 재는 자리다 */
const travelTo = async (at: number) => {
  expect((await api("/api/__test__/now", { method: "POST", body: { at } })).status).toBe(200);
};

/** 익명 쪽지가 열린 파티. 셋이 앉아 있다 — 이성 하나, 동성 하나 */
async function party(config: Partial<EventConfig> = { maxNotes: 2 }) {
  const ev = await freshEvent(config);
  const a = await join(ev, { gender: "M", nickname: "철수" });
  const b = await join(ev, { gender: "F", nickname: "영희" });
  const c = await join(ev, { gender: "M", nickname: "민수" });
  await setPhase(ev.id, "prevote");
  await setPhase(ev.id, "party");
  return { ev, a, b, c };
}

// ─────────────────────────────────────────── A. 보내기

describe("보내기", () => {
  it("★ 파티 중에만 보낸다 — 앞에서도 뒤에서도 409", async () => {
    const ev = await freshEvent({ maxNotes: 2 });
    const a = await join(ev, { gender: "M" });
    const b = await join(ev, { gender: "F" });

    expect((await send(a.cookie, b.id)).status, "등록 중").toBe(409);
    await setPhase(ev.id, "prevote");
    expect((await send(a.cookie, b.id)).status, "매력 투표 중").toBe(409);
    await setPhase(ev.id, "party");
    expect((await send(a.cookie, b.id)).status, "파티 중").toBe(200);
    await setPhase(ev.id, "done");
    expect((await send(a.cookie, b.id)).status, "발표 뒤").toBe(409);
  });

  it("★ 횟수는 회차 설정이 정한다 — 다 쓰면 409 no_budget", async () => {
    const { a, b, c } = await party({ maxNotes: 2 });
    expect((await send(a.cookie, b.id)).status).toBe(200);
    const second = await send(a.cookie, c.id);
    expect(second.status).toBe(200);
    expect(second.body.budget).toEqual({ max: 2, used: 2 });

    const third = await send(a.cookie, b.id);
    expect(third.status).toBe(409);
    expect((third.body as unknown as { error: string }).error).toBe("no_budget");
  });

  it("★ 0 이면 길 자체가 없다 — 값이 없는 옛 회차도 0 이다", async () => {
    for (const config of [{ maxNotes: 0 }, {}]) {
      const { ev, a, b } = await party(config);
      const res = await send(a.cookie, b.id);
      expect(res.status, JSON.stringify(config)).toBe(409);
      expect((res.body as unknown as { error: string }).error).toBe("closed");
      // 화면이 버튼도 kicker 도 안 그리는 근거는 이 숫자 하나다
      expect((await me(a.cookie, ev.code)).body.note.budget.max).toBe(0);
    }
  });

  it("★ 같은 사람에게 여러 장 — 받는 쪽에는 두 줄이 따로 선다", async () => {
    const { ev, a, b } = await party({ maxNotes: 2 });
    await send(a.cookie, b.id, "첫 장이에요");
    await send(a.cookie, b.id, "둘째 장이에요");

    const got = (await me(b.cookie, ev.code)).body.note.received;
    expect(got).toHaveLength(2);
    // 합쳐서 `2장` 으로 세지 않는다 — 본문이 있으니 합칠 수도 없다
    expect(got.map((n) => n.text).sort()).toEqual(["둘째 장이에요", "첫 장이에요"]);
    expect(new Set(got.map((n) => n.id)).size, "줄마다 다른 아이디").toBe(2);
  });

  it("★ 대상은 누구에게나 — 동성 콕 설정과 무관하다", async () => {
    const { a, c } = await party({ maxNotes: 2, allowSameGender: false });
    // 콕이면 409 였을 자리다 (`POKE.blocked.sameGender`)
    expect((await send(a.cookie, c.id)).status).toBe(200);
  });

  it("★ 자기 자신에게는 못 보낸다", async () => {
    const { a } = await party();
    expect((await send(a.cookie, a.id)).status).toBe(400);
  });

  it("★ 없는 사람에게는 못 보낸다 — 예산도 안 빠진다", async () => {
    const { ev, a } = await party();
    expect((await send(a.cookie, "없는사람")).status).toBe(400);
    expect((await me(a.cookie, ev.code)).body.note.budget.used).toBe(0);
  });

  it("★ 빈 글과 120자 초과는 거절한다", async () => {
    const { ev, a, b } = await party();
    const max = LIMITS.noteMax;
    for (const bad of ["", "   ", "\n", "가".repeat(max + 1)]) {
      expect((await send(a.cookie, b.id, bad)).status, JSON.stringify(bad.slice(0, 12))).toBe(400);
    }
    expect((await send(a.cookie, b.id, "가".repeat(max))).status, "딱 맞으면 통과").toBe(200);
    expect((await me(a.cookie, ev.code)).body.note.budget.used, "거절된 것은 안 센다").toBe(1);
  });

  it("★ 세션 없이는 안 된다", async () => {
    const { b } = await party();
    expect((await send(null, b.id)).status).toBe(401);
    expect((await seen(null)).status).toBe(401);
    expect((await remove(null, "x")).status).toBe(401);
  });
});

// ─────────────────────────────────────────── B. 보낸 쪽 — 본문과 읽음

describe("보낸 쪽", () => {
  it("★ 내가 보낸 본문은 그 사람 자리에 남는다 — 안 보낸 사람 자리에는 없다", async () => {
    const { ev, a, b, c } = await party({ maxNotes: 2 });
    await send(a.cookie, b.id, "커피 이야기 더 듣고 싶어요");

    const note = (await me(a.cookie, ev.code)).body.note;
    expect(note.sent[b.id]).toEqual([{ text: "커피 이야기 더 듣고 싶어요", read: false }]);
    expect(note.sent[c.id], "보낸 적이 없으면 묶음이 없다").toBeUndefined();
  });

  it("★ 받는 쪽의 줄에는 읽음 상태가 없다 — 쪽지함 배지가 쓰는 숫자 하나뿐이다", async () => {
    const { ev, a, b } = await party();
    await send(a.cookie, b.id);
    await seen(b.cookie);

    const mine = (await me(b.cookie, ev.code)).body.note;
    // 줄마다 `read` 도 `seen` 도 없다 — 어느 줄이 새것인지는 줄에 싣지 않는다 (ADR-98 후기 3)
    expect(JSON.stringify(mine.received)).not.toContain("read");
    expect(JSON.stringify(mine.received)).not.toContain("seen");
    expect(mine.unread).toBe(0);
    expect(mine.sent, "받기만 한 사람에게는 보낸 묶음이 비어 있다").toEqual({});
  });

  it("★ 읽음은 5분이 지나야 발신자에게 보인다 (S-B6)", async () => {
    const { ev, a, b } = await party();
    await send(a.cookie, b.id);
    expect((await me(a.cookie, ev.code)).body.note.sent[b.id][0].read, "아직 안 열었다").toBe(false);

    await seen(b.cookie);
    expect((await me(a.cookie, ev.code)).body.note.sent[b.id][0].read, "방금 읽었다 — 아직 안 보인다").toBe(false);

    try {
      await travelTo(Date.now() + 6 * MIN);
      expect((await me(a.cookie, ev.code)).body.note.sent[b.id][0].read, "5분이 지났다").toBe(true);
    } finally {
      await travelTo(Date.now());
    }
  });

  it("★ 읽음은 한 번만 선다 — 다시 열어도 시계가 되감기지 않는다", async () => {
    const { ev, a, b } = await party();
    await send(a.cookie, b.id);
    await seen(b.cookie);
    await seen(b.cookie);

    try {
      await travelTo(Date.now() + 6 * MIN);
      // 두 번째 `seen` 이 `read_at` 을 새로 찍었다면 여기서 아직 `false` 다
      expect((await me(a.cookie, ev.code)).body.note.sent[b.id][0].read).toBe(true);
    } finally {
      await travelTo(Date.now());
    }
  });
});

// ─────────────────────────────────────────── C. 받는 쪽

describe("받는 쪽", () => {
  it("★ 발신자는 어느 응답에도 없다 — 발표 뒤에도, 서로 콕 찌른 쌍에게도", async () => {
    const { ev, a, b } = await party({ maxNotes: 2, allowSameGender: false });
    await send(a.cookie, b.id, "오늘 재밌게 보내세요");
    // 서로 콕 찌른 쌍으로 만든다 — 발표 뒤에 실명이 열리는 관계다 (ADR-42)
    await api("/api/poke", { method: "POST", cookie: a.cookie, body: { toId: b.id } });
    await api("/api/poke", { method: "POST", cookie: b.cookie, body: { toId: a.id } });
    await setPhase(ev.id, "done");

    const state = (await me(b.cookie, ev.code)).body;
    const raw = JSON.stringify(state.note.received);
    expect(raw).not.toContain(a.id);
    expect(raw).not.toContain("철수");
    expect(raw).not.toContain("fromId");
    // 명단에도 매칭에도 익명 쪽지가 없다
    expect(JSON.stringify(state.roster)).not.toContain("오늘 재밌게 보내세요");
    expect(JSON.stringify(state.poke.matches)).not.toContain("오늘 재밌게 보내세요");
  });

  it("★ 시각이 없다 — 받은 콕과 같다", async () => {
    const { ev, a, b } = await party();
    await send(a.cookie, b.id);
    const got = (await me(b.cookie, ev.code)).body.note.received;
    // 담을 자리가 없는 것이 방어다 (`MatchInfo` 의 논리)
    expect(Object.keys(got[0]).sort()).toEqual(["id", "text"]);
  });

  it("★ 최신이 앞이다 (ADR-48)", async () => {
    const { ev, a, b, c } = await party({ maxNotes: 2 });
    await send(a.cookie, b.id, "먼저 온 것");
    await send(c.cookie, b.id, "나중에 온 것");
    const got = (await me(b.cookie, ev.code)).body.note.received;
    expect(got.map((n) => n.text)).toEqual(["나중에 온 것", "먼저 온 것"]);
  });

  it("★ 지워도 발신자 화면은 한 칸도 안 바뀐다 (S-C3)", async () => {
    const { ev, a, b } = await party({ maxNotes: 2 });
    await send(a.cookie, b.id, "지워질 글");
    await seen(b.cookie);
    const before = (await me(a.cookie, ev.code)).body.note;

    const got = (await me(b.cookie, ev.code)).body.note.received;
    const res = await remove(b.cookie, got[0].id);
    expect(res.status).toBe(200);
    expect(res.body.received, "받는 쪽에서는 사라진다").toHaveLength(0);

    // 예산도, 본문도, 읽음도 지우기 전과 똑같다 — 지웠다는 것이 어디에도 안 간다
    expect((await me(a.cookie, ev.code)).body.note).toEqual(before);
  });

  it("★ 안 읽은 수 — 쪽지함을 열면 0 이 되고, 지운 줄은 세지 않는다 (ADR-98 후기 3)", async () => {
    const { ev, a, b, c } = await party({ maxNotes: 2 });
    await send(a.cookie, b.id, "하나");
    await send(c.cookie, b.id, "둘");
    // 도착하면 바로 센다 — 늦춰 배달하지 않는다
    expect((await me(b.cookie, ev.code)).body.note.unread).toBe(2);

    const opened = await seen(b.cookie);
    expect(opened.body.unread, "쪽지함을 열었다").toBe(0);

    await send(a.cookie, b.id, "셋");
    const got = (await me(b.cookie, ev.code)).body.note;
    expect(got.unread, "연 뒤에 온 것만 센다").toBe(1);
    // 안 읽은 채로 지우면 셀 것도 사라진다 — 가리기 중에 제목만 보고 지우는 길이다
    const fresh = got.received.find((n) => n.text === "셋")!;
    expect((await remove(b.cookie, fresh.id)).body.unread).toBe(0);
    // 보낸 사람의 숫자는 받는 사람의 것이 아니다
    expect((await me(a.cookie, ev.code)).body.note.unread).toBe(0);
  });

  it("★ 지운 것은 다시 오지 않는다 — 새로 읽어도, 다시 지워도", async () => {
    const { ev, a, b } = await party();
    await send(a.cookie, b.id);
    const id = (await me(b.cookie, ev.code)).body.note.received[0].id;
    await remove(b.cookie, id);

    expect((await me(b.cookie, ev.code)).body.note.received).toHaveLength(0);
    // 이미 없는 것을 또 지워도 조용히 통과한다 — 두 번 누른 사람에게 오류를 주지 않는다
    expect((await remove(b.cookie, id)).status).toBe(200);
  });

  it("★ 남의 쪽지는 못 지운다 — 받는 사람만이다", async () => {
    const { ev, a, b, c } = await party({ maxNotes: 2 });
    await send(a.cookie, b.id);
    const id = (await me(b.cookie, ev.code)).body.note.received[0].id;

    expect((await remove(c.cookie, id)).status, "남이 지우려 했다").toBe(200);
    expect((await remove(a.cookie, id)).status, "보낸 사람도 못 지운다").toBe(200);
    expect((await me(b.cookie, ev.code)).body.note.received, "그대로 있다").toHaveLength(1);
  });
});

// ─────────────────────────────────────────── D. 운영자

describe("운영자", () => {
  it("★ 본문도 쌍도 받은 수도 없다 — 보낸 장 수 하나뿐이다 (S-D1)", async () => {
    const { ev, a, b } = await party({ maxNotes: 2 });
    await send(a.cookie, b.id, "본문이 새면 안 된다");

    const state = (await hostState(ev)).body;
    expect(state.noteSent[a.id]).toBe(1);
    // b 는 한 장을 **받았다**. 그 숫자가 어디에도 없으니 b 의 값은 보낸 0 이다 (ADR-22·30)
    expect(state.noteSent[b.id]).toBe(0);
    expect(state.noteUsedMax).toBe(1);
    expect(JSON.stringify(state)).not.toContain("본문이 새면 안 된다");
    // 쌍도 받은 수도 담을 칸이 없다 — 있으면 화면이 실수로라도 보여줄 수 있다
    expect(Object.keys(state).filter((k) => k.startsWith("note")).sort()).toEqual(["noteSent", "noteUsedMax"]);
  });

  it("★ 0 으로는 언제나 내려간다 — 1~5 는 이미 쓴 장 수가 바닥이다 (S-D2)", async () => {
    const { ev, a, b } = await party({ maxNotes: 5 });
    await send(a.cookie, b.id);
    await send(a.cookie, b.id);
    await send(a.cookie, b.id);

    const put = (maxNotes: number) =>
      api<EventMeta>(`/api/host/events/${ev.id}`, {
        method: "PUT",
        cookie: master,
        body: { name: ev.name, config: { ...ev.config, maxNotes } },
      });

    const low = await put(2);
    expect(low.status, "이미 3장 보낸 사람이 있다").toBe(409);
    // 쪽지의 바닥은 쪽지로 말한다 — 콕 문구(`이미 3회 찌른 참가자가…`)가 나가면 운영자는 엉뚱한 것을 찾는다
    expect((low.body as unknown as { message?: string }).message).toBe(HOST_UI.noteFloor(3));
    expect((await put(3)).status, "바닥까지는 된다").toBe(200);
    // 0 은 이 회차의 익명 쪽지를 닫는 스위치라 바닥에 안 걸린다 — 운영자의 유일한 레버다
    const off = await put(0);
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(off.body.config.maxNotes ?? 0).toBe(0);

    // 닫혀도 이미 온 것은 남는다
    expect((await me(b.cookie, ev.code)).body.note.received).toHaveLength(3);
    expect((await send(a.cookie, b.id)).status).toBe(409);
  });

  it("★ 나간 사람이 보낸 장 수는 바닥이 아니다 — 운영자 화면이 세는 것과 같다", async () => {
    /*
     * 나간 사람이 보낸 쪽지 줄은 남는다 (발신자의 장 수를 지키려고). 그 줄까지 바닥에 넣으면 운영자 화면은
     * 내려도 된다고 하는데 서버가 409 로 막았다 — 화면의 숫자와 서버의 숫자가 달랐다.
     */
    const { ev, a, b, c } = await party({ maxNotes: 5 });
    for (let i = 0; i < 3; i++) await send(a.cookie, b.id);
    await send(c.cookie, b.id);
    await api(`/api/host/events/${ev.id}/players/${a.id}`, { method: "DELETE", cookie: master });

    const put = await api<EventMeta>(`/api/host/events/${ev.id}`, {
      method: "PUT",
      cookie: master,
      body: { name: ev.name, config: { ...ev.config, maxNotes: 1 } },
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
  });

  it("★ 굳지 않는다 — 콕이 오간 뒤에도 고칠 수 있다 (ADR-35)", async () => {
    const { ev } = await party({ maxNotes: 1 });
    const res = await api<EventMeta>(`/api/host/events/${ev.id}`, {
      method: "PUT",
      cookie: master,
      body: { name: ev.name, config: { ...ev.config, maxNotes: 4 } },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.config.maxNotes).toBe(4);
  });

  it("★ 다른 설정을 저장해도 안 사라진다 — `meta.config` 는 통째로 교체다", async () => {
    /*
     * 교체 리터럴에 `maxNotes` 를 안 적으면 **저장 한 번에 사라진다.** 이 저장소는 그 사고를
     * 이미 겪었다 — 옛 회차의 `allowUndo` 가 그렇게 없어졌다 (ADR-95).
     * 운영자가 파티 중에 콕 횟수를 올리는 것은 허용된 흔한 동작이다.
     */
    const { ev } = await party({ maxNotes: 3 });
    const res = await api<EventMeta>(`/api/host/events/${ev.id}`, {
      method: "PUT",
      cookie: master,
      body: { name: ev.name, config: { maxPre: 2, maxParty: 5 } },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.config.maxNotes, "안 보낸 값은 지금 값을 지킨다").toBe(3);
  });

  /**
   * ★ **운영자 기본값도 통째로 교체다.** 위 `meta.config` 와 같은 사고가 기본값 저장에서 났다 —
   * 라우트는 장 수를 넘기는데 레지스트리가 그 칸을 안 적어서, 기본값 화면에서 몇 장으로 바꾸든
   * 다시 읽으면 앱 기본값(2장)이었다. 에러도 없이 조용히 무시됐다. 슬라이스 38 이 리터럴을 고쳤고
   * 이 테스트가 그 자리를 지킨다.
   *
   * **0 을 꼭 본다.** 익명 쪽지를 기본으로 끄는 것이 운영자가 고를 수 있어야 하는 값이다 —
   * 0 이 기본값으로 접히면 끈 줄 알고 만든 회차마다 쪽지가 열린다.
   */
  it("★ 운영자 기본값의 장 수가 저장된다 — 0 도 그대로 남는다", async () => {
    const before = await api<Defaults>("/api/host/defaults", { cookie: master });
    try {
      for (const maxNotes of [4, 0]) {
        const put = await api<Defaults>("/api/host/defaults", {
          method: "PUT",
          cookie: master,
          body: { ...before.body, maxNotes },
        });
        expect(put.status, JSON.stringify(put.body)).toBe(200);
        expect(put.body.maxNotes, `${maxNotes}장 저장 응답`).toBe(maxNotes);
        const again = await api<Defaults>("/api/host/defaults", { cookie: master });
        expect(again.body.maxNotes, `${maxNotes}장으로 저장하고 다시 읽었다`).toBe(maxNotes);
      }

    } finally {
      // 다른 테스트가 기본값을 읽는다 — 되돌려 둔다
      await api("/api/host/defaults", { method: "PUT", cookie: master, body: before.body });
    }
  });
});

// ─────────────────────────────────────────── E. 삭제

describe("참가자를 지울 때", () => {
  it("★ 받은 사람을 지워도 발신자의 장 수는 안 줄어든다 (S-E1)", async () => {
    const { ev, a, b, c } = await party({ maxNotes: 2 });
    await send(a.cookie, b.id);
    await send(a.cookie, c.id);

    await api(`/api/host/events/${ev.id}/players/${b.id}`, { method: "DELETE", cookie: master });

    // 운영자 화면에서 줄어들면 기본 2장짜리 회차에서 발신자가 한 명까지 좁혀진다
    expect((await hostState(ev)).body.noteSent[a.id]).toBe(2);
    // 예산이 돌아오면 가해자가 재장전한다 — 쪽지는 이미 전달된 말이다
    const mine = (await me(a.cookie, ev.code)).body.note;
    expect(mine.budget).toEqual({ max: 2, used: 2 });
    expect((await send(a.cookie, c.id)).status).toBe(409);
  });

  it("★ 보낸 사람을 지워도 받은 줄은 그대로 있다 (S-E1)", async () => {
    const { ev, a, b } = await party({ maxNotes: 2 });
    await send(a.cookie, b.id, "남아 있어야 하는 글");
    await api(`/api/host/events/${ev.id}/players/${a.id}`, { method: "DELETE", cookie: master });

    const got = (await me(b.cookie, ev.code)).body.note.received;
    expect(got).toHaveLength(1);
    expect(got[0].text).toBe("남아 있어야 하는 글");
  });

  it("★ 회차를 지우면 익명 쪽지도 함께 사라진다", async () => {
    const { ev, a, b } = await party({ maxNotes: 2 });
    await send(a.cookie, b.id);
    expect((await api(`/api/host/events/${ev.id}`, { method: "DELETE", cookie: master })).status).toBe(200);
    expect((await me(b.cookie, ev.code)).status).toBe(404);
  });
});
