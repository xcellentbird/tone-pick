/**
 * 슬라이스 19 — 이상형 찾기의 서버 규칙 (시나리오 19-ideal-type · 표면 19-surface)
 *
 * 순수 함수(고르는 방식)는 `19-ideal-type.test.ts` 가 본다. 여기는 **저장과 공개 범위**다 —
 * 서버는 기기가 계산한 결과를 받아 **모양만** 보고 저장한다 (S-D3). 테스트도 그 문 밖에서만 두드린다:
 * `POST /api/ideal` · `POST /api/ideal/verdict` · `GET /api/me` · 운영자 응답 · 소켓.
 *
 *   S-A2  단계를 보지 않는다 — 등록부터, 되돌아간 준비 단계에서도
 *   S-C3  먼저 온 것이 남는다. 두 번째 저장은 첫 행을 돌려받는다
 *   S-E2  다른 기기가 늦게 보내도 409 가 아니라 저장된 행이다
 *   S-C4  정답은 한 번. 결과는 그대로다
 *   S-D1  남의 응답·명단·운영자 응답 어디에도 없다. 요청에 섞인 모르는 키도 저장되지 않는다
 *   S-D2  참가자를 지우면 함께 사라진다
 *   방송하지 않는다 — 내 행은 나만 본다
 *
 * id 는 회차마다 새로 짓는다 (`zq001a1` …). 응답 JSON 을 문자열로 뒤져 새는지 보는 재료라
 * 흔한 낱말과 겹치지 않는 모양으로 둔다.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { Ideal, IdealInput } from "../src/shared/ideal.ts";
import type { EventMeta, ParticipantState } from "../src/shared/types.ts";
import { api, enter, freshEvent, join, listen, master, setPhase, settle, signInMaster } from "./helpers/party.ts";

beforeAll(signInMaster);

let seq = 0;

/** 결과 한 벌. 부를 때마다 id 가 다르다 — 두 기기가 각자 고른 것처럼 */
function input(over: Partial<IdealInput> = {}): IdealInput {
  const t = `zq${(++seq).toString(36).padStart(3, "0")}`;
  return {
    v: 1,
    pool: "F",
    picks: [[`${t}a1`], [`${t}b1`, `${t}b2`], [`${t}c1`, `${t}c2`, `${t}c3`]],
    result: [`${t}r1`, `${t}r2`, `${t}r3`],
    ...over,
  };
}

/** 이 한 벌의 id 중 JSON 에 새어 나온 것 */
function leaked(json: unknown, inp: IdealInput): string[] {
  const raw = JSON.stringify(json);
  return [...inp.picks.flat(), ...inp.result].filter((id) => raw.includes(id));
}

const save = (cookie: string | null, body: unknown) =>
  api<Ideal>("/api/ideal", { method: "POST", cookie, body });
const verdict = (cookie: string | null, body: unknown) =>
  api<Ideal>("/api/ideal/verdict", { method: "POST", cookie, body });
const me = (cookie: string | null) => api<ParticipantState>("/api/me", { cookie });

// ─────────────────────────────────────────── A. 때

describe("S-A2 ★ 등록부터 열린다 — 단계를 보지 않는다", () => {
  /*
   * 남의 데이터를 전혀 쓰지 않으니 명단(ADR-21)처럼 아껴 열 이유가 없다.
   * **준비 단계도 포함이다** — 운영자가 등록을 되돌려도 이미 들어온 사람의 재미 탭은 그대로다.
   * 단계 검사가 한 줄이라도 끼면 그 단계의 사람은 저장 버튼을 눌렀다가 실패를 본다.
   */
  it("★ 등록 · 준비(되돌림) · 매력 투표 · 파티 · 발표 뒤 — 어느 단계에서도 저장하고 답한다", async () => {
    const ev = await freshEvent();
    const people = [];
    for (let i = 0; i < 5; i++) people.push(await join(ev, { gender: i % 2 ? "F" : "M" }));

    const steps: Array<[string, (() => Promise<void>) | null]> = [
      ["reg", null],
      ["prep", () => setPhase(ev.id, "prep")],
      ["prevote", () => setPhase(ev.id, "prevote")],
      ["party", () => setPhase(ev.id, "party")],
      ["done", () => setPhase(ev.id, "done")],
    ];
    for (const [i, [phase, move]] of steps.entries()) {
      await move?.();
      const p = people[i];
      const inp = input();

      const made = await save(p.cookie, inp);
      expect(made.status, `${phase} 에서 저장이 막혔다: ${JSON.stringify(made.body)}`).toBe(200);
      expect(made.body.result).toEqual(inp.result);

      const said = await verdict(p.cookie, { chosen: inp.result[0] });
      expect(said.status, `${phase} 에서 정답 확인이 막혔다`).toBe(200);
      expect(said.body.verdict).toEqual({ chosen: inp.result[0] });

      const state = await me(p.cookie);
      expect(state.body.event.phase).toBe(phase);
      expect(state.body.ideal, `${phase} 에서 다시 읽으면 결과가 있어야 한다`).toEqual(said.body);
    }
  });
});

// ─────────────────────────────────────────── C. 결과

describe("S-C3 ★ 한 번 찾으면 그대로 남는다", () => {
  it("★ 저장하면 저장된 행을 돌려준다 — 보낸 것 그대로, 시각은 서버가 적는다", async () => {
    const ev = await freshEvent();
    const a = await join(ev);
    const inp = input({ v: 3, pool: "M" });

    const made = await save(a.cookie, inp);
    expect(made.status).toBe(200);
    expect(made.body).toMatchObject({ v: 3, pool: "M", picks: inp.picks, result: inp.result });
    expect(typeof made.body.at).toBe("number");
    // 정답은 아직이다 — 결과를 본 뒤에야 생기는 값이다 (S-C4)
    expect(made.body).not.toHaveProperty("verdict");
  });

  it("★ 두 번 저장돼도 먼저 온 것이 남는다 — 두 번째 요청은 첫 행을 돌려받는다", async () => {
    const ev = await freshEvent();
    const a = await join(ev);
    const first = input();
    const second = input({ pool: "M", v: 2 });

    const one = await save(a.cookie, first);
    const two = await save(a.cookie, second);
    // 409 로 혼내지 않는다. 늦은 쪽이 잘못한 게 아니다
    expect(two.status).toBe(200);
    expect(two.body, "두 번째 요청이 결과를 바꿨다 — 테이블에서 한 말이 거짓말이 된다").toEqual(one.body);
    expect(leaked(two.body, second)).toEqual([]);
  });

  it("★ 다시 읽으면 같은 결과다 — /api/me 에 실려 온다", async () => {
    const ev = await freshEvent();
    const a = await join(ev);
    const made = await save(a.cookie, input());

    const state = await me(a.cookie);
    expect(state.status).toBe(200);
    expect(state.body.ideal).toEqual(made.body);
    // 두 번 읽어도 같다
    expect((await me(a.cookie)).body.ideal).toEqual(made.body);
  });

  it("아직 안 찾았으면 없는 채로 내려간다", async () => {
    const ev = await freshEvent();
    const a = await join(ev);
    const state = await me(a.cookie);
    expect(state.status).toBe(200);
    expect(state.body).not.toHaveProperty("ideal");
  });
});

describe("S-E2 ★ 같은 사람, 두 기기 — 먼저 끝낸 쪽이 남는다", () => {
  it("★ 늦게 보낸 기기는 자기가 고른 것이 아니라 저장된 그 행을 받는다", async () => {
    const ev = await freshEvent();
    const a = await join(ev);
    // 두 번째 기기 — 같은 번호 + PIN 번호로 들어온다 (ADR-75)
    const other = await enter(ev.id, a.phone, a.pin);
    expect(other.status).toBe(200);
    expect(other.body.registered).toBe(true);

    const mine = input();
    const theirs = input({ pool: "M" });
    const first = await save(a.cookie, mine);
    const late = await save(other.cookie, theirs);

    expect(late.status, "늦은 쪽을 409 로 혼냈다").toBe(200);
    expect(late.body).toEqual(first.body);
    // 방금 고른 셋이 아니다 — 화면은 이 응답을 그대로 그린다
    expect(leaked(late.body, theirs)).toEqual([]);
    expect((await me(other.cookie)).body.ideal).toEqual(first.body);
    expect((await me(a.cookie)).body.ideal).toEqual(first.body);
  });
});

describe("S-C4 ★ 정답을 한 번 묻는다", () => {
  async function saved() {
    const ev = await freshEvent();
    const a = await join(ev);
    const inp = input();
    const made = await save(a.cookie, inp);
    expect(made.status).toBe(200);
    return { a, inp, made: made.body };
  }

  it("★ 결과가 없으면 답할 것이 없다 — 404", async () => {
    const ev = await freshEvent();
    const a = await join(ev);
    expect((await verdict(a.cookie, { none: true })).status).toBe(404);
    // 답을 받았다고 결과가 생기지도 않는다
    expect((await me(a.cookie)).body).not.toHaveProperty("ideal");
    // 길이 없어서 404 가 난 게 아니다 — 결과가 생기면 같은 답이 받아진다
    const inp = input();
    expect((await save(a.cookie, inp)).status).toBe(200);
    expect((await verdict(a.cookie, { none: true })).status).toBe(200);
  });

  it("★ 결과 셋에 없는 사람은 고를 수 없다 — 400, 아무것도 남지 않는다", async () => {
    const { a, made } = await saved();
    const res = await verdict(a.cookie, { chosen: "zzzzother" });
    expect(res.status).toBe(400);
    expect((await me(a.cookie)).body.ideal).toEqual(made);
  });

  it("★ 셋 중 하나를 고르면 물음이 답으로 바뀐다 — 결과는 그대로다", async () => {
    const { a, inp, made } = await saved();
    const res = await verdict(a.cookie, { chosen: inp.result[1] });
    expect(res.status).toBe(200);
    expect(res.body.verdict).toEqual({ chosen: inp.result[1] });
    // 답이 결과를 바꾸면 S-C3 이 무너진다
    expect(res.body).toEqual({ ...made, verdict: { chosen: inp.result[1] } });
    expect((await me(a.cookie)).body.ideal).toEqual(res.body);
  });

  it("★ 한 번 답하면 다시 묻지 않는다 — 두 번째 답은 첫 답을 돌려받는다", async () => {
    const { a, inp } = await saved();
    const first = await verdict(a.cookie, { chosen: inp.result[0] });

    for (const again of [{ chosen: inp.result[2] }, { none: true }]) {
      const res = await verdict(a.cookie, again);
      expect(res.status, JSON.stringify(again)).toBe(200);
      expect(res.body, `${JSON.stringify(again)} 이 첫 답을 덮었다`).toEqual(first.body);
    }
    // 이미 답했으면 무엇이 오든 저장된 행이다 — 같은 답을 두 번 보낸 기기를 400 으로 혼내지 않는다
    const junk = await verdict(a.cookie, { chosen: "zzzzother" });
    expect(junk.status).toBe(200);
    expect(junk.body).toEqual(first.body);
    expect((await me(a.cookie)).body.ideal).toEqual(first.body);
  });

  it("★ '없었어요' 도 답이다 — 결과를 바꾸지도, 다시 찾기를 열지도 않는다", async () => {
    const { a, inp, made } = await saved();
    const res = await verdict(a.cookie, { none: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ...made, verdict: { none: true } });

    // 다시 찾기가 없다 — 새 결과를 보내도 처음 것이 돌아온다
    const retry = await save(a.cookie, input());
    expect(retry.body).toEqual(res.body);
    // 뒤늦게 고른 사람도 안 받는다
    expect((await verdict(a.cookie, { chosen: inp.result[0] })).body.verdict).toEqual({ none: true });
  });

  it("★ 답의 모양이 어긋나면 400 — 둘 다거나, 다른 값이거나", async () => {
    const { a, inp, made } = await saved();
    const bad: unknown[] = [
      {},
      null,
      [inp.result[0]],
      inp.result[0],
      { chosen: inp.result[0], none: true },
      { none: false },
      { none: "true" },
      { none: 1 },
      { chosen: 1 },
      { chosen: [inp.result[0]] },
      { chosen: inp.result[0].toUpperCase() },
    ];
    for (const body of bad) {
      expect((await verdict(a.cookie, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await me(a.cookie)).body.ideal, "어긋난 답이 남았다").toEqual(made);
  });
});

// ─────────────────────────────────────────── 모양

describe("모양만 본다 — 어긋나면 400 (S-D3)", () => {
  /*
   * 내용(정말 가까운가)은 안 본다 — 벡터를 서버에 들이지 않는다. 그래도 **모양은 서버가 문지기다.**
   * 화면이 이 행을 그대로 그리므로, 모양이 틀린 행이 한 번 저장되면 결과 화면이 영영 깨진 채로 남는다
   * (다시 하기가 없다).
   */
  it("★ 표 — 어느 칸이 어긋나도 저장하지 않는다", async () => {
    const ev = await freshEvent();
    const a = await join(ev);
    const base = input();
    const [r1, r2, r3] = base.picks;
    const bad: Array<[string, unknown]> = [
      ["빈 몸통", {}],
      ["null", null],
      ["배열", [base]],
      ["문자열", "ideal"],
      ["v 없음", { ...base, v: undefined }],
      ["v 0", { ...base, v: 0 }],
      ["v 음수", { ...base, v: -1 }],
      ["v 소수", { ...base, v: 1.5 }],
      ["v 문자열", { ...base, v: "1" }],
      // 지표 blob 으로 흘러가는 값이다 — 기기가 보낸 아무 숫자나 거기 쌓이면 안 된다
      ["v 너무 큼", { ...base, v: 10_000 }],
      ["pool 없음", { ...base, pool: undefined }],
      ["pool 모름", { ...base, pool: "X" }],
      ["pool 소문자", { ...base, pool: "f" }],
      ["picks 없음", { ...base, picks: undefined }],
      ["picks 가 묶음이 아님", { ...base, picks: "zq999a1" }],
      ["picks 두 라운드", { ...base, picks: [r1, r2] }],
      ["picks 네 라운드", { ...base, picks: [r1, r2, r3, ["zq999d1"]] }],
      ["빈 라운드", { ...base, picks: [[], r2, r3] }],
      // 한 라운드 상한은 다섯이다 (v2) — 넷·다섯은 아래 따로 200 을 본다
      ["한 라운드에 여섯", { ...base, picks: [r1, r2, [...r3, "zq999c4", "zq999c5", "zq999c6"]] }],
      ["라운드 안 중복", { ...base, picks: [r1, [r2[0], r2[0]], r3] }],
      ["라운드가 배열이 아님", { ...base, picks: [r1[0], r2, r3] }],
      ["id 가 문자열이 아님", { ...base, picks: [[1234], r2, r3] }],
      ["id 대문자", { ...base, picks: [["ZQ999A1"], r2, r3] }],
      ["id 짧음", { ...base, picks: [["abc"], r2, r3] }],
      ["id 김", { ...base, picks: [["a".repeat(17)], r2, r3] }],
      ["id 에 경로", { ...base, picks: [["../f000"], r2, r3] }],
      ["result 없음", { ...base, result: undefined }],
      ["result 둘", { ...base, result: base.result.slice(0, 2) }],
      ["result 넷", { ...base, result: [...base.result, "zq999r4"] }],
      ["result 중복", { ...base, result: [base.result[0], base.result[0], base.result[1]] }],
      ["result 나쁜 id", { ...base, result: [base.result[0], base.result[1], "no space"] }],
      ["result 가 배열이 아님", { ...base, result: base.result.join(",") }],
    ];
    for (const [why, body] of bad) {
      const res = await save(a.cookie, body);
      expect(res.status, why).toBe(400);
    }
    // 어느 것도 남지 않았다 — 남았으면 아래 정상 저장이 그 행을 돌려받는다
    expect((await me(a.cookie)).body).not.toHaveProperty("ideal");
    const good = await save(a.cookie, base);
    expect(good.status).toBe(200);
    expect(good.body.result).toEqual(base.result);
  });

  it("★ 한 라운드에 넷·다섯도 받는다 — 상한은 다섯이다 (v2)", async () => {
    /*
     * v2 는 아홉 얼굴에서 1~5 를 고른다. 문지기가 v1 상한(셋)에 머물러 있으면 넷째를 고른 사람은
     * 결과를 다 보고 저장에서 400 을 받는다 — 다시 하기가 없으니 그 사람의 결과는 영영 없다.
     */
    const ev = await freshEvent();
    const a = await join(ev);
    const b = await join(ev);
    const four = input();
    const t = four.picks[2][0].slice(0, -2);
    const five = input();
    const u = five.picks[2][0].slice(0, -2);
    four.picks = [four.picks[0], [...four.picks[1], `${t}b3`, `${t}b4`], four.picks[2]];
    five.picks = [five.picks[0], five.picks[1], [...five.picks[2], `${u}c4`, `${u}c5`]];
    expect(four.picks[1]).toHaveLength(4);
    expect(five.picks[2]).toHaveLength(5);

    const r4 = await save(a.cookie, four);
    expect(r4.status, JSON.stringify(r4.body)).toBe(200);
    expect(r4.body.picks).toEqual(four.picks);
    const r5 = await save(b.cookie, five);
    expect(r5.status, JSON.stringify(r5.body)).toBe(200);
    expect(r5.body.picks).toEqual(five.picks);
  });

  it("★ 요청에 섞인 모르는 키는 저장되지도 되돌아오지도 않는다 (S-D1)", async () => {
    /*
     * 요청 본문을 펼쳐 저장하면 기기가 보낸 무엇이든 `ParticipantState.ideal` 로 흘러 나간다 —
     * 그 칸은 매번 내 응답에 실린다. 저장 요청으로 정답(`verdict`)을 미리 박거나
     * 시각(`at`)을 지어내는 길도 같은 구멍이다.
     */
    const ev = await freshEvent();
    const a = await join(ev);
    const inp = input();
    const res = await save(a.cookie, {
      ...inp,
      verdict: { chosen: inp.result[0] },
      at: 1,
      zqleakkey: "zqleakvalue",
      nickname: "zqleaknick",
    });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["at", "picks", "pool", "result", "v"]);
    expect(res.body.at, "시각을 기기가 정했다").not.toBe(1);
    expect(JSON.stringify(res.body)).not.toContain("zqleak");

    const said = await verdict(a.cookie, { chosen: inp.result[2], zqleakkey: "zqleakvalue" });
    expect(said.status).toBe(200);
    expect(said.body.verdict).toEqual({ chosen: inp.result[2] });

    const state = await me(a.cookie);
    expect(state.body.ideal).toEqual(said.body);
    expect(JSON.stringify(state.body)).not.toContain("zqleak");
  });
});

// ─────────────────────────────────────────── D. 공개 범위

describe("S-D1 ★ 내 결과는 내 응답에만 있다", () => {
  it("★ 남의 응답 · 명단 · 운영자 응답 어디에도 없다", async () => {
    const ev = await freshEvent();
    const a = await join(ev, { gender: "M" });
    const b = await join(ev, { gender: "F" });
    // 명단이 열리고 나이·MBTI 까지 나가는 단계에서 본다 — 가장 넓게 열린 자리다
    await setPhase(ev.id, "party");
    const inp = input();
    expect((await save(a.cookie, inp)).status).toBe(200);
    expect((await verdict(a.cookie, { chosen: inp.result[0] })).status).toBe(200);

    // 내 응답에는 있다 — 한 칸이 전부다
    const mine = await me(a.cookie);
    expect(mine.body.ideal?.result).toEqual(inp.result);

    // 남의 응답: 그 사람 자신의 칸도, 명단의 내 줄도 비어 있다
    const theirs = await me(b.cookie);
    expect(theirs.status).toBe(200);
    expect(theirs.body).not.toHaveProperty("ideal");
    expect(theirs.body.roster.find((p) => p.id === a.id), "명단에 내가 있어야 비교가 된다").toBeTruthy();
    for (const p of theirs.body.roster) expect(p).not.toHaveProperty("ideal");
    expect(leaked(theirs.body, inp), "남의 응답에 내 결과가 샜다").toEqual([]);

    // 운영자도 안 본다 — 운영에 필요 없는 건 운영자도 안 본다 (ADR-22 와 같은 결)
    const host = await api(`/api/host/events/${ev.id}/state`, { cookie: master });
    expect(host.status).toBe(200);
    expect(leaked(host.body, inp), "운영자 상태에 결과가 샜다").toEqual([]);
    const meta = await api(`/api/host/events/${ev.id}`, { cookie: master });
    expect(meta.status).toBe(200);
    expect(leaked(meta.body, inp)).toEqual([]);
  });
});

/*
 * 이 두 테스트가 재는 것은 **공개 표면에서 보이는 만큼**이다 — 같은 번호로 온 새 사람이 앞사람의
 * 결과를 물려받지 않는 것, 지워진 세션이 행을 새로 쓰지 못하는 것. `deletePlayer` 의
 * `DELETE FROM ideals` 줄 자체는 **어느 테스트도 보지 못한다.** 다시 들어온 사람은 새 id 라
 * 앞사람의 행이 남아 있어도 어떤 응답에도 안 나온다 — 그 줄을 지워도 여기는 초록이다.
 * 운세(03-player-edit 의 `지운 사람의 운세가 남지 않는다`)와 같은 한계다.
 * 표 이름을 아는 테스트를 두지 않은 것은 고른 것이다 — 테스트는 공개 표면에만 붙인다 (ADR-122 대가).
 */
describe("S-D2 ★ 참가자를 지우면 결과도 사라진다", () => {
  it("★ 지운 뒤 같은 번호로 다시 들어온 새 사람에게 앞사람의 결과가 없다", async () => {
    const ev = await freshEvent();
    const a = await join(ev);
    const inp = input();
    expect((await save(a.cookie, inp)).status).toBe(200);
    expect((await me(a.cookie)).body.ideal?.result).toEqual(inp.result);

    const del = await api(`/api/host/events/${ev.id}/players/${a.id}`, { method: "DELETE", cookie: master });
    expect(del.status).toBe(200);

    // 같은 번호 → 새 사람이다 (등록 폼부터)
    const gate = await enter(ev.id, a.phone);
    expect(gate.body.registered).toBe(false);
    const again = await api<{ state: ParticipantState }>("/api/register", {
      method: "POST",
      cookie: gate.cookie,
      body: a.input,
    });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body.state).not.toHaveProperty("ideal");
    const state = await me(again.cookie);
    expect(state.body).not.toHaveProperty("ideal");
    expect(leaked(state.body, inp)).toEqual([]);
  });

  it("★ 지워진 사람의 세션은 저장도 답도 못 한다 — 404, 고아 행을 남기지 않는다", async () => {
    /*
     * 세션 쿠키는 서명만 된 것이라 지운 뒤에도 한동안 산다. 여기서 행이 써지면
     * 아무도 지우지 않는 행이 회차 DO 에 남는다 — 지우면 다 사라진다는 약속이 거기서 샌다.
     * 401 이 아니라 404 다: 세션은 멀쩡하고 **사람이** 없다 (화면은 404 를 `빠졌다` 로 읽는다).
     */
    const ev = await freshEvent();
    const a = await join(ev);
    const b = await join(ev);
    const inp = input();
    // 지우기 전에는 된다 — 아래 404 가 길이 없어서 난 것이 아님을 먼저 보인다
    expect((await save(b.cookie, inp)).status).toBe(200);
    await api(`/api/host/events/${ev.id}/players/${a.id}`, { method: "DELETE", cookie: master });
    await api(`/api/host/events/${ev.id}/players/${b.id}`, { method: "DELETE", cookie: master });

    expect((await save(a.cookie, input())).status).toBe(404);
    expect((await verdict(b.cookie, { chosen: inp.result[0] })).status).toBe(404);
  });
});

// ─────────────────────────────────────────── 문

describe("세션이 곧 사람이다", () => {
  it("★ 세션이 없으면 401", async () => {
    expect((await save(null, input())).status).toBe(401);
    expect((await verdict(null, { none: true })).status).toBe(401);
  });
});

describe("방송하지 않는다", () => {
  /*
   * 내 행은 나만 본다 — 남의 화면이 다시 읽을 까닭이 없다. 신호 하나가 곧 인원수만큼의 재조회이고
   * (ADR-26), 파티 중 마흔 명이 한꺼번에 결과를 저장하면 그 읽기가 콕 앞에 선다.
   * **내 소켓에도 보내지 않는다** — 화면은 응답을 그대로 그리고, 다른 기기는 다음에 다시 읽을 때 본다.
   */
  it("★ 저장·중복 저장·정답 확인 어느 것도 아무 소켓에도 신호를 보내지 않는다", async () => {
    const ev: EventMeta = await freshEvent();
    const a = await join(ev, { gender: "M" });
    const b = await join(ev, { gender: "F" });
    await setPhase(ev.id, "prevote");
    const socks = {
      self: await listen(ev, { cookie: a.cookie }),
      other: await listen(ev, { cookie: b.cookie }),
      host: await listen(ev, { cookie: master, host: true }),
      nobody: await listen(ev),
    };
    await settle();
    const before = Object.fromEntries(Object.entries(socks).map(([k, v]) => [k, v.length]));

    const inp = input();
    expect((await save(a.cookie, inp)).status).toBe(200);
    expect((await save(a.cookie, input())).status).toBe(200);
    expect((await verdict(a.cookie, { chosen: inp.result[0] })).status).toBe(200);
    await settle();

    for (const [k, got] of Object.entries(socks)) {
      expect(got.slice(before[k]), `${k} 에게 신호가 갔다`).toEqual([]);
    }
  });
});
