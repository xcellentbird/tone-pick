/**
 * 운영자 콘솔이 조용히 죽지 않는지 본다 (ADR-8).
 *
 * 특히 단계 전환 — 참가자 전원의 화면이 바뀌는 행동이라 확인창이 **무엇이 어떻게 바뀌는지**
 * 항목으로 보여줘야 하고, 확인을 누르기 전에는 아무 일도 일어나면 안 된다.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouterProvider, createMemoryRouter } from "react-router";
import { HOST_UI, PREVOTE_ALREADY_CLOSED, phaseAction } from "../../src/shared/copy.ts";
import { formatWhen } from "../../src/shared/time.ts";
import type { HostState } from "../../src/shared/types.ts";
import HostConsole from "../../src/client/routes/host/HostConsole.tsx";
import Dash from "../../src/client/routes/host/Dash.tsx";

afterEach(cleanup);

const HOUR = 3600_000;

function hostState(over: Partial<HostState["meta"]> = {}): HostState & { seatingClosed: boolean } {
  return {
    meta: {
      id: "e1",
      name: "테스트 회차",
      code: "ABCDEF",
      phase: "reg",
      fired: { reg: Date.now() - HOUR },
      schedule: { regOpenAt: Date.now() - HOUR, voteCloseAt: Date.now() + HOUR },
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
        mbti: "ISFJ",
        charms: ["a", "b", "c"],
        createdAt: 2,
      },
    ],
    received: { p1: 0, p2: 1 },
    sent: { p1: 1, p2: 0 },
    prevoteRank: [{ id: "p2", count: 1 }, { id: "p1", count: 0 }],
    mutual: [],
    pokeCount: { pre: 1, party: 0 },
    seatings: [],
    seatingClosed: false,
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

function renderConsole() {
  const router = createMemoryRouter(
    [{ path: "/host/:id", element: <HostConsole />, children: [{ index: true, element: <Dash /> }] }],
    { initialEntries: ["/host/e1"] },
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

  it("★ 마감이 이미 지났으면 시작하자마자 마감된다고 경고한다", async () => {
    const past = Date.now() - 10 * 60_000;
    stubFetch(hostState({ schedule: { regOpenAt: Date.now() - HOUR, voteCloseAt: past } }));
    renderConsole();

    const copy = phaseAction("prevote", { code: "ABCDEF", maxPre: 3, maxParty: 3 })!;
    fireEvent.click(await screen.findByText(copy.btn));
    await screen.findByText(copy.title);
    expect(screen.getByText(PREVOTE_ALREADY_CLOSED(formatWhen(past))[1])).toBeTruthy();
  });
});
