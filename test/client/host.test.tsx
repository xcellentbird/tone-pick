/**
 * 운영자 콘솔이 조용히 죽지 않는지 본다 (ADR-8).
 *
 * 특히 단계 전환 — 참가자 전원의 화면이 바뀌는 행동이라 확인창이 **무엇이 어떻게 바뀌는지**
 * 항목으로 보여줘야 하고, 확인을 누르기 전에는 아무 일도 일어나면 안 된다.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouterProvider, createMemoryRouter } from "react-router";
import { FAIL, GENDER, HOST_UI, INVITE_TEMPLATE, UNIT, phaseAction, schedDiff } from "../../src/shared/copy.ts";
import { formatGap, formatWhen, toLocalInput } from "../../src/shared/time.ts";
import type { HostState, SeatingRound } from "../../src/shared/types.ts";
import { HOST_CONSOLE_ROUTES } from "../../src/client/router.tsx";
import HostConsole from "../../src/client/routes/host/HostConsole.tsx";
import { topRanks } from "../../src/client/routes/host/Dash.tsx";
import Players from "../../src/client/routes/host/Players.tsx";

afterEach(cleanup);

const HOUR = 3600_000;

function hostState(over: Partial<HostState["meta"]> = {}, more: Partial<HostState> = {}): HostState {
  return {
    meta: {
      id: "e1",
      name: "테스트 회차",
      code: "ABCDEF",
      phase: "reg",
      fired: { reg: Date.now() - HOUR },
      schedule: { partyAt: Date.now() + 24 * HOUR, regOpenAt: Date.now() - HOUR, prevoteAt: Date.now() + HOUR },
      config: { maxPre: 3, maxParty: 3 },
      createdAt: Date.now() - 2 * HOUR,
      ...over,
    },
    players: [
      {
        id: "p1",
        nickname: "가",
        realName: "김가",
        age: 28,
        gender: "M",
        phone: "01011112222",
        instagram: "gram_a",
        mbti: "ENFP",
        charms: ["a", "b", "c"],
            createdAt: 1,
        pin: "set",
      },
      {
        id: "p2",
        nickname: "나",
        realName: "김나",
        age: 27,
        gender: "F",
        phone: "01033334444",
        instagram: "gram_b",
        mbti: "ISFJ",
        charms: ["a", "b", "c"],
            createdAt: 2,
        pin: "set",
      },
    ],
    sent: { pre: { p1: 1, p2: 0 }, party: { p1: 2, p2: 0 } },
    // 라운드마다 따로 센다 (ADR-46) — 합쳐 두면 현황 탭이 어느 쪽을 그리는지 테스트가 못 가른다
    received: { pre: { p1: 0, p2: 1 }, party: { p1: 2, p2: 0 } },
    mutual: [],
    pokeCount: { pre: 1, party: 0 },
    pokeUsedMax: { pre: 1, party: 0 },
    noteSent: {},
    noteUsedMax: 0,
    seatings: [],
    invites: [],
    announcements: [],
    apart: [],
    ...more,
  };
}

const calls: Array<{ url: string; body: unknown }> = [];

/** 테스트 스텁이 돌려주는 JSON 응답 */
function json(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(state: ReturnType<typeof hostState>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const payload = url.includes("/state") ? state : { ok: true };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

/** 히스토리를 직접 밀고 당겨야 하는 테스트용 — 라우터를 돌려준다 */
function renderPlayers(at: string) {
  const router = createMemoryRouter(
    [
      {
        path: "/host/:id",
        element: <HostConsole />,
        children: [
          { path: "players", element: <Players /> },
          { path: "players/:pid", element: <Players /> },
        ],
      },
    ],
    { initialEntries: [at] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

function renderConsole(at = "/host/e1") {
  const router = createMemoryRouter(
    [
      // **실제 표를 그대로 쓴다.** 베껴 두면 새 경로가 빠져도 테스트는 자기 사본으로 통과한다
      { path: "/host/:id", element: <HostConsole />, children: HOST_CONSOLE_ROUTES },
    ],
    { initialEntries: [at] },
  );
  return render(<RouterProvider router={router} />);
}

beforeEach(() => {
  calls.length = 0;
  // WebSocket 은 이 환경에 없다. 실시간은 "다시 읽어라" 신호일 뿐이라 없어도 화면은 살아야 한다
  vi.stubGlobal(
    "WebSocket",
    class {
      close() {}
    },
  );
});

describe("운영자 콘솔이 비어버리지 않는다", () => {
  /*
   * 401·403 은 PIN 화면으로 되돌린다 (`useAuthRedirect`). 그 밖의 실패는 아무 데도 안 갔고,
   * **파티 중에 콘솔이 통째로 비어버렸다** — 단계도 못 넘기고 자리도 못 본다.
   * 빈 화면은 무엇이 잘못됐는지도, 다음에 뭘 해야 하는지도 말하지 않는다.
   */
  it("★ 망이 끊겨도 빈 화면이 아니라 다시 시도할 길을 준다", async () => {
    /*
     * 닿지 못한 실패는 곧바로 올리지 않는다 — 기기가 깨어나는 순간의 1초짜리 실패에
     * 콘솔을 통째로 갈아치울 이유가 없다. 다만 **영영 감추지도 않는다.**
     * 정말 망이 없는 운영자는 자기가 왜 못 보는지 알아야 한다.
     */
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    renderConsole();
    for (let i = 0; i < 6; i++) await act(async () => void (await vi.advanceTimersByTimeAsync(4000)));
    expect(screen.getByText(new RegExp(FAIL.offline.split("\n")[0]))).toBeTruthy();
    expect(screen.getByText(FAIL.reconnect)).toBeTruthy();
    vi.useRealTimers();
  });

  it("★ 서버가 500 을 줘도 마찬가지다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "boom" }), { status: 500 })),
    );
    renderConsole();
    await screen.findByText(FAIL.retry);
  });
});

describe("매칭 목록", () => {
  it("★ 갈래를 나누지 않는다 — 매칭은 파티 콕만 센다 (ADR-34)", async () => {
    /*
     * 사전·파티·엇갈림으로 쪼개던 카드를 걷어냈다. 매칭이 파티 콕만 세므로
     * 그 갈래가 나올 수 없고, **매력 투표를 서로 했다는 건 붙일 의미가 없는 사실**이다.
     * 죽은 값을 그리느니 지운다.
     */
    stubFetch(
      // 매칭 카드는 파티부터 선다 (ADR-46) — 그전에는 있을 수가 없어서 그리지 않는다
      hostState({ phase: "party" }, {
        mutual: [["a", "b"], ["a", "c"], ["b", "c"], ["c", "d"]],
      }),
    );
    renderConsole();
    await screen.findByText(HOST_UI.dash.mutualTitle(4));

    // 갈래 카드가 없다 — 쌍 수를 세는 칸이 어디에도 뜨지 않는다
    expect(screen.queryByText("1쌍")).toBeNull();
    expect(screen.queryByText("0쌍")).toBeNull();
  });
});

/**
 * 현황 탭의 순위 둘 (ADR-46).
 *
 * 두 라운드는 쓰임이 다르다 — 매력 투표 표는 **자리의 재료**고, 파티 콕은 **매칭의 재료**다 (ADR-34).
 * 그래서 한 수로 합치면 `콕 TOP` 이 *파티에서 몇 번 받았나* 를 말하지 못한다.
 *
 * ⚠️ 이 파일이 순위의 **내용**을 재는 유일한 자리다. 서버 테스트는 두 표가 갈렸는지만 보고,
 * 어느 표가 어느 제목 아래 그려지는지는 못 본다 — 둘을 맞바꿔도 서버는 초록이다.
 */
describe("현황 탭의 순위 둘", () => {
  /** 제목 줄부터 **다음 제목 줄 전까지**를 한 묶음으로 본다. 순위 행은 그 사이에만 있다 */
  function rankRows(title: string) {
    const rows: Array<[string, string]> = [];
    let el = screen.getByText(title).nextElementSibling;
    while (el && !el.classList.contains("kicker")) {
      for (const r of el.querySelectorAll(".rank")) {
        rows.push([r.querySelector(".name")!.textContent!, r.querySelector(".ct")!.textContent!]);
      }
      el = el.nextElementSibling;
    }
    return rows;
  }

  it("★ 콕 TOP 에 매력 투표 표가 얹히지 않는다", async () => {
    // `가` 는 매력 투표에서 9표를 받았지만 파티에서는 한 번도 못 받았다
    stubFetch(hostState({ phase: "party" }, { received: { pre: { p1: 9, p2: 1 }, party: { p1: 0, p2: 2 } } }));
    renderConsole();
    await screen.findByText(HOST_UI.dash.rankTitle(1));

    expect(rankRows(HOST_UI.dash.preRankTitle(2))).toEqual([["가", "9"], ["나", "1"]]);
    // 합쳐 세면 `가` 가 9회로 여기 1위에 선다. 그 순간 이 숫자는 파티를 말하지 않는다
    expect(rankRows(HOST_UI.dash.rankTitle(1))).toEqual([["나", "2"]]);
  });

  it("★ 매력 투표도 TOP 5 — 1위만 크게 보여주지 않는다", async () => {
    const mk = (n: number) => ({
      id: `x${n}`, nickname: `사람${n}`, realName: `김${n}`, age: 30, gender: (n % 2 ? "M" : "F") as "M" | "F",
      phone: `0100000000${n}`, instagram: `gram_${n}`, mbti: "ENFP",
      charms: ["a", "b", "c"] as [string, string, string], createdAt: n, pin: "set" as const,
    });
    const players = [1, 2, 3, 4, 5, 6, 7].map(mk);
    // 7·6·5·4·3·2·1 — 여섯째부터는 TOP 5 밖이다
    const pre = Object.fromEntries(players.map((p, i) => [p.id, 7 - i]));
    stubFetch(hostState({ phase: "party" }, { players, received: { pre, party: {} } }));
    renderConsole();
    await screen.findByText(HOST_UI.dash.preRankTitle(5));

    const rows = rankRows(HOST_UI.dash.preRankTitle(5));
    expect(rows.map(([who]) => who)).toEqual(["사람1", "사람2", "사람3", "사람4", "사람5"]);
    // 콕 쪽은 아무도 못 받았으니 순위가 아니라 빈 문구다
    expect(rankRows(HOST_UI.dash.rankTitle(5))).toEqual([]);
    expect(screen.getByText(HOST_UI.dash.rankEmpty)).toBeTruthy();
  });

  /**
   * 낱말이 라운드마다 다르다 (ADR-34). 매력 투표 자리에서 `콕` 이라고 하면
   * 운영자가 읽는 것과 참가자가 겪는 것이 갈린다 — 참가자는 그 단계에서 콕을 찌른 적이 없다.
   */
  it("★ 아무도 못 받았을 때 두 자리가 다른 말을 한다", async () => {
    stubFetch(hostState({ phase: "party" }, { received: { pre: {}, party: {} } }));
    renderConsole();
    await screen.findByText(HOST_UI.dash.preRankEmpty);

    expect(screen.getByText(HOST_UI.dash.rankEmpty)).toBeTruthy();
    expect(HOST_UI.dash.preRankEmpty).not.toBe(HOST_UI.dash.rankEmpty);
  });

  /** 화면에 선 카드 제목을 **위에서 아래 순서 그대로** 읽는다 */
  const sections = () => [...document.querySelectorAll(".kicker")].map((k) => k.textContent);

  /**
   * **파티 전에는 매력 투표 하나뿐이다** (ADR-46).
   *
   * 매칭도 파티 콕도 그전에는 **있을 수가 없다** (ADR-34) — 빈 카드를 미리 세워두면
   * 운영자가 매번 그게 정상인지 확인하게 되고, 정작 볼 것(표가 어디로 몰렸나)이 아래로 밀린다.
   */
  it("★ 파티 전에는 매칭도 콕 TOP 도 서지 않는다", async () => {
    for (const phase of ["reg", "prevote"] as const) {
      cleanup();
      stubFetch(hostState({ phase }, { received: { pre: { p1: 2, p2: 1 }, party: {} }, mutual: [] }));
      renderConsole();
      await screen.findByText(HOST_UI.dash.preRankTitle(2));

      expect(sections(), `${phase} 에 다른 카드가 섰다`).toEqual([HOST_UI.dash.preRankTitle(2)]);
      // 빈 콕 문구도 없어야 한다 — 감춘 게 아니라 그리지 않는 것이다
      expect(screen.queryByText(HOST_UI.dash.rankEmpty)).toBeNull();
      expect(screen.queryByText(HOST_UI.dash.mutualNone)).toBeNull();
    }
  });

  /**
   * **파티가 시작되면 순서가 바뀐다** — 지금 쓰이는 것이 위로 온다.
   * 매칭이 맨 위인 건 자리를 붙일지 판단하는 게 그 시점의 일이라서고,
   * 매력 투표는 끝난 라운드라 기록으로 맨 아래에 남는다.
   */
  /**
   * ★ **빈 순위가 아래 칸의 간격을 벌리지 않는다.**
   *
   * 순위 행을 담는 `stack` 이 자식 없이도 그려지면, 그것도 flex 항목이라 부모의 `gap` 을
   * 한 번 더 먹는다. 받은 콕이 없는 회차에서 **콕 TOP 아래만 넓어져** 묶음마다
   * 간격이 다르게 보였다 — 눈에는 "여기만 뭔가 빠졌나" 로 읽힌다.
   */
  it("★ 빈 순위가 아래 간격을 벌리지 않는다", async () => {
    stubFetch(hostState({ phase: "party" }, { received: { pre: { p1: 2, p2: 1 }, party: {} }, mutual: [] }));
    renderConsole();
    await screen.findByText(HOST_UI.dash.rankEmpty);

    // 자식 없는 `stack` 이 하나도 없어야 한다. 있으면 그 자리가 곧 유령 간격이다
    const empties = [...document.querySelectorAll(".stack")].filter((el) => el.children.length === 0);
    expect(empties.length, `빈 stack ${empties.length}개가 간격을 먹고 있다`).toBe(0);
  });

  it("★ 파티가 시작되면 매칭 · 콕 TOP · 매력 투표 순으로 선다", async () => {
    for (const phase of ["party", "done"] as const) {
      cleanup();
      stubFetch(hostState({ phase }, { received: { pre: { p1: 2, p2: 1 }, party: { p1: 1, p2: 0 } }, mutual: [["p1", "p2"]] }));
      renderConsole();
      await screen.findByText(HOST_UI.dash.rankTitle(1));

      expect(sections(), `${phase} 의 순서가 다르다`).toEqual([
        HOST_UI.dash.mutualTitle(1),
        HOST_UI.dash.rankTitle(1),
        HOST_UI.dash.preRankTitle(2),
      ]);
    }
  });
});

describe("운영자 콘솔", () => {
  it("현황 탭이 뜨고 다음 단계 버튼이 보인다", async () => {
    stubFetch(hostState());
    renderConsole();

    await screen.findByText("테스트 회차");
    // 등록 중 다음은 사전 투표 시작이다
    expect(screen.getByText(phaseAction("prevote", { maxPre: 3, maxParty: 3 })!.btn)).toBeTruthy();
    expect(screen.getByText(HOST_UI.dash.registered(2))).toBeTruthy();
  });

  /**
   * 단계 버튼이 하는 일은 **예약을 앞당기는 것**이다. 그래서 옆에 남은 시간이 함께 선다 —
   * 가만히 두면 언제 저절로 넘어가는지 모르면 "지금 눌러도 되나" 를 판단할 수 없다.
   *
   * ★ **넷이 다 같은 뜻이 됐다** (ADR-93). 파티 시작만 "이 숫자는 그냥 파티 일시고
   * 눌러야 열린다" 였는데, 이제 그것도 가만히 두면 그때 열린다 — 그래서 그 하나에만
   * 붙던 안내를 걷었다. **숫자 옆에 다른 뜻을 붙이지 마라.**
   */
  it("★ 버튼 옆 카운트다운은 네 전환에 모두 붙고, 뜻이 하나다", async () => {
    // 등록 중 — 다음은 매력 투표 시작이고, 예약이 걸려 있다
    stubFetch(hostState());
    renderConsole();
    await screen.findByText("테스트 회차");
    expect(document.querySelector(".phaseBtn > .due")).toBeTruthy();
    cleanup();

    /*
     * 매력 투표 중 — 다음은 파티 시작이다 (매력 투표도 그때 닫힌다, ADR-100). `partyAt` 이 예약이 되면서(ADR-93)
     * 이 숫자도 나머지와 같은 뜻이 됐다: **가만히 두면 그때 넘어간다.**
     */
    stubFetch(
      hostState({
        phase: "prevote",
        fired: { reg: Date.now() - 3 * HOUR, prevote: Date.now() - 2 * HOUR },
      }),
    );
    renderConsole();
    await screen.findByText(phaseAction("party", { maxPre: 3, maxParty: 3 })!.btn);
    expect(document.querySelector(".phaseBtn > .due"), "파티 시작 옆에 남은 시간이 없다").toBeTruthy();
  });

  /**
   * ★ **파티 시작도 예약을 앞당기는 것이다** (ADR-93). 그래서 확인창에 얼마나 이른지가
   * 나머지 둘과 똑같이 붙는다 — 예약이 없던 시절에는 이 줄이 못 서던 자리다.
   */
  it("★ 파티를 일찍 시작하면 얼마나 이른지 확인창에 적는다", async () => {
    const soon = Date.now() + 30 * 60_000;
    stubFetch(
      hostState({
        phase: "prevote",
        schedule: { partyAt: soon, regOpenAt: Date.now() - 3 * HOUR, prevoteAt: Date.now() - 2 * HOUR },
        fired: { reg: Date.now() - 3 * HOUR, prevote: Date.now() - 2 * HOUR },
      }),
    );
    renderConsole();

    const copy = phaseAction("party", { maxPre: 3, maxParty: 3 })!;
    fireEvent.click(await screen.findByText(copy.btn));
    await screen.findByText(copy.title);
    const line = schedDiff("party", {
      atText: formatWhen(soon),
      gapText: formatGap(soon - Date.now()),
      direction: "early",
    })!;
    expect(screen.getByText(line[1])).toBeTruthy();
  });

  /**
   * ★ **매력 투표 다음 버튼은 파티 시작이다** (ADR-100) — `매력 투표 마감` 버튼은 걷어냈다.
   * 그리고 1위 보너스를 켠 회차면 확인창이 **누가 받는지 이름으로** 말한다 (규칙 4).
   * 서버와 같은 함수(`topVoters`)로 세므로 확인창이 말한 사람이 실제로 받는다.
   */
  it("★ 매력 투표 다음은 파티 시작이고, 확인창이 1위 보너스를 받을 사람을 말한다", async () => {
    stubFetch(
      hostState(
        {
          phase: "prevote",
          fired: { reg: Date.now() - 2 * HOUR, prevote: Date.now() - HOUR },
          config: { maxPre: 3, maxParty: 3, topVoteBonus: 1 },
        },
        // 남자는 가 가 2표, 여자는 나 가 1표 — 1표뿐인 성별에는 1위가 없다
        { received: { pre: { p1: 2, p2: 1 }, party: {} } },
      ),
    );
    renderConsole();

    const copy = phaseAction("party", { maxPre: 3, maxParty: 3, topVoters: ["가"] })!;
    fireEvent.click(await screen.findByText(copy.btn));
    await screen.findByText(copy.title);
    const line = copy.facts.find(([k]) => k === "프로필 투표 1위")!;
    expect(screen.getByText(line[1])).toBeTruthy();
    // 파티 전에는 칩이 없다 — 1위는 파티가 시작되는 순간 정해진다
    expect(screen.queryByText(HOST_UI.dash.topVoteChip)).toBeNull();
  });

  it("★ 단계 전환은 확인을 거치고, 확인창이 바뀌는 것을 항목으로 보여준다", async () => {
    stubFetch(hostState());
    renderConsole();
    const copy = phaseAction("prevote", { maxPre: 3, maxParty: 3 })!;

    fireEvent.click(await screen.findByText(copy.btn));
    await screen.findByText(copy.title);
    for (const [label] of copy.facts) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    // 아직 아무 일도 일어나지 않았다
    expect(calls.some((c) => c.url.includes("/phase"))).toBe(false);

    fireEvent.click(screen.getAllByText(copy.btn)[1]);
    await waitFor(() => expect(calls.find((c) => c.url.includes("/phase"))?.body).toEqual({ to: "prevote" }));
  });

  it("★ 필터 칩은 성별 축이다 — 칩 셋이 곧 성비다", async () => {
    /*
     * 칩의 진짜 용도는 "세 숫자를 한 번에 보는 것"(성비)이다 —
     * 고른 쪽만 세면 성비를 보려고 버튼을 두 번 눌러야 한다.
     * 미등록은 칩에 없다. 그건 위쪽 명단이 맡는다.
     */
    const st = hostState();
    st.invites = [{ phone: "01099998888", addedAt: 2 }];
    stubFetch(st);
    renderConsole("/host/e1/players");

    // 라벨과 숫자가 다른 요소라 버튼 전체의 글자로 본다
    const label = (text: string) =>
      screen.getAllByRole("button").find((b) => b.textContent?.startsWith(text))?.textContent;

    await screen.findByText(HOST_UI.invites.title);
    expect(label(HOST_UI.players.filterAll)).toContain("2");   // 등록한 사람만 센다
    expect(label(GENDER.M)).toContain("1");
    expect(label(GENDER.F)).toContain("1");

    // 여성만 남긴다 — 카드 목록이 그 축으로 걸러진다
    fireEvent.click(screen.getAllByRole("button").find((b) => b.textContent?.startsWith(GENDER.F))!);
    expect(document.body.textContent).not.toContain(st.players[0].realName);
    expect(document.body.textContent).toContain(st.players[1].realName);
  });

  it("★ 명단은 등록 전, 카드는 등록 후 — 같은 사람이 두 번 나오지 않는다", async () => {
    /*
     * 역할이 갈린다. 위의 초대 명단은 **등록 전/후**(부를 사람·안내문·아직 등록 안 한 사람),
     * 아래 카드는 **등록 후**(누가 왔나). 등록하면 명단 행에서 빠지고 카드로 올라온다 —
     * 두 곳에 나오면 "누구에게 보냈나" 와 "누가 왔나" 를 같은 사람으로 두 번 세게 된다.
     */
    const st = hostState();
    st.invites = [
      // 이미 등록한 사람 — 아래 카드로만 나온다
      { phone: "01011112222", addedAt: 1, nickname: st.players[0].nickname },
      // 아직 등록 안 한 사람 — 번호가 그의 유일한 이름이다
      { phone: "01099998888", addedAt: 2 },
    ];
    stubFetch(st);
    renderConsole("/host/e1/players");

    await screen.findByText(HOST_UI.invites.title);

    // 탭에는 명단 **요약 한 줄**과 등록한 사람의 카드뿐이다
    expect(screen.getByText(HOST_UI.invites.count(2, 1))).toBeTruthy();
    expect(screen.getAllByText("010-1111-2222")).toHaveLength(1);
    // 아직 등록 안 한 사람의 번호는 탭에 없다 — 시트를 열어야 나온다
    expect(screen.queryByText("010-9999-8888")).toBeNull();

    // 카드를 누르면 명단 시트가 열리고, 거기 그 사람이 있다
    fireEvent.click(screen.getByText(HOST_UI.invites.title));
    expect(await screen.findByText("010-9999-8888")).toBeTruthy();
    expect(screen.getByText(HOST_UI.invites.waitingCount(1))).toBeTruthy();
    // 시트를 열어도 등록한 사람은 여전히 한 번만 나온다
    expect(screen.getAllByText("010-1111-2222")).toHaveLength(1);
  });

  it("★ 명단 시트는 라우트다 — 뒤로 가기로 닫힌다", async () => {
    /*
     * 안드로이드의 뒤로 가기가 시트를 닫아야 한다 (ROUTES.md).
     * 닫히지 않으면 뒤로 가기 한 번이 콘솔 밖으로 나가버린다.
     */
    const st = hostState();
    st.invites = [{ phone: "01099998888", addedAt: 2 }];
    stubFetch(st);
    const router = renderPlayers("/host/e1/players");

    fireEvent.click(await screen.findByText(HOST_UI.invites.title));
    await screen.findByLabelText(HOST_UI.invites.addLabel);

    await act(async () => void (await router.navigate(-1)));
    await waitFor(() => expect(screen.queryByLabelText(HOST_UI.invites.addLabel)).toBeNull());
    // 탭은 그대로다 — 시트만 닫혔다
    expect(screen.getByText(HOST_UI.invites.title)).toBeTruthy();
  });

  /**
   * ★ **명단을 열었다고 키보드가 올라오지 않는다** (ADR-63).
   *
   * 이 시트를 여는 이유는 대개 **읽으려는 것**이다 — 누가 초대됐고 누가 아직 등록 안 했나.
   * 그런데 폰에서 열면 키보드가 곧장 올라와 화면 절반을 먹고, 정작 보려던 명단이 그 아래 깔린다.
   *
   * 원인은 우리 코드의 `autoFocus` 가 아니다 — 그건 어디에도 없다.
   * **Radix Dialog 가 열릴 때 첫 포커스 가능한 요소를 잡는다.** 이 시트에서 그게 전화번호 칸이다.
   * 시트 중에 텍스트 입력을 가진 건 여기 하나뿐이라, 나머지 넷은 첫 요소가 버튼이라 티가 안 났다.
   */
  it("★ 명단을 열었다고 전화번호 칸에 커서가 가지 않는다", async () => {
    const st = hostState();
    st.invites = [{ phone: "01099998888", addedAt: 2 }];
    stubFetch(st);
    renderConsole("/host/e1/players/invites");

    const input = await screen.findByLabelText(HOST_UI.invites.addLabel);
    // 자동 포커스는 마운트 뒤 효과에서 돈다. 한 박자 기다렸다 본다
    await waitFor(() => expect(screen.getByText(HOST_UI.invite.copy)).toBeTruthy());

    expect(
      document.activeElement,
      "전화번호 칸에 커서가 갔다 — 폰에서는 이 순간 키보드가 올라온다",
    ).not.toBe(input);

    /*
     * **포커스는 시트 안에 남아 있어야 한다.** `preventDefault()` 만 하면 `body` 로 떨어져서
     * 포커스 트랩이 풀리고(Tab 이 시트 뒤 목록으로 샌다) 스크린리더가 제목을 못 읽는다.
     * 키보드를 막으려다 그걸 부수는 고침이 제일 쉽게 나온다.
     */
    const sheet = input.closest("[role=dialog]");
    expect(sheet, "시트를 못 찾았다").toBeTruthy();
    expect(
      sheet!.contains(document.activeElement),
      "포커스가 시트 밖으로 떨어졌다 — 트랩이 풀린다",
    ).toBe(true);
  });

  /**
   * ★ **화면이 이미 말한 것을 토스트가 또 말하지 않는다** (ADR-65).
   *
   * 토스트는 `position: fixed` 로 화면 아래에 떠서 **시트 안 명단을 덮는다.**
   * 더하면 행이 생기고 머리 숫자가 오른다 — 덮어가며 다시 말할 것이 없다.
   */
  it("★ 명단에 더해도 토스트를 띄우지 않는다 — 화면이 이미 말한다", async () => {
    const st = hostState();
    st.invites = [];
    /* 공용 스텁은 POST 에 `{ok:true}` 만 준다. 더하기 왕복은 서버가 **전체 명단**을 돌려줘야 흉내가 된다 */
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        if (url.includes("/invites") && body && "phones" in body) {
          for (const phone of (body as { phones: string[] }).phones) {
            st.invites.push({ phone, addedAt: 1 });
          }
          return json(st.invites);
        }
        return json(url.includes("/state") ? st : { ok: true });
      }),
    );
    renderConsole("/host/e1/players/invites");

    const input = await screen.findByLabelText(HOST_UI.invites.addLabel);
    fireEvent.change(input, { target: { value: "010-5032-7984" } });
    fireEvent.click(screen.getByText(HOST_UI.invites.addOne));

    // 행이 생기는 것이 곧 알림이다
    await screen.findByText("010-5032-7984");
    expect(document.querySelector(".toast"), "명단을 덮는 토스트가 떴다").toBeNull();
  });

  /**
   * ★ **방금 넣은 번호는 더하기 폼 바로 아래에 선다.**
   *
   * 토스트가 없으니(ADR-65) 행이 생기는 것이 유일한 알림이다 — 그 행이 **화면 안에** 생겨야
   * 알림이 된다. 오래된 순이면 새 행은 명단 끝에 붙는다. 스무 명 넘게 부른 회차에서 그 끝은
   * 폰으로 세 화면 아래라, 운영자는 칸만 `010` 으로 비는 것을 보고 **안 들어간 줄 안다.**
   * (실제로 그렇게 신고가 왔다. 서버에는 들어가 있었다.)
   */
  it("★ 방금 넣은 번호가 명단 맨 위에 선다 — 명단이 길어도 폼 바로 아래다", async () => {
    const st = hostState();
    st.invites = Array.from({ length: 20 }, (_, i) => ({
      phone: `0105555${String(1000 + i)}`,
      addedAt: 1 + i,
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        if (url.includes("/invites") && body && "phones" in body) {
          for (const phone of (body as { phones: string[] }).phones) {
            st.invites.push({ phone, addedAt: 100 });
          }
          return json(st.invites);
        }
        return json(url.includes("/state") ? st : { ok: true });
      }),
    );
    renderConsole("/host/e1/players/invites");

    const input = await screen.findByLabelText(HOST_UI.invites.addLabel);
    fireEvent.change(input, { target: { value: "010-5032-7984" } });
    fireEvent.click(screen.getByText(HOST_UI.invites.addOne));
    await screen.findByText("010-5032-7984");

    const sheet = document.body.querySelector("[role=dialog]")!;
    const rows = [...sheet.querySelectorAll("span")]
      .map((el) => el.textContent ?? "")
      .filter((t) => /^\d{3}-\d{4}-\d{3,4}$/.test(t));
    expect(rows[0], "방금 넣은 번호가 명단 끝에 붙었다 — 폰에서는 화면 밖이다").toBe("010-5032-7984");
    // 나머지도 새것부터다
    expect(rows.slice(1, 3)).toEqual(["010-5555-1019", "010-5555-1018"]);
  });

  /**
   * ★ **클립보드는 눈에 안 보이니 버튼이 스스로 말한다** (ADR-65).
   *
   * 여기서까지 토스트를 없애면 눌렀는지조차 알 수 없다 — 운영자의 일이
   * 복사해서 보내는 것이라 그 신호가 없으면 안 된다. 누른 자리에서 말하면 명단을 안 덮는다.
   */
  it("★ 복사는 버튼이 말한다 — 아래에 띄우지 않는다", async () => {
    const st = hostState();
    st.invites = [{ phone: "01099998888", addedAt: 2 }];
    stubFetch(st);
    stubClipboard();
    renderConsole("/host/e1/players/invites");

    fireEvent.click(await screen.findByText(HOST_UI.invite.copy));

    await screen.findByText(HOST_UI.invite.copyDone);
    expect(document.querySelector(".toast"), "명단을 덮는 토스트가 떴다").toBeNull();
  });

  /**
   * ★ **안내문 → 더하기 → 명단.** 시트 안에서 가장 자주 하는 일이 위에 온다.
   *
   * 안내문 복사는 사람을 부를 때마다 하고, 번호 더하기는 대개 회차를 열 때 한 번이다.
   * 명단은 그 아래에 한 덩어리로 모인다 — 번호가 그 사람의 유일한 이름인 자리라
   * 흩어 두면 어깨너머로 더 읽힌다.
   *
   * DOM 순서로 잠근다. 화면에서 위아래는 **읽는 차례**라 CSS 가 아니라 순서가 정한다.
   */
  it("★ 시트 순서는 안내문 → 더하기 → 명단이다", async () => {
    const st = hostState();
    st.invites = [{ phone: "01099998888", addedAt: 2 }];
    stubFetch(st);
    renderConsole("/host/e1/players/invites");

    await screen.findByText(HOST_UI.invite.copy);
    /* 시트는 포털로 나가서 `container` 밖에 붙는다 (Radix `Dialog.Portal`) */
    const sheet = document.body.querySelector("[role=dialog]")!;
    expect(sheet, "시트를 못 찾았다").toBeTruthy();
    const seen = [...sheet.querySelectorAll("button, input, p")].map((el) =>
      el.id === "oneInvite" ? "폼" : el.textContent?.includes(HOST_UI.invite.copy) ? "안내문"
        : el.textContent?.includes(HOST_UI.invites.waitingCount(1)) ? "명단" : null,
    );
    expect(seen.filter(Boolean), "안내문 → 폼 → 명단 순서가 아니다").toEqual(["안내문", "폼", "명단"]);
  });

  it("★ 안내문 카드에 미리보기를 두지 않는다 — 고치는 화면이 그 일을 한다", async () => {
    const st = hostState();
    st.invites = [{ phone: "01099998888", addedAt: 2 }];
    stubFetch(st);
    // 시트도 라우트라 주소로 바로 열린다
    renderConsole("/host/e1/players/invites");

    await screen.findByText(HOST_UI.invite.copy);
    expect(screen.getByText(HOST_UI.invite.editTemplate)).toBeTruthy();
    // 글 자체는 화면에 없다. 복사 버튼이 담아 주는 것이지 읽으라고 펼쳐 두는 것이 아니다
    expect(document.body.textContent).not.toContain(INVITE_TEMPLATE.split("{")[0]);
  });

  /** 클립보드는 happy-dom 에 없다. 컴포넌트가 쓰는 자리만 채운다 */
  function stubClipboard() {
    // 인자 타입을 적어야 `calls[0][0]` 을 읽을 수 있다
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    return writeText;
  }

  /**
   * ★ **링크는 회차마다 하나이고 안내문 안에 있다** (ADR-75).
   *
   * 사람마다 다른 링크가 없어졌다 — 안내문 하나가 완결된 초대장이라 한 메시지로 끝난다.
   * 토큰이 주소에 실리면 안 된다: 초대 쿠키의 내부 식별자일 뿐이고, 응답에도 없다.
   */
  it("★ 안내문에 회차 링크가 들어간다 — 사람마다 다른 링크는 없다", async () => {
    const st = hostState();
    st.invites = [{ phone: "01099998888", addedAt: 2 }];
    stubFetch(st);
    const writeText = stubClipboard();
    renderConsole("/host/e1/players/invites");

    fireEvent.click(await screen.findByText(HOST_UI.invite.copy));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const text = String(writeText.mock.calls[0][0]);
    expect(text).toContain(`${location.origin}/j/e1`);
    // 회차 링크 뒤에 아무것도 붙지 않는다 — 토큰도 번호도
    expect(text).toMatch(new RegExp(`/j/e1(\\s|$)`));
    expect(text).not.toContain("/j/e1/");
  });

  /**
   * 행에 붙는 건 **빼기뿐이다.** 사람마다 다른 것이 없어졌으니 행마다 링크 버튼이 없고(ADR-75),
   * 문구는 전원이 같아서 행마다 둘 이유가 없다. 어디까지 보냈는지도 표시하지 않는다 —
   * 복사가 곧 발송이 아니고, 되돌릴 수 있는 표시는 틀렸을 때 아무도 모른다.
   */
  it("★ 명단 행에는 빼기뿐이다 — 복사 둘은 명단 머리에 하나씩이고, 보냄 표시는 없다", async () => {
    const st = hostState();
    st.invites = [
      { phone: "01099998888", addedAt: 2 },
      { phone: "01077776666", addedAt: 3 },
    ];
    stubFetch(st);
    renderConsole("/host/e1/players/invites");

    // 안내문 복사도 링크 복사도 명단 머리에 하나뿐이다 — 사람이 둘이어도 하나다
    expect((await screen.findAllByText(HOST_UI.invite.copy)).length).toBe(1);
    expect(screen.getAllByText(HOST_UI.invite.copyLink).length).toBe(1);
    expect(screen.getAllByText(HOST_UI.invites.remove).length).toBe(2);
    // 보냄으로 찍는 길이 아예 없다
    expect(calls.some((c) => c.url.includes("/sent"))).toBe(false);
  });

  /**
   * ★ **링크만 복사하는 버튼은 주소 하나만 담는다.** 안내문은 이미 보냈고 링크만 다시 보낼 때
   * (잃어버린 사람, 늦게 합류한 사람) 안내문 전체를 또 붙여넣게 하지 않는다.
   * 다른 글자가 섞이면 대화방에서 눌러 열 수 없다.
   */
  it("★ 초대 링크 복사는 회차 링크 하나만 담는다 — 다른 글자 없이", async () => {
    const st = hostState();
    st.invites = [{ phone: "01099998888", addedAt: 2 }];
    stubFetch(st);
    const writeText = stubClipboard();
    renderConsole("/host/e1/players/invites");

    fireEvent.click(await screen.findByText(HOST_UI.invite.copyLink));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toBe(`${location.origin}/j/e1`);
    // 누른 버튼이 말한다 — 안내문 버튼은 그대로다 (ADR-65)
    await screen.findByText(HOST_UI.invite.copyDone);
    expect(screen.getByText(HOST_UI.invite.copy)).toBeTruthy();
    expect(document.querySelector(".toast"), "명단을 덮는 토스트가 떴다").toBeNull();
  });

  /**
   * ★ **참가자 PIN 번호는 상태만 보인다** (S-C3). 값도 해시도 응답에 없다 — 운영자도 남의 PIN 번호를 못 본다.
   * `잠김` 은 눈에 띄어야 한다: 참가자가 말하기 전에 운영자가 먼저 보는 편이 낫다.
   */
  it("★ 상세 시트는 참가자 PIN 번호의 상태만 보여준다 — 잠김은 눈에 띈다", async () => {
    const st = hostState();
    st.players[0].pin = "locked";
    stubFetch(st);
    renderConsole("/host/e1/players/p1");

    await screen.findByText(HOST_UI.players.pinLabel);
    const state = screen.getByText(HOST_UI.players.pinState.locked);
    expect(state.className, "잠김이 다른 상태와 같은 색이다").toContain("warnText");
    // 초기화 길은 상세 시트 안에 있다 — 목록에서 손끝으로 지워지는 자리가 아니다
    expect(screen.getByText(HOST_UI.players.pinReset)).toBeTruthy();
  });

  /**
   * ★ **초기화는 확인을 거치고, 무엇이 어떻게 바뀌는지 항목으로 보여준다** (S-C4).
   * 되돌릴 수 없는 일이다 — 지운 PIN 번호는 아무도 모른다(해시뿐). 콕·자리가 그대로라는 것도 여기서 말한다.
   */
  it("★ 참가자 PIN 번호 초기화는 확인을 거쳐 그 사람의 초기화 경로로 간다", async () => {
    const st = hostState();
    stubFetch(st);
    renderConsole("/host/e1/players/p1");

    fireEvent.click(await screen.findByText(HOST_UI.players.pinReset));
    await screen.findByText(HOST_UI.players.pinResetTitle);
    for (const [label] of HOST_UI.players.pinResetFacts("set")) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(screen.getByText(HOST_UI.players.pinResetNote)).toBeTruthy();
    // 아직 아무 일도 일어나지 않았다
    expect(calls.some((c) => c.url.includes("/pin/reset"))).toBe(false);

    fireEvent.click(screen.getAllByText(HOST_UI.players.pinReset)[1]);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/host/events/e1/players/p1/pin/reset"))).toBe(true));
    // 토스트를 띄우지 않는다 (ADR-65) — 시트의 상태 줄이 바뀐다
    expect(document.querySelector(".toast")).toBeNull();
  });

  /*
   * 운영자 명단의 번호 칸. 참가자의 입장 확인창과 **같은 규칙**(씨앗·하이픈)을 쓴다 (ADR-75).
   * 여기서 잘못 옮겨 적은 번호는 그 사람이 문 앞에서 `초대된 번호가 아니에요` 를 볼 때야 드러난다.
   */
  describe("명단 번호 칸", () => {
    const field = async () => {
      stubFetch(hostState());
      // 번호 칸은 명단 시트 안에 있다. 시트도 라우트라 주소로 바로 열린다
      renderConsole("/host/e1/players/invites");
      return (await screen.findByLabelText(HOST_UI.invites.addLabel)) as HTMLInputElement;
    };

    it("★ 010 이 채워진 채로 시작하고, 지우고 다른 번호를 칠 수 있다", async () => {
      /*
       * 거의 모든 번호가 010 이라 세 번의 탭을 아낀다. 다만 **칸 밖의 고정 접두사로 두지 않는다** —
       * 011 같은 옛 번호를 지우고 칠 수 없으면 그 사람은 문 앞에서 막힌다.
       */
      const input = await field();
      expect(input.value).toBe("010");
      fireEvent.change(input, { target: { value: "0112345678" } });
      expect(input.value).toBe("011-2345-678");
    });

    it("★ 씨앗만 있는 칸에 포커스가 오면 010 이 선택된 채로 남지 않는다", async () => {
      /*
       * 브라우저가 `010` 을 **통째로 선택한 채** 포커스를 준다. 그대로 두면 다음에 누르는
       * 숫자 하나가 그 세 글자를 덮어써서, 여덟 자리만 친 번호가 명단에 들어간다.
       */
      const input = await field();
      input.setSelectionRange(0, input.value.length);
      fireEvent.focus(input);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      expect(input.selectionStart).toBe(3);
      expect(input.selectionEnd).toBe(3);
    });

    it("이미 친 번호가 있으면 전체 선택을 건드리지 않는다 — 다 지우고 다시 치려는 것이다", async () => {
      const input = await field();
      fireEvent.change(input, { target: { value: "01012345678" } });
      input.setSelectionRange(0, input.value.length);
      fireEvent.focus(input);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(input.value.length);
    });

    it("★ 치는 대로 하이픈이 붙고, 자리가 덜 차면 더할 수 없다", async () => {
      const input = await field();
      const submit = screen.getByText(HOST_UI.invites.addOne) as HTMLButtonElement;

      fireEvent.change(input, { target: { value: "0101234" } });
      expect(input.value).toBe("010-1234");
      expect(submit.disabled).toBe(true);

      fireEvent.change(input, { target: { value: "01012345678" } });
      expect(input.value).toBe("010-1234-5678");
      expect(submit.disabled).toBe(false);
    });

    it("자동완성이 채운 열한 자리도 그대로 받는다", async () => {
      // 자동완성은 하이픈 없이 한 번에 넣는다. 세 번 아끼려다 열한 번을 잃으면 안 된다
      const input = await field();
      fireEvent.change(input, { target: { value: "010-9876-5432" } });
      expect(input.value).toBe("010-9876-5432");
    });
  });

  it("★ 운영자에게도 받은 콕은 보여주지 않는다", async () => {
    // 알면 그 사람을 다르게 대하게 된다. 이 앱이 없애려던 경험이다 (ADR-22)
    stubFetch(hostState());
    renderConsole("/host/e1/players");
    await screen.findByText(HOST_UI.invites.title);

    // 참가자 탭에는 안 보인다. 현황 탭의 순위와는 자리가 다르다 (ADR-30)
    expect(document.body.textContent).not.toContain("받은 콕");
  });

  it("★ 카드는 실명부터 보여준다 — 얼굴과 맞추는 건 닉네임이 아니다", async () => {
    // 문 앞에서 사람을 찾는 화면이다. MBTI·콕 횟수는 상세로 갔다 (ADR-33)
    const st = hostState();
    stubFetch(st);
    renderConsole("/host/e1/players");
    await screen.findByText(HOST_UI.invites.title);

    const card = screen.getAllByRole("button").find((b) => b.textContent?.includes(st.players[0].realName));
    expect(card, "실명이 카드 앞면에 있어야 한다").toBeTruthy();
    const text = card!.textContent ?? "";
    // 실명이 닉네임보다 앞에 온다
    expect(text.indexOf(st.players[0].realName)).toBeLessThan(text.indexOf(st.players[0].nickname));
    // 번호도 같이 보인다 — 문 앞에서 대조하는 값이다
    expect(text).toContain("010-1111-2222");
    // MBTI 는 앞면에 없다
    expect(text).not.toContain(st.players[0].mbti);
  });

  it("★ 설정은 확인을 거쳐야 적용된다", async () => {
    stubFetch(hostState());
    renderConsole("/host/e1/settings");

    const name = await screen.findByLabelText(HOST_UI.fields.name);
    fireEvent.change(name, { target: { value: "바꾼 이름" } });
    fireEvent.click(screen.getByText(HOST_UI.applySettings));

    // 무엇이 어떻게 바뀌는지 항목으로 보여준다. 아직 저장되지 않았다
    await screen.findByText(HOST_UI.applyTitle);
    expect(screen.getByText("테스트 회차 → 바꾼 이름")).toBeTruthy();
    expect(calls.some((c) => c.url.includes("/host/events/e1") && c.body)).toBe(false);

    fireEvent.click(screen.getAllByText(HOST_UI.applySettings)[1]);
    await waitFor(() =>
      expect(calls.find((c) => c.url.endsWith("/host/events/e1"))?.body).toMatchObject({ name: "바꾼 이름" }),
    );
  });

  it("★ 알림을 회차마다, 라운드마다 정한다 (ADR-43)", async () => {
    /*
     * 알림은 **라운드마다 따로다.** 매력 투표는 며칠에 걸쳐 쌓여서, 켜두면 파티 전에
     * 이미 순위가 생긴다. 기본은 둘 다 안전한 쪽 — 알리지 않는다.
     *
     * 되돌리기 토글 둘이 여기 있었다 (ADR-95 가 걷었다). **되살리지 마라** —
     * 아래 `되돌리기 칸이 없다` 가 그 약속을 지킨다.
     */
    stubFetch(hostState());
    renderConsole("/host/e1/settings");
    // 설정은 묶음으로 접혀 있다 — 규칙은 `콕 설정` 안이다
    fireEvent.click(await screen.findByText(HOST_UI.settings.rules));

    /** 그 설정 줄 안의 버튼만 집는다 — 여러 줄이 같은 글자를 쓴다 */
    const rowBtn = (label: string, option: string) => {
      const field = screen.getAllByText(label).find((el) => el.tagName === "LABEL")!.parentElement!;
      return [...field.querySelectorAll("button")].find((b) => b.textContent === option)!;
    };

    // 기본값이 눌려 있다 (알림은 안 보냄)
    expect(rowBtn(HOST_UI.fields.preNotify, HOST_UI.fields.pokeNotifyOff).getAttribute("aria-pressed")).toBe("true");
    expect(rowBtn(HOST_UI.fields.pokeNotify, HOST_UI.fields.pokeNotifyOff).getAttribute("aria-pressed")).toBe("true");

    // 둘 다 뒤집는다
    fireEvent.click(rowBtn(HOST_UI.fields.preNotify, HOST_UI.fields.pokeNotifyOn));
    fireEvent.click(rowBtn(HOST_UI.fields.pokeNotify, HOST_UI.fields.pokeNotifyOn));
    fireEvent.click(screen.getByText(HOST_UI.applySettings));

    // 확인창이 무엇이 어떻게 바뀌는지 말한다 (CLAUDE.md 규칙 4)
    await screen.findByText(HOST_UI.applyTitle);
    expect(
      screen.getAllByText(`${HOST_UI.fields.pokeNotifyOff} → ${HOST_UI.fields.pokeNotifyOn}`),
    ).toHaveLength(2);

    fireEvent.click(screen.getAllByText(HOST_UI.applySettings)[1]);
    await waitFor(() =>
      expect(calls.find((c) => c.url.endsWith("/host/events/e1"))?.body).toMatchObject({
        config: { preNotify: true, pokeNotify: true },
      }),
    );
  });

  /**
   * ★ **되돌리기는 회차 설정이 아니다** (ADR-95).
   *
   * 라운드마다 켜고 끄는 토글이 둘 있었다. 걷어낸 이유는 막는 회차를 만들 이유가 없어서다 —
   * 잘못 누른 것을 못 무르게 하면 다 쓴 사람이 손쓸 데가 없다.
   * 되살리려면 이 테스트부터 갈아야 한다.
   */
  it("★ 콕 설정에도 회차 만들기에도 되돌리기 칸이 없다", async () => {
    stubFetch(hostState());
    renderConsole("/host/e1/settings");
    fireEvent.click(await screen.findByText(HOST_UI.settings.rules));

    // 같은 묶음의 다른 줄은 그대로 있다 — 묶음을 못 연 것이 아니다
    expect(screen.getByText(HOST_UI.fields.pokeTarget)).toBeTruthy();
    for (const word of ["되돌리기", "할 수 있음", "못 함"]) {
      expect(screen.queryAllByText(word), word).toHaveLength(0);
    }
  });

  /**
   * 설정은 **네 묶음으로 접혀 있다** — 기본 정보 · 예약 · 콕 설정 · 삭제.
   *
   * 앞의 셋은 회차 만들기의 스텝과 **같은 이름·같은 순서**다. 만들 때 고른 것을 고치러
   * 오는 자리라, 이름이 다르면 어디를 눌러야 할지 다시 찾는다.
   */
  it("★ 설정 묶음 이름이 회차 만들기의 스텝과 같다", () => {
    const { identity, schedule, rules } = HOST_UI.settings;
    expect([identity, schedule, rules]).toEqual([...HOST_UI.steps]);
  });

  it("★ 고른 묶음만 그려진다", async () => {
    stubFetch(hostState());
    renderConsole("/host/e1/settings");
    await screen.findByLabelText(HOST_UI.fields.name);

    // 처음은 기본 정보 — 규칙도 일정도 여기 없다
    expect(screen.queryByText(HOST_UI.fields.pokeTarget)).toBeNull();
    expect(screen.queryByLabelText(HOST_UI.fields.maxPre)).toBeNull();

    fireEvent.click(screen.getByText(HOST_UI.settings.rules));
    expect(screen.getByText(HOST_UI.fields.pokeTarget)).toBeTruthy();
    // 옮겨가면 앞 묶음은 접힌다 — 두 벌이 동시에 떠 있으면 무엇이 저장될지 헷갈린다
    expect(screen.queryByLabelText(HOST_UI.fields.name)).toBeNull();

    /*
     * **`적용` 은 어느 묶음에서든 있다.** 세 묶음을 한꺼번에 저장하므로,
     * 없는 묶음이 생기면 거기서 고친 것을 저장할 길이 사라진다.
     */
    fireEvent.click(screen.getByText(HOST_UI.settings.schedule));
    expect(screen.getByText(HOST_UI.applySettings)).toBeTruthy();

    // 삭제만 예외다 — 저장할 값이 없고, 되돌릴 수 없는 버튼은 혼자 서 있어야 한다
    fireEvent.click(screen.getByText(HOST_UI.settings.danger));
    expect(screen.getByText(HOST_UI.deleteEvent)).toBeTruthy();
    expect(screen.queryByText(HOST_UI.applySettings), "삭제 묶음에 적용 버튼이 있다").toBeNull();
  });

  /**
   * **접힌 자리의 변경은 눈에 안 보인다.** 그게 묶는 것의 유일한 위험이라,
   * 그 사실을 두 곳에서 말한다 — 묶음의 점, 그리고 확인창.
   */
  it("★ 다른 묶음에서 고친 것도 확인창에 다 나온다", async () => {
    stubFetch(hostState());
    renderConsole("/host/e1/settings");

    // 기본 정보에서 이름을 고친다
    const nameInput = (await screen.findByLabelText(HOST_UI.fields.name)) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "고친 이름" } });

    // 콕 설정으로 옮겨 하나 더 고친다
    fireEvent.click(screen.getByText(HOST_UI.settings.rules));
    fireEvent.click(
      [...screen.getAllByText(HOST_UI.fields.pokeTarget)
        .find((el) => el.tagName === "LABEL")!
        .parentElement!.querySelectorAll("button")].find((b) => b.textContent === HOST_UI.fields.pokeTargetOpposite)!,
    );

    // 접힌 `기본 정보` 에 점이 붙어 있다
    const tab = screen.getByRole("tab", { name: new RegExp(HOST_UI.settings.identity) });
    expect(tab.textContent, "접힌 묶음에 점이 없다").toContain(HOST_UI.settings.dirty);
    // 지금 안 보이는 곳에 안 저장된 것이 있다는 한 줄
    expect(screen.getByText(HOST_UI.settings.dirtyNote)).toBeTruthy();

    // 확인창에는 **묶음과 상관없이** 둘 다 나온다
    fireEvent.click(screen.getByText(HOST_UI.applySettings));
    await screen.findByText(HOST_UI.applyTitle);
    /*
     * 확인창은 폼 **위에** 겹쳐 뜨므로 같은 글자가 화면에 둘이다 (라벨과 항목).
     * 확인창의 항목만 집는다 — 폼의 라벨이 있다고 확인창에 나온 게 아니다.
     */
    const inDialog = (label: string) =>
      screen.getAllByText(label).some((el) => el.tagName === "B");
    expect(inDialog(HOST_UI.fields.name), "이름 변경이 확인창에 없다").toBe(true);
    expect(inDialog(HOST_UI.fields.pokeTarget), "접힌 묶음의 변경이 확인창에 없다").toBe(true);
  });

  /** 예약 칸은 **시간 순**이다 — 위저드 2스텝과 같아야 고치러 온 사람이 다시 찾지 않는다 */
  it("★ 예약 묶음은 시간 순으로 선다", async () => {
    stubFetch(hostState());
    renderConsole("/host/e1/settings");
    fireEvent.click(await screen.findByText(HOST_UI.settings.schedule));

    const labels = [...document.querySelectorAll(".field")]
      .filter((f) => f.querySelector('input[type="datetime-local"]'))
      .map((f) => f.querySelector("label")!.textContent);
    /*
     * ⚠️ **파티 시작은 여기 없다** (ADR-54) — 예약이 되고도(ADR-93) `기본 정보` 묶음에
     * 남는다. 위저드 1스텝과 같은 자리라, 옮기면 만들 때와 고칠 때가 어긋난다.
     *
     * ⚠️ **등록 시작도 없다** (ADR-93). 회차를 만든 시각이라 고칠 수도 없고
     * 운영자가 볼 일도 없었다 — 못 누르는 칸이 맨 위에 서서 나머지를 한 칸씩 밀었다.
     */
    // 매력 투표 마감도 없다 (ADR-100) — 파티가 시작될 때 함께 닫힌다
    expect(labels, "예약 묶음에 예약 아닌 칸이 있다").toEqual([HOST_UI.fields.prevoteAt, HOST_UI.fields.revealAt]);
  });

  /**
   * ★ **파티 시작은 기본 정보 묶음이다** (ADR-54) — 위저드 1스텝과 같다.
   *
   * 고치면 점도 그 묶음에 붙어야 한다. 다른 알약에 붙으면 어디를 고쳤는지 못 찾는다.
   */
  it("★ 파티 시작은 기본 정보 묶음에 있고, 점도 거기 붙는다", async () => {
    stubFetch(hostState());
    renderConsole("/host/e1/settings");
    await screen.findByLabelText(HOST_UI.fields.name);

    const row = (label: string) =>
      screen.getAllByText(label).find((el) => el.tagName === "LABEL")!.parentElement!;
    const party = row(HOST_UI.fields.partyAt).querySelector("input");
    expect(party, "기본 정보에 파티 시작이 없다").toBeTruthy();
    expect(party!.type).toBe("datetime-local");

    // 고치면 `기본 정보` 알약에 점이 붙는다
    fireEvent.change(party!, { target: { value: toLocalInput(Date.now() + 48 * HOUR) } });
    const pill = screen.getByText(HOST_UI.settings.identity).closest("button")!;
    expect(pill.textContent, "고쳤는데 기본 정보에 점이 없다").toContain(HOST_UI.settings.dirty);
  });

  /**
   * ★ **콕 설정 묶음에도 설명 줄이 없다** (ADR-54 후기 2).
   *
   * 토글 다섯 중 셋에 곁설명이 붙어 **켜고 끄는 자리가 읽는 자리**가 됐다.
   * 위저드에서 걷고 여기 남겼다가 그것마저 걷었다 — 두 화면 다 없다.
   *
   * ⚠️ 다만 `frozen` 은 남아야 한다. **설명이 아니라 상태**라, 굳은 칸이 왜 안 눌리는지는
   * 말해줘야 한다 — 같은 자리에 그려지므로 함께 지우기 쉽다.
   */
  it("★ 콕 설정에 설명 줄은 없고, 굳음 표시는 남는다", async () => {
    stubFetch(hostState());
    renderConsole("/host/e1/settings");
    fireEvent.click(await screen.findByText(HOST_UI.settings.rules));

    expect(
      [...document.querySelectorAll(".tiny.dim")].map((e) => e.textContent),
      "콕 설정에 설명 줄이 남아 있다",
    ).toEqual([]);
    cleanup();

    // 굳으면 그 자리에 `frozen` 이 선다 — 설명을 걷으면서 함께 사라지면 안 된다.
    // 굳는 기준은 `rulesLocked(fired)` 다 (ADR-35) — 콕이 오갈 수 있게 된 시점부터
    stubFetch(hostState({ phase: "party", fired: { reg: Date.now() - 2 * HOUR, party: Date.now() - HOUR } }));
    renderConsole("/host/e1/settings");
    fireEvent.click(await screen.findByText(HOST_UI.settings.rules));
    expect(screen.getAllByText(HOST_UI.frozen).length, "굳음 표시까지 사라졌다").toBeGreaterThan(0);
  });

  it("★ 콕이 오가기 시작하면 규칙 셋과 일정이 잠긴다 (ADR-35)", async () => {
    /*
     * 잠긴 줄을 **지우지 않는다** — 지금 어느 규칙으로 돌아가는 중인지는
     * 파티 도중에 가장 자주 확인하는 값이다. 못 누르게만 하고 이유를 한 줄 남긴다.
     */
    stubFetch(hostState({ phase: "party", fired: { reg: Date.now() - 2 * HOUR, party: Date.now() - HOUR } }));
    renderConsole("/host/e1/settings");
    await screen.findByText(HOST_UI.settings.rules);

    const row = (label: string) =>
      screen.getAllByText(label).find((el) => el.tagName === "LABEL")!.parentElement!;
    const disabled = (label: string) =>
      [...row(label).querySelectorAll("button")].every((b) => (b as HTMLButtonElement).disabled);

    // 규칙은 `콕 설정` 묶음 안이다
    fireEvent.click(screen.getByText(HOST_UI.settings.rules));
    // 되돌리기 둘이 여기 있었다 — 설정이 없어졌으니 굳을 것도 없다 (ADR-95)
    for (const label of [
      HOST_UI.fields.pokeTarget,
      HOST_UI.fields.preNotify,
      HOST_UI.fields.pokeNotify,
    ]) {
      expect(disabled(label), label).toBe(true);
    }
    // 콕 횟수는 일부러 열려 있다 — 파티 중에 **올리는** 것이 매칭이 모자랄 때의 손잡이다
    const plus = [...row(HOST_UI.fields.maxParty).querySelectorAll("button")].at(-1) as HTMLButtonElement;
    expect(plus.disabled).toBe(false);
    expect(screen.getAllByText(HOST_UI.frozen).length).toBeGreaterThan(0);

    // 일정도 함께 굳는다 — 다른 묶음이라 옮겨가서 본다
    fireEvent.click(screen.getByText(HOST_UI.settings.schedule));
    for (const label of [HOST_UI.fields.prevoteAt]) {
      expect((row(label).querySelector("input") as HTMLInputElement).disabled, label).toBe(true);
    }
    // 파티 시작도 굳는다 — 다만 `기본 정보` 묶음에 있다 (ADR-54)
    fireEvent.click(screen.getByText(HOST_UI.settings.identity));
    expect(
      (row(HOST_UI.fields.partyAt).querySelector("input") as HTMLInputElement).disabled,
      HOST_UI.fields.partyAt,
    ).toBe(true);
  });

  it("★ 입장 코드는 바꿀 수 없다", async () => {
    stubFetch(hostState());
    renderConsole("/host/e1/settings");
    await screen.findByText(HOST_UI.codeFixed);
    // 코드는 글자로만 있다. 입력 칸이 아니다
    expect(screen.queryByLabelText(HOST_UI.fields.code)).toBeNull();
    expect(screen.getByText("ABCDEF")).toBeTruthy();
  });

  it("★ 받은 콕 순위는 TOP 5 — 5위가 동점이면 그만큼 늘어난다", () => {
    const mk = (n: number, g: "M" | "F" = "M") => ({
      id: `x${n}`, nickname: `사람${n}`, realName: `김${n}`, age: 30, gender: g,
      phone: `0100000000${n}`, instagram: `gram_${n}`, mbti: "ENFP", charms: ["a", "b", "c"] as [string, string, string],
        createdAt: n, pin: "set" as const,
    });
    const players = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => mk(n));
    // 5·4·3·2·2·2 — 5위 자리(2회)에 동점 셋. 잘랐다면 순위가 거짓말이 된다
    const received = { x1: 5, x2: 4, x3: 3, x4: 2, x5: 2, x6: 2, x7: 1, x8: 0 };
    const rows = topRanks(players, received);

    expect(rows.length).toBe(6);                        // TOP 5 + 동점 확장 = 6
    expect(rows.map((r) => r.p.id)).not.toContain("x7"); // 잘린 사람
    expect(rows.map((r) => r.p.id)).not.toContain("x8"); // 0회는 애초에 없다
    // 공동 순위: 같은 수 = 같은 번호
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 4, 4]);
  });

  it("받은 콕이 아무도 없으면 순위도 없다", () => {
    const players = [{ id: "a", nickname: "가", realName: "김가", age: 30, gender: "M" as const,
      phone: "01011112222", instagram: "gram_a", mbti: "ENFP", charms: ["a", "b", "c"] as [string, string, string], createdAt: 1, pin: "set" as const }];
    expect(topRanks(players, { a: 0 })).toEqual([]);
  });

  it("★ 예약보다 일찍 넘기면 얼마나 이른지 확인창에 적는다", async () => {
    const soon = Date.now() + 30 * 60_000;
    stubFetch(hostState({ schedule: { partyAt: Date.now() + 24 * HOUR, regOpenAt: Date.now() - HOUR, prevoteAt: soon } }));
    renderConsole();

    const copy = phaseAction("prevote", { maxPre: 3, maxParty: 3 })!;
    fireEvent.click(await screen.findByText(copy.btn));
    await screen.findByText(copy.title);
    const line = schedDiff("prevote", {
      atText: formatWhen(soon),
      gapText: formatGap(soon - Date.now()),
      direction: "early",
    })!;
    expect(screen.getByText(line[1])).toBeTruthy();
  });
});

// ─────────────────────────────────────────── 자리 배정 시트

/**
 * **배정은 두 걸음이다** (ADR-45) — 뺄 사람 고르기 → 테이블 수.
 *
 * 순서가 이래야 하는 이유가 하나다. 둘째 걸음의 `테이블당 N명` 이 첫 걸음에서 남은
 * 인원으로 계산되므로, 뒤집히면 운영자가 방금 읽은 숫자가 곧바로 틀린 것이 된다.
 */
/**
 * 발행된 라운드를 고치는 문 (ADR-49).
 *
 * 이 카드는 대부분 *누가 어디 앉았나* 를 읽으러 여는 자리다. 그래서 **기본이 잠김**이고,
 * 고치는 것은 **가장 최신 라운드 하나뿐**이다 — 지난 라운드를 고쳐도 사람들은 이미
 * 다음 자리에 앉아 있어서 아무 데도 반영되지 않는다.
 */
describe("발행된 자리를 고치는 문", () => {
  const round = (n: number, over: Partial<SeatingRound> = {}): SeatingRound => ({
    round: n,
    tableCount: 1,
    status: "published",
    seats: [{ playerId: "p1", table: 1 }, { playerId: "p2", table: 1 }],
    acks: [],
    createdAt: n,
    publishedAt: n,
    ...over,
  });

  /** 라운드 카드 하나를 제목으로 집는다. 목록은 최신이 위다 */
  const card = (n: number) =>
    screen.getByText(HOST_UI.seats.roundTitle(n)).closest(".card") as HTMLElement;

  const seatsState = (over: Partial<HostState["meta"]> = {}) =>
    hostState({ phase: "party", ...over }, { seatings: [round(1), round(2)] });

  it("★ 기본은 잠겨 있다 — 설명 줄도 없다", async () => {
    stubFetch(seatsState());
    renderConsole("/host/e1/seats");
    await screen.findByText(HOST_UI.seats.roundTitle(2));

    // 읽으러 연 사람에게는 테이블이 먼저다. 두 설명 줄이 위를 먹고 있으면 안 된다
    expect(screen.queryByText(HOST_UI.seats.swapHint), "안 고치는데 설명 줄이 떴다").toBeNull();
    // 사람을 눌러도 아무 일이 없다 — 고르는 상태로 넘어가지 않는다
    fireEvent.click(within(card(2)).getByText("가"));
    expect(screen.queryByText(HOST_UI.seats.pickedOne("가")), "잠겼는데 골라졌다").toBeNull();
  });

  it("★ 수정하기로 열고 완료로 닫는다", async () => {
    stubFetch(seatsState());
    renderConsole("/host/e1/seats");
    await screen.findByText(HOST_UI.seats.roundTitle(2));

    fireEvent.click(within(card(2)).getByText(HOST_UI.seats.edit));
    // 열렸다 — 설명 둘이 이제 선다
    expect(screen.getByText(HOST_UI.seats.swapHint)).toBeTruthy();
    // 이제 골라진다
    fireEvent.click(within(card(2)).getByText("가"));
    expect(screen.getByText(HOST_UI.seats.pickedOne("가"))).toBeTruthy();

    fireEvent.click(within(card(2)).getByText(HOST_UI.seats.editDone));
    expect(screen.queryByText(HOST_UI.seats.swapHint), "완료했는데 안 닫혔다").toBeNull();

    /*
     * **다시 열면 아무도 안 골라져 있어야 한다.**
     * ⚠️ 닫힌 상태에서 재는 건 소용없다 — 고른 줄 자체가 편집 중에만 그려져서
     * 안 놓아도 통과한다. 열어서 봐야 이 줄이 무언가를 지킨다.
     */
    fireEvent.click(within(card(2)).getByText(HOST_UI.seats.edit));
    expect(screen.getByText(HOST_UI.seats.swapHint), "다시 안 열렸다").toBeTruthy();
    expect(screen.queryByText(HOST_UI.seats.pickedOne("가")), "닫았다 열었는데 옛 선택이 살아 있다").toBeNull();
  });

  /**
   * ★ **지난 라운드에는 문이 없다.**
   *
   * 고쳐도 사람들은 이미 다음 자리에 앉아 있다. 버튼만 남겨두면 고쳤다는 사실만 남고
   * 아무 데도 반영되지 않는다 — 운영자는 바꿨다고 믿는다.
   */
  it("★ 지난 라운드는 고칠 수 없다 — 최신 하나만 열린다", async () => {
    stubFetch(seatsState());
    renderConsole("/host/e1/seats");
    await screen.findByText(HOST_UI.seats.roundTitle(1));

    expect(within(card(2)).queryByText(HOST_UI.seats.edit), "최신 라운드가 안 열린다").toBeTruthy();
    expect(within(card(1)).queryByText(HOST_UI.seats.edit), "지난 라운드에 문이 열려 있다").toBeNull();

    // 눌러도 골라지지 않는다 — 버튼만 감춘 게 아니라 실제로 잠겼다
    fireEvent.click(within(card(1)).getByText("가"));
    expect(screen.queryByText(HOST_UI.seats.pickedOne("가")), "지난 라운드에서 골라졌다").toBeNull();
  });

  it("★ 발표 뒤에는 최신 라운드도 안 열린다 (ADR-28)", async () => {
    stubFetch(seatsState({ phase: "done", fired: { reg: 1, prevote: 2, party: 3, done: 4 } }));
    renderConsole("/host/e1/seats");
    await screen.findByText(HOST_UI.seats.roundTitle(2));

    expect(screen.queryByText(HOST_UI.seats.edit), "발표 뒤에 고치는 문이 열려 있다").toBeNull();
  });
});

/**
 * 자리를 **아직 확인 안 한 사람**을 이름으로 보여준다.
 *
 * 숫자(`HOST.ack.progress`)만 있을 때는 운영자가 할 수 있는 일이 없었다 — 몇 명인지는
 * 알아도 누구인지를 몰라서다. 화장실에 갔거나 밖에 나간 사람은 방에 대고 말해도 안 들린다.
 */
describe("자리를 아직 확인 안 한 사람", () => {
  const round = (n: number, over: Partial<SeatingRound> = {}): SeatingRound => ({
    round: n,
    tableCount: 2,
    status: "published",
    seats: [{ playerId: "p1", table: 2 }, { playerId: "p2", table: 1 }],
    acks: [],
    createdAt: n,
    publishedAt: n,
    ...over,
  });
  const card = (n: number) => screen.getByText(HOST_UI.seats.roundTitle(n)).closest(".card") as HTMLElement;
  const seatsState = (over: Partial<HostState["meta"]> = {}, rounds: SeatingRound[] = [round(1), round(2)]) =>
    hostState({ phase: "party", ...over }, { seatings: rounds });

  it("★ 이름으로 보여준다 — 숫자만으로는 찾아갈 수가 없다", async () => {
    stubFetch(seatsState());
    renderConsole("/host/e1/seats");
    await screen.findByText(HOST_UI.seats.roundTitle(2));

    const body = card(2).textContent ?? "";
    // 옮겨갈 테이블을 함께 준다 — 찾았을 때 알려줄 값이 이름 옆에 있어야 한다
    expect(body, "이름이 없다").toContain(HOST_UI.seats.notAckedAt("가", 2));
    expect(body, "이름이 없다").toContain(HOST_UI.seats.notAckedAt("나", 1));
    // 테이블 순 — 같은 번호끼리 붙어 있어야 한 번에 말해줄 수 있다
    expect(body.indexOf("나 · 1번"), "테이블 순이 아니다").toBeLessThan(body.indexOf("가 · 2번"));
  });

  it("★ 전원이 확인하면 사라진다 — `0명` 을 띄우지 않는다", async () => {
    stubFetch(seatsState({}, [round(1, { acks: ["p1", "p2"] }), round(2, { acks: ["p1", "p2"] })]));
    renderConsole("/host/e1/seats");
    await screen.findByText(HOST_UI.seats.roundTitle(2));

    expect(screen.queryByText(HOST_UI.seats.notAcked), "할 일이 없는데 목록이 떴다").toBeNull();
  });

  it("★ 한 명만 남으면 그 한 명만 선다", async () => {
    stubFetch(seatsState({}, [round(2, { acks: ["p2"] })]));
    renderConsole("/host/e1/seats");
    await screen.findByText(HOST_UI.seats.roundTitle(2));

    const body = card(2).textContent ?? "";
    expect(body).toContain(HOST_UI.seats.notAckedAt("가", 2));
    expect(body, "확인한 사람이 남아 있다").not.toContain(HOST_UI.seats.notAckedAt("나", 1));
  });

  /**
   * ★ **지난 라운드에는 서지 않는다.** 사람들은 이미 다음 자리에 앉아 있어서
   * 그 라운드의 확인을 이제 와서 받을 길이 없다 — 영영 안 지워지는 할 일이 된다.
   */
  it("★ 지난 라운드에는 서지 않는다 — 최신 하나만", async () => {
    stubFetch(seatsState());
    renderConsole("/host/e1/seats");
    await screen.findByText(HOST_UI.seats.roundTitle(1));

    expect(within(card(2)).queryByText(HOST_UI.seats.notAcked), "최신 라운드에 안 선다").toBeTruthy();
    expect(within(card(1)).queryByText(HOST_UI.seats.notAcked), "지난 라운드에 섰다").toBeNull();
  });

  /**
   * ★ **발표 뒤에는 서지 않는다.** 참가자 화면에 자리 카드가 아예 안 뜨므로
   * (`SeatTakeover`) 확인이 올 수 없다. 그때 이 목록은 아무도 지울 수 없는 이름표다.
   */
  it("★ 발표 뒤에는 서지 않는다 — 확인이 올 수 없는 자리다", async () => {
    stubFetch(seatsState({ phase: "done", fired: { reg: 1, prevote: 2, party: 3, done: 4 } }));
    renderConsole("/host/e1/seats");
    await screen.findByText(HOST_UI.seats.roundTitle(2));

    expect(screen.queryByText(HOST_UI.seats.notAcked), "발표 뒤에 섰다").toBeNull();
  });
});

describe("자리 배정 시트", () => {
  const party = () => hostState({ phase: "party" });

  /** 시트 안의 것을 누른다 — 목록 화면에도 같은 이름의 버튼이 있다 */
  const inSheet = () => within(document.querySelector('[role="dialog"]') as HTMLElement);
  /** 목록은 접힌 채로 열린다 (ADR-77). 이름 줄·성별 칩을 만지려면 먼저 편다 */
  const unfold = () => fireEvent.click(inSheet().getByText(HOST_UI.seats.excludePick));
  /** a 가 b 보다 앞에 섰는가 — 운영자가 보는 순서다 */
  const before = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

  it("★ 테이블 수보다 뺄 사람을 먼저 묻는다", async () => {
    stubFetch(party());
    renderConsole("/host/e1/seats/new");

    // 첫 걸음에는 테이블 수 스테퍼가 없다
    await screen.findByText(HOST_UI.seats.excludeNote);
    expect(screen.queryByText(HOST_UI.seats.tableCount)).toBeNull();

    fireEvent.click(inSheet().getByText(HOST_UI.seats.excludeNext));
    // 시트 제목과 스테퍼 라벨이 같은 말이다. 둘 다 떴는지만 본다
    expect((await screen.findAllByText(HOST_UI.seats.tableCount)).length).toBeGreaterThan(0);
  });

  it("★ 아무도 안 빼면 전원이 배정된다 — 없는 일을 알리지 않는다", async () => {
    stubFetch(party());
    renderConsole("/host/e1/seats/new");

    await screen.findByText(HOST_UI.seats.seatedAll(2));
    expect(screen.queryByText(HOST_UI.seats.leftOutNote)).toBeNull();
  });

  /**
   * ★ **접힌 채로 연다** (ADR-77). 대부분의 라운드는 아무도 안 빼므로, 서른 줄을 지나서야
   * 다음 버튼에 닿게 하지 않는다 — 열자마자 인원 줄과 다음 버튼이 있고, 이름은 손잡이를
   * 눌러야 선다. 펼치면 손잡이는 사라진다.
   */
  it("★ 접힌 채로 열린다 — 다음 버튼은 바로, 이름은 펼쳐야 보인다", async () => {
    stubFetch(party());
    renderConsole("/host/e1/seats/new");
    await screen.findByText(HOST_UI.seats.seatedAll(2));

    expect(inSheet().getByText(HOST_UI.seats.excludeNext)).toBeTruthy();
    expect(inSheet().queryByText("김가"), "펼치기 전에는 이름이 없다").toBeNull();

    unfold();
    expect(inSheet().getByText("김가")).toBeTruthy();
    expect(inSheet().queryByText(HOST_UI.seats.excludePick), "펼친 뒤 손잡이는 없다").toBeNull();
  });

  /**
   * ★ **실명이 앞에 서고, 닉네임과 나이가 같은 줄에 있다** (ADR-77 후기).
   * 운영자는 닉네임만으로 그 사람이 누구인지 알기 어렵다 — 참가자 탭과 같은 차례다.
   */
  it("★ 줄은 실명이 앞에 서고, 닉네임과 나이가 따라온다", async () => {
    stubFetch(party());
    renderConsole("/host/e1/seats/new");
    await screen.findByText(HOST_UI.seats.seatedAll(2));
    unfold();

    const row = inSheet().getByText("김가").closest("button") as HTMLElement;
    const text = row.textContent ?? "";
    expect(text.indexOf("김가"), "실명이 닉네임보다 앞").toBeLessThan(text.indexOf("가 "));
    expect(text).toContain(UNIT.age(28));
  });

  /**
   * ★ **자리 검토의 머리말은 뺄 사람 시트의 `제외` 와 같은 말이다** (ADR-77 후기).
   * 운영자가 방금 고른 낱말이 검토 카드에서 다시 보여야 두 화면이 이어진다 —
   * `아직 앉지 않은 사람` 은 참가자가 스스로 안 앉은 것처럼 읽혔다.
   */
  it("★ 검토 카드의 빠진 사람 머리말은 시트의 `제외` 표시와 같은 말이다", () => {
    expect(HOST_UI.seats.unassigned).toBe(HOST_UI.seats.excludeOut);
  });

  /** ★ **실명 순이다** (ADR-77 후기). 등록 순서도, 닉네임 순도 아니다 */
  it("★ 목록은 등록 순서도 닉네임 순도 아니라 실명 순으로 선다", async () => {
    const st = party();
    // 등록 순서는 다(이서) → 가(박준) → 나(김민). 닉네임 순이면 가·나·다, 실명 순이면 김민·박준·이서
    st.players = [
      { ...st.players[0], id: "p3", nickname: "다", realName: "이서" },
      { ...st.players[0], nickname: "가", realName: "박준" },
      { ...st.players[1], nickname: "나", realName: "김민" },
    ];
    stubFetch(st);
    renderConsole("/host/e1/seats/new");
    await screen.findByText(HOST_UI.seats.seatedAll(3));
    unfold();

    const [kim, park, lee] = ["김민", "박준", "이서"].map((n) => inSheet().getByText(n));
    expect(before(kim, park), "김민 → 박준").toBe(true);
    expect(before(park, lee), "박준 → 이서").toBe(true);
  });

  it("★ 뺀 사람은 인원에서 빠지고, 왜 빠졌는지 말한다", async () => {
    stubFetch(party());
    renderConsole("/host/e1/seats/new");
    await screen.findByText(HOST_UI.seats.seatedAll(2));
    unfold();

    // 한 명을 뺀다 — `2명 배정` 이 아니라 `1명 배정 · 1명 제외`, 그리고 발에 누구를 뺐는지(실명)
    fireEvent.click(inSheet().getByText("김가"));
    await screen.findByText(HOST_UI.seats.leftOut(1, 1));
    expect(screen.queryByText(HOST_UI.seats.seatedAll(2))).toBeNull();
    expect(inSheet().getByText(HOST_UI.seats.excludedNames(["김가"], 0))).toBeTruthy();
  });

  /**
   * 사람이 서른을 넘으면 한 목록에서 한 사람을 찾는 게 일이 된다.
   * **참가자 탭과 같은 칩**이라 운영자가 어느 쪽인지 다시 익힐 것이 없다.
   */
  it("★ 성별 칩으로 목록을 좁힌다", async () => {
    stubFetch(party());
    renderConsole("/host/e1/seats/new");
    await screen.findByText(HOST_UI.seats.seatedAll(2));

    unfold();
    // 전체로 시작한다 — 남 하나, 여 하나
    expect(inSheet().getByText("김가")).toBeTruthy();
    expect(inSheet().getByText("김나")).toBeTruthy();

    fireEvent.click(inSheet().getByText(GENDER.M, { exact: false }));
    expect(inSheet().getByText("김가")).toBeTruthy();
    expect(inSheet().queryByText("김나")).toBeNull();
  });

  /**
   * ★ **거르는 것은 보는 방법이지 빼는 방법이 아니다.**
   *
   * 남성만 보고 있다고 여성이 배정에서 빠지면, 운영자는 화면에 안 보이는 사람이
   * 조용히 사라진 것을 배정하고 나서야 안다.
   */
  it("★ 걸러 놔도 안 보이는 사람은 그대로 배정된다", async () => {
    stubFetch(party());
    renderConsole("/host/e1/seats/new");
    await screen.findByText(HOST_UI.seats.seatedAll(2));
    unfold();

    fireEvent.click(inSheet().getByText(GENDER.M, { exact: false }));
    // 인원 줄은 여전히 전원 기준이다
    expect(screen.getByText(HOST_UI.seats.seatedAll(2))).toBeTruthy();

    fireEvent.click(inSheet().getByText(HOST_UI.seats.excludeNext));
    await screen.findAllByText(HOST_UI.seats.tableCount);
    fireEvent.click(inSheet().getByText(HOST_UI.seats.make));

    await waitFor(() => expect(calls.find((c) => c.url.endsWith("/seating"))).toBeTruthy());
    expect(calls.find((c) => c.url.endsWith("/seating"))?.body).toEqual({
      tableCount: 1,
      exclude: [],
    });
  });

  /**
   * ★ **배정 버튼은 하나뿐이다** (ADR-51).
   *
   * 옆에 `💘 커플 자리 배정` 이 있었다. 콕이 매 라운드 자리에 반영되므로 쌍만 모으는
   * 전용 라운드가 필요 없어졌고, 못 붙은 쌍은 운영자가 자리에서 보고 맞교환으로 옮긴다.
   */
  it("★ 자리 탭의 배정 버튼은 하나뿐이다", async () => {
    stubFetch(party());
    renderConsole("/host/e1/seats");

    const buttons = await screen.findAllByText(HOST_UI.seats.make);
    expect(buttons).toHaveLength(1);
  });

  it("★ 뺀 사람이 배정 요청에 실린다", async () => {
    // 한 명을 빼고도 테이블 하나를 채울 수 있어야 다음 걸음으로 넘어간다 (최소 2명)
    const st = party();
    st.players = [...st.players, { ...st.players[1], id: "p3", nickname: "다", realName: "김다" }];
    stubFetch(st);
    renderConsole("/host/e1/seats/new");
    await screen.findByText(HOST_UI.seats.seatedAll(3));
    unfold();

    fireEvent.click(inSheet().getByText("김가"));
    fireEvent.click(inSheet().getByText(HOST_UI.seats.excludeNext));
    await screen.findAllByText(HOST_UI.seats.tableCount);
    fireEvent.click(inSheet().getByText(HOST_UI.seats.make));

    await waitFor(() => expect(calls.find((c) => c.url.endsWith("/seating"))).toBeTruthy());
    expect(calls.find((c) => c.url.endsWith("/seating"))?.body).toEqual({
      tableCount: 1,
      exclude: ["p1"],
    });
  });
});

// ─────────────────────────────────────────── 자리에서 쌍 짚어주기

/**
 * **쌍을 붙이는 일이 알고리즘에서 운영자의 손으로 옮겨왔다** (ADR-51).
 *
 * 커플 자리 라운드가 하던 일을 이제 사람이 한다 — 그래서 화면이 짚어주지 않으면
 * 할 수 있는 일이 없다. 💘 는 붙었다는 뜻이고, **💔 은 옮길 수 있다는 신호다.**
 */
describe("자리 검토 — 서로 찌른 쌍", () => {
  /** 두 테이블, 네 사람. p1–p2 가 서로 찔렀고 어디 앉힐지는 테스트가 정한다 */
  function withSeats(sameTable: boolean) {
    const st = hostState({ phase: "party" });
    st.players = [
      ...st.players,
      { ...st.players[0], id: "p3", nickname: "다", realName: "김다" },
      { ...st.players[1], id: "p4", nickname: "라", realName: "김라" },
    ];
    st.mutual = [["p1", "p2"]];
    st.seatings = [
      {
        round: 1,
        tableCount: 2,
        status: "draft",
        acks: [],
        createdAt: Date.now(),
        seats: [
          { playerId: "p1", table: 1 },
          { playerId: "p2", table: sameTable ? 1 : 2 },
          { playerId: "p3", table: 2 },
          { playerId: "p4", table: sameTable ? 2 : 1 },
        ],
      },
    ];
    return st;
  }

  /** 자리 칩에 찍힌 글자들. 그림과 글자가 같은 말을 하는지 여기서 본다 */
  const chips = () => [...document.querySelectorAll(".seatChip")].map((el) => el.textContent ?? "");

  it("★ 같은 테이블에 앉은 쌍은 💘 로 표시된다", async () => {
    stubFetch(withSeats(true));
    renderConsole("/host/e1/seats");

    await screen.findByText(HOST_UI.seats.pairAllTogether);
    const marked = chips().filter((t) => t.includes(HOST_UI.seats.pairChip(1)));
    expect(marked).toHaveLength(2);
    // 그림만으로 말하지 않는다 — 같은 것을 글자로도 준다
    for (const t of marked) expect(t).toContain(HOST_UI.seats.pairChipNote(1));
  });

  it("★ 떨어져 앉은 쌍은 💔 이고, 누구인지 이름으로 말한다", async () => {
    stubFetch(withSeats(false));
    renderConsole("/host/e1/seats");

    // 떨어진 쌍은 이름으로 — 그게 운영자가 손볼 목록이다
    await screen.findByText(HOST_UI.seats.pairSplit("가 ↔ 나"));
    expect(screen.queryByText(HOST_UI.seats.pairAllTogether)).toBeNull();

    const marked = chips().filter((t) => t.includes(HOST_UI.seats.pairChip(0)));
    expect(marked).toHaveLength(2);
    for (const t of marked) expect(t).toContain(HOST_UI.seats.pairChipNote(0));
  });

  /** 짝이 없는 사람에게는 아무 표시도 붙이지 않는다 — 없는 일을 알리지 않는다 */
  it("★ 짝이 없는 사람에게는 표시가 없다", async () => {
    stubFetch(withSeats(true));
    renderConsole("/host/e1/seats");

    await screen.findByText(HOST_UI.seats.pairAllTogether);
    // 넷이 앉아 있고 그중 둘만 쌍이다
    expect(chips()).toHaveLength(4);
    expect(chips().filter((t) => t.includes(HOST_UI.seats.pairChipNote(1)))).toHaveLength(2);
    expect(chips().filter((t) => t.includes(HOST_UI.seats.pairChipNote(0)))).toHaveLength(0);
  });
});

describe("참가자 탭 · 나이 띠", () => {
  /**
   * ★ **남녀 나이가 얼마나 겹치는지 눈으로 본다.**
   *
   * 운영자가 조절하려는 것은 *남녀 나이차* 인데, 숫자 하나로는 그 답을 못 준다 —
   * 쌍봉이면 평균 차이가 0 으로 나오고, 다 겹치는 판이 한쪽 끝에 혼자 있는 판보다
   * 평균 차이가 더 크게 나온다. 그래서 **같은 축 위의 띠 두 줄**로 보여주고,
   * 숫자는 그 옆에 거드는 자리다 (ADR-86 후기 — 중앙값에서 평균으로).
   *
   * 인원 수는 여기 없다 — 바로 아래 성별 칩이 이미 말한다.
   */
  const mk = (id: string, age: number, gender: "M" | "F") => ({
    id, nickname: id, realName: `김${id}`, age, gender,
    phone: `0100000${id.padStart(4, "0")}`, instagram: id, mbti: "ENFP",
    charms: ["a", "b", "c"] as [string, string, string], createdAt: 1, pin: "set" as const,
  });

  /**
   * 성별 줄 하나를 집어온다 — 어느 줄에 무엇이 적혔는지까지 봐야 한다.
   * **띠 카드 안으로 좁힌다** — `남성`·`여성` 은 바로 아래 필터 칩에도 있다.
   */
  const card = () => document.querySelector<HTMLElement>(".ageBand")!;
  const row = (label: string) => within(card()).getByText(label).closest<HTMLElement>(".ageRow")!;
  /** 띠의 자리 — `left`·`width` 를 퍼센트 문자열로 */
  function band(label: string) {
    const i = row(label).querySelector<HTMLElement>(".bar i")!;
    return { left: i.style.left, width: i.style.width };
  }

  it("★ 남녀 각각 나이대와 평균이 보인다", async () => {
    stubFetch(hostState({}, {
      players: [mk("a", 26, "M"), mk("b", 29, "M"), mk("c", 34, "M"),
                mk("d", 23, "F"), mk("e", 27, "F"), mk("f", 31, "F")],
    }));
    renderPlayers("/host/e1/players");
    await screen.findByText(HOST_UI.players.ages.summary(26, 34, 29.7));

    // **줄마다** 본다 — 두 줄을 한꺼번에 훑으면 남녀가 뒤바뀌어도 통과한다
    expect(within(row(GENDER.M)).getByText(HOST_UI.players.ages.summary(26, 34, 29.7))).toBeTruthy();
    expect(within(row(GENDER.F)).getByText(HOST_UI.players.ages.summary(23, 31, 27))).toBeTruthy();
  });

  it("★ 평균은 한 자리까지 남긴다 — 정수로 자르면 두 줄이 같아 보인다", async () => {
    // 남 27.5 · 여 27.0. 반올림해 버리면 둘 다 `28세` 와 `27세` 로 갈리거나 같아진다
    stubFetch(hostState({}, {
      players: [mk("a", 27, "M"), mk("b", 28, "M"), mk("d", 26, "F"), mk("e", 28, "F")],
    }));
    renderPlayers("/host/e1/players");
    await waitFor(() => expect(card()).toBeTruthy());

    expect(within(row(GENDER.M)).getByText(HOST_UI.players.ages.summary(27, 28, 27.5))).toBeTruthy();
    // 27.0 은 `.0` 을 달지 않는다
    expect(within(row(GENDER.F)).getByText(HOST_UI.players.ages.summary(26, 28, 27))).toBeTruthy();
  });

  it("★ 두 띠가 같은 축을 쓴다 — 그래야 겹침이 보인다", async () => {
    stubFetch(hostState({}, {
      players: [mk("a", 26, "M"), mk("b", 29, "M"), mk("c", 34, "M"),
                mk("d", 23, "F"), mk("e", 27, "F"), mk("f", 31, "F")],
    }));
    renderPlayers("/host/e1/players");
    await screen.findByText(HOST_UI.players.ages.summary(26, 34, 29.7));

    /*
     * 축은 23~34 (폭 11). 줄마다 제 범위로 늘이면 두 띠가 똑같이 꽉 차서
     * **겹침이 사라진다** — 그게 이 화면이 답하려는 질문 자체다.
     */
    expect(band(GENDER.M)).toEqual({ left: "27.3%", width: "72.7%" });
    expect(band(GENDER.F)).toEqual({ left: "0%", width: "72.7%" });
  });

  it("★ 모두 같은 나이여도 띠가 사라지지 않는다", async () => {
    stubFetch(hostState({}, { players: [mk("a", 30, "M"), mk("d", 30, "F")] }));
    renderPlayers("/host/e1/players");
    await waitFor(() => expect(card()).toBeTruthy());

    // 폭이 0 이면 0% 가 되어 줄이 빈 것처럼 보인다. 나이가 하나뿐인 것과 아무도 없는 것은 다르다
    for (const g of [GENDER.M, GENDER.F]) expect(band(g).width).not.toBe("0%");
    // 범위가 없으면 범위처럼 적지 않는다 — `30~30세 · 중앙 30세` 는 같은 말을 세 번 한다
    expect(within(row(GENDER.M)).getByText(UNIT.age(30))).toBeTruthy();
  });

  it("★ 띠는 성별 칩 **위**에 있다 — 칩 아래에는 칩이 거르는 것만 온다", async () => {
    stubFetch(hostState({}, { players: [mk("a", 26, "M"), mk("d", 31, "F")] }));
    renderPlayers("/host/e1/players");
    await waitFor(() => expect(card()).toBeTruthy());

    /*
     * 띠는 **필터를 안 탄다** — `남성` 을 눌러도 두 줄이 그대로다. 그런 것이 칩과 목록
     * 사이에 끼면 칩이 가리키는 곳이 칩이 거르는 것이 아니게 된다.
     *
     * `Node.DOCUMENT_POSITION_FOLLOWING` = 4. 앞뒤만 재고 **누가 누구의 형제인지는
     * 묻지 않는다** — 사이에 무엇을 더 끼워도 순서만 맞으면 통과한다.
     */
    const chips = document.querySelector<HTMLElement>(".choice")!;
    expect(card().compareDocumentPosition(chips) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("★ 한쪽 성별만 있으면 그 줄만 선다", async () => {
    stubFetch(hostState({}, { players: [mk("a", 26, "M"), mk("b", 34, "M")] }));
    renderPlayers("/host/e1/players");
    await screen.findByText(HOST_UI.players.ages.summary(26, 34, 30));

    // 여성 줄을 빈 띠로 두면 `0명` 이 아니라 `0세` 로 읽힌다
    expect(card().querySelectorAll(".ageRow")).toHaveLength(1);
  });
});

/**
 * 떨어뜨려 앉히기 (ADR-90, 슬라이스 33). **운영자 화면에만 있다.**
 *
 * 알리는 자리는 **자리 칩 하나**다 — 요약 문구·토스트·테이블 머리글이 없다.
 * 되돌릴 수 있는 일이라 넣기도 빼기도 확인창이 없다 (ADR-6).
 */
describe("떨어뜨려 앉히기", () => {
  const published = (seats: SeatingRound["seats"]): SeatingRound => ({
    round: 1, tableCount: 2, status: "published", seats, acks: [], createdAt: 1, publishedAt: 1,
  });

  it("★ 떼어 놓을 상대와 같은 테이블이면 두 사람 자리 칩에만 ⛔ 와 상대 닉네임이 뜬다", async () => {
    stubFetch(
      hostState(
        { phase: "party" },
        { seatings: [published([{ playerId: "p1", table: 1 }, { playerId: "p2", table: 1 }])], apart: [["p1", "p2"]] },
      ),
    );
    renderConsole("/host/e1/seats");
    await screen.findByText(HOST_UI.seats.roundTitle(1));

    const chips = [...document.querySelectorAll(".seatChip")];
    const chipOf = (nick: string) => chips.find((c) => c.textContent?.includes(nick) && c.querySelector(".ellipsis")?.textContent?.endsWith(nick))!;
    expect(chipOf("가").textContent).toContain(HOST_UI.seats.apartChip);
    expect(chipOf("가").textContent, "그림만으로 말했다").toContain(HOST_UI.seats.apartNote(["나"]));
    expect(chipOf("나").textContent).toContain(HOST_UI.seats.apartNote(["가"]));
    // 칩 밖 어디에도 없다 — 요약 문구·머리글을 두지 않는다
    const outside = document.body.textContent!.split(HOST_UI.seats.apartChip).length - 1;
    expect(outside, "칩 밖에 ⛔ 가 있다").toBe(2);
  });

  /**
   * 서로 찌른 쌍인데 떼어 놓을 쌍이기도 하면 **짝으로 짚지 않는다.** 💔(`짝 따로`)는 *붙일 수 있다* 는
   * 신호라, 떼어 놓은 두 사람을 다시 붙이라고 말하게 된다. 떼어 놓기가 이긴다 (ADR-90).
   */
  it("★ 떼어 놓을 쌍은 서로 찔렀어도 💘·💔 로 짚지 않는다", async () => {
    stubFetch(
      hostState(
        { phase: "party" },
        {
          mutual: [["p1", "p2"]],
          apart: [["p1", "p2"]],
          seatings: [published([{ playerId: "p1", table: 1 }, { playerId: "p2", table: 2 }])],
        },
      ),
    );
    renderConsole("/host/e1/seats");
    await screen.findByText(HOST_UI.seats.roundTitle(1));
    expect(document.body.textContent, "떼어 놓은 쌍을 다시 붙이라고 짚었다").not.toContain(HOST_UI.seats.pairChip(0));
    expect(document.body.textContent).not.toContain(HOST_UI.seats.pairChipNote(0));
  });

  it("★ 다른 테이블이면 아무 표시도 없다", async () => {
    stubFetch(
      hostState(
        { phase: "party" },
        { seatings: [published([{ playerId: "p1", table: 1 }, { playerId: "p2", table: 2 }])], apart: [["p1", "p2"]] },
      ),
    );
    renderConsole("/host/e1/seats");
    await screen.findByText(HOST_UI.seats.roundTitle(1));
    expect(document.body.textContent).not.toContain(HOST_UI.seats.apartChip);
  });

  it("★ 상세 시트에서 고르면 그 쌍으로 간다 — 확인창 없이", async () => {
    stubFetch(hostState());
    renderConsole("/host/e1/players/p1");

    fireEvent.click(await screen.findByText(HOST_UI.players.apart.add));
    await screen.findByText(HOST_UI.players.apart.pickTitle("가"));
    const sheet = screen.getByRole("dialog", { name: HOST_UI.players.apart.pickTitle("가") });
    // 자기 자신은 고를 수 없다
    expect(within(sheet).queryByText(`김가 · 가 · ${UNIT.age(28)}`)).toBeNull();
    fireEvent.click(within(sheet).getByText(`김나 · 나 · ${UNIT.age(27)}`));

    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/host/events/e1/apart"))).toBe(true));
    expect(calls.find((c) => c.url.endsWith("/host/events/e1/apart"))!.body).toEqual({ a: "p1", b: "p2" });
    expect(document.querySelector(".dialog"), "되돌릴 수 있는데 확인창이 떴다").toBeNull();
    expect(document.querySelector(".toast"), "줄이 생기는 것이 알림인데 토스트가 떴다").toBeNull();
  });

  it("★ 이미 넣은 쌍은 상세 시트에 줄로 있고, 빼기도 확인창 없이 간다", async () => {
    stubFetch(hostState({}, { apart: [["p1", "p2"]] }));
    renderConsole("/host/e1/players/p2");

    await screen.findByText("김가 · 가");
    fireEvent.click(screen.getByText(HOST_UI.players.apart.remove));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/host/events/e1/apart/p2/p1"))).toBe(true));
    expect(document.querySelector(".dialog")).toBeNull();
  });

  it("★ 발표 뒤에는 더하는 버튼이 없다", async () => {
    stubFetch(hostState({ phase: "done" }));
    renderConsole("/host/e1/players/p1");
    await screen.findByText(HOST_UI.players.apart.title);
    expect(screen.queryByText(HOST_UI.players.apart.add)).toBeNull();
  });

  /**
   * ★ **거절은 화면이 말한다.** 고르는 시트를 열어 둔 사이 발표가 나면 서버가 409 로 거절하는데,
   * 조용히 실패하면 시트가 그대로 열린 채 아무 말이 없어 운영자가 다시 누른다 (ADR-8).
   */
  it("★ 거절되면 토스트로 말한다 — 시트를 열어 둔 사이 발표가 났을 때", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/apart") && init?.method === "POST") {
          return new Response(JSON.stringify({ error: "closed", message: HOST_UI.players.apart.afterReveal }), {
            status: 409,
            headers: { "content-type": "application/json" },
          });
        }
        return json(url.includes("/state") ? hostState() : { ok: true });
      }),
    );
    renderConsole("/host/e1/players/p1");

    fireEvent.click(await screen.findByText(HOST_UI.players.apart.add));
    const sheet = await screen.findByRole("dialog", { name: HOST_UI.players.apart.pickTitle("가") });
    fireEvent.click(within(sheet).getByText(`김나 · 나 · ${UNIT.age(27)}`));

    await screen.findByText(HOST_UI.players.apart.afterReveal);
  });
});
