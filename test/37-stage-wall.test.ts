/**
 * 슬라이스 37 — 한 탭 스테이지. 운영자와 참가자 화면을 한꺼번에 보고, 콕을 쉽게 친다 (ADR-99).
 *
 *   참가자 남녀를 따로 2~50명, 등록은 묶음으로 나눠도 같다
 *   콕     뿌리기 · 모으기 · 서로 콕 N쌍 — 앱의 규칙(상한 · 이성)을 넘지 않는다
 *   상한   QA 를 부른 횟수로 센다 — 만들기 전 어림이 실제보다 작지 않고, 묶음 명령은 한 요청의 몫 안이다
 *   쿠키   틀에 심는 것은 참가자 쿠키 하나 — 그 쿠키로 QA 가 그 참가자를 알아본다
 *   화면   틀은 QA 의 공개 주소로, 페이지에 세션 토큰이 없다
 *
 * 나이와 자동 콕은 `37-stage-auto.test.ts` 다.
 *
 * core 는 **`fetchApp` 을 넣어 진짜 앱에 대고** 돌린다 (35 와 같다). 워커의 라우터 · DO 와 틀 여럿을 붙여
 * 브라우저에서 돌려 본 기록은 ADR-99 에 있다.
 */
import { fetchApp } from "./helpers/app.ts";
import { beforeAll, describe, expect, it } from "vitest";
import { BULK_MAX, autoTables, beginStage, buildStage, createLog } from "../scripts/qa/core.mjs";
import { DAILY, OVERHEAD, buildCost, grant, quotaDay, refusal } from "../scripts/qa/worker/budget.ts";
import { PLAYER_COOKIE as PLANTED, clearCookie, cookieDomain, frameName, plantCookie } from "../scripts/qa/worker/plant.ts";
import { ACTION_MAX, ENROLL_BATCH, START_PHASES } from "../scripts/qa/worker/stage-do.ts";
import { stagePage } from "../scripts/qa/worker/view.ts";
import { PLAYER_COOKIE } from "../src/server/auth.ts";
import type { HostState, ParticipantState } from "../src/shared/types.ts";
import { api, master, signInMaster } from "./helpers/party.ts";

beforeAll(signInMaster);

const BASE = "https://tone-pick.test";
const PUBLIC = "https://tone-pick-qa.example.workers.dev";

/** 스테이지 워커와 같은 모양으로 core 를 부른다. `calls` 가 QA 를 부른 횟수를 센다 */
function env() {
  const counter = { calls: 0 };
  return {
    counter,
    fetch: (url: string, init?: RequestInit) => {
      counter.calls++;
      return fetchApp(url, init);
    },
    base: BASE,
    publicBase: PUBLIC,
    log: createLog(),
    platform: {},
    timeTravel: false,
  };
}
const want = (over: Record<string, unknown> = {}) => ({ men: 3, women: 3, phase: "party", tables: 2, config: {}, pin: "1234", practiceOnly: false, ...over });
const hostState = async (id: string) => (await api<HostState>(`/api/host/events/${id}/state`, { cookie: master })).body;
type Persona = { n: number; id: string; gender: "M" | "F"; session: { ref: string; cookies: Map<string, string>; call: (p: string) => Promise<{ status: number; body: unknown }> } };

describe("가짜 참가자 — 남녀를 따로, 모두 등록을 마친 채로", () => {
  it("★ 남녀 수를 따로 받는다 — 번호는 남 · 여 · 남 · 여, 한쪽이 떨어지면 남은 쪽이 잇는다", async () => {
    const stage = await buildStage(env(), want({ men: 2, women: 4, phase: "prevote" }));
    expect(stage.cast.map((p: Persona) => p.gender)).toEqual(["M", "F", "M", "F", "F", "F"]);
    const st = await hostState(stage.event.id);
    expect(st.players.filter((p) => p.gender === "M")).toHaveLength(2);
    expect(st.players.filter((p) => p.gender === "F")).toHaveLength(4);
    // 모두 등록을 마쳤다 — 가짜 참가자는 등록 화면을 거치지 않는다
    expect(st.meta.phase).toBe("prevote");
    await stage.close();
  });

  it("★ 등록 단계에서도 시작한다 — 가짜 참가자는 모두 등록을 마쳤고, 회차는 아직 등록 중이다", async () => {
    expect(START_PHASES).toContain("reg");
    const stage = await buildStage(env(), want({ men: 2, women: 2, phase: "reg" }));
    const st = await hostState(stage.event.id);
    expect(st.meta.phase).toBe("reg");
    expect(st.players).toHaveLength(4);
    await stage.close();
  });

  it("★ 스테이지 중에 참가자를 더한다 — 남자나 여자를 골라서, 그 성별의 나이 범위 안에서", async () => {
    const ages = { M: { avg: 40, min: 38, max: 44 }, F: { avg: 22, min: 20, max: 25 } };
    const stage = await buildStage(env(), want({ men: 2, women: 2, phase: "party", ages }));
    for (const line of ["late f", "late f", "late m"]) await stage.run(line);
    const added = (stage.cast as Persona[]).slice(4);
    expect(added.map((p) => p.gender)).toEqual(["F", "F", "M"]);
    const st = await hostState(stage.event.id);
    for (const p of added) {
      const player = st.players.find((q) => q.id === p.id)!;
      expect(player.gender).toBe(p.gender);
      expect(player.age).toBeGreaterThanOrEqual(ages[p.gender].min);
      expect(player.age).toBeLessThanOrEqual(ages[p.gender].max);
      // 더한 사람도 제 세션으로 앱을 쓴다 — 화면을 띄우면 그 사람으로 뜬다
      expect(((await p.session.call("/me")).body as ParticipantState).me.id).toBe(p.id);
    }
    await stage.close();
  });

  it("★ 등록을 묶음으로 나눠도 같다 — 한 요청이 QA 를 부를 수 있는 횟수에 끝이 있다", async () => {
    const e = env();
    const stage = await beginStage(e, want({ men: 3, women: 2 }));
    expect(stage.pending).toHaveLength(5);
    const left: number[] = [];
    while (stage.pending.length) left.push(await stage.enrollSome(2));
    expect(left).toEqual([3, 1, 0]);
    for (const p of stage.cast as Persona[]) {
      const me = await p.session.call("/me");
      expect((me.body as ParticipantState).me.id).toBe(p.id);
    }
    await stage.close();
  });

  it("★ 파티로 갈 때 테이블 수는 앱이 받는 범위 안이다 — 1~12, 한 테이블에 둘 이상", () => {
    for (let people = 4; people <= 100; people++) {
      const t = autoTables(people);
      expect(t, String(people)).toBeGreaterThanOrEqual(1);
      expect(t, String(people)).toBeLessThanOrEqual(12);
      expect(people, String(people)).toBeGreaterThanOrEqual(t * 2);
    }
  });
});

describe("콕 — 쉽게, 앱의 규칙 안에서", () => {
  it("★ 콕 뿌리기는 상한을 넘지 않고 이성에게만 찌른다", async () => {
    const stage = await buildStage(env(), want());
    await stage.run(`spray ${BULK_MAX}`);
    const gender = new Map((stage.cast as Persona[]).map((p) => [p.id, p.gender]));
    let total = 0;
    for (const p of stage.cast as Persona[]) {
      const { poke } = (await p.session.call("/me")).body as ParticipantState;
      expect(poke.budget.party.used).toBeLessThanOrEqual(poke.budget.party.max);
      for (const to of Object.keys(poke.sentTo)) expect(gender.get(to)).not.toBe(p.gender);
      total += poke.budget.party.used;
    }
    // 여섯 명이 두 번씩 — 뿌리기는 남은 콕을 다 쓴다
    expect(total).toBe(12);
    expect((await hostState(stage.event.id)).pokeCount.party).toBe(12);
    await stage.close();
  });

  it("★ 콕 모으기 — 한 사람에게 이성 N명이 한 번씩", async () => {
    const stage = await buildStage(env(), want());
    const [first] = stage.cast as Persona[];
    await stage.run(`crowd ${first.n} 3`);
    expect((await hostState(stage.event.id)).received.party[first.id]).toBe(3);
    await stage.close();
  });

  it("★ 서로 콕 N쌍 — 남녀를 짝지어 서로 한 번씩", async () => {
    const stage = await buildStage(env(), want());
    await stage.run("pairs 2");
    const st = await hostState(stage.event.id);
    expect(st.mutual).toHaveLength(2);
    expect(st.pokeCount.party).toBe(4);
    await stage.close();
  });
});

describe("하루 상한 — QA 를 부른 횟수로 센다", () => {
  it("★ 남은 만큼만 주고, 요청 하나의 몫도 못 채우면 주지 않는다", () => {
    expect(grant(0, 50)).toBe(50);
    expect(grant(DAILY - 20, 50)).toBe(20);
    expect(grant(DAILY - OVERHEAD, 50)).toBe(0);
    expect(grant(DAILY, 50)).toBe(0);
    expect(grant(DAILY + 7, 50)).toBe(0);
    expect(refusal()).toContain("오전 9시");
  });

  it("★ 하루는 한국 오전 9시(00:00 UTC)에 바뀐다 — Cloudflare 의 하루 한도가 다시 차는 때다", () => {
    const kst = (d: number, h: number, m = 0) => Date.UTC(2026, 8, d, h - 9, m);
    expect(quotaDay(kst(25, 8, 59))).toBe(quotaDay(kst(24, 9, 0)));
    expect(quotaDay(kst(25, 9, 0))).not.toBe(quotaDay(kst(25, 8, 59)));
    // 자정은 경계가 아니다 — 밤에 QA 를 하다 날짜가 넘어가도 이어서 센다
    expect(quotaDay(kst(25, 0, 30))).toBe(quotaDay(kst(24, 23, 30)));
  });

  it("★ 만들기 전 어림이 실제보다 작지 않다 — 작으면 가다가 막혀 등록한 사람들이 몫만 먹고 지워진다", async () => {
    const e = env();
    const stage = await buildStage(e, want({ men: 3, women: 2, phase: "done" }));
    const batches = Math.ceil(5 / ENROLL_BATCH);
    expect(e.counter.calls).toBeLessThanOrEqual(buildCost(5, batches) - OVERHEAD * (batches + 2));
    await stage.close();
  });

  it("★ 묶음 명령은 요청 하나의 몫 안에서 끝난다 — 서브요청 상한 아래", async () => {
    const e = env();
    const stage = await buildStage(e, want({ men: 6, women: 6 }));
    for (const line of ["auto last", `spray ${BULK_MAX}`, `crowd 1 ${BULK_MAX}`, "pairs 10", "lock 2"]) {
      e.counter.calls = 0;
      await stage.run(line);
      expect(e.counter.calls, line).toBeLessThanOrEqual(BULK_MAX);
    }
    expect(BULK_MAX).toBeLessThan(ACTION_MAX);
    expect(ENROLL_BATCH * 2).toBeLessThanOrEqual(ACTION_MAX);
    await stage.close();
  });
});

describe("틀에 심는 쿠키 — 참가자 쿠키 하나", () => {
  const where = { domain: "tone-party.workers.dev", secure: true };

  it("★ 이름은 앱의 참가자 쿠키이고, 이름표 없는 기본 쿠키나 운영자 쿠키는 만들 길이 없다", () => {
    expect(PLANTED).toBe(PLAYER_COOKIE);
    const c = plantCookie("ab12cd34", "cGF5bG9hZA.c2lnbg", where)!;
    expect(c.startsWith(`${PLAYER_COOKIE}_ab12cd34=cGF5bG9hZA.c2lnbg;`)).toBe(true);
    for (const attr of ["Domain=tone-party.workers.dev", "HttpOnly", "SameSite=Lax", "Secure", "Path=/"]) expect(c).toContain(attr);
    // 이름표가 16진수가 아니면 심지 않는다 — 비면 기본 쿠키가 되고, `;` 가 있으면 속성이 붙는다
    for (const ref of ["", "XYZ", "ab;cd", "0123456789abcdef0"]) expect(plantCookie(ref, "a.b", where), ref).toBeNull();
    for (const token of ["a.b; Domain=x", "a b", "", "tp_host=1"]) expect(plantCookie("ab12", token, where), token).toBeNull();
    expect(clearCookie("ab12", where)).toContain("Max-Age=0");
    expect(frameName("ab12")).toBe("tp.ab12");
  });

  it("★ 부모 도메인은 도구와 QA 가 함께 쓰는 것뿐이다 — 없으면 심지 않는다", () => {
    expect(cookieDomain("tone-pick-qa-tool.tone-party.workers.dev", "tone-pick-qa.tone-party.workers.dev")).toBe("tone-party.workers.dev");
    // 로컬 — 포트만 다르다. 쿠키는 포트를 가리지 않으니 호스트에만
    expect(cookieDomain("localhost", "localhost")).toBe("");
    expect(cookieDomain("evil.example.com", "tone-pick-qa.tone-party.workers.dev")).toBeNull();
    expect(cookieDomain("127.0.0.1", "localhost")).toBeNull();
    // 부모가 최상위 도메인 하나뿐이면 심지 않는다
    expect(cookieDomain("tool.dev", "qa.dev")).toBeNull();
  });

  it("★ 심은 쿠키와 틀 이름표로 QA 가 그 참가자를 알아본다", async () => {
    const stage = await buildStage(env(), want({ men: 2, women: 2, phase: "prevote" }));
    for (const p of stage.cast as Persona[]) {
      const token = p.session.cookies.get(`${PLAYER_COOKIE}_${p.session.ref}`)!;
      const pair = plantCookie(p.session.ref, token, where)!.split(";")[0];
      // 틀 안의 앱이 하는 그대로 — 쿠키 하나에 이름표 머리
      const res = await fetchApp(`${BASE}/api/me`, { headers: { cookie: pair, "x-tp-ref": p.session.ref } });
      expect(res.status).toBe(200);
      expect(((await res.json()) as ParticipantState).me.id).toBe(p.id);
    }
    await stage.close();
  });
});

describe("스테이지 화면 — 틀은 QA 를 직접 연다", () => {
  it("★ 틀은 QA 의 공개 주소로 열고, 페이지에는 세션 토큰이 없다", async () => {
    const stage = await buildStage(env(), want({ men: 2, women: 2, phase: "prevote" }));
    const cast = (stage.cast as (Persona & { nickname: string; age: number; phone: string; pin: string })[]).map((p) => ({
      n: p.n, nickname: p.nickname, gender: p.gender, age: p.age, ref: p.session.ref, phone: p.phone, pin: p.pin,
    }));
    const page = stagePage({
      id: "0".repeat(64),
      view: { event: stage.event, cast, lines: [], backlog: 0 },
      left: DAILY,
      daily: DAILY,
      qa: PUBLIC,
      hostPin: "0000",
      plantable: true,
    });
    expect(page).toContain(`"qa":"${PUBLIC}"`);
    expect(page).not.toContain(BASE);
    for (const p of stage.cast as Persona[]) {
      for (const [, value] of p.session.cookies) expect(page).not.toContain(value);
    }
    await stage.close();
  });

  it("★ 콕 단추는 자동 콕 하나다 — 보내는 사람 칸도, 묶음 단추도 없다 (ADR-99 후기 5)", () => {
    const page = stagePage({
      id: "0".repeat(64),
      view: { event: { id: "e1", code: "ABC123" }, cast: [], lines: [], backlog: 0 },
      left: DAILY,
      daily: DAILY,
      qa: PUBLIC,
      hostPin: "0000",
      plantable: true,
    });
    expect(page.match(/data-cmd="auto[^"]*"/g)).toEqual(['data-cmd="auto"']);
    expect(page).not.toMatch(/<select|data-poke|data-cmd="(poke|unpoke|mutual|crowd|pairs|spray)/);
  });
});
