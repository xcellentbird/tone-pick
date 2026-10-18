/**
 * 슬라이스 19 — 이상형 찾기의 평가 기록 (ADR-137)
 *
 * **파티 기록을 평가 자료로 계속 쓴다** (운영자, 2026-10-19). 결과가 된 찾기마다 **본 화면째** 한 줄이 회차 DO 에 남는다 —
 * 라운드마다 본 쪽(넘긴 쪽까지)과 그 쪽의 화면 순서, 고른 얼굴, 결과, 정답. 다시 찾아도 지난 찾기는 남는다.
 * 고른 얼굴만 남기던 때(ADR-133)는 고르지 않은 얼굴을 자산과 규칙으로 다시 세워야 했다 — 판이나 규칙이 바뀌면 그 길이 끊긴다.
 *
 * **앱에는 꺼내는 길이 없다** (ADR-133). 운영자가 Data Studio 에서 `IDEAL_RUNS_SQL` 을 돌린다. 그 쿼리가 이 기록의
 * 하나뿐인 문이라 **테스트도 그 쿼리를 그대로 돌린다** — 표 이름은 쿼리가 안다. 테스트는 쿼리의 답과 앱의 응답만 본다.
 *
 *   ★ 본 화면째 남는다 — 고른 얼굴과 고르지 않은 얼굴, 넘긴 쪽, 화면 순서
 *   ★ 다시 찾아도 지난 찾기가 남는다 — 참가자에게 보이는 결과는 새것 하나다 (S-C3 그대로)
 *   ★ 정답은 그 찾기에 붙는다
 *   ★ 꺼낸 것에 사람도 시각도 없다 — 사람마다 한 줄로 묶인다
 *   ★ 참가자를 지우면 그 사람의 기록도 지운다 (S-D2)
 *   ★ 기록은 참가자 응답 어디에도 없다 (S-D1)
 *   화면이 어긋나거나 없으면 결과는 남기고 화면만 뺀다 — 기록 때문에 결과가 깨지지 않는다
 *   결과가 되지 않은 저장은 기록하지 않는다 (S-E2) · 사람마다 `IDEAL_SHAPE.runs` 줄까지
 *   ★ 배포를 걸친 회차 — 기록이 생기기 전의 결과도 꺼낸 것에 선다(`prior`), 다시 찾으면 그것이 먼저 적힌다
 */
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { IDEAL_RUNS_SQL, IDEAL_SHAPE, type Ideal, type IdealInput, type IdealRun } from "../src/shared/ideal.ts";
import type { EventMeta, ParticipantState } from "../src/shared/types.ts";
import { api, freshEvent, join, master, setPhase, signInMaster } from "./helpers/party.ts";

beforeAll(signInMaster);

let seq = 0;

/**
 * 찾기 한 벌 — 1라운드는 한 번 넘겼고(넘긴 쪽 아홉 → 고른 쪽 아홉), 2 · 3라운드는 아홉 한 쪽이다.
 * 부를 때마다 id 가 다르다. 고른 얼굴은 일부러 쪽의 앞자리가 아닌 곳에 둔다 — 화면 순서가 그대로 남는지 본다
 */
function run(over: Partial<IdealInput> = {}) {
  const t = `zl${(++seq).toString(36).padStart(3, "0")}`;
  const page = (k: string) => Array.from({ length: IDEAL_SHAPE.faces }, (_, i) => `${t}${k}${i}`);
  const pages = [[page("x"), page("a")], [page("b")], [page("c")]];
  const input: IdealInput = {
    v: 6,
    pool: "F",
    picks: [[pages[0][1][4]], [pages[1][0][7], pages[1][0][0]], [pages[2][0][2]]],
    result: [`${t}r1`, `${t}r2`, `${t}r3`],
    start: 3,
    ...over,
  };
  return { input, pages };
}

/** 고른 얼굴도 결과도 아닌 id — 기록에만 있어야 하는 것 (넘긴 쪽 · 고르지 않은 얼굴) */
const onlyInPages = (r: ReturnType<typeof run>) => {
  const kept = new Set([...r.input.picks.flat(), ...r.input.result]);
  return r.pages.flat(2).filter((id) => !kept.has(id));
};

const save = (cookie: string | null, body: unknown) => api<Ideal>("/api/ideal", { method: "POST", cookie, body });
const verdict = (cookie: string | null, body: unknown) =>
  api<Ideal>("/api/ideal/verdict", { method: "POST", cookie, body });
const me = (cookie: string | null) => api<ParticipantState>("/api/me", { cookie });

async function openEvent(): Promise<EventMeta> {
  const ev = await freshEvent();
  await setPhase(ev.id, "prevote");
  return ev;
}

const stubOf = (ev: EventMeta) => {
  const ns = (env as unknown as { EVENT: DurableObjectNamespace }).EVENT;
  return ns.get(ns.idFromName(ev.id));
};

/** 운영자가 Data Studio 에서 돌리는 그 쿼리의 답 — 줄마다 한 사람. 찾기는 차례(`n`)대로 편다 */
async function exported(ev: EventMeta): Promise<{ raw: string; people: { runs: IdealRun[] }[] }> {
  const rows = await runInDurableObject(stubOf(ev), (_inst, state: DurableObjectState) =>
    state.storage.sql.exec<{ person: string }>(IDEAL_RUNS_SQL).toArray(),
  );
  const people = rows.map((r) => JSON.parse(r.person) as { runs: IdealRun[] });
  for (const p of people) p.runs.sort((a, b) => a.n - b.n);
  return { raw: JSON.stringify(rows), people };
}

describe("★ 결과가 된 찾기는 본 화면째 남는다 (ADR-137)", () => {
  it("★ 고른 얼굴 · 고르지 않은 얼굴 · 넘긴 쪽 · 화면 순서가 보낸 그대로 남는다", async () => {
    /*
     * 평가에는 **고른 얼굴과 같은 화면에서 고르지 않은 얼굴**이 함께 있어야 한다 — 고른 것만으로는 무엇을 마다했는지 모른다.
     * 넘긴 쪽(`다른 얼굴 보기`)은 아홉을 다 마다한 것이고, 화면 순서는 자리(윗줄)의 버릇을 잴 재료다
     */
    const ev = await openEvent();
    const a = await join(ev);
    const r = run();
    expect((await save(a.cookie, { ...r.input, pages: r.pages })).status).toBe(200);

    const { people } = await exported(ev);
    expect(people).toEqual([
      { runs: [{ n: 1, v: 6, pool: "F", start: 3, picks: r.input.picks, pages: r.pages, result: r.input.result }] },
    ]);
  });

  it("★ 다시 찾아도 지난 찾기는 기록에 남는다 — 참가자에게 보이는 결과는 새것 하나다 (S-C3)", async () => {
    const ev = await openEvent();
    const a = await join(ev);
    const one = run();
    const two = run({ pool: "M", start: 0 });
    const first = await save(a.cookie, { ...one.input, pages: one.pages });
    expect(first.status).toBe(200);
    const again = await save(a.cookie, { ...two.input, pages: two.pages, replaces: first.body.at });
    expect(again.status).toBe(200);

    const { people } = await exported(ev);
    expect(people).toHaveLength(1);
    expect(people[0].runs.map((x) => [x.n, x.pool, x.result])).toEqual([
      [1, "F", one.input.result],
      [2, "M", two.input.result],
    ]);
    expect(people[0].runs[0].pages).toEqual(one.pages);
    expect(people[0].runs[1].pages).toEqual(two.pages);

    // 참가자의 결과는 그대로 한 줄이다 — 지난 결과를 나란히 두지 않는다
    const state = await me(a.cookie);
    expect(state.body.ideal?.result).toEqual(two.input.result);
    expect(JSON.stringify(state.body)).not.toContain(one.input.result[0]);
  });

  it("★ 정답은 그 찾기에 붙는다 — 다시 찾은 뒤의 답은 새 찾기에만", async () => {
    const ev = await openEvent();
    const a = await join(ev);
    const one = run();
    const two = run();
    const first = await save(a.cookie, { ...one.input, pages: one.pages });
    expect((await verdict(a.cookie, { none: true })).status).toBe(200);
    const again = await save(a.cookie, { ...two.input, pages: two.pages, replaces: first.body.at });
    expect(again.status).toBe(200);
    expect((await verdict(a.cookie, { chosen: [two.input.result[1]] })).status).toBe(200);

    const { people } = await exported(ev);
    expect(people[0].runs.map((x) => x.verdict)).toEqual([{ none: true }, { chosen: [two.input.result[1]] }]);
  });
});

describe("★ 꺼내는 길 — 사람도 시각도 없다", () => {
  it("★ 사람마다 한 줄로 묶이고, 참가자 id · 닉네임 · 시각은 어디에도 없다", async () => {
    /*
     * 한 회차는 스무 명 남짓이다. 시각이 실리면 '그때 폰을 보던 사람' 과 맞춰지고, id 가 실리면 회차 저장소의 다른 표와 맞춰진다.
     * 같은 사람의 찾기는 묶여야 한다 — 다시 찾은 사람을 두 사람으로 세면 구간이 거짓으로 좁아진다
     */
    const ev = await openEvent();
    const a = await join(ev, { nickname: "zlnicka" });
    const b = await join(ev, { nickname: "zlnickb" });
    const ra = run();
    const rb = run({ pool: "M" });
    const sa = await save(a.cookie, { ...ra.input, pages: ra.pages });
    const sb = await save(b.cookie, { ...rb.input, pages: rb.pages });
    expect([sa.status, sb.status]).toEqual([200, 200]);
    const ra2 = run();
    expect((await save(a.cookie, { ...ra2.input, pages: ra2.pages, replaces: sa.body.at })).status).toBe(200);

    const { raw, people } = await exported(ev);
    expect(people.map((p) => p.runs.length).sort()).toEqual([1, 2]);
    for (const p of people) {
      expect(Object.keys(p)).toEqual(["runs"]);
      for (const x of p.runs) expect(x).not.toHaveProperty("at");
    }
    for (const leak of [a.id, b.id, "zlnicka", "zlnickb", String(sa.body.at), String(sb.body.at)]) {
      expect(raw, `꺼낸 것에 ${leak} 이 실렸다`).not.toContain(leak);
    }
  });

  it("★ 참가자를 지우면 그 사람의 기록도 지운다 (S-D2)", async () => {
    const ev = await openEvent();
    const a = await join(ev);
    const b = await join(ev);
    const ra = run();
    const rb = run();
    expect((await save(a.cookie, { ...ra.input, pages: ra.pages })).status).toBe(200);
    expect((await save(b.cookie, { ...rb.input, pages: rb.pages })).status).toBe(200);
    expect((await exported(ev)).people).toHaveLength(2);

    const del = await api(`/api/host/events/${ev.id}/players/${a.id}`, { method: "DELETE", cookie: master });
    expect(del.status).toBe(200);
    const { raw, people } = await exported(ev);
    expect(people.map((p) => p.runs[0].result)).toEqual([rb.input.result]);
    for (const id of [...ra.input.picks.flat(), ...onlyInPages(ra)]) expect(raw).not.toContain(id);
  });

  it("★ 기록은 참가자 응답 어디에도 없다 — 넘긴 쪽 · 고르지 않은 얼굴이 결과 행에 실리지 않는다 (S-D1)", async () => {
    const ev = await openEvent();
    const a = await join(ev, { gender: "M" });
    const b = await join(ev, { gender: "F" });
    await setPhase(ev.id, "party");
    const r = run();
    const saved = await save(a.cookie, { ...r.input, pages: r.pages });
    expect(saved.status).toBe(200);
    expect(saved.body).not.toHaveProperty("pages");

    const hidden = onlyInPages(r);
    expect(hidden.length, "고르지 않은 얼굴이 있어야 비교가 된다").toBeGreaterThan(20);
    for (const body of [saved.body, (await me(a.cookie)).body, (await me(b.cookie)).body]) {
      const s = JSON.stringify(body);
      expect(hidden.filter((id) => s.includes(id)), "참가자 응답에 기록이 샜다").toEqual([]);
    }
    const host = await api(`/api/host/events/${ev.id}/state`, { cookie: master });
    expect(host.status).toBe(200);
    const h = JSON.stringify(host.body);
    expect(hidden.filter((id) => h.includes(id)), "운영자 응답에 기록이 샜다").toEqual([]);
  });
});

describe("기록 때문에 결과가 깨지지 않는다", () => {
  it("★ 화면이 어긋나면 결과는 남기고 기록에서 화면만 뺀다", async () => {
    /*
     * 화면은 평가 자료일 뿐이다 — 모양이 틀렸다고 결과 저장을 막으면 파티장에서 결과를 못 보는 사람이 생긴다.
     * 기기는 서버가 모르는 자산으로 화면을 세운다(S-D3) — 서버는 모양만 보고, 틀리면 화면 없이 기록한다
     */
    const ev = await openEvent();
    const r = run();
    const [p1, p2, p3] = r.pages;
    const nine = (k: string) => Array.from({ length: IDEAL_SHAPE.faces }, (_, i) => `zlbad${k}${i}`);
    const bad: Array<[string, unknown]> = [
      ["배열이 아님", "pages"],
      ["두 라운드", [p1, p2]],
      ["네 라운드", [p1, p2, p3, [nine("d")]]],
      ["빈 라운드", [p1, [], p3]],
      ["넘김이 한도보다 많다", [[nine("e"), ...p1], p2, p3]],
      ["한 쪽에 열", [p1, [[...p2[0], "zlbadten0"]], p3]],
      ["빈 쪽", [p1, [[]], p3]],
      ["고른 얼굴이 마지막 쪽에 없다", [[p1[1], p1[0]], p2, p3]],
      ["한 찾기에 같은 얼굴이 두 번", [p1, p2, [[...p3[0].slice(0, 8), p2[0][3]]]]],
      ["id 가 아님", [p1, [[...p2[0].slice(0, 8), "No Space"]], p3]],
    ];
    for (const [why, pages] of bad) {
      const a = await join(ev);
      const res = await save(a.cookie, { ...r.input, pages });
      expect(res.status, why).toBe(200);
      expect(res.body.result, why).toEqual(r.input.result);
    }
    const { people } = await exported(ev);
    expect(people).toHaveLength(bad.length);
    for (const p of people) {
      expect(p.runs).toHaveLength(1);
      expect(p.runs[0], "어긋난 화면이 기록에 남았다").not.toHaveProperty("pages");
      expect(p.runs[0].picks).toEqual(r.input.picks);
    }
  });

  it("화면을 보내지 않는 기기도 결과를 남기고 기록에 선다 — 배포 전에 열어 둔 탭이다", async () => {
    const ev = await openEvent();
    const a = await join(ev);
    const r = run();
    expect((await save(a.cookie, r.input)).status).toBe(200);
    const { people } = await exported(ev);
    expect(people).toEqual([{ runs: [{ n: 1, v: 6, pool: "F", start: 3, picks: r.input.picks, result: r.input.result }] }]);
  });

  it("★ 결과가 되지 않은 저장은 기록하지 않는다 — 늦게 닿은 기기는 먼저 온 결과를 받는다 (S-E2)", async () => {
    const ev = await openEvent();
    const a = await join(ev);
    const one = run();
    const late = run();
    expect((await save(a.cookie, { ...one.input, pages: one.pages })).status).toBe(200);
    const res = await save(a.cookie, { ...late.input, pages: late.pages });
    expect(res.body.result).toEqual(one.input.result);

    const { people } = await exported(ev);
    expect(people[0].runs.map((x) => x.result)).toEqual([one.input.result]);
  });

  it(`사람마다 ${IDEAL_SHAPE.runs}줄까지 — 그 뒤의 다시 찾기는 결과만 바꾼다`, async () => {
    const ev = await openEvent();
    const a = await join(ev);
    let at: number | undefined;
    let last = run();
    for (let i = 0; i <= IDEAL_SHAPE.runs; i++) {
      last = run();
      const res = await save(a.cookie, { ...last.input, pages: last.pages, ...(at ? { replaces: at } : {}) });
      expect(res.status).toBe(200);
      at = res.body.at;
    }
    const { people } = await exported(ev);
    expect(people[0].runs.map((x) => x.n)).toEqual(Array.from({ length: IDEAL_SHAPE.runs }, (_, i) => i + 1));
    expect((await me(a.cookie)).body.ideal?.result).toEqual(last.input.result);
  });
});

describe("배포를 걸친 회차 — 기록이 생기기 전에 찾은 결과", () => {
  /*
   * 배포는 회차 한가운데 떨어질 수 있다 (114회차가 그랬다, ADR-133 ①). 그 전에 찾은 결과는 결과 행에만 있다 —
   * 공개 표면으로는 만들 수 없는 상태라 저장소에 직접 심는다 (옛 표를 직접 만드는 old-schema 테스트와 같은 까닭이다)
   */
  async function seedOld(ev: EventMeta, playerId: string, ideal: Ideal) {
    await runInDurableObject(stubOf(ev), (_inst, state: DurableObjectState) => {
      state.storage.sql.exec("INSERT INTO ideals (player_id, json) VALUES (?, ?)", playerId, JSON.stringify(ideal));
    });
  }

  it("★ 다시 찾지 않았어도 꺼낸 것에 선다 — 화면 없이 `prior` 로, 시각 · 설명글은 빼고", async () => {
    const ev = await openEvent();
    const a = await join(ev);
    const r = run();
    await seedOld(ev, a.id, { ...r.input, verdict: { chosen: [r.input.result[0]] }, story: "zlstoryold", at: 777_777 });

    const { raw, people } = await exported(ev);
    expect(people).toEqual([
      {
        runs: [
          {
            n: 1,
            prior: true,
            v: 6,
            pool: "F",
            start: 3,
            picks: r.input.picks,
            result: r.input.result,
            verdict: { chosen: [r.input.result[0]] },
          },
        ],
      },
    ]);
    expect(raw).not.toContain("zlstoryold");
    expect(raw).not.toContain("777777");
  });

  it("★ 그 결과를 다시 찾으면 지난 결과가 먼저 적힌다 — 다시 찾은 결과가 첫 찾기로 읽히지 않는다", async () => {
    /*
     * 안 적으면 지난 결과는 결과 행이 갈아끼워지며 사라지고, 결과를 본 뒤의 다시 찾기가 `n` 1 — 가장 깨끗한 찾기 — 로 읽힌다
     */
    const ev = await openEvent();
    const a = await join(ev);
    const one = run();
    const two = run();
    await seedOld(ev, a.id, { ...one.input, verdict: { none: true }, at: 5_555 });
    const res = await save(a.cookie, { ...two.input, pages: two.pages, replaces: 5_555 });
    expect(res.status).toBe(200);
    expect(res.body.result).toEqual(two.input.result);

    const { people } = await exported(ev);
    expect(people).toEqual([
      {
        runs: [
          { n: 1, prior: true, v: 6, pool: "F", start: 3, picks: one.input.picks, result: one.input.result, verdict: { none: true } },
          { n: 2, v: 6, pool: "F", start: 3, picks: two.input.picks, pages: two.pages, result: two.input.result },
        ],
      },
    ]);
  });
});
