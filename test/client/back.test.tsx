/**
 * 뒤로 가기를 눌렀을 때 어디로 가는가.
 *
 * 안드로이드 백 버튼과 iOS 가장자리 스와이프가 같은 동작이라, 여기서 어긋나면 현장에서 사고가 난다.
 * 사람이 기대하는 건 "내 발자국 되감기"가 아니라 **"목록으로 돌아가기"** 다.
 *
 *   탭에서 뒤로  → 홈 탭 (참가자 탭)
 *   홈 탭에서 뒤로 → 앱 밖
 *   시트에서 뒤로 → 시트만 닫히고 목록은 그대로
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouterProvider, createMemoryRouter } from "react-router";
import { HELP, HOME, TABS_PARTICIPANT } from "../../src/shared/copy.ts";
import type { ParticipantState } from "../../src/shared/types.ts";
import { PARTICIPANT_ROUTES } from "../../src/client/router.tsx";

afterEach(cleanup);

const STATE: ParticipantState = {
  event: {
    id: "e1",
    name: "테스트 파티",
    code: "ABCDEF",
    phase: "prevote",
    fired: { reg: 1, prevote: 2 },
    schedule: { partyAt: Date.now() + 3600_000 },
    config: { maxPre: 3, maxParty: 3 },
  },
  me: {
    id: "me",
    nickname: "나",
    realName: "김나",
    age: 30,
    gender: "M",
    phone: "01000000000",
    instagram: "gram_a",
    mbti: "ENFP",
    charms: ["하나", "둘", "셋"],
    createdAt: 1,
  },
  roster: [{ id: "her", nickname: "그녀", age: 29, gender: "F", mbti: "ISFJ", charms: ["가", "나", "다"] }],
  poke: { budget: { pre: { max: 3, used: 1 }, party: { max: 3, used: 0 } }, sentTo: {}, receivedCount: 0, matches: [] },
  announcements: [],
};

/**
 * **진짜 라우터의 표를 그대로 쓴다.** 베껴 두면 언젠가 어긋난다 —
 * 실제로 `/help` 를 표에 안 넣었는데 테스트는 자기 사본으로 통과했고,
 * 참가자에게는 "찾을 수 없어요" 가 떴다.
 */
function participantRouter(start = "/e/ABCDEF") {
  return createMemoryRouter(PARTICIPANT_ROUTES, { initialEntries: [start] });
}

const tab = (key: "home" | "people" | "me") =>
  screen.getByText(TABS_PARTICIPANT.find((t) => t.key === key)!.label);

beforeEach(() => {
  vi.stubGlobal("WebSocket", class { close() {} });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(STATE), {
      status: 200,
      headers: { "content-type": "application/json" },
    })),
  );
});

describe("참가자 화면 · 뒤로 가기", () => {
  it("★ 탭을 여러 번 오가도 뒤로 가기 한 번이면 참가자 탭이다", async () => {
    const router = participantRouter();
    render(<RouterProvider router={router} />);
    await screen.findByText(HOME.todo.prevote.title);

    fireEvent.click(tab("people"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/e/ABCDEF/people"));
    fireEvent.click(tab("me"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/e/ABCDEF/me"));
    fireEvent.click(tab("people"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/e/ABCDEF/people"));

    // 발자국을 되감지 않는다. 한 번이면 목록으로
    await router.navigate(-1);
    expect(router.state.location.pathname).toBe("/e/ABCDEF");
  });

  it("★ 참가자 탭에서 뒤로 가면 앱 밖이다 — 탭 사이를 맴돌지 않는다", async () => {
    const router = participantRouter();
    render(<RouterProvider router={router} />);
    await screen.findByText(HOME.todo.prevote.title);

    fireEvent.click(tab("me"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/e/ABCDEF/me"));
    await router.navigate(-1);
    expect(router.state.location.pathname).toBe("/e/ABCDEF");

    // 여기서 한 번 더 = 들어오기 전으로 (메모리 라우터에는 그 앞이 없다)
    expect(router.state.historyAction).not.toBe("PUSH");
  });

  it("★ 프로필 시트는 뒤로 가기로 닫히고 목록이 남는다", async () => {
    const router = participantRouter();
    render(<RouterProvider router={router} />);

    // 화면이 뜬 뒤 참가자 탭으로 간다
    await screen.findByText(HOME.todo.prevote.title);
    fireEvent.click(tab("people"));
    fireEvent.click(await screen.findByText(/그녀/));
    await waitFor(() => expect(router.state.location.pathname).toBe("/e/ABCDEF/p/her"));

    // 시트만 닫히고 목록이 남는다
    await router.navigate(-1);
    expect(router.state.location.pathname).toBe("/e/ABCDEF/people");
  });
});

describe("도움말", () => {
  it("★ 주소로 열면 도움말이 뜬다 — 라우터 표에 빠져 있으면 여기서 걸린다", async () => {
    /*
     * 시트도 라우트다. 화면 쪽에서 경로를 읽는 코드만 넣고 **라우터 표에 안 넣으면**
     * 참가자에게 "찾을 수 없어요" 가 뜬다. 실제로 그렇게 나갔다.
     */
    render(<RouterProvider router={participantRouter("/e/ABCDEF/help")} />);
    await screen.findByText(HELP.title);
  });

  it("★ 뒤로 가면 도움말만 닫힌다", async () => {
    const router = participantRouter();
    render(<RouterProvider router={router} />);
    await screen.findByText(HOME.news);

    fireEvent.click(screen.getByLabelText(HELP.open));
    await screen.findByText(HELP.title);

    router.navigate(-1);
    await waitFor(() => expect(screen.queryByText(HELP.title)).toBeNull());
    expect(router.state.location.pathname).toBe("/e/ABCDEF");
  });
});
