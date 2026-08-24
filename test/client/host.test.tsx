/**
 * 운영자 콘솔이 조용히 죽지 않는지 본다 (ADR-8).
 *
 * 특히 단계 전환 — 참가자 전원의 화면이 바뀌는 행동이라 확인창이 **무엇이 어떻게 바뀌는지**
 * 항목으로 보여줘야 하고, 확인을 누르기 전에는 아무 일도 일어나면 안 된다.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouterProvider, createMemoryRouter } from "react-router";
import { FAIL, HOST_UI, phaseAction, schedDiff } from "../../src/shared/copy.ts";
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
    attendance: {},
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

function renderConsole(at = "/host/e1") {
  const router = createMemoryRouter(
    [
      {
        path: "/host/:id",
        element: <HostConsole />,
        children: [
          { index: true, element: <Dash /> },
          { path: "players", element: <Players /> },
          { path: "players/:pid", element: <Players /> },
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

  it("★ 필터 칩은 상태 축이고, 성비는 숫자로 남는다", async () => {
    /*
     * 성별 칩의 진짜 용도는 "세 숫자를 한 번에 보는 것"(성비)이었다 (ADR-33).
     * 칩 한 줄은 상태가 쓰고, 성비는 숫자로 옮겼다.
     */
    const st = hostState();
    st.invites = [{ phone: "01099998888", token: "t2", addedAt: 2 }];
    stubFetch(st);
    renderConsole("/host/e1/players");

    // 라벨과 숫자가 다른 요소라 버튼 전체의 글자로 본다
    const label = (text: string) =>
      screen.getAllByRole("button").find((b) => b.textContent?.startsWith(text))?.textContent;

    await screen.findByLabelText(HOST_UI.invites.addLabel);
    expect(label(HOST_UI.players.filterAll)).toContain("3");        // 등록 2 + 미등록 1
    expect(label(HOST_UI.status.registered)).toContain("2");
    expect(label(HOST_UI.status.unregistered)).toContain("1");
    expect(screen.getByText(HOST_UI.players.ratio(1, 1))).toBeTruthy();
  });

  it("★ 명단과 참가자가 한 목록이다 — 같은 사람이 두 번 나오지 않는다", async () => {
    /*
     * 둘은 같은 사람들이고 운영자가 하는 일도 하나다 — 부를 사람을 넣고, 안내문을 보내고, 온 사람을 본다.
     * 갈라 두니 같은 사람이 두 번 나오고 "누구에게 보냈나" 와 "누가 왔나" 를 따로 세게 됐다.
     */
    const st = hostState();
    st.invites = [
      // 이미 등록한 사람 — 위쪽 카드로만 나온다
      { phone: "01011112222", token: "t1", addedAt: 1, nickname: st.players[0].nickname },
      // 아직 안 온 사람 — 번호가 그의 유일한 이름이다
      { phone: "01099998888", token: "t2", addedAt: 2 },
    ];
    stubFetch(st);
    renderConsole("/host/e1/players");

    await screen.findByLabelText(HOST_UI.invites.addLabel);

    // 안 온 사람은 번호로 나온다
    expect(screen.getByText("010-9999-8888")).toBeTruthy();
    // 안 온 사람 수를 세어 준다
    expect(screen.getByText(HOST_UI.invites.waitingCount(1))).toBeTruthy();
  });

  it("★ 안내문 미리보기는 눌러야 열린다", async () => {
    // 늘 펼쳐 두면 명단이 그만큼 아래로 밀린다. 문구는 한 번 확인하면 되는 것이다
    const st = hostState();
    st.invites = [{ phone: "01099998888", token: "t2", addedAt: 2 }];
    stubFetch(st);
    renderConsole("/host/e1/players");

    const toggle = await screen.findByText(HOST_UI.invite.preview);
    expect(document.body.textContent).not.toContain("/j/e1/t2");

    fireEvent.click(toggle);
    await waitFor(() => expect(document.body.textContent).toContain("/j/e1/t2"));
  });

  /*
   * 번호 칸은 **운영자 명단에만** 남았다. 참가자 쪽은 링크가 신원이라 번호를 치지 않는다 (ADR-32).
   * 그래도 이 칸의 동작은 그대로 중요하다 — 여기서 잘못 옮겨 적은 번호는 파티 당일에야 드러난다.
   */
  describe("명단 번호 칸", () => {
    const field = async () => {
      stubFetch(hostState());
      // 번호 칸은 참가자 탭 안에 있다 — 명단이 목록에 합쳐졌다
      renderConsole("/host/e1/players");
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
    await screen.findByLabelText(HOST_UI.invites.addLabel);

    // 참가자 탭에는 안 보인다. 현황 탭의 순위와는 자리가 다르다 (ADR-30)
    expect(document.body.textContent).not.toContain("받은 콕");
  });

  it("★ 카드는 실명부터 보여준다 — 얼굴과 맞추는 건 닉네임이 아니다", async () => {
    // 문 앞에서 사람을 찾는 화면이다. MBTI·콕 횟수는 상세로 갔다 (ADR-33)
    const st = hostState();
    stubFetch(st);
    renderConsole("/host/e1/players");
    await screen.findByLabelText(HOST_UI.invites.addLabel);

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
    await screen.findByLabelText(HOST_UI.fields.name);

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

  it("★ 콕이 오가기 시작하면 규칙 넷과 일정이 잠긴다 (ADR-35)", async () => {
    /*
     * 잠긴 줄을 **지우지 않는다** — 지금 어느 규칙으로 돌아가는 중인지는
     * 파티 도중에 가장 자주 확인하는 값이다. 못 누르게만 하고 이유를 한 줄 남긴다.
     */
    stubFetch(hostState({ phase: "party", fired: { reg: Date.now() - 2 * HOUR, party: Date.now() - HOUR } }));
    renderConsole("/host/e1/settings");
    await screen.findByLabelText(HOST_UI.fields.name);

    const row = (label: string) =>
      screen.getAllByText(label).find((el) => el.tagName === "LABEL")!.parentElement!;
    const disabled = (label: string) =>
      [...row(label).querySelectorAll("button")].every((b) => (b as HTMLButtonElement).disabled);

    for (const label of [
      HOST_UI.fields.pokeTarget,
      HOST_UI.fields.undoPre,
      HOST_UI.fields.undoParty,
      HOST_UI.fields.pokeNotify,
    ]) {
      expect(disabled(label), label).toBe(true);
    }
    // 일정 셋도 함께 굳는다
    for (const label of [HOST_UI.fields.partyAt, HOST_UI.fields.regOpenAt, HOST_UI.fields.prevoteAt]) {
      expect((row(label).querySelector("input") as HTMLInputElement).disabled, label).toBe(true);
    }
    // 콕 횟수는 일부러 열려 있다 — 파티 중에 **올리는** 것이 매칭이 모자랄 때의 손잡이다
    const plus = [...row(HOST_UI.fields.maxParty).querySelectorAll("button")].at(-1) as HTMLButtonElement;
    expect(plus.disabled).toBe(false);
    expect(screen.getAllByText(HOST_UI.frozen).length).toBeGreaterThan(0);
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
