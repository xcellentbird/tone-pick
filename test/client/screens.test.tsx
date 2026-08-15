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
import { ENTRY, ENV_BANNER, FORTUNE, HOME, ME, NOTICE, PEOPLE, PHASE_LABEL, POKE, REVEAL, SCREEN_TITLE, SEAT, STATUS, TABS_PARTICIPANT, UNIT } from "../../src/shared/copy.ts";
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
      schedule: { partyAt: Date.now() + 3600_000 },
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

function renderParticipant(source: ParticipantSource, profileId?: string) {
  return render(
    <MemoryRouter>
      <ParticipantView source={source} tab="people" profileId={profileId} onTab={() => {}} onProfile={() => {}} />
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
    expect(screen.getAllByText(UNIT.times(2)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(UNIT.times(1)).length).toBeGreaterThan(0);
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

    // 기본은 성별을 가리지 않는다. 반쪽만 보여주면 찌를 수 있는 사람이 가려진다 (ADR-17)
    expect(everyone.getAttribute("aria-pressed")).toBe("true");
    expect(onlyOpposite.getAttribute("aria-pressed")).toBe("false");

    // 한 버튼을 껐다 켜는 방식이면 눌린 상태를 화면에서 알 수 없다. 둘 중 하나가 항상 켜져 있어야 한다
    fireEvent.click(onlyOpposite);
    expect(onlyOpposite.getAttribute("aria-pressed")).toBe("true");
    expect(everyone.getAttribute("aria-pressed")).toBe("false");
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

// ─────────────────────────────────────────── 오늘의 연애운

describe("오늘 탭", () => {
  /**
   * 이 앱에서 유일하게 기능이 아니라 재미인 자리다. 그래도 규칙은 같다 —
   * 열기 전에는 뒷면이고, 한 번 열면 그대로 남는다.
   */
  const party = (over: Partial<ParticipantState> = {}) =>
    fakeSource({
      load: async () =>
        participantState({ event: { ...participantState().event, phase: "party" }, ...over }),
    });

  function renderFortune(source: ParticipantSource) {
    return render(
      <MemoryRouter>
        <ParticipantView source={source} tab="fortune" onTab={() => {}} onProfile={() => {}} />
      </MemoryRouter>,
    );
  }

  it("★ 파티가 시작되면 탭이 생긴다", async () => {
    renderFortune(party());
    expect(await screen.findByText(FORTUNE.tab)).toBeTruthy();
  });

  it("★ 열기 전에는 뒷면이다 — 운세가 미리 보이지 않는다", async () => {
    renderFortune(party());
    expect(await screen.findByText(FORTUNE.open)).toBeTruthy();
    expect(screen.queryByText(new RegExp(FORTUNE.missionTitle))).toBeNull();
  });

  it("★ 이미 연 사람에게는 뒤집기 없이 바로 보인다", async () => {
    const opened = party({
      fortune: {
        headline: "천천히 말하는 밤이에요",
        body: "첫 문단이에요.\n\n둘째 문단이에요.\n\n셋째 문단이에요.",
        mission: "요즘 자주 듣는 노래를 물어보세요",
        color: "violet",
        matchTypes: ["ENFP", "ENTJ"],
        at: 1,
      },
    });
    renderFortune(opened);

    await screen.findByText("천천히 말하는 밤이에요");
    expect(screen.queryByText(FORTUNE.open)).toBeNull();
    // 세 문단이 각각 제 줄을 갖는다 — 한 덩어리로 붙여 놓으면 폰에서 읽다가 놓친다
    for (const para of ["첫 문단이에요.", "둘째 문단이에요.", "셋째 문단이에요."]) {
      expect(screen.getByText(para)).toBeTruthy();
    }
    // 다시 열어도 같은 운세라는 걸 미리 말해둔다
    expect(screen.getByText(FORTUNE.again)).toBeTruthy();
  });

  it("★ 점수를 보여주지 않는다", async () => {
    renderFortune(
      party({
        fortune: {
          headline: "h",
          body: "b",
          mission: "m",
          color: "gold",
          matchTypes: ["ENFP", "ENTJ"],
          at: 1,
        },
      }),
    );
    await screen.findByText("h");
    // 점·score·% 어느 것도 화면에 없다. 비교하는 순간을 만들지 않는다
    expect(document.body.textContent).not.toMatch(/\d+\s*점|score|%/i);
  });
});

// ─────────────────────────────────────────── 발표

describe("발표 후 참가자 탭", () => {
  /**
   * 결과는 **그 사람이 있는 자리**에 나와야 한다. 다른 탭에 숨겨두면
   * 파티장에서 상대를 앞에 두고 화면을 뒤지게 된다.
   */
  const matched: MyPokeState = {
    ...POKE_STATE,
    matches: [
      {
        player: {
          id: "her",
          nickname: "그녀",
          age: 29,
          gender: "F",
          mbti: "ISFJ",
          charms: ["가", "나", "다"],
        },
        sameTable: 2,
        contact: { realName: "이실명", phone: "01055556666", instagram: "her_gram" },
      },
    ],
  };

  const revealed = (over = {}) =>
    fakeSource({
      load: async () =>
        participantState({
          event: { ...participantState().event, phase: "done" },
          poke: matched,
          ...over,
        }),
    });

  it("★ 서로 찌른 사람은 목록에서 글자로도 구분된다 — 색만으로 말하지 않는다", async () => {
    renderParticipant(revealed());
    await screen.findByText(/그녀/);
    expect(screen.getByText(new RegExp(REVEAL.matchBadge))).toBeTruthy();
  });

  it("★ 서로 찌른 사람이 목록 맨 위로 온다", async () => {
    // 스무 명 목록에서 그 사람을 찾아 내려가게 두면, 다른 탭에 숨긴 것과 다를 게 없다
    const two = participantState().roster.concat({
      id: "him",
      nickname: "그남",
      age: 31,
      gender: "M",
      mbti: "ESTJ",
      charms: ["ㄱ", "ㄴ", "ㄷ"],
    });
    const source = fakeSource({
      load: async () =>
        participantState({
          event: { ...participantState().event, phase: "done" },
          poke: { ...matched, matches: matched.matches },
          roster: [two[1], two[0]],   // 매칭된 '그녀'가 뒤에 있는 상태에서 시작한다
        }),
    });
    renderParticipant(source);

    await screen.findByText(/그녀/);
    const names = screen.getAllByText(/그녀|그남/).map((el) => el.textContent);
    expect(names[0]).toMatch(/그녀/);
  });

  it("★ 발표 전에는 목록에 아무 표시도 없다", async () => {
    renderParticipant(fakeSource());
    await screen.findByText(/그녀/);
    expect(screen.queryByText(new RegExp(REVEAL.matchBadge))).toBeNull();
  });

  it("★ 서로 찌른 상대의 연락처가 프로필에서 열린다", async () => {
    // 프로필 시트를 연 채로 그린다
    renderParticipant(revealed(), "her");

    await screen.findByText(REVEAL.contactTitle);
    expect(screen.getByText("이실명")).toBeTruthy();
    // 번호는 눌러서 걸 수 있어야 한다 — 파티장에서 손으로 옮겨 적게 하지 않는다
    expect(screen.getByText("01055556666").getAttribute("href")).toBe("tel:01055556666");
    // 상대에게도 내 연락처가 간다는 걸 그 자리에서 말한다
    expect(screen.getByText(REVEAL.contactNote)).toBeTruthy();
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
        { path: "/j/:id", element: <Join /> },
        { path: "/j/:id/register/:step", element: <div>{SCREEN_TITLE.register}</div> },
        { path: "/e/:code", element: <div>참가자 화면</div> },
      ],
      { initialEntries: ["/j/e1"] },
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

  /**
   * ★ 링크만으로는 들어올 수 없다 (ADR-15).
   *
   * 참가 링크는 단톡방에 돌고, 스크린샷으로도 퍼진다. 그 링크가 곧 입장이면
   * 운영자가 부르지 않은 사람이 명단에 들어온다 —
   * 문을 여는 건 **운영자가 미리 받아둔 전화번호**다. 코드는 옮겨 적을 수 있지만
   * 남의 번호로는 들어올 수 없다.
   */
  function stubGate(enter: { status: number; body: unknown }) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/me")) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("/enter")) {
          return new Response(JSON.stringify(enter.body), {
            status: enter.status,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({ id: "e1", name: "테스트 파티", phase: "reg", canRegister: true }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
  }

  it("★ 링크만 열면 회차만 보이고, 번호를 넣어야 등록으로 간다", async () => {
    stubGate({ status: 200, body: { registered: false } });
    renderJoin();

    // 방은 보인다
    await screen.findByText("테스트 파티");
    // 등록으로 가는 문은 아직 닫혀 있다
    expect(screen.queryByText(SCREEN_TITLE.register)).toBeNull();
    expect(screen.getByText(ENTRY.gateNote)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(ENTRY.phoneLabel), { target: { value: "010-1234-5678" } });
    fireEvent.click(screen.getByText(ENTRY.submit));

    expect(await screen.findByText(SCREEN_TITLE.register)).toBeTruthy();
  });

  it("★ 명단에 없는 번호는 문 앞에서 막히고, 입력값은 남는다", async () => {
    stubGate({ status: 403, body: { error: "not_invited", message: ENTRY.notInvited } });
    renderJoin();
    await screen.findByText("테스트 파티");

    const input = screen.getByLabelText(ENTRY.phoneLabel) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "01099998888" } });
    fireEvent.click(screen.getByText(ENTRY.submit));

    expect(await screen.findByText(ENTRY.notInvited)).toBeTruthy();
    expect(screen.queryByText(SCREEN_TITLE.register)).toBeNull();
    // 번호를 다시 치게 하지 않는다
    expect(input.value).toBe("01099998888");
  });

  it("이미 등록한 사람은 등록 폼을 건너뛴다", async () => {
    stubGate({ status: 200, body: { registered: true, code: "ABCDEF" } });
    renderJoin();
    await screen.findByText("테스트 파티");

    fireEvent.change(screen.getByLabelText(ENTRY.phoneLabel), { target: { value: "01012345678" } });
    fireEvent.click(screen.getByText(ENTRY.submit));

    expect(await screen.findByText("참가자 화면")).toBeTruthy();
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
    expect(screen.getByText(STATUS.untilParty)).toBeTruthy();
    expect(screen.getByText(/^\d{2}:\d{2}:\d{2}$/)).toBeTruthy();
  });

  it("★ 남은 콕은 한 곳에만 — 콕을 찌르는 화면", async () => {
    renderParticipant(fakeSource());
    await screen.findByText(/그녀/);
    // 어느 라운드의 콕인지 함께 적는다. 숫자만 있으면 마감된 줄 모른다
    expect(screen.getAllByText(STATUS.roundLeft("pre", 2))).toHaveLength(1);
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
    // 파티 한 번에 많아야 몇 개다. 탭 하나를 상시 내줄 양이 아니다
    renderTab("home", { poke: { ...POKE_STATE, receivedCount: 2 } });
    await screen.findByText(HOME.news);
    expect(screen.getByText(NOTICE.prevote(3).title)).toBeTruthy();
  });

  it("★ 받은 콕은 한 번에 하나씩 쌓인다 — 합쳐서 세지 않는다", async () => {
    renderTab("home", { poke: { ...POKE_STATE, receivedCount: 3 } });
    await screen.findByText(HOME.news);
    // 세 번 받았으면 세 줄이다. "지금까지 3회" 한 줄이 아니다
    expect(screen.getAllByText(POKE.received)).toHaveLength(3);

    // '오늘' 은 파티가 시작돼야 생긴다. 사전 투표 중에는 세 개다
    // '오늘' 은 맨 오른쪽에 붙는다 — 도중에 끼어들면 옆 탭들이 밀린다
    expect(TABS_PARTICIPANT.map((t) => t.key)).toEqual(["home", "people", "me", "fortune"]);
    expect(screen.queryByText(FORTUNE.tab)).toBeNull();
  });
});

// ─────────────────────────────────────────── 시트·확인창의 동작

describe("시트와 확인창", () => {
  /**
   * 손으로 만들었을 때 없던 것들. Radix Dialog 로 동작만 빌려 왔다 (gzip 12KB).
   * 특히 Escape 로 닫을 때 **행동이 실행되면 안 된다** — 취소와 같아야 한다.
   */
  it("★ Escape 로 확인창을 닫아도 콕은 나가지 않는다", async () => {
    const source = fakeSource();
    renderParticipant(source);
    await screen.findByText(/그녀/);

    fireEvent.click(screen.getAllByLabelText(POKE.confirm.submit)[0]);
    await screen.findByText(POKE.confirm.title(1));

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText(POKE.confirm.title(1))).toBeNull());
    expect(source.calls.poke).toEqual([]);
  });

  it("확인창에 읽을 수 있는 이름이 붙는다", async () => {
    renderParticipant(fakeSource());
    await screen.findByText(/그녀/);

    fireEvent.click(screen.getAllByLabelText(POKE.confirm.submit)[0]);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain(POKE.confirm.title(1));
  });
});
