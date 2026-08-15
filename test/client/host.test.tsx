/**
 * 운영자 콘솔이 조용히 죽지 않는지 본다 (ADR-8).
 *
 * 특히 단계 전환 — 참가자 전원의 화면이 바뀌는 행동이라 확인창이 **무엇이 어떻게 바뀌는지**
 * 항목으로 보여줘야 하고, 확인을 누르기 전에는 아무 일도 일어나면 안 된다.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouterProvider, createMemoryRouter } from "react-router";
import { GENDER, HOST_UI, phaseAction, schedDiff } from "../../src/shared/copy.ts";
import { formatGap, formatWhen } from "../../src/shared/time.ts";
import type { HostState } from "../../src/shared/types.ts";
import HostConsole from "../../src/client/routes/host/HostConsole.tsx";
import Dash from "../../src/client/routes/host/Dash.tsx";
import Players from "../../src/client/routes/host/Players.tsx";
import Settings from "../../src/client/routes/host/Settings.tsx";

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
    sent: { p1: 1, p2: 0 },
    prevoteRank: [{ id: "p2", count: 1 }, { id: "p1", count: 0 }],
    mutual: [],
    pokeCount: { pre: 1, party: 0 },
    pokeUsedMax: { pre: 1, party: 0 },
    seatings: [],
    invites: [],
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
