/**
 * 화면이 조용히 죽지 않는지 본다.
 *
 * ADR-8 — 에러를 남기지 않는 실패는 사람 눈으로 못 잡는다. `새 회차 만들기` 버튼이
 * 아무 반응 없던 사고가 그랬다. 그래서 기계가 잡게 만든다.
 *
 * 여기서 보는 건 컴포넌트 내부 구조가 아니라 **규칙**이다.
 *   · 되돌릴 수 없는 행동에만 확인창이 뜨고, 확인창은 숫자를 보여준다
 *   · 발표가 끝나면 자리 이동 확인이 화면을 덮지 않는다
 *   · 코드가 틀려도 입력값을 지우지 않는다
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, RouterProvider, createMemoryRouter } from "react-router";
import { ENTRY, ENV_BANNER, HOME, ME, NOTICE, PEOPLE, PHASE_LABEL, POKE, SCREEN_TITLE, SEAT, STATUS, TABS_PARTICIPANT } from "../../src/shared/copy.ts";
import type { MyPokeState, ParticipantState } from "../../src/shared/types.ts";
import Entry from "../../src/client/routes/Entry.tsx";
import Join from "../../src/client/routes/Join.tsx";
import { ParticipantView } from "../../src/client/routes/Participant.tsx";
import type { ParticipantSource } from "../../src/client/lib/participant.ts";
import { Overlays } from "../../src/client/ui/Overlays.tsx";
import EnvBadge from "../../src/client/ui/EnvBadge.tsx";

afterEach(cleanup);

// ─────────────────────────────────────────── 재료

const POKE_STATE: MyPokeState = {
  budget: { pre: { max: 3, used: 1 }, party: { max: 3, used: 0 } },
  sentTo: { her: 1 },
  receivedCount: 0,
  matches: [],
};

function participantState(over: Partial<ParticipantState> = {}): ParticipantState {
  return {
    event: {
      id: "e1",
      name: "테스트 파티",
      code: "ABCDEF",
      phase: "prevote",
      fired: { reg: 1, prevote: 2 },
      schedule: { voteCloseAt: Date.now() + 3600_000 },
      config: { maxPre: 3, maxParty: 3 },
      playerCount: 2,
    },
    me: {
      id: "me",
      nickname: "나",
      realName: "김나",
      age: 30,
      gender: "M",
      phone: "01000000000",
      mbti: "ENFP",
      charms: ["하나", "둘", "셋"],
      createdAt: 1,
    },
    roster: [{ id: "her", nickname: "그녀", age: 29, gender: "F", mbti: "ISFJ", charms: ["가", "나", "다"] }],
    poke: POKE_STATE,
    ...over,
  };
}

function fakeSource(over: Partial<ParticipantSource> = {}): ParticipantSource & {
  calls: { poke: string[]; ack: number[] };
} {
  const calls = { poke: [] as string[], ack: [] as number[] };
  return {
    key: "test",
    calls,
    load: async () => participantState(),
    poke: async (toId) => {
      calls.poke.push(toId);
      return POKE_STATE;
    },
    ackSeat: async (round) => {
      calls.ack.push(round);
    },
    ...over,
  };
}

function renderParticipant(source: ParticipantSource) {
  return render(
    <MemoryRouter>
      <ParticipantView source={source} tab="people" onTab={() => {}} onProfile={() => {}} />
    </MemoryRouter>,
  );
}

// ─────────────────────────────────────────── 입장

describe("입장 화면", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "not_found", message: ENTRY.notFound }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
  });

  it("코드가 틀려도 입력값을 지우지 않는다", async () => {
    render(
      <MemoryRouter>
        <Overlays>
          <Entry />
        </Overlays>
      </MemoryRouter>,
    );
    const input = screen.getByLabelText(ENTRY.codeLabel) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "ZZZZZZ" } });
    fireEvent.click(screen.getByText(ENTRY.submit));

    await screen.findByText(ENTRY.notFound);
    expect(input.value).toBe("ZZZZZZ");
  });
});

// ─────────────────────────────────────────── 콕

describe("참가자 화면 · 콕", () => {
  it("★ 콕 찌르기는 확인을 거치고, 확인창이 숫자를 보여준다", async () => {
    const source = fakeSource();
    renderParticipant(source);
    await screen.findByText(/그녀/);

    fireEvent.click(screen.getAllByLabelText(POKE.confirm.submit)[0]);

    // 이미 1회 보냈으므로 "한 번 더" 쪽 문장이다
    await screen.findByText(POKE.confirm.title(1));
    expect(screen.getByText(POKE.confirm.rowTarget)).toBeTruthy();
    // 보낸 콕 2회 · 남은 횟수 1회 — 무엇이 어떻게 바뀌는지 숫자로
    expect(screen.getAllByText(POKE.confirm.count(2)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(POKE.confirm.count(1)).length).toBeGreaterThan(0);
    expect(source.calls.poke).toEqual([]);   // 아직 보내지 않았다

    fireEvent.click(screen.getByText(POKE.confirm.submit));
    await waitFor(() => expect(source.calls.poke).toEqual(["her"]));
  });

  it("되돌리기는 지금 화면에 없다 — 확인창도 되돌릴 수 없다고 말한다", async () => {
    renderParticipant(fakeSource());
    await screen.findByText(/그녀/);
    expect(screen.queryByText("−")).toBeNull();
    expect(POKE.confirm.note).not.toContain("되돌릴 수 있");
  });

  it("★ '이성만 / 전체' 는 지금 어느 쪽인지 보인다", async () => {
    renderParticipant(fakeSource());
    const onlyOpposite = await screen.findByText(PEOPLE.onlyOpposite);
    const everyone = screen.getByText(PEOPLE.everyone);

    // 한 버튼을 껐다 켜는 방식이면 눌린 상태를 화면에서 알 수 없다. 둘 중 하나가 항상 켜져 있어야 한다
    expect(onlyOpposite.getAttribute("aria-pressed")).toBe("true");
    expect(everyone.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(everyone);
    expect(onlyOpposite.getAttribute("aria-pressed")).toBe("false");
    expect(everyone.getAttribute("aria-pressed")).toBe("true");
  });

  it("등록 중에는 콕 버튼이 잠겨 있다", async () => {
    const source = fakeSource({
      load: async () => participantState({ event: { ...participantState().event, phase: "reg" } }),
    });
    renderParticipant(source);
    await screen.findByText(/그녀/);
    expect((screen.getAllByLabelText(POKE.confirm.submit)[0] as HTMLButtonElement).disabled).toBe(true);
  });
});

// ─────────────────────────────────────────── 자리

describe("참가자 화면 · 자리", () => {
  const seat = { round: 1, table: 2, final: false, mates: 6, men: 3, acked: false };

  it("자리가 발행되면 전체 화면으로 확인을 받는다", async () => {
    const source = fakeSource({ load: async () => participantState({ seat }) });
    renderParticipant(source);
    await screen.findByText(SEAT.ack.headline(2));

    fireEvent.click(screen.getByText(SEAT.ack.submit));
    await waitFor(() => expect(source.calls.ack).toEqual([1]));
  });

  it("★ 발표가 끝났으면 자리 이동 확인을 띄우지 않는다", async () => {
    const source = fakeSource({
      load: async () =>
        participantState({ seat, event: { ...participantState().event, phase: "done" } }),
    });
    renderParticipant(source);
    await screen.findByText(/그녀/);
    expect(screen.queryByText(SEAT.ack.submit)).toBeNull();
  });
});

// ─────────────────────────────────────────── 참가 링크 재방문

describe("참가 링크", () => {
  /**
   * 운영자는 링크를 한 번 뿌리고 참가자는 그 링크를 계속 다시 연다.
   * 등록을 마친 사람에게 등록 화면을 다시 보여주면 "내가 등록이 안 됐나?" 하고
   * 두 번 등록하려 든다. 실제로 나온 신고다.
   */
  function renderJoin() {
    const router = createMemoryRouter(
      [
        { path: "/j/:code", element: <Join /> },
        { path: "/e/:code", element: <div>참가자 화면</div> },
      ],
      { initialEntries: ["/j/ABCDEF"] },
    );
    return render(<RouterProvider router={router} />);
  }

  it("★ 이미 등록한 사람은 등록 화면이 아니라 자기 화면으로 간다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const body = url.includes("/me")
          ? participantState()
          : { id: "e1", name: "테스트 파티", phase: "reg", canRegister: true };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    renderJoin();
    await screen.findByText("참가자 화면");
  });

  it("아직 등록하지 않았으면 등록 화면이 나온다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/me")
          ? new Response(JSON.stringify({ error: "unauthorized" }), {
              status: 401,
              headers: { "content-type": "application/json" },
            })
          : new Response(
              JSON.stringify({ id: "e1", name: "테스트 파티", phase: "reg", canRegister: true }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
      ),
    );
    renderJoin();
    expect(await screen.findByText(SCREEN_TITLE.register)).toBeTruthy();
  });
});

// ─────────────────────────────────────────── 연습용 환경 표시

describe("연습용 환경", () => {
  /**
   * 파티 당일 운영자가 연습용 콘솔에서 단계를 넘기고 "참가자 화면이 왜 안 바뀌지?" 하는 사고를 막는다.
   * 주소가 아니라 **배포된 설정**이 진실이라, 서버가 알려준 라벨만 믿는다.
   */
  const health = (body: object) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      })),
    );

  it("★ 라벨이 오면 띠를 띄운다", async () => {
    health({ ok: true, serverTime: Date.now(), label: "QA" });
    render(<EnvBadge />);
    expect(await screen.findByText(ENV_BANNER("QA"))).toBeTruthy();
  });

  it("프로덕션에는 아무것도 뜨지 않는다", async () => {
    health({ ok: true, serverTime: Date.now() });
    const { container } = render(<EnvBadge />);
    await waitFor(() => expect(container.querySelector(".envBadge")).toBeNull());
  });
});

// ─────────────────────────────────────────── 상단 한 줄

describe("상단 바", () => {
  /**
   * 참가자가 반복해서 보는 건 셋뿐이다 — 지금 단계, 남은 콕, 남은 시간.
   * 헤더는 스크롤되지 않으므로 여기 있는 것만 항상 보인다.
   */
  it("★ 단계와 '무엇까지' 가 붙은 카운트다운이 한 줄에 있다", async () => {
    renderParticipant(fakeSource());
    await screen.findByText(PHASE_LABEL.prevote);
    // 숫자만 있으면 무엇을 세는지 알 수 없다
    expect(screen.getByText(STATUS.untilVoteClose)).toBeTruthy();
    expect(screen.getByText(/^\d{2}:\d{2}:\d{2}$/)).toBeTruthy();
  });

  it("★ 남은 콕은 한 곳에만 — 콕을 찌르는 화면", async () => {
    renderParticipant(fakeSource());
    await screen.findByText(/그녀/);
    expect(screen.getAllByText(STATUS.pokeLeft(2))).toHaveLength(1);
  });

  it("회차 이름은 상단이 아니라 '내 정보' 에 있다", async () => {
    const { rerender } = renderParticipant(fakeSource());
    await screen.findByText(PHASE_LABEL.prevote);
    expect(screen.queryByText("테스트 파티")).toBeNull();

    rerender(
      <MemoryRouter>
        <ParticipantView source={fakeSource()} tab="me" onTab={() => {}} onProfile={() => {}} />
      </MemoryRouter>,
    );
    await screen.findByText("테스트 파티");
  });
});

// ─────────────────────────────────────────── 탭 역할 분담

describe("탭 역할 분담", () => {
  /**
   * 같은 정보가 두 탭에 있으면 어느 쪽이 맞는지 눈이 한 번 더 확인한다.
   * 탭마다 답하는 질문이 하나씩이고 겹치지 않아야 한다.
   */
  const withSeat = { round: 1, table: 2, final: false, mates: 6, men: 3, acked: true };

  const renderTab = (t: "home" | "me", over: Partial<ParticipantState> = {}) =>
    render(
      <MemoryRouter>
        <ParticipantView
          source={fakeSource({ load: async () => participantState(over) })}
          tab={t}
          onTab={() => {}}
          onProfile={() => {}}
        />
      </MemoryRouter>,
    );

  it("★ 내 자리는 홈에만 있다", async () => {
    renderTab("home", { seat: withSeat });
    await screen.findByText(SEAT.banner(2));
    cleanup();

    renderTab("me", { seat: withSeat });
    await screen.findByText(ME.labels.nickname);
    expect(screen.queryByText(SEAT.banner(2))).toBeNull();
  });

  it("홈은 단계 이름 대신 할 일을 말한다", async () => {
    renderTab("home");
    // "사전 투표"는 운영자 용어다. 참가자에게는 문장으로
    await screen.findByText(HOME.todo.prevote.title);
  });

  it("★ 소식은 홈에 있다 — 알림 탭을 따로 두지 않는다", async () => {
    // 파티 한 번에 많아야 네 개다. 탭 하나를 상시 내줄 양이 아니다
    renderTab("home", { poke: { ...POKE_STATE, receivedCount: 2 } });
    await screen.findByText(HOME.news);
    expect(screen.getByText(POKE.received)).toBeTruthy();
    expect(screen.getByText(NOTICE.prevote(3).title)).toBeTruthy();

    // 탭은 셋뿐이다
    expect(TABS_PARTICIPANT.map((t) => t.key)).toEqual(["home", "people", "me"]);
  });
});
