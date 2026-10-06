/**
 * 슬라이스 19 — 이상형 찾기의 화면 규칙.
 *
 * **진짜 라우터의 표를 그대로 쓴다** (`PARTICIPANT_ROUTES`) — 라운드는 주소이고 뒤로 가기가 곧 이전 라운드라,
 * 표에 빠진 주소는 여기서 "찾을 수 없어요" 로 드러나야 한다.
 * 얼굴 자료는 `fetch` 가 내준다 — **지금 판(IDEAL_ASSET_V)은 아래 합성 풀**, 옛 판은 픽스처 풀(`test/fixtures/faces/pool.ts`).
 * 픽스처 풀은 v1 크기(1단계 여섯)라 아홉 × 두 쪽을 세 라운드 채우지 못한다. 이름은 `n<id>` 라 화면에서 셀 수 있다.
 *
 * ⚠️ 자산은 모듈 캐시에 남는다 (같은 판을 두 번 받지 않는다). 그래서 **실패를 재는 테스트는 저마다 다른 `v`** 를
 *    쓴다 — 앞 테스트가 받아 둔 판을 다시 받지 않아 실패가 안 보이는 일이 없게.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouterProvider, createMemoryRouter } from "react-router";
import { FORTUNE, FUN, HELP, IDEAL, TABS_PARTICIPANT } from "../../src/shared/copy.ts";
import type { ParticipantState, Phase } from "../../src/shared/types.ts";
import {
  IDEAL_ASSET_V,
  IDEAL_SHAPE,
  IDEAL_TRAITS,
  decodeVec,
  idealTraits,
  meanOf,
  nearestCelebs,
  pickRound,
  tasteCenters,
  type FacePoolFile,
  type Ideal,
  type IdealTraits,
} from "../../src/shared/ideal.ts";
import { PARTICIPANT_ROUTES } from "../../src/client/router.tsx";
import { forgetPools } from "../../src/client/routes/Ideal.tsx";
import { POOL, enc } from "../fixtures/faces/pool.ts";

const BASE = "/e/ABCDEF";

function stateIn(phase: Phase, ideal?: Ideal): ParticipantState {
  return {
    event: {
      id: "e1",
      name: "테스트 파티",
      code: "ABCDEF",
      phase,
      fired: { reg: 1 },
      schedule: { partyAt: Date.now() + 3600_000 },
      config: { maxPre: 3, maxParty: 3 },
    },
    me: {
      id: "me",
      nickname: "나",
      realName: "김나",
      age: 30,
      gender: "M",
      instagram: "gram_a",
      mbti: "ENFP",
      charms: ["하나", "둘", "셋"],
      createdAt: 1,
    },
    roster: [],
    poke: { budget: { pre: { max: 3, used: 0 }, party: { max: 3, used: 0 } }, sentTo: {}, received: { pre: 0, party: 0 }, matches: [] },
    note: { budget: { max: 0, used: 0 }, sent: {}, received: [], unread: 0 },
    announcements: [],
    ...(ideal ? { ideal } : {}),
  };
}

/**
 * 지금 판의 합성 풀 — 1단계 18(아홉 두 쪽), 2단계 36, 3단계 30. 연예인과 얼굴은 같은 사람들이다 (S-C5).
 * 벡터는 단위원 위 각도라 두 갈래를 손으로 만들 수 있다. 어느 각도도 겹치지 않는다:
 *   1단계 0°~340° 20° 간격 (첫 쪽 0°~160°, 둘째 쪽 180°~340°) · 2단계 5°~355° 10° 간격 · 3단계 2°~350° 12° 간격
 * 기대값은 화면이 쓰는 순수 함수로 센다 — 여기서 재는 것은 **화면이 그 함수에 무엇을 넘기나**다.
 */
const SYN_DEGS = [
  ...Array.from({ length: 18 }, (_, k) => ["a", 20 * k, 1] as const),
  ...Array.from({ length: 36 }, (_, k) => ["b", 5 + 10 * k, 2] as const),
  ...Array.from({ length: 30 }, (_, k) => ["c", 2 + 12 * k, 3] as const),
].map(([p, deg, level]) => ({ id: p + String(deg).padStart(3, "0"), deg, level }));
/** 특징 부호 (ADR-127) — 0°~90° 는 고양이상 · 시크한, 나머지는 강아지상. 그 밖의 칸은 없다 */
const synTraits = (deg: number) => (deg <= 90 ? ["animal.cat", "vibe.chic"] : ["animal.dog"]);
const SYN: FacePoolFile = {
  version: IDEAL_ASSET_V,
  dim: 2,
  scale: 127,
  celebs: SYN_DEGS.map(({ id, deg }) => ({ id, name: `n${id}`, v: enc(deg), t: synTraits(deg) })),
  faces: SYN_DEGS.map(({ id, deg, level }) => ({ id, v: enc(deg), level })),
};
const SYN_FACES = SYN.faces.map((f) => ({ id: f.id, level: f.level, vec: decodeVec(f.v, SYN.dim, SYN.scale) }));
const SYN_CELEBS = SYN.celebs.map((c) => ({ id: c.id, name: c.name, vec: decodeVec(c.v, SYN.dim, SYN.scale) }));
const vecOf = (id: string) => SYN_FACES.find((f) => f.id === id)!.vec;
const LEVEL1 = SYN.faces.filter((f) => f.level === 1).map((f) => f.id);
const ids = (fs: readonly { id: string }[]) => fs.map((f) => f.id);

/** 저장된 한 벌 (v1 — 픽스처 풀의 사람들). 결과 셋은 고른 얼굴과 겹치지 않는다 (S-C2) */
const SAVED: Ideal = {
  v: 1,
  pool: "F",
  picks: [["f060"], ["f070", "f040"], ["f085"]],
  result: ["f050", "f100", "f130"],
  at: 1,
};

type Faces = "ok" | "html" | "404";
interface Stub {
  asked: { url: string; body?: unknown }[];
  /** 얼굴 자료가 어떻게 오나. 테스트 도중에 바꿔 '다시 불러오기' 를 잰다 */
  faces: Faces;
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

/**
 * 가짜 서버. `/faces/v{n}/…json` 에는 그 판의 픽스처를(버전을 경로에 맞춰), `/api/ideal*` 에는 저장된 행을,
 * 나머지(`/api/me?code=…`)에는 상태를 준다.
 *
 * `html` 은 **SPA 폴백** — 없는 파일에 index.html 이 200 으로 온다. `404` 는 개발 서버·다른 호스트의 모양이다.
 */
function stub(state: ParticipantState, over: { saved?: Ideal; faces?: Faces } = {}): Stub {
  const s: Stub = { asked: [], faces: over.faces ?? "ok" };
  let row: Ideal | undefined = state.ideal;
  vi.stubGlobal("WebSocket", class { close() {} });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (u: string, init?: RequestInit) => {
      const url = String(u);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      s.asked.push({ url, body });
      const face = url.match(/^\/faces\/v(\d+)\/[fm]\.json$/);
      if (face) {
        if (s.faces === "html") return new Response("<!doctype html><title>app</title>", { headers: { "content-type": "text/html" } });
        if (s.faces === "404") return new Response("", { status: 404 });
        return json(Number(face[1]) === IDEAL_ASSET_V ? SYN : { ...POOL, version: Number(face[1]) });
      }
      if (url === "/api/ideal") {
        // 서버처럼 — 가리킨 값(`replaces`)은 저장하지 않고, 새 행에는 지난 행과 다른 시각이 붙는다 (다시 찾기, ADR-125)
        const { replaces: _replaces, ...rest } = body as Record<string, unknown>;
        row = over.saved ?? ({ ...rest, at: (row?.at ?? 0) + 1 } as Ideal);
        return json(row);
      }
      if (url === "/api/ideal/verdict") {
        row = { ...row!, verdict: body };
        return json(row);
      }
      return json(state);
    }),
  );
  return s;
}

/** 여러 칸을 주면 마지막 칸에 선다 — 앞의 칸이 뒤로 가기의 자리다 */
function mount(...entries: string[]) {
  const router = createMemoryRouter(PARTICIPANT_ROUTES, { initialEntries: entries, initialIndex: entries.length - 1 });
  render(<RouterProvider router={router} />);
  return router;
}
const path = (router: ReturnType<typeof mount>) => router.state.location.pathname;

const tabBtn = (key: string) => screen.getByText(TABS_PARTICIPANT.find((t) => t.key === key)!.label).closest("button")!;
const funTab = () => tabBtn("fun");
const tiles = () => Array.from({ length: IDEAL_SHAPE.faces }, (_, i) => screen.getByRole("button", { name: IDEAL.face(i + 1) }));
/** 타일의 얼굴 id — 사진 주소에서 읽는다 (화면에 이름이 없으니 이것뿐이다) */
const idOf = (el: Element) => el.querySelector("img")!.getAttribute("src")!.match(/\/([a-z0-9]+)\.webp$/)![1];
const shownIds = () => tiles().map(idOf);
const pressed = () => screen.queryAllByRole("button", { pressed: true });
const nextBtn = () => screen.getByRole("button", { name: IDEAL.next }) as HTMLButtonElement;
const rerollBtn = () => screen.queryByRole("button", { name: IDEAL.reroll });
const tileOf = (id: string) => tiles().find((t) => idOf(t) === id)!;
const meReads = (s: Stub) => s.asked.filter((a) => a.url.startsWith("/api/me")).length;

/** 재미 탭의 이상형 카드 `시작`. 두 카드가 다 `시작` 을 든다 — 이상형이 첫 카드다 (ADR-124) */
const idealStart = async () => (await screen.findAllByRole("button", { name: IDEAL.cardStart }))[0];

/** 재미 탭 카드에서 풀을 고르고 1라운드 얼굴이 뜰 때까지 */
async function startRun(router: ReturnType<typeof mount>, pool: "F" | "M" = "F") {
  fireEvent.click(await idealStart());
  await waitFor(() => expect(path(router)).toBe(`${BASE}/ideal`));
  fireEvent.click(await screen.findByRole("button", { name: IDEAL.pool[pool] }));
  await waitFor(() => expect(path(router)).toBe(`${BASE}/ideal/1`));
}

/**
 * 라운드마다 첫 타일 하나를 고르고 넘어간다. 라운드마다 보인 id 를 돌려준다.
 * `reroll` 이면 라운드마다 먼저 `다른 얼굴 보기` 를 누른다 — 넘긴 아홉은 `skipped` 에 따로 담긴다.
 */
async function playRounds(
  router: ReturnType<typeof mount>,
  opts: { reroll?: boolean } = {},
): Promise<{ shown: string[][]; picked: string[][]; skipped: string[][] }> {
  const shown: string[][] = [];
  const picked: string[][] = [];
  const skipped: string[][] = [];
  for (const r of [1, 2, 3]) {
    await waitFor(() => expect(path(router)).toBe(`${BASE}/ideal/${r}`));
    // 주소가 먼저 바뀌고 화면이 뒤따른다 — 그 라운드가 그려진 뒤에 센다
    await screen.findByText(IDEAL.roundCount(r));
    await screen.findByRole("button", { name: IDEAL.face(1) });
    if (opts.reroll) {
      skipped.push(shownIds());
      fireEvent.click(rerollBtn()!);
    }
    shown.push(shownIds());
    fireEvent.click(tiles()[0]);
    picked.push([idOf(tiles()[0])]);
    if (r < 3) fireEvent.click(nextBtn());
  }
  return { shown, picked, skipped };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ─────────────────────────────────────────── A. 자리와 때

describe("재미 탭 · 여는 때는 하나다 (ADR-125)", () => {
  /**
   * **재미는 프로필 투표가 시작될 때 한 번에 열린다.** 탭은 그 전에도 켜져 있다 — 없다가 생기지 않고(ADR-20 후기),
   * 흐린 탭을 눌러 토스트로 막던 옛 방식도 되살리지 않는다. 대신 탭 맨 위 한 줄이 언제 볼 수 있는지 말한다.
   */
  for (const phase of ["reg", "prep"] as const) {
    it(`★ ${phase} 에도 재미 탭이 켜져 있고, 누르면 간다 — 맨 위 한 줄이 언제 볼 수 있는지 말한다`, async () => {
      stub(stateIn(phase));
      const router = mount(BASE);
      await screen.findByText(TABS_PARTICIPANT.find((t) => t.key === "fun")!.label);

      expect(funTab().getAttribute("aria-disabled")).toBeNull();
      fireEvent.click(funTab());
      await waitFor(() => expect(path(router)).toBe(`${BASE}/fun`));
      expect(await screen.findByText(FUN.closed)).toBeTruthy();
      expect(path(router)).toBe(`${BASE}/fun`);
    });
  }

  it("★ 열기 전에는 카드가 무엇이 오는지만 말한다 — 버튼도 입력칸도 없다", async () => {
    const s = stub(stateIn("reg"));
    mount(`${BASE}/fun`);
    await screen.findByText(FUN.closed);

    expect(screen.getByText(IDEAL.title)).toBeTruthy();
    expect(screen.getByText(IDEAL.cardBody)).toBeTruthy();
    expect(screen.getByText(FORTUNE.name)).toBeTruthy();
    expect(screen.getByText(FORTUNE.cardBody)).toBeTruthy();
    expect(screen.queryByRole("button", { name: FUN.start })).toBeNull();
    expect(screen.queryByRole("button", { name: FUN.result })).toBeNull();
    expect(screen.queryByRole("button", { name: IDEAL.again })).toBeNull();
    // 생년월일 칸은 탭에 서지 않는다 — 운세 페이지 안에만 있다
    expect(document.querySelector("input")).toBeNull();
    expect(s.asked.some((a) => a.url.startsWith("/faces/"))).toBe(false);
  });

  it("★ 이상형 카드가 운세 위에 있다 — 열린 뒤 두 카드에 시작이 붙는다 · 카드만 보는 사람은 얼굴 자료를 받지 않는다", async () => {
    const s = stub(stateIn("prevote"));
    mount(`${BASE}/fun`);

    expect(await screen.findAllByRole("button", { name: FUN.start })).toHaveLength(2);
    expect(screen.queryByText(FUN.closed)).toBeNull();
    const fortune = screen.getByText(FORTUNE.name);
    // 이상형이 첫 카드, 운세가 두 번째 카드다 (ADR-124) — 한 번 연 운세는 길어서 위에 두면 아래 카드를 접힌 아래로 민다
    expect(fortune.compareDocumentPosition(screen.getByText(IDEAL.title)) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(s.asked.some((a) => a.url.startsWith("/faces/"))).toBe(false);
  });

  it("★ 파티 운세 보기는 탭 안의 페이지로 간다 — 생년월일은 거기서 받는다 · 뒤로 가면 재미 탭", async () => {
    stub(stateIn("prevote"));
    const router = mount(`${BASE}/fun`);
    const starts = await screen.findAllByRole("button", { name: FUN.start });
    fireEvent.click(starts[1]);

    await waitFor(() => expect(path(router)).toBe(`${BASE}/fortune`));
    expect(await screen.findByLabelText(FORTUNE.birthLabel)).toBeTruthy();
    expect(screen.getByRole("button", { name: FORTUNE.open })).toBeTruthy();
    // 탭 안의 페이지다 — 탭바는 재미에 불이 켜진 채다
    expect(funTab().getAttribute("aria-current")).toBe("true");
    // 열었다고 커서를 주지 않는다 (ADR-63)
    expect(document.activeElement?.tagName).not.toBe("INPUT");

    await router.navigate(-1);
    await waitFor(() => expect(path(router)).toBe(`${BASE}/fun`));
  });

  it("★ 운세 페이지에서 탭을 누르면 페이지 칸이 기록에 남지 않는다 — 뒤로 한 번이면 홈이다", async () => {
    stub(stateIn("prevote"));
    const router = mount(BASE, `${BASE}/fun`);
    fireEvent.click((await screen.findAllByRole("button", { name: FUN.start }))[1]);
    await waitFor(() => expect(path(router)).toBe(`${BASE}/fortune`));

    fireEvent.click(tabBtn("people"));
    await waitFor(() => expect(path(router)).toBe(`${BASE}/people`));
    await router.navigate(-1);
    await waitFor(() => expect(path(router)).toBe(BASE));
  });

  for (const at of ["/ideal", "/ideal/again", "/ideal/2", "/fortune"]) {
    it(`★ 열기 전에 ${at} 를 열면 재미 탭으로 갈아끼운다`, async () => {
      stub(stateIn("reg"));
      const router = mount(`${BASE}${at}`);
      await waitFor(() => expect(path(router)).toBe(`${BASE}/fun`));
      expect(router.state.historyAction).toBe("REPLACE");
      expect(await screen.findByText(FUN.closed)).toBeTruthy();
      expect(screen.queryByText(IDEAL.poolAsk)).toBeNull();
    });
  }

  it("★ 이상형 결과는 입구 카드에 없다 — 이름도 사진도. 결과 보기와 다시 찾기만 있다", async () => {
    const s = stub(stateIn("prevote", SAVED));
    mount(`${BASE}/fun`);

    expect(await screen.findByRole("button", { name: FUN.result })).toBeTruthy();
    expect(screen.getByRole("button", { name: IDEAL.again })).toBeTruthy();
    // 탭을 열 때마다 옆 사람에게 취향이 보인다 — 결과는 결과 화면에만
    for (const id of SAVED.result) expect(document.body.textContent).not.toContain(`n${id}`);
    expect(document.querySelector('img[src^="/faces/"]')).toBeNull();
    expect(s.asked.some((a) => a.url.startsWith("/faces/"))).toBe(false);
  });

  it("★ 단계가 되돌아가도 결과는 볼 수 있다 — 다시 찾기만 없다", async () => {
    stub(stateIn("reg", SAVED));
    const router = mount(`${BASE}/fun`);
    await screen.findByText(FUN.closed);
    expect(screen.queryByRole("button", { name: IDEAL.again })).toBeNull();

    fireEvent.click(await screen.findByRole("button", { name: FUN.result }));
    await waitFor(() => expect(path(router)).toBe(`${BASE}/ideal`));
    await screen.findAllByText(`n${SAVED.result[0]}`);
    expect(screen.queryByRole("button", { name: IDEAL.again })).toBeNull();
  });
});

// ─────────────────────────────────────────── B. 고르기

describe("이상형 찾기 · 고르기", () => {
  it("★ 처음에 어느 쪽 얼굴을 볼지 묻는다 — 두 버튼, 어느 쪽도 눌려 있지 않다 (S-B1)", async () => {
    stub(stateIn("prevote"));
    const router = mount(`${BASE}/fun`);
    fireEvent.click(await idealStart());
    await waitFor(() => expect(path(router)).toBe(`${BASE}/ideal`));

    expect(await screen.findByText(IDEAL.poolAsk)).toBeTruthy();
    const f = screen.getByRole("button", { name: IDEAL.pool.F });
    const m = screen.getByRole("button", { name: IDEAL.pool.M });
    for (const b of [f, m]) {
      expect(b.getAttribute("aria-pressed")).toBeNull();
      expect(b.className).toBe(f.className); // 같은 크기 — 한쪽만 강조하지 않는다
    }
    // 처음 찾을 때는 부담을 덜어 주는 한 줄이다 — 대신한다는 말은 다시 찾을 때의 것이다 (ADR-125)
    expect(screen.getByText(IDEAL.firstNote)).toBeTruthy();
    expect(screen.queryByText(IDEAL.againNote)).toBeNull();
  });

  it("★ 한 라운드에 얼굴 아홉(3×3), 1~5개. 0개면 '다음' 이 안 눌리고 여섯째는 골라지지 않는다 (S-B2 · v2)", async () => {
    stub(stateIn("prevote"));
    const router = mount(`${BASE}/fun`);
    await startRun(router);
    await screen.findByRole("button", { name: IDEAL.face(1) });

    expect(tiles()).toHaveLength(9);
    expect(screen.queryByRole("button", { name: IDEAL.face(10) })).toBeNull();
    // 1라운드는 모두에게 같은 첫 쪽 — 자산 순서 그대로
    expect(shownIds()).toEqual(LEVEL1.slice(0, 9));
    expect(screen.getByText(IDEAL.roundCount(1))).toBeTruthy();
    expect(nextBtn().disabled).toBe(true);

    fireEvent.click(tiles()[0]);
    expect(nextBtn().disabled).toBe(false);
    for (const i of [1, 2, 3, 4, 5]) fireEvent.click(tiles()[i]);
    expect(pressed()).toHaveLength(5);
    expect(tiles()[5].getAttribute("aria-pressed")).toBe("false");
    expect(tiles()[5].getAttribute("aria-disabled")).toBe("true");
    expect(tiles()[8].getAttribute("aria-disabled")).toBe("true");

    // 하나를 풀면 다시 고를 수 있다
    fireEvent.click(tiles()[0]);
    fireEvent.click(tiles()[5]);
    expect(tiles()[5].getAttribute("aria-pressed")).toBe("true");
    // 다 풀면 다시 못 넘어간다
    for (const t of tiles()) if (t.getAttribute("aria-pressed") === "true") fireEvent.click(t);
    expect(nextBtn().disabled).toBe(true);

    // 마지막 라운드의 버튼은 '결과 보기' 다
    fireEvent.click(tiles()[0]);
    fireEvent.click(nextBtn());
    await waitFor(() => expect(path(router)).toBe(`${BASE}/ideal/2`));
    await screen.findByText(IDEAL.roundCount(2));
    fireEvent.click(screen.getByRole("button", { name: IDEAL.face(1) }));
    fireEvent.click(nextBtn());
    await waitFor(() => expect(path(router)).toBe(`${BASE}/ideal/3`));
    await screen.findByText(IDEAL.roundCount(3));
    await screen.findByRole("button", { name: IDEAL.face(1) });
    expect(screen.queryByRole("button", { name: IDEAL.next })).toBeNull();
    const finish = screen.getByRole("button", { name: IDEAL.finish }) as HTMLButtonElement;
    expect(finish.disabled).toBe(true);
    expect(screen.getByText(IDEAL.roundCount(3))).toBeTruthy();
  });

  it("★ 같은 얼굴이 두 번 나오지 않는다 · 고르는 동안 이름도 '연예인' 이라는 말도 없다 (S-B3 · S-B5 · S-B6)", async () => {
    stub(stateIn("prevote"));
    const router = mount(`${BASE}/fun`);
    await startRun(router);

    const names = SYN.celebs.map((c) => c.name);
    const seen: string[] = [];
    for (const r of [1, 2, 3]) {
      await waitFor(() => expect(path(router)).toBe(`${BASE}/ideal/${r}`));
      await screen.findByText(IDEAL.roundCount(r));
      await screen.findByRole("button", { name: IDEAL.face(1) });
      seen.push(...shownIds());

      const text = document.body.textContent ?? "";
      for (const n of names) expect(text).not.toContain(n);
      expect(text).not.toContain(IDEAL.resultKicker);
      expect(text).not.toMatch(/연예인/);
      // 타일에서 사진을 찾는다 — 아홉이 다 있어야 검사가 헛돌지 않는다
      const imgs = tiles().map((t) => t.querySelector("img"));
      expect(imgs.filter(Boolean)).toHaveLength(9);
      for (const img of imgs) {
        // 파일명은 불투명 id 다. 대체 글에도 이름이 없다
        expect(img!.getAttribute("src")).toMatch(new RegExp(`^/faces/v${IDEAL_ASSET_V}/[a-z0-9]{4,16}\\.webp$`));
        expect(img!.getAttribute("alt")).toBe("");
      }

      // 골랐음은 색만이 아니다 — 눌림 상태와 ✓ (S-B6)
      fireEvent.click(tiles()[r - 1]);
      expect(tiles()[r - 1].getAttribute("aria-pressed")).toBe("true");
      expect(tiles()[r - 1].textContent).toContain("✓");
      expect(tiles()[r].textContent).not.toContain("✓");
      if (r < 3) fireEvent.click(nextBtn());
    }
    expect(seen).toHaveLength(27);
    expect(new Set(seen).size).toBe(27);
  });

  it("★ 뒤로 가면 이전 라운드다 — 고른 건 남아 있다 (S-B4)", async () => {
    stub(stateIn("prevote"));
    const router = mount(`${BASE}/fun`);
    await startRun(router);
    await screen.findByRole("button", { name: IDEAL.face(1) });

    fireEvent.click(tiles()[1]);
    fireEvent.click(tiles()[4]);
    fireEvent.click(nextBtn());
    await waitFor(() => expect(path(router)).toBe(`${BASE}/ideal/2`));
    await screen.findByText(IDEAL.roundCount(2));

    await router.navigate(-1);
    await waitFor(() => expect(path(router)).toBe(`${BASE}/ideal/1`));
    // 주소가 먼저 바뀌고 화면이 뒤따른다 — 1라운드가 그려진 뒤에 본다
    await screen.findByText(IDEAL.roundCount(1));
    expect(tiles()[1].getAttribute("aria-pressed")).toBe("true");
    expect(tiles()[4].getAttribute("aria-pressed")).toBe("true");
    expect(pressed()).toHaveLength(2);

    // 1 에서 뒤로 가면 풀 고르기다 (등록 스텝과 같다)
    await router.navigate(-1);
    await waitFor(() => expect(path(router)).toBe(`${BASE}/ideal`));
    expect(await screen.findByText(IDEAL.poolAsk)).toBeTruthy();
  });

  it("★ 고르던 값이 없는데 라운드 주소를 열면 시작으로 갈아끼운다", async () => {
    stub(stateIn("prevote"));
    const router = mount(`${BASE}/ideal/2`);

    await waitFor(() => expect(path(router)).toBe(`${BASE}/ideal`));
    expect(router.state.historyAction).toBe("REPLACE");
    expect(await screen.findByText(IDEAL.poolAsk)).toBeTruthy();
  });

  it("★ 없는 라운드 주소도 시작으로 갈아끼운다", async () => {
    stub(stateIn("prevote"));
    const router = mount(`${BASE}/ideal/9`);

    await waitFor(() => expect(path(router)).toBe(`${BASE}/ideal`));
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("★ 앞 라운드를 고쳐 고르면 뒤 라운드는 다시 센다 — 뒤에서 고른 것은 버린다 (S-B4)", async () => {
    stub(stateIn("prevote"));
    let router = mount(`${BASE}/fun`);
    await startRun(router);
    await screen.findByRole("button", { name: IDEAL.face(1) });

    fireEvent.click(tiles()[0]);
    fireEvent.click(nextBtn());
    await screen.findByText(IDEAL.roundCount(2));
    await screen.findByRole("button", { name: IDEAL.face(1) });
    const before = shownIds();
    fireEvent.click(tiles()[0]);
    expect(pressed()).toHaveLength(1);

    // 1라운드로 돌아가 다른 얼굴로 바꿔 고른다
    await router.navigate(-1);
    await screen.findByText(IDEAL.roundCount(1));
    fireEvent.click(tiles()[0]);
    fireEvent.click(tiles()[5]);
    fireEvent.click(nextBtn());
    await screen.findByText(IDEAL.roundCount(2));
    await screen.findByRole("button", { name: IDEAL.face(1) });
    const after = shownIds();
    // 뒤 라운드에서 고른 것은 버려졌다 — 그 얼굴이 이번 후보에 없을 수도 있다
    expect(pressed()).toHaveLength(0);
    expect(after).not.toEqual(before);

    // 처음부터 그 얼굴 하나만 고른 사람과 같은 아홉이다 — 옛 후보를 고쳐 쓴 게 아니라 다시 셌다
    cleanup();
    router = mount(`${BASE}/fun`);
    await startRun(router);
    await screen.findByRole("button", { name: IDEAL.face(1) });
    fireEvent.click(tiles()[5]);
    fireEvent.click(nextBtn());
    await screen.findByText(IDEAL.roundCount(2));
    await screen.findByRole("button", { name: IDEAL.face(1) });
    expect(shownIds()).toEqual(after);
  });

  it("★ 고른 얼굴이 두 무리로 갈리면 다음 라운드가 두 무리를 따라간다 — 평균 하나가 아니다 (v2)", async () => {
    stub(stateIn("prevote"));
    const router = mount(`${BASE}/fun`);
    await startRun(router);
    await screen.findByRole("button", { name: IDEAL.face(1) });
    const r1 = shownIds();

    // 0°·20° 와 140°·160° — 두 무리의 평균이 반대쪽을 향한다
    const mine = ["a000", "a020", "a140", "a160"];
    for (const id of mine) fireEvent.click(tileOf(id));
    const centers = tasteCenters(mine.map(vecOf));
    expect(centers).toHaveLength(2);
    const expected = ids(pickRound(SYN_FACES, 2, centers, new Set(r1)));
    // 평균 하나로 셌다면 다른 아홉이다 — 아니면 이 검사는 헛돈다
    expect(expected).not.toEqual(ids(pickRound(SYN_FACES, 2, [{ vec: meanOf(mine.map(vecOf)), weight: 4 }], new Set(r1))));

    fireEvent.click(nextBtn());
    await screen.findByText(IDEAL.roundCount(2));
    await screen.findByRole("button", { name: IDEAL.face(1) });
    expect(shownIds()).toEqual(expected);
  });

  describe("다른 얼굴 보기", () => {
    it("★ 아무것도 안 골랐고 아직 안 썼을 때만 보인다 — 누르면 다른 아홉, 주소는 그대로 (v2)", async () => {
      stub(stateIn("prevote"));
      const router = mount(`${BASE}/fun`);
      await startRun(router);
      await screen.findByRole("button", { name: IDEAL.face(1) });

      // `다음` 아래의 옅은 버튼
      const btn = rerollBtn()!;
      expect(btn).toBeTruthy();
      expect(btn.className).toContain("ghost");
      expect(nextBtn().compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      // 하나라도 고르면 사라지고, 다 풀면 돌아온다 — 아직 안 썼다
      fireEvent.click(tiles()[0]);
      expect(rerollBtn()).toBeNull();
      fireEvent.click(tiles()[0]);
      expect(rerollBtn()).toBeTruthy();

      const first = shownIds();
      const key = router.state.location.key;
      rerollBtn()!.focus();
      fireEvent.click(rerollBtn()!);
      // 버튼이 사라져도 포커스는 화면 안에 선다 — `body` 로 떨어지면 키보드·화면 읽기 사용자가 자리를 잃는다
      // 서는 곳은 라운드 머리다 — 몇 번째인지와 안내를 함께 읽는다 (ADR-129)
      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement?.textContent).toContain(IDEAL.roundCount(1));
      expect(document.activeElement?.textContent).toContain(IDEAL.roundHint);
      const second = shownIds();
      expect(second).toHaveLength(9);
      for (const id of second) expect(first).not.toContain(id);
      // 1라운드의 둘째 쪽도 모두에게 같다 — 자산 순서의 다음 아홉
      expect(second).toEqual(LEVEL1.slice(9, 18));
      // 칸을 쌓지 않는다 — 같은 주소, 같은 칸
      expect(path(router)).toBe(`${BASE}/ideal/1`);
      expect(router.state.location.key).toBe(key);
      // 라운드마다 한 번 — 안 골라도 다시 보이지 않는다
      expect(rerollBtn()).toBeNull();
      expect(nextBtn().disabled).toBe(true);

      // 뒤로 한 번이면 풀 고르기다 — 넘긴 쪽이 기록에 남지 않았다
      await router.navigate(-1);
      await waitFor(() => expect(path(router)).toBe(`${BASE}/ideal`));
    });

    it("★ 뒤로 갔다 와도 넘긴 쪽이 그대로 선다 — 라운드마다 따로 기억한다 (v2)", async () => {
      stub(stateIn("prevote"));
      const router = mount(`${BASE}/fun`);
      await startRun(router);
      await screen.findByRole("button", { name: IDEAL.face(1) });

      fireEvent.click(rerollBtn()!);
      const r1 = shownIds();
      fireEvent.click(tiles()[0]);
      fireEvent.click(nextBtn());
      await screen.findByText(IDEAL.roundCount(2));
      await screen.findByRole("button", { name: IDEAL.face(1) });
      const skipped = shownIds();
      fireEvent.click(rerollBtn()!);
      const r2 = shownIds();
      for (const id of r2) expect(skipped).not.toContain(id);
      fireEvent.click(tiles()[2]);

      await router.navigate(-1);
      await screen.findByText(IDEAL.roundCount(1));
      expect(shownIds()).toEqual(r1);
      expect(tiles()[0].getAttribute("aria-pressed")).toBe("true");
      expect(rerollBtn()).toBeNull();

      await router.navigate(1);
      await screen.findByText(IDEAL.roundCount(2));
      expect(shownIds()).toEqual(r2);
      expect(tiles()[2].getAttribute("aria-pressed")).toBe("true");
      expect(pressed()).toHaveLength(1);
    });

    it("★ 앞 라운드를 고쳐 고르면 뒤 라운드는 넘긴 쪽까지 다시 센다 (v2)", async () => {
      stub(stateIn("prevote"));
      const router = mount(`${BASE}/fun`);
      await startRun(router);
      await screen.findByRole("button", { name: IDEAL.face(1) });
      const r1 = shownIds();

      fireEvent.click(tiles()[0]);
      fireEvent.click(nextBtn());
      await screen.findByText(IDEAL.roundCount(2));
      await screen.findByRole("button", { name: IDEAL.face(1) });
      fireEvent.click(rerollBtn()!);
      expect(rerollBtn()).toBeNull();

      await router.navigate(-1);
      await screen.findByText(IDEAL.roundCount(1));
      fireEvent.click(tiles()[0]);
      fireEvent.click(tiles()[4]);
      fireEvent.click(nextBtn());
      await screen.findByText(IDEAL.roundCount(2));
      await screen.findByRole("button", { name: IDEAL.face(1) });

      // 새 선택의 첫 쪽이고, 넘기기도 다시 쓸 수 있다
      expect(shownIds()).toEqual(ids(pickRound(SYN_FACES, 2, tasteCenters([vecOf(r1[4])]), new Set(r1))));
      expect(rerollBtn()).toBeTruthy();
      expect(pressed()).toHaveLength(0);
    });

    it("★ 넘긴 얼굴도 본 얼굴이다 — 흐름 전체에서 다시 안 나오고 결과에도 없다 · 결과는 취향의 중심으로 잰다 (v2)", async () => {
      const s = stub(stateIn("prevote"));
      const router = mount(`${BASE}/fun`);
      await startRun(router);
      const { shown, skipped } = await playRounds(router, { reroll: true });

      const seen = [...skipped.flat(), ...shown.flat()];
      expect(seen).toHaveLength(54);
      expect(new Set(seen).size).toBe(54);

      fireEvent.click(screen.getByRole("button", { name: IDEAL.finish }));
      await screen.findByText(IDEAL.resultTitle);
      const sent = s.asked.find((a) => a.url === "/api/ideal")!.body as Ideal;
      for (const id of sent.result) expect(seen).not.toContain(id);
      // 넘긴 아홉은 저장하지 않는다 — 고른 것만 간다
      for (const id of sent.picks.flat()) expect(skipped.flat()).not.toContain(id);
      const centers = tasteCenters(sent.picks.flat().map(vecOf));
      expect(sent.result).toEqual(ids(nearestCelebs(SYN_CELEBS, centers, new Set(seen))));
    });
  });

  it("★ 라운드에서 ? 를 열었다 닫아도 그 라운드와 고른 것이 그대로다 (ADR-114)", async () => {
    stub(stateIn("prevote"));
    const router = mount(`${BASE}/fun`);
    await startRun(router);
    await screen.findByRole("button", { name: IDEAL.face(1) });
    fireEvent.click(tiles()[0]);
    fireEvent.click(nextBtn());
    await screen.findByText(IDEAL.roundCount(2));
    await screen.findByRole("button", { name: IDEAL.face(1) });
    fireEvent.click(tiles()[1]);
    fireEvent.click(tiles()[3]);
    const ids = shownIds();

    fireEvent.click(screen.getByRole("button", { name: HELP.open }));
    await waitFor(() => expect(path(router)).toBe(`${BASE}/help`));
    await router.navigate(-1);
    await waitFor(() => expect(path(router)).toBe(`${BASE}/ideal/2`));
    // 주소는 라우터가 먼저 바꾸고 화면은 전환(startTransition)으로 뒤따른다 — 시트가 닫혀야 아래 타일이 읽힌다.
    // 주소만 기다리면 시트의 aria-hidden 이 남은 채로 타일을 찾아서, 느린 CI 에서만 빨개졌다
    await waitFor(() => expect(screen.queryByRole("dialog", { name: HELP.title })).toBeNull());

    await screen.findByText(IDEAL.roundCount(2));
    expect(shownIds()).toEqual(ids);
    expect(tiles()[1].getAttribute("aria-pressed")).toBe("true");
    expect(tiles()[3].getAttribute("aria-pressed")).toBe("true");
    expect(pressed()).toHaveLength(2);
  });

  it("★ ? 아래의 라운드를 새로고침으로 잃어도 ? 는 그대로다 — 그 아래만 시작으로 바뀐다", async () => {
    stub(stateIn("prevote"));
    // 라운드에서 ? 를 연 채 새로고침 — 기록의 `under` 는 남고 고르던 값은 없다
    const router = createMemoryRouter(PARTICIPANT_ROUTES, {
      initialEntries: [{ pathname: `${BASE}/help`, state: { under: `${BASE}/ideal/2` } }],
    });
    render(<RouterProvider router={router} />);

    await screen.findByText(IDEAL.poolAsk);
    expect(path(router)).toBe(`${BASE}/help`);
    expect((router.state.location.state as { under?: string }).under).toBe(`${BASE}/ideal`);
  });

  it("★ 라운드에서 탭을 누르면 라운드 칸이 기록에 남지 않는다 — 뒤로 한 번이면 홈이다", async () => {
    stub(stateIn("prevote"));
    // 홈에서 재미 탭으로 온 사람 — 기록이 [홈, 재미]
    const router = mount(BASE, `${BASE}/fun`);
    await startRun(router);
    await screen.findByRole("button", { name: IDEAL.face(1) });
    fireEvent.click(tiles()[0]);
    fireEvent.click(nextBtn());
    await screen.findByText(IDEAL.roundCount(2));

    fireEvent.click(tabBtn("people"));
    await waitFor(() => expect(path(router)).toBe(`${BASE}/people`));

    // 라운드 칸을 밟지 않는다 — 시작 화면을 몇 번씩 보여주지 않고 곧장 홈
    await router.navigate(-1);
    await waitFor(() => expect(path(router)).toBe(BASE));
    expect(screen.queryByText(IDEAL.poolAsk)).toBeNull();
  });

  it("★ 재미 탭을 눌러 나가도 라운드 칸이 남지 않는다", async () => {
    stub(stateIn("prevote"));
    const router = mount(BASE, `${BASE}/fun`);
    await startRun(router);
    await screen.findByRole("button", { name: IDEAL.face(1) });

    fireEvent.click(funTab());
    await waitFor(() => expect(path(router)).toBe(`${BASE}/fun`));
    expect(await idealStart()).toBeTruthy();
    await router.navigate(-1);
    await waitFor(() => expect(path(router)).toBe(BASE));
  });
});

// ─────────────────────────────────────────── C. 결과

describe("이상형 찾기 · 결과", () => {
  it("★ 결과 셋은 본 얼굴이 아니고, 고른 얼굴은 그 아래 따로 있다 (S-C1 · S-C2)", async () => {
    const s = stub(stateIn("prevote"));
    const router = mount(`${BASE}/fun`);
    await startRun(router);
    const { shown, picked } = await playRounds(router);

    // 처음 찾는 흐름에는 대신한다는 말이 없다 — 대신할 결과가 없다 (ADR-125)
    expect(screen.queryByText(IDEAL.againNote)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: IDEAL.finish }));
    await screen.findByText(IDEAL.resultTitle);

    const sent = s.asked.find((a) => a.url === "/api/ideal")!.body as Ideal;
    // 처음 찾을 때는 가리키는 것이 없다
    expect(sent).not.toHaveProperty("replaces");
    expect(sent.v).toBe(IDEAL_ASSET_V);
    expect(sent.pool).toBe("F");
    expect(sent.picks).toEqual(picked);
    expect(sent.result).toHaveLength(3);
    expect(new Set(sent.result).size).toBe(3);
    for (const id of sent.result) expect(shown.flat()).not.toContain(id);
    // 중심 하나(고른 셋이 한 무리)여도 같은 길로 센다
    expect(sent.result).toEqual(ids(nearestCelebs(SYN_CELEBS, tasteCenters(picked.flat().map(vecOf)), new Set(shown.flat()))));

    // 이름 셋이 순서대로, 퍼센트 없이
    const text = document.body.textContent ?? "";
    const at = sent.result.map((id) => text.indexOf(`n${id}`));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(text).not.toMatch(/%|\d+\s*점|score/i);

    // 고른 얼굴은 결과 아래 따로
    const pickedBox = screen.getByRole("region", { name: IDEAL.pickedTitle });
    const pickedSrcs = Array.from(pickedBox.querySelectorAll("img")).map((i) => i.getAttribute("src"));
    expect(pickedSrcs).toEqual(picked.flat().map((id) => `/faces/v${IDEAL_ASSET_V}/${id}.webp`));
    expect(screen.getByText(IDEAL.resultTitle).compareDocumentPosition(pickedBox) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("★ 결과를 보면 기록이 시작 주소로 되감긴다 — 뒤로 가기는 재미 탭이지 라운드가 아니다", async () => {
    stub(stateIn("prevote"));
    const router = mount(`${BASE}/fun`);
    await startRun(router);
    await playRounds(router);

    fireEvent.click(screen.getByRole("button", { name: IDEAL.finish }));
    await screen.findByText(IDEAL.resultTitle);
    await waitFor(() => expect(path(router)).toBe(`${BASE}/ideal`));

    await router.navigate(-1);
    await waitFor(() => expect(path(router)).toBe(`${BASE}/fun`));
    // 카드는 이제 결과로 간다
    expect(await screen.findByRole("button", { name: IDEAL.cardResult })).toBeTruthy();
  });

  it("★ 결과 뒤에 앞으로 가기로 라운드 칸에 닿아도 결과로 되돌아온다 — 라운드는 다시 열리지 않는다", async () => {
    stub(stateIn("prevote"));
    const router = mount(`${BASE}/fun`);
    await startRun(router);
    await playRounds(router);
    fireEvent.click(screen.getByRole("button", { name: IDEAL.finish }));
    await screen.findByText(IDEAL.resultTitle);
    await waitFor(() => expect(path(router)).toBe(`${BASE}/ideal`));

    const seen: string[] = [];
    router.subscribe((st) => seen.push(st.location.pathname));
    await router.navigate(1);
    // 라운드 칸에 정말 닿았다가(되감기가 남긴 앞 칸), 갈아끼우지 않고 결과 칸으로 되감는다
    await waitFor(() => expect(seen).toEqual([`${BASE}/ideal/1`, `${BASE}/ideal`]));
    expect(router.state.historyAction).toBe("POP");
    expect(screen.getByText(IDEAL.resultTitle)).toBeTruthy();
    expect(screen.queryByText(IDEAL.roundCount(1))).toBeNull();
  });

  it("★ 저장을 기다리는 동안 뒤로 갔어도 결과에 선다 — 누른 순간의 칸으로 되감지 않는다", async () => {
    stub(stateIn("prevote"));
    const router = mount(`${BASE}/fun`);
    await startRun(router);
    await playRounds(router);

    // 저장 응답을 붙잡아 두고 그 사이에 뒤로 간다
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const inner = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string, init?: RequestInit) => {
        if (String(u) === "/api/ideal") await gate;
        return inner(u, init);
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: IDEAL.finish }));
    await router.navigate(-1);
    await waitFor(() => expect(path(router)).toBe(`${BASE}/ideal/2`));
    release();

    await screen.findByText(IDEAL.resultTitle);
    await waitFor(() => expect(path(router)).toBe(`${BASE}/ideal`));
    // 되감기가 재미 탭까지 넘어가지 않았다 — 뒤로 한 번이 재미 탭이다
    await router.navigate(-1);
    await waitFor(() => expect(path(router)).toBe(`${BASE}/fun`));
  });

  it("★ 서버가 다른 행을 돌려주면 그 행을 그린다 — 다시 읽지 않는다 (S-E2)", async () => {
    const other: Ideal = { v: 1, pool: "F", picks: [["f120"], ["f130"], ["f150"]], result: ["f210", "f265", "f330"], at: 9 };
    const s = stub(stateIn("prevote"), { saved: other });
    const router = mount(`${BASE}/fun`);
    await startRun(router);
    await playRounds(router);
    const before = meReads(s);

    fireEvent.click(screen.getByRole("button", { name: IDEAL.finish }));
    await screen.findByText(IDEAL.resultTitle);
    await screen.findAllByText(`n${other.result[0]}`);

    const text = document.body.textContent ?? "";
    const at = other.result.map((id) => text.indexOf(`n${id}`));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    const pickedBox = screen.getByRole("region", { name: IDEAL.pickedTitle });
    expect(Array.from(pickedBox.querySelectorAll("img")).map((i) => i.getAttribute("src"))).toEqual(
      other.picks.flat().map((id) => `/faces/v1/${id}.webp`),
    );
    expect(meReads(s)).toBe(before);
  });

  it("★ 저장된 결과가 있으면 시작 주소가 곧 결과다 — 순서대로, 점수 없이 (S-C1 · S-C3)", async () => {
    stub(stateIn("party", SAVED));
    mount(`${BASE}/ideal`);

    await screen.findAllByText(`n${SAVED.result[0]}`);
    expect(screen.getByText(IDEAL.resultKicker)).toBeTruthy();
    const text = document.body.textContent ?? "";
    const at = SAVED.result.map((id) => text.indexOf(`n${id}`));
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(text).not.toMatch(/%/);
    // 풀 고르기는 저절로 서지 않는다 — 다시 찾기를 눌러야 선다 (ADR-125)
    expect(screen.queryByText(IDEAL.poolAsk)).toBeNull();
    expect(screen.queryByRole("button", { name: IDEAL.pool.F })).toBeNull();
    expect(screen.getByRole("button", { name: IDEAL.again })).toBeTruthy();
  });

  it("★ 결과가 있으면 라운드 주소는 열리지 않는다 — 시작 주소로 갈아끼운다 (S-C3)", async () => {
    stub(stateIn("prevote", SAVED));
    const router = mount(`${BASE}/ideal/2`);

    await waitFor(() => expect(path(router)).toBe(`${BASE}/ideal`));
    expect(router.state.historyAction).toBe("REPLACE");
    await screen.findAllByText(`n${SAVED.result[0]}`);
  });

  /** 정답 물음의 이름 단추 — 결과 칸에도 같은 이름이 있어 마지막 것이 단추다 */
  const verdictBtn = (id: string) => {
    const all = screen.getAllByRole("button", { name: `n${id}` });
    return all[all.length - 1];
  };
  const submitBtn = () => screen.getByRole("button", { name: IDEAL.verdictSubmit }) as HTMLButtonElement;

  it("★ 정답을 한 번 묻는다 — 고르고 보내면 물음이 답으로 바뀐다 (S-C4)", async () => {
    const s = stub(stateIn("prevote", SAVED));
    mount(`${BASE}/ideal`);
    expect(await screen.findByText(IDEAL.verdictAsk)).toBeTruthy();

    const pick = SAVED.result[1];
    // 이름을 누르는 것은 고르기일 뿐이다 — 보내기 전에는 아무것도 가지 않는다
    expect(submitBtn().disabled).toBe(true);
    fireEvent.click(verdictBtn(pick));
    expect(verdictBtn(pick).getAttribute("aria-pressed")).toBe("true");
    expect(s.asked.some((a) => a.url === "/api/ideal/verdict")).toBe(false);
    fireEvent.click(submitBtn());
    await screen.findByText(IDEAL.verdictChosen([`n${pick}`]));

    expect(s.asked.find((a) => a.url === "/api/ideal/verdict")!.body).toEqual({ chosen: [pick] });
    expect(screen.queryByText(IDEAL.verdictAsk)).toBeNull();
    expect(screen.queryByRole("button", { name: IDEAL.verdictNone })).toBeNull();
    // 결과는 그대로다
    for (const id of SAVED.result) expect(document.body.textContent).toContain(`n${id}`);
  });

  it("★ 여럿을 고를 수 있다 — 다시 누르면 빠진다 (ADR-127)", async () => {
    const s = stub(stateIn("prevote", SAVED));
    mount(`${BASE}/ideal`);
    await screen.findByText(IDEAL.verdictAsk);

    const [a, b, c] = SAVED.result;
    fireEvent.click(verdictBtn(c));
    fireEvent.click(verdictBtn(a));
    fireEvent.click(verdictBtn(b));
    fireEvent.click(verdictBtn(b)); // 다시 누르면 빠진다
    expect(verdictBtn(b).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(submitBtn());
    await screen.findByText(IDEAL.verdictChosen([`n${c}`, `n${a}`]));

    expect(s.asked.find((x) => x.url === "/api/ideal/verdict")!.body).toEqual({ chosen: [c, a] });
  });

  it("★ 정답 단추마다 그 사람의 얼굴이 함께 있다 — 이름만 보고 답하지 않게 (ADR-129)", async () => {
    // 물음을 읽을 때쯤 첫 사진은 화면 위로 지나가 있다 — 답하는 자리에 얼굴이 있어야 기억이 아니라 알아보기로 답한다
    stub(stateIn("prevote", SAVED));
    mount(`${BASE}/ideal`);
    await screen.findByText(IDEAL.verdictAsk);

    for (const id of SAVED.result) {
      const img = verdictBtn(id).querySelector("img");
      expect(img, `n${id} 단추에 얼굴이 없다`).not.toBeNull();
      // 결과에 그린 그 사진이다 — 저장된 행의 판으로 부른다
      expect(img!.getAttribute("src")).toBe(`/faces/v${SAVED.v}/${id}.webp`);
      // 이름표는 그대로 이름이다 — 사진에는 대체 글이 없다 (S-B5 와 같은 결)
      expect(img!.getAttribute("alt")).toBe("");
    }
  });

  it("★ '없음' 도 답이다 — 결과는 그대로이고, 풀 고르기가 저절로 서지 않는다 (S-C4)", async () => {
    const s = stub(stateIn("prevote", SAVED));
    mount(`${BASE}/ideal`);

    fireEvent.click(await screen.findByRole("button", { name: IDEAL.verdictNone }));
    await screen.findByText(IDEAL.verdictNoneDone);

    expect(s.asked.find((a) => a.url === "/api/ideal/verdict")!.body).toEqual({ none: true });
    expect(screen.queryByText(IDEAL.verdictAsk)).toBeNull();
    expect(screen.queryByRole("button", { name: IDEAL.pool.F })).toBeNull();
    for (const id of SAVED.result) expect(document.body.textContent).toContain(`n${id}`);
  });

  it("★ 이미 답한 결과에는 묻지 않는다", async () => {
    stub(stateIn("prevote", { ...SAVED, verdict: { none: true } }));
    mount(`${BASE}/ideal`);

    await screen.findAllByText(`n${SAVED.result[0]}`);
    expect(screen.getByText(IDEAL.verdictNoneDone)).toBeTruthy();
    expect(screen.queryByText(IDEAL.verdictAsk)).toBeNull();
  });

  it("★ v1 결과는 v1 경로에서 그린다 — 지금 판(v2)의 자료를 받지 않는다", async () => {
    expect(IDEAL_ASSET_V).not.toBe(1);
    const s = stub(stateIn("prevote", SAVED));
    mount(`${BASE}/ideal`);

    // 이름은 v1 풀에만 있다 — 이름이 섰다면 v1 자료로 그렸다
    await screen.findAllByText(`n${SAVED.result[0]}`);
    const srcs = Array.from(document.querySelectorAll(".body img")).map((i) => i.getAttribute("src")!);
    // 결과 셋 · 정답 단추의 얼굴 셋 (ADR-129 — 아직 답하지 않았다) · 고른 얼굴
    expect(srcs).toHaveLength(SAVED.result.length * 2 + SAVED.picks.flat().length);
    for (const src of srcs) expect(src).toMatch(/^\/faces\/v1\//);
    expect(s.asked.some((a) => a.url.startsWith(`/faces/v${IDEAL_ASSET_V}/`))).toBe(false);
  });

  it("★ 옛 판의 결과는 옛 경로에서 그린다", async () => {
    // 지금 판(IDEAL_ASSET_V)이 아닌 판 — 저장된 행의 v 를 따라간다
    const old = IDEAL_ASSET_V - 1;
    const s = stub(stateIn("prevote", { ...SAVED, v: old }));
    mount(`${BASE}/ideal`);

    await screen.findAllByText(`n${SAVED.result[0]}`);
    expect(s.asked.map((a) => a.url)).toContain(`/faces/v${old}/f.json`);
    const srcs = Array.from(document.querySelectorAll(".body img")).map((i) => i.getAttribute("src")!);
    expect(srcs.length).toBeGreaterThan(0);
    for (const src of srcs) expect(src.startsWith(`/faces/v${old}/`)).toBe(true);
  });
});

// ─────────────────────────────────────────── 다시 찾기 (ADR-125)

describe("이상형 찾기 · 다시 찾기 (ADR-125)", () => {
  /**
   * **다시 뽑기가 아니라 다시 고르기다.** 이 기능에는 난수가 없어서 같은 얼굴을 고르면 같은 결과다.
   * 지난 결과는 **새 결과가 저장될 때만** 바뀐다 — 다시 찾다가 나가면 그대로다. 확인창은 없다: 시작 화면과
   * 마지막 `결과 보기` 위에서 미리 말한다 (S-C3 이 처음부터 그렇게 해 왔다).
   */
  it("★ 결과 화면에서 다시 찾는다 — 시작 화면과 마지막 결과 보기 위에서 대신한다고 말하고, 새 결과에는 다시 묻는다 · 뒤로 가면 재미 탭", async () => {
    const s = stub(stateIn("prevote", { ...SAVED, verdict: { none: true } }));
    const router = mount(`${BASE}/fun`);
    fireEvent.click(await screen.findByRole("button", { name: FUN.result }));
    await waitFor(() => expect(path(router)).toBe(`${BASE}/ideal`));
    await screen.findByText(IDEAL.verdictNoneDone);

    fireEvent.click(screen.getByRole("button", { name: IDEAL.again }));
    await waitFor(() => expect(path(router)).toBe(`${BASE}/ideal/again`));
    // 결과 칸을 갈아끼운다 — 쌓으면 뒤로 가기가 지난 결과를 한 번 더 보여준다
    expect(router.state.historyAction).toBe("REPLACE");
    expect(await screen.findByText(IDEAL.againNote)).toBeTruthy();
    expect(screen.queryByText(IDEAL.firstNote)).toBeNull();
    // 지난번 쪽을 미리 눌러 두지 않는다 (S-B1)
    for (const g of ["F", "M"] as const) {
      expect(screen.getByRole("button", { name: IDEAL.pool[g] }).getAttribute("aria-pressed")).toBeNull();
    }

    // 지난번과 같은 쪽이다 — 지금 판의 남자 쪽은 아래 `404` 테스트가 처음 받아야 실패가 보인다 (자산은 모듈 캐시에 남는다)
    fireEvent.click(screen.getByRole("button", { name: IDEAL.pool.F }));
    await waitFor(() => expect(path(router)).toBe(`${BASE}/ideal/1`));
    await playRounds(router);
    // 되돌릴 수 없는 버튼 위에서 한 번 더 말한다
    expect(screen.getByText(IDEAL.againNote)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: IDEAL.finish }));

    await waitFor(() => expect(path(router)).toBe(`${BASE}/ideal`));
    const sent = s.asked.find((a) => a.url === "/api/ideal")!.body as Record<string, unknown>;
    // 지금 결과를 가리켜 보낸다 — 그 사이 다른 기기가 바꿨으면 서버가 먼저 온 것을 남긴다 (S-E2)
    expect(sent.replaces).toBe(SAVED.at);
    expect(sent.pool).toBe("F");
    expect(sent.v).toBe(IDEAL_ASSET_V);
    // 새 결과에는 정답을 다시 묻는다. 지난 결과는 사라졌다
    expect(await screen.findByText(IDEAL.verdictAsk)).toBeTruthy();
    for (const id of SAVED.result) expect(document.body.textContent).not.toContain(`n${id}`);

    // 뒤로 가면 재미 탭이다 — 라운드도, 다시 찾기 시작도, 지난 결과도 밟지 않는다
    await router.navigate(-1);
    await waitFor(() => expect(path(router)).toBe(`${BASE}/fun`));
  });

  it("★ 재미 탭 카드에서도 다시 찾는다 — 같은 시작 화면이다 · 뒤로 가면 재미 탭 · 저장하지 않는다", async () => {
    const s = stub(stateIn("prevote", SAVED));
    const router = mount(`${BASE}/fun`);
    fireEvent.click(await screen.findByRole("button", { name: IDEAL.again }));

    await waitFor(() => expect(path(router)).toBe(`${BASE}/ideal/again`));
    expect(router.state.historyAction).toBe("PUSH");
    expect(await screen.findByText(IDEAL.againNote)).toBeTruthy();
    await router.navigate(-1);
    await waitFor(() => expect(path(router)).toBe(`${BASE}/fun`));
    expect(s.asked.some((a) => a.url === "/api/ideal")).toBe(false);
  });

  it("★ 다시 찾다가 나가면 지난 결과가 그대로다 — 아무것도 저장하지 않는다", async () => {
    const s = stub(stateIn("prevote", SAVED));
    const router = mount(`${BASE}/fun`);
    fireEvent.click(await screen.findByRole("button", { name: IDEAL.again }));
    fireEvent.click(await screen.findByRole("button", { name: IDEAL.pool.F }));
    await waitFor(() => expect(path(router)).toBe(`${BASE}/ideal/1`));
    await screen.findByRole("button", { name: IDEAL.face(1) });
    fireEvent.click(tiles()[0]);

    // 탭을 눌러 나간다 — 다시 찾기가 쌓은 칸부터 걷고 재미 탭에 선다
    fireEvent.click(funTab());
    await waitFor(() => expect(path(router)).toBe(`${BASE}/fun`));
    fireEvent.click(await screen.findByRole("button", { name: FUN.result }));
    await screen.findAllByText(`n${SAVED.result[0]}`);
    expect(s.asked.some((a) => a.url === "/api/ideal")).toBe(false);
  });

  it("★ 다시 찾다가 단계가 되돌아가면 지난 결과로 물러난다 — 누를 수 없는 풀 고르기가 아니다", async () => {
    const st = stateIn("prevote", SAVED);
    stub(st);
    // 소켓 신호 하나가 곧 다시 읽기다 (ADR-26) — 운영자가 단계를 되돌린 순간을 그렇게 만든다
    const socks: { onmessage?: (e: { data: string }) => void }[] = [];
    vi.stubGlobal(
      "WebSocket",
      class {
        onmessage?: (e: { data: string }) => void;
        constructor() {
          socks.push(this);
        }
        close() {}
      },
    );
    const router = mount(`${BASE}/ideal`);
    fireEvent.click(await screen.findByRole("button", { name: IDEAL.again }));
    fireEvent.click(await screen.findByRole("button", { name: IDEAL.pool.F }));
    await waitFor(() => expect(path(router)).toBe(`${BASE}/ideal/1`));
    await screen.findByRole("button", { name: IDEAL.face(1) });

    st.event.phase = "reg";
    socks.at(-1)!.onmessage?.({ data: JSON.stringify({ type: "phase" }) });

    await waitFor(() => expect(path(router)).toBe(`${BASE}/ideal`));
    await screen.findAllByText(`n${SAVED.result[0]}`);
    expect(screen.queryByRole("button", { name: IDEAL.pool.F })).toBeNull();
    // 문이 닫혔으니 다시 찾기도 없다 — 결과는 본다
    expect(screen.queryByRole("button", { name: IDEAL.again })).toBeNull();
  });

  it("★ 결과가 없으면 다시 찾기 주소는 시작 화면으로 갈아끼운다", async () => {
    stub(stateIn("prevote"));
    const router = mount(`${BASE}/ideal/again`);
    await waitFor(() => expect(path(router)).toBe(`${BASE}/ideal`));
    expect(router.state.historyAction).toBe("REPLACE");
    expect(await screen.findByText(IDEAL.firstNote)).toBeTruthy();
  });
});

// ─────────────────────────────────────────── 자산을 못 받았을 때

describe("이상형 찾기 · 얼굴 자료를 못 받았을 때", () => {
  /**
   * 없는 파일에 **index.html 이 200 으로 온다** (SPA 폴백). `res.ok` 만 보면 HTML 을 JSON 으로 읽다 죽는다.
   * 실패는 화면 안에서 말한다 — 토스트가 아니다 (ADR-65). 다시 불러오면 그 자리에서 이어진다.
   */
  it("★ HTML 이 200 으로 오면 실패다 — 다시 불러오면 이어진다", async () => {
    const s = stub(stateIn("prevote", { ...SAVED, v: 5 }), { faces: "html" });
    mount(`${BASE}/ideal`);

    expect(await screen.findByText(IDEAL.loadFail)).toBeTruthy();
    expect(screen.queryAllByText(`n${SAVED.result[0]}`)).toHaveLength(0);

    s.faces = "ok";
    fireEvent.click(screen.getByRole("button", { name: IDEAL.retry }));
    await screen.findAllByText(`n${SAVED.result[0]}`);
    expect(screen.queryByText(IDEAL.loadFail)).toBeNull();
  });

  it("★ 404 도 실패다 — 실패는 캐시에 남지 않는다", async () => {
    // 앞 테스트의 시작 화면이 지금 판을 미리 받아 뒀다 — 비우고 시작한다
    forgetPools();
    const s = stub(stateIn("prevote"), { faces: "404" });
    const router = mount(`${BASE}/fun`);
    await startRun(router, "M");

    expect(await screen.findByText(IDEAL.loadFail)).toBeTruthy();
    expect(screen.queryByRole("button", { name: IDEAL.face(1) })).toBeNull();

    const asks = () => s.asked.filter((a) => a.url === `/faces/v${IDEAL_ASSET_V}/m.json`).length;
    const before = asks();
    s.faces = "ok";
    fireEvent.click(screen.getByRole("button", { name: IDEAL.retry }));
    expect(await screen.findByRole("button", { name: IDEAL.face(1) })).toBeTruthy();
    // 다시 불러오기가 정말 다시 묻는다 — 실패가 캐시에 남았으면 묻지 않고 같은 실패를 돌려준다
    expect(asks()).toBe(before + 1);
    expect(screen.queryByText(IDEAL.loadFail)).toBeNull();
  });

  it("★ 모양이 틀린 JSON 도 실패다 — 판 번호가 경로와 다르면 받지 않는다", async () => {
    const s = stub(stateIn("prevote", { ...SAVED, v: 6 }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string) => {
        const url = String(u);
        s.asked.push({ url });
        if (url.startsWith("/faces/")) return json({ ...POOL, version: 1 });
        return json(stateIn("prevote", { ...SAVED, v: 6 }));
      }),
    );
    mount(`${BASE}/ideal`);

    expect(await screen.findByText(IDEAL.loadFail)).toBeTruthy();
  });
});

describe("끌린 얼굴의 특징 (ADR-127)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  /** 지금 판으로 찾은 한 벌 — 0°~60° 를 골랐다 */
  const NOW: Ideal = {
    v: IDEAL_ASSET_V,
    pool: "F",
    picks: [["a000", "a020"], ["b005", "b015"], ["c014"]],
    result: ["a040", "b025", "c026"],
    at: 1,
  };

  it("★ 결과 얼굴 위에, 고른 얼굴로 센 특징이 선다", async () => {
    stub(stateIn("prevote", NOW));
    mount(`${BASE}/ideal`);
    await screen.findAllByText(`n${NOW.result[0]}`);

    const want = idealTraits(
      NOW.picks.flat().map((id) => synTraits(SYN_DEGS.find((d) => d.id === id)!.deg)),
      SYN_DEGS.map((d) => synTraits(d.deg)),
    );
    expect(want).toEqual({ animal: ["cat"], vibe: ["chic"] });
    const { title, person, note } = IDEAL.traits(want);
    const text = document.body.textContent!;
    expect(text).toContain(IDEAL.traitsKicker);
    expect(text).toContain(title);
    // 낱말만이 아니다 — 그 얼굴에서 읽히는 사람과 연구 한 줄까지 (ADR-128)
    expect(person).toBeTruthy();
    expect(text).toContain(person!);
    expect(text).toContain(note);
    // 특징이 먼저, 연예인이 그 예다
    expect(text.indexOf(title)).toBeLessThan(text.indexOf(person!));
    expect(text.indexOf(note)).toBeLessThan(text.indexOf(IDEAL.resultTitle));
    expect(text).not.toMatch(/%/);
  });

  it("★ 두드러진 것이 없으면 그렇다고 말한다 — 카드를 감추지 않는다", async () => {
    // 강아지상은 풀의 대부분이라 두드러지지 않는다
    stub(stateIn("prevote", { ...NOW, picks: [["a180", "a200"], ["b185"], ["c194"]] }));
    mount(`${BASE}/ideal`);
    await screen.findAllByText(`n${NOW.result[0]}`);
    expect(document.body.textContent).toContain(IDEAL.traitsNone);
  });

  it("★ 특징이 없는 옛 판의 결과에는 카드가 없다", async () => {
    stub(stateIn("prevote", SAVED));
    mount(`${BASE}/ideal`);
    await screen.findAllByText(`n${SAVED.result[0]}`);
    expect(document.body.textContent).not.toContain(IDEAL.traitsKicker);
  });
});

describe("끌린 얼굴의 글 (ADR-128)", () => {
  /** 칸마다 부호 하나씩, 그리고 둘씩 고를 수 있는 칸은 둘씩 — 화면이 받을 수 있는 모양을 고루 */
  const shapes = (): IdealTraits[] => {
    const out: IdealTraits[] = [];
    for (const k of Object.keys(IDEAL_TRAITS) as (keyof typeof IDEAL_TRAITS)[]) {
      const codes = IDEAL_TRAITS[k] as readonly string[];
      for (const a of codes) {
        out.push({ [k]: [a] });
        if (k === "animal" || k === "vibe") for (const b of codes) if (b !== a) out.push({ [k]: [a, b] });
      }
    }
    for (const gaze of IDEAL_TRAITS.gaze)
      for (const jaw of IDEAL_TRAITS.jaw)
        for (const features of IDEAL_TRAITS.features) out.push({ vibe: ["warm"], gaze: [gaze], jaw: [jaw], features: [features] });
    return out as IdealTraits[];
  };

  it("★ 어느 특징으로도 몸의 한 부분이나 평가하는 말, 점수가 나오지 않는다", () => {
    // 칸을 인상 다섯으로 줄인 까닭 그대로다 (ADR-127) — 나란히 보는 화면에서 몸의 한 부분은 평가로 읽힌다
    const banned = /예쁘|예쁜|잘생|못생|미인|미남|매력적|섹시|피부|광대|쌍꺼풀|눈썹|입술|콧|코[가는를와]|얼굴형|눈 크기|큰 눈|작은 눈|점수|순위|등급|%|\d/;
    for (const t of shapes()) {
      const { title, person, detail } = IDEAL.traits(t);
      for (const s of [title, person, detail]) if (s) expect(s, JSON.stringify(t)).not.toMatch(banned);
    }
  });

  it("★ 그 얼굴에서 읽히는 사람을 말한다 — 분위기가 있으면 분위기로, 없을 때만 동물상으로", () => {
    for (const t of shapes()) {
      const { person } = IDEAL.traits(t);
      if (t.vibe || t.animal) expect(person, JSON.stringify(t)).toMatch(/사람에게 눈이 갔어요\.$/);
    }
    // 분위기가 사람을 정한다 — 같은 분위기면 동물상이 달라도 같은 사람이다
    expect(IDEAL.traits({ animal: ["dog"], vibe: ["chic"] }).person).toBe(IDEAL.traits({ animal: ["fox"], vibe: ["chic"] }).person);
  });

  it("★ 조사는 앞말의 받침을 따른다", () => {
    // 눈매(받침 없음) — 와 · 가, 턱선(받침 ㄴ) — 과 · 이
    expect(IDEAL.traits({ gaze: ["gentle"], jaw: ["slim"] }).detail).toContain("순한 눈매와 갸름한 턱선이 많았어요");
    expect(IDEAL.traits({ jaw: ["slim"], features: ["bold"] }).detail).toContain("갸름한 턱선과 뚜렷한 이목구비가 많았어요");
    expect(IDEAL.traits({ gaze: ["gentle"] }).detail).toContain("순한 눈매가 많았어요");
    expect(IDEAL.traits({ jaw: ["round"] }).detail).toContain("둥근 턱선이 많았어요");
  });

  it("★ 두드러진 것이 없으면 그렇다고 말한다 — 없는 것을 채우지 않고, 연구 한 줄은 그대로 선다", () => {
    const none = IDEAL.traits({});
    expect(none.title).toBe(IDEAL.traitsNone);
    expect(none.person).toBeUndefined();
    expect(none.note).toBeTruthy();
  });

  it("같은 특징이면 같은 글이다 — 난수가 없다", () => {
    for (const t of shapes()) expect(IDEAL.traits(t)).toEqual(IDEAL.traits(t));
  });
});

describe("이상형 찾기 · 포커스와 안내 (ADR-129)", () => {
  /** 지금 포커스가 선 자리의 글 — `body` 면 자리를 잃은 것이다 */
  const focused = () => (document.activeElement === document.body ? "(body)" : (document.activeElement?.textContent ?? ""));

  it("★ 단계마다 포커스가 그 화면의 머리로 간다 — 누른 단추가 사라져도 body 로 떨어지지 않는다", async () => {
    stub(stateIn("prevote"));
    const router = mount(`${BASE}/fun`);

    // 카드의 `시작` 이 사라진다 → 시작 화면의 물음
    fireEvent.click(await idealStart());
    await waitFor(() => expect(focused()).toBe(IDEAL.poolAsk));

    // 풀 단추가 사라진다 → 1라운드 머리 (몇 번째부터 읽는다)
    fireEvent.click(screen.getByRole("button", { name: IDEAL.pool.F }));
    await waitFor(() => expect(path(router)).toBe(`${BASE}/ideal/1`));
    await waitFor(() => expect(focused()).toContain(IDEAL.roundCount(1)));
    expect(focused()).toContain(IDEAL.roundHint);

    // `다음` 은 남지만 라운드가 바뀐다 → 새 라운드 머리
    for (const r of [2, 3]) {
      fireEvent.click((await screen.findAllByRole("button", { name: IDEAL.face(1) }))[0]);
      fireEvent.click(nextBtn());
      await screen.findByText(IDEAL.roundCount(r));
      await waitFor(() => expect(focused()).toContain(IDEAL.roundCount(r)));
    }

    // `결과 보기` 가 사라진다 → 결과의 첫 제목
    fireEvent.click((await screen.findAllByRole("button", { name: IDEAL.face(1) }))[0]);
    fireEvent.click(screen.getByRole("button", { name: IDEAL.finish }));
    await screen.findByText(IDEAL.resultTitle);
    await waitFor(() => expect(document.activeElement?.tagName).toBe("H2"));

    // `없음` 이 사라진다 → 그 답
    fireEvent.click(await screen.findByRole("button", { name: IDEAL.verdictNone }));
    await screen.findByText(IDEAL.verdictNoneDone);
    await waitFor(() => expect(focused()).toBe(IDEAL.verdictNoneDone));
  });

  it("★ 저장된 결과를 열 때는 첫 제목에 서고, 답으로 옮기지 않는다 — 방금 보낸 답만이다", async () => {
    stub(stateIn("prevote", { ...SAVED, verdict: { none: true } }));
    mount(`${BASE}/ideal`);
    await screen.findByText(IDEAL.verdictNoneDone);
    await waitFor(() => expect(document.activeElement?.tagName).toBe("H2"));
    expect(focused()).toBe(IDEAL.resultTitle);
  });

  it("★ 2 · 3라운드는 앞에서 고른 얼굴과 닮은 얼굴이라고 먼저 말한다 — 1라운드는 모두에게 같아 말하지 않는다", async () => {
    stub(stateIn("prevote"));
    const router = mount(`${BASE}/fun`);
    await startRun(router);
    await screen.findByRole("button", { name: IDEAL.face(1) });
    expect(screen.queryByText(IDEAL.roundNarrow)).toBeNull();

    for (const r of [2, 3]) {
      fireEvent.click(tiles()[0]);
      fireEvent.click(nextBtn());
      await screen.findByText(IDEAL.roundCount(r));
      // 안내보다 먼저 — 왜 비슷한 얼굴인지 알고 고른다
      const narrow = screen.getByText(IDEAL.roundNarrow);
      expect(narrow.compareDocumentPosition(screen.getByText(IDEAL.roundHint)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      await screen.findByRole("button", { name: IDEAL.face(1) });
    }
  });

  it("★ 재미 탭 카드의 단추는 카드 제목으로 설명된다 — 둘 다 `시작` 이어도 무엇의 시작인지 들린다", async () => {
    stub(stateIn("prevote"));
    mount(`${BASE}/fun`);
    const starts = await screen.findAllByRole("button", { name: FUN.start });
    const about = (b: HTMLElement) => document.getElementById(b.getAttribute("aria-describedby") ?? "")?.textContent;
    expect(starts.map(about)).toEqual([IDEAL.title, FORTUNE.name]);
    cleanup();

    // 결과가 있으면 `결과 보기` 와 `다시 찾기` 도 같다
    stub(stateIn("prevote", SAVED));
    mount(`${BASE}/fun`);
    for (const name of [IDEAL.cardResult, IDEAL.again]) {
      expect(about(await screen.findByRole("button", { name }))).toBe(IDEAL.title);
    }
  });
});

describe("다음에 보일 사진은 미리 받는다", () => {
  /**
   * 한국에서 이 워커는 멀리 붙어(LAX) 왕복 한 번이 150ms 쯤이다. 자료 → 사진을 차례로 기다리면 라운드마다 빈 칸이 섰다.
   * 미리 받는 것은 `new Image()` 다 — 그 주소를 센다.
   */
  let warmed: string[] = [];
  function stubImage() {
    warmed = [];
    vi.stubGlobal(
      "Image",
      class {
        decoding = "";
        set src(v: string) {
          warmed.push(v);
        }
      },
    );
  }
  const url = (id: string) => `/faces/v${IDEAL_ASSET_V}/${id}.webp`;

  // 미리 받은 주소는 모듈에 남는다 — 앞 테스트가 받아 둔 사진은 다시 부르지 않으니 비우고 시작한다
  beforeEach(forgetPools);
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("★ 시작 화면이 서면 두 풀의 자료와 1라운드 첫 쪽을 받는다 — 풀을 고르기 전에", async () => {
    const s = stub(stateIn("prevote"));
    stubImage();
    const router = mount(`${BASE}/fun`);
    fireEvent.click(await idealStart());
    await waitFor(() => expect(path(router)).toBe(`${BASE}/ideal`));

    await waitFor(() => expect(warmed).toEqual(expect.arrayContaining(LEVEL1.slice(0, IDEAL_SHAPE.faces).map(url))));
    const asked = s.asked.map((a) => a.url);
    expect(asked).toContain(`/faces/v${IDEAL_ASSET_V}/f.json`);
    expect(asked).toContain(`/faces/v${IDEAL_ASSET_V}/m.json`);
    expect(path(router)).toBe(`${BASE}/ideal`);
  });

  it("★ 고르면 다음 라운드의 아홉을 받는다 — 고른 대로 다시 센 그 아홉", async () => {
    stub(stateIn("prevote"));
    stubImage();
    const router = mount(`${BASE}/fun`);
    await startRun(router);
    await screen.findByRole("button", { name: IDEAL.face(1) });

    const first = idOf(tiles()[0]);
    fireEvent.click(tiles()[0]);
    const r2 = pickRound(SYN_FACES, 2, tasteCenters([vecOf(first)]), new Set(shownIds()));
    await waitFor(() => expect(warmed).toEqual(expect.arrayContaining(r2.map((f) => url(f.id)))));
  });

  it("★ 아무것도 안 골랐으면 `다른 얼굴 보기` 의 아홉도 받는다", async () => {
    stub(stateIn("prevote"));
    stubImage();
    const router = mount(`${BASE}/fun`);
    await startRun(router);
    await screen.findByRole("button", { name: IDEAL.face(1) });
    await waitFor(() => expect(warmed).toEqual(expect.arrayContaining(LEVEL1.slice(IDEAL_SHAPE.faces).map(url))));
  });

  it("★ 마지막 라운드에서 고르면 결과 셋을 받는다", async () => {
    stub(stateIn("prevote"));
    stubImage();
    const router = mount(`${BASE}/fun`);
    await startRun(router);
    const { picked, shown } = await playRounds(router);

    const centers = tasteCenters(picked.flat().map(vecOf));
    const result = nearestCelebs(SYN_CELEBS, centers, new Set(shown.flat()));
    await waitFor(() => expect(warmed).toEqual(expect.arrayContaining(result.map((c) => url(c.id)))));
  });
});
