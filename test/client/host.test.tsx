/**
 * 운영자 콘솔이 조용히 죽지 않는지 본다 (ADR-8).
 *
 * 특히 단계 전환 — 참가자 전원의 화면이 바뀌는 행동이라 확인창이 **무엇이 어떻게 바뀌는지**
 * 항목으로 보여줘야 하고, 확인을 누르기 전에는 아무 일도 일어나면 안 된다.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouterProvider, createMemoryRouter } from "react-router";
import { FAIL, GENDER, HOST_UI, INVITE_TEMPLATE, phaseAction, schedDiff } from "../../src/shared/copy.ts";
import { formatGap, formatWhen } from "../../src/shared/time.ts";
import type { HostState } from "../../src/shared/types.ts";
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
      hostState({}, {
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
   * **파티 시작에는 붙지 않는다.** 예약이 없는 전환이라(ADR-14) 셀 시각이 없다.
   * 없는 시각을 지어내면 현장이 그 숫자를 따라가게 되고, 그게 ADR-14 가 막으려던 일이다.
   */
  it("★ 버튼 옆 카운트다운은 예약이 있는 전환에만 붙는다", async () => {
    // 등록 중 — 다음은 매력 투표 시작이고, 예약이 걸려 있다
    stubFetch(hostState());
    renderConsole();
    await screen.findByText("테스트 회차");
    expect(document.querySelector(".phaseBtn > .due")).toBeTruthy();
    cleanup();

    // 매력 투표 중 — 다음은 파티 시작이고, 그건 운영자가 누를 때만 일어난다
    stubFetch(
      hostState({
        phase: "prevote",
        fired: { reg: Date.now() - 2 * HOUR, prevote: Date.now() - HOUR },
      }),
    );
    renderConsole();
    await screen.findByText("테스트 회차");
    expect(document.querySelector(".phaseBtn > .due")).toBeNull();
  });

  /**
   * 매력 투표 마감은 **버튼이 아니라 줄이다** (ADR-39).
   *
   * 앞당길 수 있는 전환이 아니라 시각이 내리는 판정이라 누를 손잡이가 없다.
   * 그래도 매력 투표 동안 다음에 일어날 일은 이것이라, 버튼 아래에서 그 사실을 말한다.
   */
  it("★ 매력 투표 마감은 버튼이 되지 않고 남은 시간만 말한다", async () => {
    const voteEndAt = Date.now() + 30 * 60_000;
    stubFetch(
      hostState({
        phase: "prevote",
        fired: { reg: Date.now() - 2 * HOUR, prevote: Date.now() - HOUR },
        schedule: { partyAt: Date.now() + 2 * HOUR, regOpenAt: Date.now() - 2 * HOUR, voteEndAt },
      }),
    );
    renderConsole();
    await screen.findByText("테스트 회차");

    // 남은 시간을 말하는 줄이 있다
    expect(screen.getByText(new RegExp(HOST_UI.dash.untilVoteEnd("").trim()))).toBeTruthy();
    // 그리고 그 자리는 버튼이 아니다 — 다음 단계 버튼은 여전히 파티 시작 하나뿐이다
    expect(document.querySelectorAll(".btn.primary.block").length).toBe(1);
    expect(screen.getByText(phaseAction("party", { maxPre: 3, maxParty: 3 })!.btn)).toBeTruthy();
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
    st.invites = [{ phone: "01099998888", token: "t2", addedAt: 2 }];
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
      { phone: "01011112222", token: "t1", addedAt: 1, nickname: st.players[0].nickname },
      // 아직 등록 안 한 사람 — 번호가 그의 유일한 이름이다
      { phone: "01099998888", token: "t2", addedAt: 2 },
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
    st.invites = [{ phone: "01099998888", token: "t2", addedAt: 2 }];
    stubFetch(st);
    const router = renderPlayers("/host/e1/players");

    fireEvent.click(await screen.findByText(HOST_UI.invites.title));
    await screen.findByLabelText(HOST_UI.invites.addLabel);

    await act(async () => void (await router.navigate(-1)));
    await waitFor(() => expect(screen.queryByLabelText(HOST_UI.invites.addLabel)).toBeNull());
    // 탭은 그대로다 — 시트만 닫혔다
    expect(screen.getByText(HOST_UI.invites.title)).toBeTruthy();
  });

  it("★ 안내문 카드에 미리보기를 두지 않는다 — 고치는 화면이 그 일을 한다", async () => {
    const st = hostState();
    st.invites = [{ phone: "01099998888", token: "t2", addedAt: 2 }];
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
   * 문구와 링크는 **따로 복사한다.**
   *
   * 한 덩어리로 보내면 참가자가 링크만 집어내야 하고, 장소에 지도 링크를 넣은 회차에서는
   * 한 메시지에 링크가 둘이 된다. 링크만 온 메시지는 그대로 눌러 열 수 있다.
   */
  it("★ 문구와 링크를 따로 복사한다", async () => {
    const st = hostState();
    st.invites = [{ phone: "01099998888", token: "t2", addedAt: 2 }];
    stubFetch(st);
    const writeText = stubClipboard();
    renderConsole("/host/e1/players/invites");

    // 문구는 명단 머리에서 한 번 복사한다 — 링크가 섞이지 않는다
    fireEvent.click(await screen.findByText(HOST_UI.invite.copy));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(String(writeText.mock.calls[0][0])).not.toContain("/j/e1/t2");

    // 링크 버튼 — 그 사람의 링크만, 다른 글자 없이
    fireEvent.click(screen.getByText(HOST_UI.invite.link));
    await waitFor(() => expect(writeText.mock.calls.length).toBe(2));
    expect(writeText.mock.calls[1][0]).toBe(`${location.origin}/j/e1/t2`);
  });

  /**
   * 행에 붙는 건 **사람마다 다른 것**뿐이다.
   *
   * 문구는 전원이 같아서 행마다 둘 이유가 없고, 어디까지 보냈는지도 표시하지 않는다
   * (ADR-32 후기) — 복사가 곧 발송이 아니고, 되돌릴 수 있는 표시는 틀렸을 때 아무도 모른다.
   */
  it("★ 명단 행에는 링크뿐이다 — 문구도, 보냄 표시도 없다", async () => {
    const st = hostState();
    st.invites = [
      { phone: "01099998888", token: "t2", addedAt: 2 },
      { phone: "01077776666", token: "t3", addedAt: 3 },
    ];
    stubFetch(st);
    const writeText = stubClipboard();
    renderConsole("/host/e1/players/invites");

    // 안내문 복사는 명단 머리에 하나뿐이다 — 사람이 둘이어도 하나다
    expect((await screen.findAllByText(HOST_UI.invite.link)).length).toBe(2);
    expect(screen.getAllByText(HOST_UI.invite.copy).length).toBe(1);

    // 두 번째 사람의 링크를 눌러도 그 사람 것이 나온다
    fireEvent.click(screen.getAllByText(HOST_UI.invite.link)[1]);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${location.origin}/j/e1/t3`));

    // 보냄으로 찍는 길이 아예 없다
    expect(calls.some((c) => c.url.includes("/sent"))).toBe(false);
  });

  /*
   * 번호 칸은 **운영자 명단에만** 남았다. 참가자 쪽은 링크가 신원이라 번호를 치지 않는다 (ADR-32).
   * 그래도 이 칸의 동작은 그대로 중요하다 — 여기서 잘못 옮겨 적은 번호는 파티 당일에야 드러난다.
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

  it("★ 되돌리기·알림을 회차마다, 라운드마다 정한다 (ADR-34)", async () => {
    /*
     * 되돌리기와 알림은 **한 몸이다** — 알림을 켠 채 되돌리기를 열면 받은 수가 줄어드는 걸 보고
     * "방금 누가 되돌렸다" 에서 발신자를 좁힐 수 있다.
     * 기본은 셋 다 안전한 쪽이다 — 되돌릴 수 있고, 알리지 않는다.
     */
    stubFetch(hostState());
    renderConsole("/host/e1/settings");
    // 설정은 묶음으로 접혀 있다 — 규칙은 `콕 설정` 안이다
    fireEvent.click(await screen.findByText(HOST_UI.settings.rules));

    /** 그 설정 줄 안의 버튼만 집는다 — 세 줄이 같은 글자를 쓴다 */
    const rowBtn = (label: string, option: string) => {
      const field = screen.getAllByText(label).find((el) => el.tagName === "LABEL")!.parentElement!;
      return [...field.querySelectorAll("button")].find((b) => b.textContent === option)!;
    };

    // 기본값이 눌려 있다 (매력 투표·콕 되돌리기는 됨, 알림은 안 보냄)
    expect(rowBtn(HOST_UI.fields.undoPre, HOST_UI.fields.undoOn).getAttribute("aria-pressed")).toBe("true");
    expect(rowBtn(HOST_UI.fields.undoParty, HOST_UI.fields.undoOn).getAttribute("aria-pressed")).toBe("true");
    expect(rowBtn(HOST_UI.fields.pokeNotify, HOST_UI.fields.pokeNotifyOff).getAttribute("aria-pressed")).toBe("true");

    // 셋 다 뒤집는다
    fireEvent.click(rowBtn(HOST_UI.fields.undoPre, HOST_UI.fields.undoOff));
    fireEvent.click(rowBtn(HOST_UI.fields.undoParty, HOST_UI.fields.undoOff));
    fireEvent.click(rowBtn(HOST_UI.fields.pokeNotify, HOST_UI.fields.pokeNotifyOn));
    fireEvent.click(screen.getByText(HOST_UI.applySettings));

    // 확인창이 무엇이 어떻게 바뀌는지 말한다 (CLAUDE.md 규칙 4)
    await screen.findByText(HOST_UI.applyTitle);
    expect(
      screen.getAllByText(`${HOST_UI.fields.undoOn} → ${HOST_UI.fields.undoOff}`),
    ).toHaveLength(2);
    expect(
      screen.getByText(`${HOST_UI.fields.pokeNotifyOff} → ${HOST_UI.fields.pokeNotifyOn}`),
    ).toBeTruthy();

    fireEvent.click(screen.getAllByText(HOST_UI.applySettings)[1]);
    await waitFor(() =>
      expect(calls.find((c) => c.url.endsWith("/host/events/e1"))?.body).toMatchObject({
        config: { allowUndo: false, allowUndoPre: false, pokeNotify: true },
      }),
    );
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
    expect(labels).toEqual([
      HOST_UI.fields.regOpenAt,
      HOST_UI.fields.prevoteAt,
      HOST_UI.fields.voteEndAt,
      HOST_UI.fields.partyAt,
      HOST_UI.fields.revealAt,
    ]);
    // 파티 시작만 예약이 아니라는 걸 그 칸에서 말한다 (ADR-14)
    expect(screen.getByText(HOST_UI.fields.partyHint)).toBeTruthy();
  });

  it("★ 콕이 오가기 시작하면 규칙 넷과 일정이 잠긴다 (ADR-35)", async () => {
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
    for (const label of [
      HOST_UI.fields.pokeTarget,
      HOST_UI.fields.undoPre,
      HOST_UI.fields.undoParty,
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
    for (const label of [HOST_UI.fields.partyAt, HOST_UI.fields.regOpenAt, HOST_UI.fields.prevoteAt]) {
      expect((row(label).querySelector("input") as HTMLInputElement).disabled, label).toBe(true);
    }
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
describe("자리 배정 시트", () => {
  const party = () => hostState({ phase: "party" });

  /** 시트 안의 것을 누른다 — 목록 화면에도 같은 이름의 버튼이 있다 */
  const inSheet = () => within(document.querySelector('[role="dialog"]') as HTMLElement);

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

  it("★ 뺀 사람은 인원에서 빠지고, 왜 빠졌는지 말한다", async () => {
    stubFetch(party());
    renderConsole("/host/e1/seats/new");
    await screen.findByText(HOST_UI.seats.seatedAll(2));

    // 한 명을 뺀다 — `2명 배정` 이 아니라 `1명 배정 · 1명 제외`
    fireEvent.click(inSheet().getByText("가"));
    await screen.findByText(HOST_UI.seats.leftOut(1, 1));
    expect(screen.queryByText(HOST_UI.seats.seatedAll(2))).toBeNull();
  });

  it("★ 뺀 사람이 배정 요청에 실린다", async () => {
    // 한 명을 빼고도 테이블 하나를 채울 수 있어야 다음 걸음으로 넘어간다 (최소 2명)
    const st = party();
    st.players = [...st.players, { ...st.players[1], id: "p3", nickname: "다", realName: "김다" }];
    stubFetch(st);
    renderConsole("/host/e1/seats/new");
    await screen.findByText(HOST_UI.seats.seatedAll(3));

    fireEvent.click(inSheet().getByText("가"));
    fireEvent.click(inSheet().getByText(HOST_UI.seats.excludeNext));
    await screen.findAllByText(HOST_UI.seats.tableCount);
    fireEvent.click(inSheet().getByText(HOST_UI.seats.make));

    await waitFor(() => expect(calls.find((c) => c.url.endsWith("/seating"))).toBeTruthy());
    expect(calls.find((c) => c.url.endsWith("/seating"))?.body).toEqual({
      tableCount: 1,
      final: false,
      exclude: ["p1"],
    });
  });
});
