/**
 * 이상형 찾기의 설명글 (ADR-134) — 같은 화면에서 고른 얼굴과 고르지 않은 얼굴을 LLM 에게 보여 주고 차이를 받는다.
 *
 * 문 밖에서만 두드린다: `POST /api/ideal/story` · `POST /api/ideal` · `POST /api/ideal/verdict` · `GET /api/me`.
 * LLM 은 진짜로 부르지 않는다 — 워커가 나가는 길(`fetch`)을 갈아끼워 **무엇이 나가는지**를 본다.
 * 사진은 그 판의 자산에서 꺼내므로 자산 바인딩도 갈아끼운다 (테스트에는 빌드한 사진이 없다).
 *
 *   ★ 꺼진 곳(프로덕션의 기본)에서는 길이 없다 — 켜는 것은 설정 하나다 (`IDEAL_STORY`)
 *   ★ 결과마다 한 번 만든다 — 두 번째는 LLM 을 부르지 않는다. 다시 찾으면 글이 없어지고, 정답 확인은 글을 지킨다
 *   ★ LLM 에는 연예인 사진과 골랐다 · 안 골랐다만 간다 — 참가자의 이름 · 닉네임 · 번호 · 인스타가 없다. 1라운드도 없다
 *   ★ 실패는 정상 경로다 — 글 없이 행이 온다. 적지 않으니 다음에 다시 청한다
 */
import { env } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { IDEAL_ASSET_V, type Ideal, type IdealInput } from "../src/shared/ideal.ts";
import type { ParticipantState } from "../src/shared/types.ts";
import { api, freshEvent, join, setPhase, signInMaster } from "./helpers/party.ts";

beforeAll(signInMaster);

const cfg = env as unknown as { IDEAL_STORY?: string; OPENAI_API_KEY?: string; ASSETS: Fetcher };
const realAssets = cfg.ASSETS;

/** 자산 바인딩이 받은 사진 주소 */
let photos: string[] = [];
/** LLM 에 나간 요청 본문 */
let calls: { url: string; body: string }[] = [];

const STORY = "같은 화면의 다른 얼굴보다 입꼬리가 살짝 올라간 얼굴을 더 골랐어요. 사람들은 이런 얼굴에서 친근한 인상을 먼저 받아요.";

/** LLM 이 이렇게 답한다 — 상태 코드와 본문을 고른다 */
function llm(reply: { status?: number; content?: string } = {}) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    calls.push({ url: String(input instanceof Request ? input.url : input), body: String(init?.body ?? "") });
    if (reply.status && reply.status !== 200) return new Response("nope", { status: reply.status });
    const content = reply.content ?? JSON.stringify({ text: STORY });
    return Response.json({ choices: [{ message: { content }, finish_reason: "stop" }] });
  });
}

beforeEach(() => {
  photos = [];
  calls = [];
  cfg.IDEAL_STORY = "1";
  cfg.OPENAI_API_KEY = "test-key";
  // 사진 한 장 — 모양만 맞으면 된다. 없는 파일에는 SPA 폴백(index.html)이 오는 것까지 흉내 내지 않는다
  cfg.ASSETS = {
    fetch: async (req: Request) => {
      photos.push(new URL(req.url).pathname);
      return new Response(new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0]), { headers: { "content-type": "image/webp" } });
    },
  } as unknown as Fetcher;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete cfg.IDEAL_STORY;
  delete cfg.OPENAI_API_KEY;
  cfg.ASSETS = realAssets;
});

let seq = 0;

/** 지금 판의 결과 한 벌과, 2 · 3라운드에 보였던 화면(고른 얼굴 + 고르지 않은 얼굴) */
function made() {
  const t = `zs${(++seq).toString(36).padStart(3, "0")}`;
  const inp: IdealInput = {
    v: IDEAL_ASSET_V,
    pool: "F",
    picks: [[`${t}a1`], [`${t}b1`, `${t}b2`], [`${t}c1`]],
    result: [`${t}r1`, `${t}r2`, `${t}r3`],
  };
  const pages = [
    [`${t}b1`, `${t}x1`, `${t}b2`, `${t}x2`, `${t}x3`],
    [`${t}y1`, `${t}c1`, `${t}y2`],
  ];
  return { inp, pages };
}

const save = (cookie: string | null, body: unknown) => api<Ideal>("/api/ideal", { method: "POST", cookie, body });
const story = (cookie: string | null, body: unknown) =>
  api<Ideal>("/api/ideal/story", { method: "POST", cookie, body });
const me = (cookie: string | null) => api<ParticipantState>("/api/me", { cookie });

/** 재미가 열린 회차의 참가자 한 명 (ADR-125) */
async function someone() {
  const ev = await freshEvent();
  await setPhase(ev.id, "prevote");
  return join(ev, { gender: "M" });
}

describe("★ 꺼진 곳(프로덕션의 기본)에서는 길이 없다 (ADR-134)", () => {
  it("★ `IDEAL_STORY` 가 없으면 404 이고, `/me` 에 켜졌다는 칸이 없다 — LLM 을 부르지 않는다", async () => {
    delete cfg.IDEAL_STORY;
    llm();
    const a = await someone();
    const { inp, pages } = made();
    expect((await save(a.cookie, inp)).status).toBe(200);

    expect((await story(a.cookie, { pages })).status).toBe(404);
    expect((await me(a.cookie)).body).not.toHaveProperty("idealStory");
    expect(calls).toHaveLength(0);
  });

  it("★ 켜진 곳에서는 `/me` 가 그렇다고 말한다", async () => {
    const a = await someone();
    expect((await me(a.cookie)).body.idealStory).toBe(true);
  });
});

describe("★ 결과마다 한 번 만든다 (ADR-134)", () => {
  it("★ 글을 만들어 결과에 붙인다 — 다시 읽어도 그 글이고, 두 번째 요청은 LLM 을 부르지 않는다", async () => {
    llm();
    const a = await someone();
    const { inp, pages } = made();
    await save(a.cookie, inp);

    const first = await story(a.cookie, { pages });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.story).toBe(STORY);
    expect(first.body.result).toEqual(inp.result);
    expect(calls).toHaveLength(1);

    const again = await story(a.cookie, { pages });
    expect(again.body.story).toBe(STORY);
    expect(calls, "한 번 만든 글은 다시 만들지 않는다").toHaveLength(1);
    expect((await me(a.cookie)).body.ideal?.story).toBe(STORY);
  });

  it("★ 정답 확인은 글을 지키고, 다시 찾으면 글이 없어진다 — 새 결과에는 새로 청한다", async () => {
    llm();
    const a = await someone();
    const { inp, pages } = made();
    const saved = await save(a.cookie, inp);
    await story(a.cookie, { pages });

    const said = await api<Ideal>("/api/ideal/verdict", { method: "POST", cookie: a.cookie, body: { none: true } });
    expect(said.body.story, "정답 확인이 글을 지웠다").toBe(STORY);

    const next = made();
    const redone = await save(a.cookie, { ...next.inp, replaces: saved.body.at });
    expect(redone.body.result).toEqual(next.inp.result);
    expect(redone.body).not.toHaveProperty("story");
    expect((await me(a.cookie)).body.ideal).not.toHaveProperty("story");

    expect((await story(a.cookie, { pages: next.pages })).body.story).toBe(STORY);
    expect(calls).toHaveLength(2);
  });

  it("★ 저장 요청에 글을 실어 보내도 남지 않는다 — 글은 서버만 적는다 (S-D1)", async () => {
    const a = await someone();
    const { inp } = made();
    const res = await save(a.cookie, { ...inp, story: "내가 지은 글" });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("story");
    expect(JSON.stringify((await me(a.cookie)).body)).not.toContain("내가 지은 글");
  });
});

describe("★ LLM 에 가는 것 (ADR-134)", () => {
  it("★ 연예인 사진과 골랐다 · 안 골랐다뿐이다 — 참가자의 이름 · 닉네임 · 번호 · 인스타가 없고, 1라운드도 없다", async () => {
    llm();
    const a = await someone();
    const { inp, pages } = made();
    await save(a.cookie, inp);
    await story(a.cookie, { pages });

    expect(calls).toHaveLength(1);
    const sent = calls[0].body;
    for (const secret of [a.input.realName, a.input.nickname, a.input.instagram, a.phone, a.id]) {
      expect(sent, `LLM 요청에 ${secret} 가 실렸다`).not.toContain(secret);
    }

    // 사진은 그 판의 자산에서 — 2 · 3라운드 화면의 얼굴 전부, 1라운드의 고른 얼굴은 없다
    const want = pages.flat().map((id) => `/faces/v${IDEAL_ASSET_V}/${id}.webp`);
    expect([...photos].sort()).toEqual([...want].sort());
    expect(photos.some((p) => p.includes(inp.picks[0][0]))).toBe(false);

    // 화면마다 고른 쪽과 고르지 않은 쪽을 나눠 싣는다 — 사진 수가 그 묶음과 맞는다
    const body = JSON.parse(sent) as { messages: { role: string; content: unknown }[] };
    const parts = body.messages[1].content as { type: string; text?: string }[];
    const labels = parts.filter((p) => p.type === "text").map((p) => p.text);
    expect(labels).toEqual(["2라운드 — 고른 얼굴", "2라운드 — 고르지 않은 얼굴", "3라운드 — 고른 얼굴", "3라운드 — 고르지 않은 얼굴"]);
    expect(parts.filter((p) => p.type === "image_url")).toHaveLength(pages.flat().length);
  });
});

describe("★ 모양 · 문 (ADR-134)", () => {
  it("★ 고른 얼굴이 그 화면에 없거나, 고르지 않은 얼굴이 없거나, 화면 수가 틀리면 400 — LLM 을 부르지 않는다", async () => {
    llm();
    const a = await someone();
    const { inp, pages } = made();
    await save(a.cookie, inp);

    const bad = [
      {},
      { pages: [pages[0]] },
      { pages: [pages[0].filter((id) => id !== inp.picks[1][0]), pages[1]] },
      { pages: [inp.picks[1], pages[1]] },
      { pages: [pages[0], ["BAD ID", ...pages[1]]] },
    ];
    for (const body of bad) expect((await story(a.cookie, body)).status, JSON.stringify(body)).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("★ 결과가 없으면 404 · 옛 판의 결과에는 쓰지 않는다 (409) · 세션이 없으면 401", async () => {
    llm();
    const a = await someone();
    const { inp, pages } = made();
    expect((await story(a.cookie, { pages })).status).toBe(404);

    await save(a.cookie, { ...inp, v: IDEAL_ASSET_V - 1 });
    expect((await story(a.cookie, { pages })).status).toBe(409);
    expect((await story(null, { pages })).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

describe("★ 실패는 정상 경로다 (ADR-134)", () => {
  it("★ LLM 이 실패하거나 형식이 어긋나면 글 없이 행이 온다 — 적지 않으니 다음에 다시 청한다", async () => {
    const a = await someone();
    const { inp, pages } = made();
    await save(a.cookie, inp);

    llm({ status: 500 });
    const down = await story(a.cookie, { pages });
    expect(down.status).toBe(200);
    expect(down.body).not.toHaveProperty("story");
    vi.restoreAllMocks();

    llm({ content: "JSON 이 아닌 답" });
    expect((await story(a.cookie, { pages })).body).not.toHaveProperty("story");
    vi.restoreAllMocks();

    llm();
    expect((await story(a.cookie, { pages })).body.story).toBe(STORY);
  });

  it("★ 키가 없으면 LLM 을 부르지 않는다", async () => {
    delete cfg.OPENAI_API_KEY;
    llm();
    const a = await someone();
    const { inp, pages } = made();
    await save(a.cookie, inp);
    const res = await story(a.cookie, { pages });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("story");
    expect(calls).toHaveLength(0);
  });
});
