/**
 * 슬라이스 27 — 설문 화면 (ADR-83)
 *
 *   운영자   설문 탭에서 카드를 누르면 답으로 걸러진 참가자 카드가 나온다 — 누가 무엇을 골랐는지
 *   참가자   홈의 설문 카드에는 **숫자가 없다.** 선택지 둘이 버튼이고, 고르면 눌린 채로 남는다
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, RouterProvider, createMemoryRouter } from "react-router";
import { HOST_UI, POLL } from "../../src/shared/copy.ts";
import type { HostState, ParticipantState, PublicAnnouncement } from "../../src/shared/types.ts";
import type { ParticipantSource } from "../../src/client/lib/participant.ts";
import { HOST_CONSOLE_ROUTES } from "../../src/client/router.tsx";
import HostConsole from "../../src/client/routes/host/HostConsole.tsx";
import { ParticipantView } from "../../src/client/routes/Participant.tsx";

afterEach(cleanup);

const HOUR = 3600_000;
const person = (id: string, nickname: string, realName: string, gender: "M" | "F", n: number) => ({
  id, nickname, realName, gender, age: 29, phone: `0101111000${n}`, instagram: n === 1 ? "gram_ga" : "", mbti: "ENFP",
  charms: ["a", "b", "c"] as [string, string, string], createdAt: 1, pin: "set" as const,
});

function hostState(): HostState {
  return {
    meta: {
      id: "e1", name: "테스트 회차", code: "ABCDEF", phase: "party",
      fired: { reg: Date.now() - 3 * HOUR, prevote: Date.now() - 2 * HOUR, party: Date.now() - HOUR },
      schedule: { partyAt: Date.now() - HOUR },
      config: { maxPre: 3, maxParty: 3 },
      createdAt: Date.now() - 4 * HOUR,
    },
    players: [person("p1", "가", "김가", "M", 1), person("p2", "나", "김나", "F", 2), person("p3", "다", "김다", "M", 3)],
    sent: { pre: {}, party: {} },
    received: { pre: {}, party: {} },
    mutual: [],
    pokeCount: { pre: 0, party: 0 },
    pokeUsedMax: { pre: 0, party: 0 },
    seatings: [],
    invites: [],
    announcements: [
      {
        id: "q1", at: Date.now() - 600_000, text: "2차 갈래요?",
        poll: { a: "갈래요", b: "못 가요" },
        count: { a: 1, b: 1 },
        choices: { p1: "a", p2: "b" },
      },
    ],
  };
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", class { close() {} });
});

describe("운영자 설문 탭", () => {
  function renderConsole(at: string) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("/state") ? hostState() : { ok: true }), {
        status: 200, headers: { "content-type": "application/json" },
      })),
    );
    const router = createMemoryRouter(
      [{ path: "/host/:id", element: <HostConsole />, children: HOST_CONSOLE_ROUTES }],
      { initialEntries: [at] },
    );
    render(<RouterProvider router={router} />);
    return router;
  }

  it("★ 카드는 숫자 셋을 말하고, 누르면 답으로 걸러진 참가자 카드가 나온다", async () => {
    const router = renderConsole("/host/e1/polls");
    const card = await screen.findByText("2차 갈래요?");
    expect(screen.getByText(HOST_UI.polls.summary("갈래요", 1, "못 가요", 1, 1))).toBeTruthy();

    fireEvent.click(card);
    await waitFor(() => expect(router.state.location.pathname).toBe("/host/e1/polls/q1"));
    // 첫 칩(선택지 1)이 켜져 있다 — 김가만 보인다. 연락처도 카드에 바로 선다
    expect(await screen.findByText(/김가/)).toBeTruthy();
    expect(screen.getByText(/0001/)).toBeTruthy();
    expect(screen.getByText("gram_ga")).toBeTruthy();
    expect(screen.queryByText(/김나/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /못 가요/ }));
    expect(await screen.findByText(/김나/)).toBeTruthy();
    expect(screen.queryByText(/김가/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: new RegExp(HOST_UI.polls.notYet) }));
    expect(await screen.findByText(/김다/)).toBeTruthy();
  });
});

describe("참가자 설문 카드", () => {
  const poll: PublicAnnouncement = { id: "q1", at: Date.now() - 600_000, text: "2차 갈래요?", poll: { a: "갈래요", b: "못 가요", closed: false } };
  const state = (): ParticipantState => ({
    event: {
      id: "e1", name: "테스트 파티", code: "ABCDEF", phase: "party",
      fired: { reg: 1, prevote: 2, party: 3 }, schedule: { partyAt: Date.now() - HOUR }, config: { maxPre: 3, maxParty: 3 },
    },
    me: { id: "me", nickname: "달빛", realName: "김나", age: 30, gender: "M", instagram: "", mbti: "ENFP", charms: ["하나", "둘", "셋"], createdAt: 1 },
    roster: [],
    poke: { budget: { pre: { max: 3, used: 0 }, party: { max: 3, used: 0 } }, sentTo: {}, received: { pre: 0, party: 0 }, matches: [] },
    announcements: [poll],
  });
  const voted: Array<[string, string]> = [];
  const source: ParticipantSource = {
    key: "test",
    load: async () => state(),
    poke: async () => state().poke,
    unpoke: async () => state().poke,
    ackSeat: async () => {},
    vote: async (id, choice) => {
      voted.push([id, choice]);
      return { ...poll, poll: { ...poll.poll!, mine: choice } };
    },
    saveProfile: async (input) => ({ ...state().me, ...input }),
  };

  it("★ 선택지 둘이 버튼이고 숫자는 없다 — 고르면 눌린 채로 남는다", async () => {
    render(
      <MemoryRouter>
        <ParticipantView source={source} tab="home" onTab={() => {}} onProfile={() => {}} onEdit={() => {}} onSeat={() => {}} helpOpen={false} onHelp={() => {}} />
      </MemoryRouter>,
    );
    await screen.findByText("2차 갈래요?");
    const a = screen.getByRole("button", { name: "갈래요" });
    const b = screen.getByRole("button", { name: "못 가요" });
    // 숫자가 없다 — 카드 어디에도 '명' 이 없다
    expect(screen.queryByText(/\d+명/)).toBeNull();
    expect(a.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(a);
    await waitFor(() => expect(a.getAttribute("aria-pressed")).toBe("true"));
    expect(b.getAttribute("aria-pressed")).toBe("false");
    expect(voted).toEqual([["q1", "a"]]);
    expect(screen.queryByText(POLL.closed)).toBeNull();
  });
});
