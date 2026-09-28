/**
 * 슬라이스 19 S-C5 — **사진이 오기 전의 빌드에서는 이상형 찾기를 열지 않는다.**
 *
 * 문은 빌드가 연다 (`src/client/lib/faces.ts` — `vite.config.ts` 가 지금 판의 풀 JSON 이 있는지 보고 박는다).
 * 다른 화면 테스트는 열린 빌드로 잰다(`vitest.config.ts` 의 define). 여기만 그 모듈을 **닫힌 값**으로 갈아 끼운다 —
 * `vi.mock` 은 파일 전체에 걸려서 파일을 따로 둔다.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouterProvider, createMemoryRouter } from "react-router";
import { FORTUNE, FUN, IDEAL, TABS_PARTICIPANT } from "../../src/shared/copy.ts";
import type { ParticipantState } from "../../src/shared/types.ts";
import { PARTICIPANT_ROUTES } from "../../src/client/router.tsx";

vi.mock("../../src/client/lib/faces.ts", () => ({ FACES_READY: false }));

const BASE = "/e/ABCDEF";
const STATE: ParticipantState = {
  event: {
    id: "e1",
    name: "테스트 파티",
    code: "ABCDEF",
    phase: "reg",
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
};

function start(at: string) {
  const asked: string[] = [];
  vi.stubGlobal("WebSocket", class { close() {} });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (u: string) => {
      asked.push(String(u));
      return new Response(JSON.stringify(STATE), { headers: { "content-type": "application/json" } });
    }),
  );
  render(<RouterProvider router={createMemoryRouter(PARTICIPANT_ROUTES, { initialEntries: [at] })} />);
  return asked;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("이상형 찾기 · 사진이 없는 빌드 (S-C5)", () => {
  it("★ 재미 탭에 이상형 카드가 없다 — 얼굴 자료도 묻지 않는다", async () => {
    const asked = start(`${BASE}/fun`);

    expect(await screen.findByText(FUN.closed)).toBeTruthy();
    // 운세 카드만 선다
    expect(screen.getByText(FORTUNE.name)).toBeTruthy();
    expect(screen.queryByText(IDEAL.title)).toBeNull();
    expect(screen.queryByRole("button", { name: IDEAL.cardStart })).toBeNull();
    expect(asked.some((u) => u.startsWith("/faces/"))).toBe(false);
  });

  it("★ 이상형 주소를 바로 열어도 화면이 열리지 않는다", async () => {
    const asked = start(`${BASE}/ideal`);

    // 홈으로 읽힌다 — 켜진 탭이 재미가 아니고, 탭 본문에 이상형 화면이 서지 않는다
    await screen.findByText(STATE.event.name);
    const home = screen.getByText(TABS_PARTICIPANT.find((t) => t.key === "home")!.label).closest("button")!;
    expect(home.getAttribute("aria-current")).toBe("true");
    expect(screen.queryByText(IDEAL.poolAsk)).toBeNull();
    expect(screen.queryByRole("button", { name: IDEAL.pool.F })).toBeNull();
    expect(asked.some((u) => u.startsWith("/faces/"))).toBe(false);
  });
});
