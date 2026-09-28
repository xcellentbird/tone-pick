/**
 * 슬라이스 19 — 이상형 찾기의 화면 규칙.
 *
 * **진짜 라우터의 표를 그대로 쓴다** (`PARTICIPANT_ROUTES`) — 라운드는 주소이고 뒤로 가기가 곧 이전 라운드라,
 * 표에 빠진 주소는 여기서 "찾을 수 없어요" 로 드러나야 한다.
 * 얼굴 자료는 `fetch` 가 내준다 — **지금 판(v2)은 아래 합성 풀**, 옛 판은 픽스처 풀(`test/fixtures/faces/pool.ts`).
 * 픽스처 풀은 v1 크기(1단계 여섯)라 아홉 × 두 쪽을 세 라운드 채우지 못한다. 이름은 `n<id>` 라 화면에서 셀 수 있다.
 *
 * ⚠️ 자산은 모듈 캐시에 남는다 (같은 판을 두 번 받지 않는다). 그래서 **실패를 재는 테스트는 저마다 다른 `v`** 를
 *    쓴다 — 앞 테스트가 받아 둔 판을 다시 받지 않아 실패가 안 보이는 일이 없게.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouterProvider, createMemoryRouter } from "react-router";
import { FORTUNE, HELP, IDEAL, TABS_PARTICIPANT } from "../../src/shared/copy.ts";
import type { ParticipantState, Phase } from "../../src/shared/types.ts";
import {
  IDEAL_ASSET_V,
  IDEAL_SHAPE,
  decodeVec,
  meanOf,
  nearestCelebs,
  pickRound,
  tasteCenters,
  type FacePoolFile,
  type Ideal,
} from "../../src/shared/ideal.ts";
import { PARTICIPANT_ROUTES } from "../../src/client/router.tsx";
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
const SYN: FacePoolFile = {
  version: IDEAL_ASSET_V,
  dim: 2,
  scale: 127,
  celebs: SYN_DEGS.map(({ id, deg }) => ({ id, name: `n${id}`, v: enc(deg) })),
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
        row = over.saved ?? { ...body, at: 1 };
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

/** 재미 탭 카드에서 풀을 고르고 1라운드 얼굴이 뜰 때까지 */
async function startRun(router: ReturnType<typeof mount>, pool: "F" | "M" = "F") {
  fireEvent.click(await screen.findByRole("button", { name: IDEAL.cardStart }));
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

describe("이상형 찾기 · 재미 탭의 문", () => {
  /**
   * **탭은 등록부터 켜져 있다** (S-A2). 탭의 문이 운세의 문을 빌려 쓰던 것을 끝냈다 —
   * 운세·미션 카드는 각자의 문을 그대로 지킨다.
   */
  for (const phase of ["reg", "prep"] as const) {
    it(`★ ${phase} 에도 재미 탭이 켜져 있고, 누르면 간다`, async () => {
      stub(stateIn(phase));
      const router = mount(BASE);
      await screen.findByText(TABS_PARTICIPANT.find((t) => t.key === "fun")!.label);

      expect(funTab().getAttribute("aria-disabled")).toBeNull();
      fireEvent.click(funTab());
      await waitFor(() => expect(path(router)).toBe(`${BASE}/fun`));
      // 홈으로 튕겨 나가지 않는다 — 한동안 꺼진 탭 주소는 홈으로 갈아끼웠다
      expect(await screen.findByText(IDEAL.title)).toBeTruthy();
      expect(path(router)).toBe(`${BASE}/fun`);
    });
  }

  it("★ 등록 중 운세 카드는 스스로 닫혀 있다 — 생년월일 칸이 없고 언제 열리는지 말한다", async () => {
    stub(stateIn("reg"));
    mount(`${BASE}/fun`);

    expect(await screen.findByText(FORTUNE.closed)).toBeTruthy();
    expect(screen.queryByLabelText(FORTUNE.birthLabel)).toBeNull();
    expect(screen.queryByRole("button", { name: FORTUNE.open })).toBeNull();
    expect(screen.getByText(FORTUNE.closed).closest("[aria-disabled='true']")).toBeTruthy();
  });

  it("★ 등록 중에도 이상형 카드가 운세 아래에 있다 — 카드만 보는 사람은 얼굴 자료를 받지 않는다", async () => {
    const s = stub(stateIn("reg"));
    mount(`${BASE}/fun`);

    const start = await screen.findByRole("button", { name: IDEAL.cardStart });
    const fortune = screen.getByText(FORTUNE.closed);
    // 운세가 첫 카드, 이상형이 두 번째 카드다 (문서 순서)
    expect(fortune.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(s.asked.some((a) => a.url.startsWith("/faces/"))).toBe(false);
  });
});

// ─────────────────────────────────────────── B. 고르기

describe("이상형 찾기 · 고르기", () => {
  it("★ 처음에 어느 쪽 얼굴을 볼지 묻는다 — 두 버튼, 어느 쪽도 눌려 있지 않다 (S-B1)", async () => {
    stub(stateIn("reg"));
    const router = mount(`${BASE}/fun`);
    fireEvent.click(await screen.findByRole("button", { name: IDEAL.cardStart }));
    await waitFor(() => expect(path(router)).toBe(`${BASE}/ideal`));

    expect(await screen.findByText(IDEAL.poolAsk)).toBeTruthy();
    const f = screen.getByRole("button", { name: IDEAL.pool.F });
    const m = screen.getByRole("button", { name: IDEAL.pool.M });
    for (const b of [f, m]) {
      expect(b.getAttribute("aria-pressed")).toBeNull();
      expect(b.className).toBe(f.className); // 같은 크기 — 한쪽만 강조하지 않는다
    }
    // 한 번 찾으면 그대로라는 것을 **시작 전에** 말한다 (S-C3)
    expect(screen.getByText(IDEAL.once)).toBeTruthy();
  });

  it("★ 한 라운드에 얼굴 아홉(3×3), 1~5개. 0개면 '다음' 이 안 눌리고 여섯째는 골라지지 않는다 (S-B2 · v2)", async () => {
    stub(stateIn("reg"));
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
    stub(stateIn("reg"));
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
    stub(stateIn("reg"));
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
    stub(stateIn("reg"));
    const router = mount(`${BASE}/ideal/2`);

    await waitFor(() => expect(path(router)).toBe(`${BASE}/ideal`));
    expect(router.state.historyAction).toBe("REPLACE");
    expect(await screen.findByText(IDEAL.poolAsk)).toBeTruthy();
  });

  it("★ 없는 라운드 주소도 시작으로 갈아끼운다", async () => {
    stub(stateIn("reg"));
    const router = mount(`${BASE}/ideal/9`);

    await waitFor(() => expect(path(router)).toBe(`${BASE}/ideal`));
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("★ 앞 라운드를 고쳐 고르면 뒤 라운드는 다시 센다 — 뒤에서 고른 것은 버린다 (S-B4)", async () => {
    stub(stateIn("reg"));
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
    stub(stateIn("reg"));
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
      stub(stateIn("reg"));
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
      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement?.textContent).toBe(IDEAL.roundHint);
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
      stub(stateIn("reg"));
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
      stub(stateIn("reg"));
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
      const s = stub(stateIn("reg"));
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
    stub(stateIn("reg"));
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

    await screen.findByText(IDEAL.roundCount(2));
    expect(shownIds()).toEqual(ids);
    expect(tiles()[1].getAttribute("aria-pressed")).toBe("true");
    expect(tiles()[3].getAttribute("aria-pressed")).toBe("true");
    expect(pressed()).toHaveLength(2);
  });

  it("★ ? 아래의 라운드를 새로고침으로 잃어도 ? 는 그대로다 — 그 아래만 시작으로 바뀐다", async () => {
    stub(stateIn("reg"));
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
    stub(stateIn("reg"));
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
    stub(stateIn("reg"));
    const router = mount(BASE, `${BASE}/fun`);
    await startRun(router);
    await screen.findByRole("button", { name: IDEAL.face(1) });

    fireEvent.click(funTab());
    await waitFor(() => expect(path(router)).toBe(`${BASE}/fun`));
    expect(await screen.findByRole("button", { name: IDEAL.cardStart })).toBeTruthy();
    await router.navigate(-1);
    await waitFor(() => expect(path(router)).toBe(BASE));
  });
});

// ─────────────────────────────────────────── C. 결과

describe("이상형 찾기 · 결과", () => {
  it("★ 결과 셋은 본 얼굴이 아니고, 고른 얼굴은 그 아래 따로 있다 (S-C1 · S-C2)", async () => {
    const s = stub(stateIn("reg"));
    const router = mount(`${BASE}/fun`);
    await startRun(router);
    const { shown, picked } = await playRounds(router);

    fireEvent.click(screen.getByRole("button", { name: IDEAL.finish }));
    await screen.findByText(IDEAL.resultTitle);

    const sent = s.asked.find((a) => a.url === "/api/ideal")!.body as Ideal;
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
    stub(stateIn("reg"));
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
    stub(stateIn("reg"));
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
    stub(stateIn("reg"));
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
    const s = stub(stateIn("reg"), { saved: other });
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
    // 다시 고르는 길이 없다
    expect(screen.queryByText(IDEAL.poolAsk)).toBeNull();
    expect(screen.queryByRole("button", { name: IDEAL.pool.F })).toBeNull();
  });

  it("★ 결과가 있으면 라운드 주소는 열리지 않는다 — 시작 주소로 갈아끼운다 (S-C3)", async () => {
    stub(stateIn("reg", SAVED));
    const router = mount(`${BASE}/ideal/2`);

    await waitFor(() => expect(path(router)).toBe(`${BASE}/ideal`));
    expect(router.state.historyAction).toBe("REPLACE");
    await screen.findAllByText(`n${SAVED.result[0]}`);
  });

  it("★ 정답을 한 번 묻는다 — 셋 중 하나를 고르면 물음이 답으로 바뀐다 (S-C4)", async () => {
    const s = stub(stateIn("reg", SAVED));
    mount(`${BASE}/ideal`);
    expect(await screen.findByText(IDEAL.verdictAsk)).toBeTruthy();

    const pick = SAVED.result[1];
    const buttons = screen.getAllByRole("button", { name: `n${pick}` });
    fireEvent.click(buttons[buttons.length - 1]);
    await screen.findByText(IDEAL.verdictChosen(`n${pick}`));

    expect(s.asked.find((a) => a.url === "/api/ideal/verdict")!.body).toEqual({ chosen: pick });
    expect(screen.queryByText(IDEAL.verdictAsk)).toBeNull();
    expect(screen.queryByRole("button", { name: IDEAL.verdictNone })).toBeNull();
    // 결과는 그대로다
    for (const id of SAVED.result) expect(document.body.textContent).toContain(`n${id}`);
  });

  it("★ '없었어요' 도 답이다 — 다시 찾기를 열지 않는다 (S-C4)", async () => {
    const s = stub(stateIn("reg", SAVED));
    mount(`${BASE}/ideal`);

    fireEvent.click(await screen.findByRole("button", { name: IDEAL.verdictNone }));
    await screen.findByText(IDEAL.verdictNoneDone);

    expect(s.asked.find((a) => a.url === "/api/ideal/verdict")!.body).toEqual({ none: true });
    expect(screen.queryByText(IDEAL.verdictAsk)).toBeNull();
    expect(screen.queryByRole("button", { name: IDEAL.pool.F })).toBeNull();
    for (const id of SAVED.result) expect(document.body.textContent).toContain(`n${id}`);
  });

  it("★ 이미 답한 결과에는 묻지 않는다", async () => {
    stub(stateIn("reg", { ...SAVED, verdict: { none: true } }));
    mount(`${BASE}/ideal`);

    await screen.findAllByText(`n${SAVED.result[0]}`);
    expect(screen.getByText(IDEAL.verdictNoneDone)).toBeTruthy();
    expect(screen.queryByText(IDEAL.verdictAsk)).toBeNull();
  });

  it("★ v1 결과는 v1 경로에서 그린다 — 지금 판(v2)의 자료를 받지 않는다", async () => {
    expect(IDEAL_ASSET_V).not.toBe(1);
    const s = stub(stateIn("reg", SAVED));
    mount(`${BASE}/ideal`);

    // 이름은 v1 풀에만 있다 — 이름이 섰다면 v1 자료로 그렸다
    await screen.findAllByText(`n${SAVED.result[0]}`);
    const srcs = Array.from(document.querySelectorAll(".body img")).map((i) => i.getAttribute("src")!);
    expect(srcs).toHaveLength(SAVED.result.length + SAVED.picks.flat().length);
    for (const src of srcs) expect(src).toMatch(/^\/faces\/v1\//);
    expect(s.asked.some((a) => a.url.startsWith(`/faces/v${IDEAL_ASSET_V}/`))).toBe(false);
  });

  it("★ 옛 판의 결과는 옛 경로에서 그린다", async () => {
    const s = stub(stateIn("reg", { ...SAVED, v: 3 }));
    mount(`${BASE}/ideal`);

    await screen.findAllByText(`n${SAVED.result[0]}`);
    expect(s.asked.map((a) => a.url)).toContain("/faces/v3/f.json");
    const srcs = Array.from(document.querySelectorAll(".body img")).map((i) => i.getAttribute("src")!);
    expect(srcs.length).toBeGreaterThan(0);
    for (const src of srcs) expect(src).toMatch(/^\/faces\/v3\//);
  });
});

// ─────────────────────────────────────────── 자산을 못 받았을 때

describe("이상형 찾기 · 얼굴 자료를 못 받았을 때", () => {
  /**
   * 없는 파일에 **index.html 이 200 으로 온다** (SPA 폴백). `res.ok` 만 보면 HTML 을 JSON 으로 읽다 죽는다.
   * 실패는 화면 안에서 말한다 — 토스트가 아니다 (ADR-65). 다시 불러오면 그 자리에서 이어진다.
   */
  it("★ HTML 이 200 으로 오면 실패다 — 다시 불러오면 이어진다", async () => {
    const s = stub(stateIn("reg", { ...SAVED, v: 5 }), { faces: "html" });
    mount(`${BASE}/ideal`);

    expect(await screen.findByText(IDEAL.loadFail)).toBeTruthy();
    expect(screen.queryAllByText(`n${SAVED.result[0]}`)).toHaveLength(0);

    s.faces = "ok";
    fireEvent.click(screen.getByRole("button", { name: IDEAL.retry }));
    await screen.findAllByText(`n${SAVED.result[0]}`);
    expect(screen.queryByText(IDEAL.loadFail)).toBeNull();
  });

  it("★ 404 도 실패다 — 실패는 캐시에 남지 않는다", async () => {
    const s = stub(stateIn("reg"), { faces: "404" });
    const router = mount(`${BASE}/fun`);
    await startRun(router, "M");

    expect(await screen.findByText(IDEAL.loadFail)).toBeTruthy();
    expect(screen.queryByRole("button", { name: IDEAL.face(1) })).toBeNull();

    s.faces = "ok";
    fireEvent.click(screen.getByRole("button", { name: IDEAL.retry }));
    expect(await screen.findByRole("button", { name: IDEAL.face(1) })).toBeTruthy();
    expect(s.asked.filter((a) => a.url === `/faces/v${IDEAL_ASSET_V}/m.json`)).toHaveLength(2);
  });

  it("★ 모양이 틀린 JSON 도 실패다 — 판 번호가 경로와 다르면 받지 않는다", async () => {
    const s = stub(stateIn("reg", { ...SAVED, v: 6 }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string) => {
        const url = String(u);
        s.asked.push({ url });
        if (url.startsWith("/faces/")) return json({ ...POOL, version: 1 });
        return json(stateIn("reg", { ...SAVED, v: 6 }));
      }),
    );
    mount(`${BASE}/ideal`);

    expect(await screen.findByText(IDEAL.loadFail)).toBeTruthy();
  });
});
