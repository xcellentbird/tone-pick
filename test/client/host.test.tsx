/**
 * 운영자 콘솔이 조용히 죽지 않는지 본다 (ADR-8).
 *
 * 특히 단계 전환 — 참가자 전원의 화면이 바뀌는 행동이라 확인창이 **무엇이 어떻게 바뀌는지**
 * 항목으로 보여줘야 하고, 확인을 누르기 전에는 아무 일도 일어나면 안 된다.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouterProvider, createMemoryRouter } from "react-router";
import { FAIL, GENDER, HOST_UI, phaseAction, schedDiff } from "../../src/shared/copy.ts";
import { formatGap, formatWhen } from "../../src/shared/time.ts";
import type { HostState } from "../../src/shared/types.ts";
import HostConsole from "../../src/client/routes/host/HostConsole.tsx";
import Dash, { topRanks } from "../../src/client/routes/host/Dash.tsx";
import Players from "../../src/client/routes/host/Players.tsx";
import Settings from "../../src/client/routes/host/Settings.tsx";

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
      },
    ],
    sent: { p1: 1, p2: 0 },
    received: { p1: 0, p2: 1 },
    prevoteRank: [{ id: "p2", count: 1 }, { id: "p1", count: 0 }],
    mutual: [],
    pokeCount: { pre: 1, party: 0 },
    pokeUsedMax: { pre: 1, party: 0 },
    seatings: [],
    invites: [],
    announcements: [],
    matchRounds: {},
    ...more,
  };
}

const calls: Array<{ url: string; body: unknown }> = [];

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

function renderConsole(at = "/host/e1") {
  const router = createMemoryRouter(
    [
      {
        path: "/host/:id",
        element: <HostConsole />,
        children: [
          { index: true, element: <Dash /> },
          { path: "players", element: <Players /> },
          { path: "settings", element: <Settings /> },
        ],
      },
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

describe("매칭이 어떻게 이루어졌나", () => {
  it("★ 네 갈래의 합이 통합 매칭 수와 같다 — 운영자가 덧셈으로 의심하지 않게", async () => {
    /*
     * 사전·파티·통합 세 숫자를 나란히 두면 3+5≠9 를 운영자가 먼저 눈치챈다.
     * 엇갈린 쌍은 어느 라운드도 아니고, 둘 다인 쌍은 두 번 세어지기 때문이다.
     */
    stubFetch(
      hostState({}, {
        mutual: [["a", "b"], ["a", "c"], ["b", "c"], ["c", "d"]],
        matchRounds: { "a|b": "pre", "a|c": "party", "b|c": "party", "c|d": "crossed" },
      }),
    );
    renderConsole();
    await screen.findByText(HOST_UI.dash.mutualTitle(4));

    expect(screen.getByText(HOST_UI.dash.mix.pre)).toBeTruthy();
    // 사전 1 · 파티 2 · 둘 다 0 · 엇갈림 1 = 4
    expect(screen.getAllByText("1쌍").length).toBe(2);
    expect(screen.getByText("2쌍")).toBeTruthy();
    expect(screen.getByText("0쌍")).toBeTruthy();
  });
});

describe("운영자 콘솔", () => {
  it("현황 탭이 뜨고 다음 단계 버튼이 보인다", async () => {
    stubFetch(hostState());
    renderConsole();

    await screen.findByText("테스트 회차");
    // 등록 중 다음은 사전 투표 시작이다
    expect(screen.getByText(phaseAction("prevote", { code: "ABCDEF", maxPre: 3, maxParty: 3 })!.btn)).toBeTruthy();
    expect(screen.getByText(HOST_UI.dash.registered(2))).toBeTruthy();
  });

  it("★ 단계 전환은 확인을 거치고, 확인창이 바뀌는 것을 항목으로 보여준다", async () => {
    stubFetch(hostState());
    renderConsole();
    const copy = phaseAction("prevote", { code: "ABCDEF", maxPre: 3, maxParty: 3 })!;

    fireEvent.click(await screen.findByText(copy.btn));
    await screen.findByText(copy.title);
    for (const [label] of copy.facts) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    // 아직 아무 일도 일어나지 않았다
    expect(calls.some((c) => c.url.includes("/phase"))).toBe(false);

    fireEvent.click(screen.getAllByText(copy.btn)[1]);
    await waitFor(() => expect(calls.find((c) => c.url.includes("/phase"))?.body).toEqual({ to: "prevote" }));
  });

  it("참가자 탭 필터에 인원 수가 함께 보인다", async () => {
    // 현황 탭에서 뺀 성비가 실제로 필요한 자리는 명단 앞이다. 세 숫자를 한 번에 본다
    stubFetch(hostState());
    renderConsole("/host/e1/players");

    // 라벨과 숫자가 다른 요소라 버튼 전체의 글자로 본다
    const label = (text: string) =>
      screen.getAllByRole("button").find((b) => b.textContent?.startsWith(text))?.textContent;

    await screen.findByText(HOST_UI.invites.title);
    expect(label(HOST_UI.players.filterAll)).toContain("2");
    expect(label(GENDER.M)).toContain("1");
    expect(label(GENDER.F)).toContain("1");
  });

  it("★ 운영자에게도 받은 콕은 보여주지 않는다", async () => {
    // 알면 그 사람을 다르게 대하게 된다. 이 앱이 없애려던 경험이다 (ADR-22)
    stubFetch(hostState());
    renderConsole("/host/e1/players");
    await screen.findByText(HOST_UI.invites.title);

    expect(screen.getAllByText(HOST_UI.players.sent(1)).length).toBeGreaterThan(0);
    // 참가자 탭에는 안 보인다. 현황 탭의 순위와는 자리가 다르다 (ADR-30)
    expect(document.body.textContent).not.toContain("받은 콕");
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
      createdAt: n,
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
      phone: "01011112222", instagram: "gram_a", mbti: "ENFP", charms: ["a", "b", "c"] as [string, string, string], createdAt: 1 }];
    expect(topRanks(players, { a: 0 })).toEqual([]);
  });

  it("★ 예약보다 일찍 넘기면 얼마나 이른지 확인창에 적는다", async () => {
    const soon = Date.now() + 30 * 60_000;
    stubFetch(hostState({ schedule: { partyAt: Date.now() + 24 * HOUR, regOpenAt: Date.now() - HOUR, prevoteAt: soon } }));
    renderConsole();

    const copy = phaseAction("prevote", { code: "ABCDEF", maxPre: 3, maxParty: 3 })!;
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
