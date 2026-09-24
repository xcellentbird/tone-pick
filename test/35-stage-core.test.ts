/**
 * 슬라이스 35 — 무대 워커. **무대의 핵심(`scripts/qa/core.mjs`)과 하루 상한(`worker/budget.ts`)**을 본다.
 *
 * core 는 `fetch` 를 넣어 받는다 — CLI 는 전역 `fetch`, 무대 워커는 서비스 바인딩이다. 여기서는
 * **`SELF.fetch` 를 넣어 진짜 앱에 대고** 돌린다. 앱을 흉내 내지 않으므로, 앱의 공개 API 가 바뀌어
 * 무대가 깨지면 여기서 먼저 빨개진다.
 *
 * 워커의 라우터·DO 는 core 를 감싼 얇은 껍데기라 여기서 따로 돌리지 않는다 — 두 워커를 붙여
 * 로컬에서 돌려 본 기록은 ADR-97 후기 3 에 있다.
 */
import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { StageError, buildStage, createLog, restoreStage } from "../scripts/qa/core.mjs";
import { DAILY, quotaDay, refusal } from "../scripts/qa/worker/budget.ts";
import type { HostState, ParticipantState } from "../src/shared/types.ts";
import { api, master, signInMaster } from "./helpers/party.ts";

beforeAll(signInMaster);

const BASE = "https://tone-pick.test";
const PUBLIC = "https://tone-pick-qa.example.workers.dev";

/** 무대 워커와 같은 모양으로 core 를 부른다 — 창 벽도 시간 이동도 없다 */
function env() {
  const log = createLog();
  return {
    fetch: (url: string, init?: RequestInit) => SELF.fetch(url, init),
    base: BASE,
    publicBase: PUBLIC,
    log,
    platform: {},
    timeTravel: false,
  };
}

// 테스트 앱에는 `ENV_LABEL` 이 없다 — 라벨 가드는 따로 한 번 보고, 나머지는 끈다
const want = (over: Record<string, unknown> = {}) => ({ people: 3, phase: "reg", tables: 2, config: {}, pin: "1234", practiceOnly: false, ...over });

const hostState = (id: string) => api<HostState>(`/api/host/events/${id}/state`, { cookie: master });
const lastLine = (e: ReturnType<typeof env>) => e.log.lines.at(-1) ?? "";

describe("무대 — 배역", () => {
  it("★ 배역은 실제 경로로 등록한다 — 사람마다 세션이 따로다 (S-C1)", async () => {
    const e = env();
    const stage = await buildStage(e, want());
    expect(stage.cast).toHaveLength(3);

    const st = (await hostState(stage.event.id)).body;
    expect(st.players.map((p) => p.id).sort()).toEqual(stage.cast.map((p: { id: string }) => p.id).sort());
    // 명단에 넣은 번호로 들어와 등록했다 — 명단 줄마다 닉네임이 붙어 있다
    expect(st.invites.filter((i) => i.nickname)).toHaveLength(3);

    // 저마다 자기 쿠키로 자기 자신이다
    for (const p of stage.cast) {
      const me = await p.session.call("/me");
      expect(me.status).toBe(200);
      expect((me.body as ParticipantState).me.id).toBe(p.id);
    }
    await stage.close();
  });

  it("★ 번호는 가짜뿐이다 — 무대가 만들고, 받는 입력이 없다 (S-C2)", async () => {
    const stage = await buildStage(env(), want({ people: 4 }));
    const phones = stage.cast.map((p: { phone: string }) => p.phone);
    for (const ph of phones) expect(ph).toMatch(/^010\d{8}$/);
    expect(new Set(phones).size).toBe(4);
    // 무대가 받는 것에 번호 자리가 없다 — 넣어도 쓰지 않는다
    const withPhone = await buildStage(env(), want({ people: 1, phones: ["01099998888"], phone: "01099998888" }));
    expect(withPhone.cast[0].phone).not.toBe("01099998888");
    await stage.close();
    await withPhone.close();
  });

  it("★ 연습용 환경이 아니면 세우지 않는다 — 회차도 만들지 않는다", async () => {
    const before = (await api<unknown[]>("/api/host/events", { cookie: master })).body.length;
    const err = await buildStage(env(), want({ practiceOnly: true })).catch((x) => x);
    expect(err).toBeInstanceOf(StageError);
    expect(err.code).toBe("not_practice");
    expect((await api<unknown[]>("/api/host/events", { cookie: master })).body.length).toBe(before);
  });

  it("★ 세우다 실패하면 만든 회차를 지운다 — 아무도 못 닫는 회차를 남기지 않는다", async () => {
    const before = (await api<unknown[]>("/api/host/events", { cookie: master })).body.length;
    // 초대 명단 부르기만 막는다 — 회차는 이미 만들어진 뒤다
    const e = env();
    const broken = {
      ...e,
      fetch: (url: string, init?: RequestInit) =>
        url.endsWith("/invites") ? Promise.resolve(new Response("{}", { status: 500 })) : SELF.fetch(url, init),
    };
    const err = await buildStage(broken, want()).catch((x) => x);
    expect(err).toBeInstanceOf(StageError);
    expect(err.code).toBe("invites");
    expect((await api<unknown[]>("/api/host/events", { cookie: master })).body.length).toBe(before);
  });

  it("★ 파티까지 가면 투표를 닫고 자리를 발행해 둔다", async () => {
    const stage = await buildStage(env(), want({ people: 4, phase: "party" }));
    const st = (await hostState(stage.event.id)).body;
    expect(st.meta.phase).toBe("party");
    expect(st.seatings.at(-1)?.status).toBe("published");
    await stage.close();
  });
});

describe("무대 — 명령", () => {
  it("★ 명령은 공개 API 로 간다 — 콕은 그 참가자의 세션으로 (S-C4)", async () => {
    const e = env();
    const stage = await buildStage(e, want({ people: 4, phase: "party" }));
    await stage.run("poke 1 2");
    await stage.run("mutual 3 4");
    const st = (await hostState(stage.event.id)).body;
    expect(st.pokeCount.party).toBe(3);
    expect(st.mutual).toHaveLength(1);
    await stage.close();
  });

  it("★ 이 무대에 없는 명령은 없다고 답한다 — 조용히 무시하지 않는다 (S-C4)", async () => {
    const e = env();
    const stage = await buildStage(e, want({ people: 2 }));
    for (const cmd of ["now +30m", "open 1", "close 1", "snap", "keep", "quit"]) {
      await stage.run(cmd);
      expect(lastLine(e), cmd).toContain("이 무대에는 없어요");
    }
    await stage.run("nosuch");
    expect(lastLine(e)).toContain("help");
    await stage.close();
  });

  it("★ 무대가 맡은 명령이 먼저다 — CLI 는 창 벽을 여기로 건다", async () => {
    const e = env();
    const seen: string[][] = [];
    const stage = await buildStage({ ...e, platform: { open: (rest: string[]) => void seen.push(rest) } }, want({ people: 2 }));
    await stage.run("open 2");
    expect(seen).toEqual([["2"]]);
    await stage.close();
  });

  it("★ 참가 링크는 사람에게 보일 주소로 — 요청이 가는 주소가 아니다 (S-D2)", async () => {
    const e = env();
    const stage = await buildStage(e, want({ people: 2 }));
    await stage.run("url 2");
    expect(lastLine(e)).toContain(`${PUBLIC}/j/${stage.event.id}`);
    expect(lastLine(e)).not.toContain(BASE);

    const page = stage.remotePage({ links: true, hostPin: "0000" });
    expect(page.split(`${PUBLIC}/j/${stage.event.id}`).length - 1).toBe(2); // 배역마다 하나
    expect(page).toContain(`${PUBLIC}/host/${stage.event.id}`);
    // CLI 의 리모컨은 링크를 안 단다 — 로컬 주소는 폰에서 안 열린다
    expect(stage.remotePage()).not.toContain(`/j/${stage.event.id}`);
    await stage.close();
  });
});

describe("무대 — 저장과 닫기", () => {
  it("★ 저장했다 되살려도 같은 사람들이다 — 세션째 돌아온다", async () => {
    const e = env();
    const stage = await buildStage(e, want({ people: 3, phase: "party" }));
    const saved = JSON.parse(JSON.stringify(stage.toJSON()));

    const back = restoreStage(env(), saved);
    await back.run("poke 2 1");
    expect((await hostState(stage.event.id)).body.pokeCount.party).toBe(1);
    const me = await back.cast[1].session.call("/me");
    expect((me.body as ParticipantState).me.id).toBe(stage.cast[1].id);
    await back.close();
  });

  it("★ 닫으면 회차를 지운다 — 남기기로 했으면 남긴다 (S-C3)", async () => {
    const kept = await buildStage(env(), want({ people: 2 }));
    expect(await kept.close({ keep: true })).toBe(false);
    expect((await hostState(kept.event.id)).status).toBe(200);

    expect(await kept.close()).toBe(true);
    expect((await hostState(kept.event.id)).status).toBe(404);
    // 두 번 닫아도 다시 지우러 가지 않는다
    expect(await kept.close()).toBe(false);
  });

  it("★ `delete` 로 지운 무대는 닫을 때 다시 지우지 않는다", async () => {
    const e = env();
    const stage = await buildStage(e, want({ people: 2 }));
    await stage.run("delete");
    expect(stage.deleted).toBe(true);
    expect(await stage.close()).toBe(false);
    // 되살려도 지운 것을 기억한다
    expect(restoreStage(env(), JSON.parse(JSON.stringify(stage.toJSON()))).deleted).toBe(true);
  });
});

// ─────────────────────────────────────────── 하루 상한 (S-B2)

describe("무대 워커의 하루 상한 — 로그인이 없어서 계정의 하루 한도를 센다", () => {
  it("★ 상한까지는 되고, 넘으면 거절하면서 언제 다시 되는지 말한다", () => {
    for (const kind of ["stage", "command"] as const) {
      expect(refusal(kind, 0)).toBeNull();
      expect(refusal(kind, DAILY[kind] - 1)).toBeNull();
      const no = refusal(kind, DAILY[kind]);
      expect(no).toContain(`${DAILY[kind]}번`);
      expect(no).toContain("오전 9시");
      expect(refusal(kind, DAILY[kind] + 3)).toBe(no);
    }
  });

  it("★ 하루는 한국 오전 9시(00:00 UTC)에 바뀐다 — Cloudflare 의 하루 한도가 다시 차는 때다", () => {
    // 한국 시각으로 적는다 — 이 도구를 쓰는 사람의 시계다
    const kst = (d: number, h: number, m = 0) => Date.UTC(2026, 8, d, h - 9, m);
    expect(quotaDay(kst(25, 8, 59))).toBe(quotaDay(kst(24, 9, 0)));
    expect(quotaDay(kst(25, 9, 0))).not.toBe(quotaDay(kst(25, 8, 59)));
    // 자정은 경계가 아니다 — 밤에 QA 를 하다 날짜가 넘어가도 이어서 센다
    expect(quotaDay(kst(25, 0, 30))).toBe(quotaDay(kst(24, 23, 30)));
  });
});
