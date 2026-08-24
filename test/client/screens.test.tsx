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
import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, RouterProvider, createMemoryRouter, useLocation, useNavigate } from "react-router";
import { BTN, ENTRY, ENV_BANNER, FAIL, HELP, FORTUNE, HOME, ME, NOTICE, PEOPLE, PHASE_LABEL, POKE, REGISTER, REVEAL, SCREEN_TITLE, SEAT, STATUS, TABS_PARTICIPANT, UNIT } from "../../src/shared/copy.ts";
import type { MyPokeState, ParticipantState, RegisterInput } from "../../src/shared/types.ts";
import Entry from "../../src/client/routes/Entry.tsx";
import Join from "../../src/client/routes/Join.tsx";
import Register from "../../src/client/routes/Register.tsx";
import { ParticipantView } from "../../src/client/routes/Participant.tsx";
import type { ParticipantSource } from "../../src/client/lib/participant.ts";
import { ApiError, api, timeoutFor } from "../../src/client/lib/api.ts";
import EnvBadge from "../../src/client/ui/EnvBadge.tsx";
import Boom from "../../src/client/ui/Boom.tsx";
import { useKeyboardInset } from "../../src/client/lib/keyboard.ts";

afterEach(cleanup);

/** 가짜 시계를 밀면서 React 가 따라잡게 한다. 다시 시도는 타이머 → 요청 → 타이머로 이어진다 */
async function pump(ms: number) {
  for (let i = 0; i < 6; i++) await act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
}

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
    },
    me: {
      id: "me",
      // UI 라벨 "나"(PEOPLE.mine)와 겹치지 않는 닉네임이어야 한다 — 겹치면 조회가 둘을 잡는다
      nickname: "달빛",
      realName: "김나",
      age: 30,
      gender: "M",
      phone: "01000000000",
      instagram: "na_gram",
      mbti: "ENFP",
      charms: ["하나", "둘", "셋"],
      contactShare: "all" as const,
      createdAt: 1,
    },
    roster: [{ id: "her", nickname: "그녀", age: 29, gender: "F", mbti: "ISFJ", charms: ["매력가", "매력나", "매력다"] }],
    poke: POKE_STATE,
    announcements: [],
    ...over,
  };
}

function fakeSource(over: Partial<ParticipantSource> = {}): ParticipantSource & {
  calls: { poke: string[]; ack: number[]; saved: RegisterInput[] };
} {
  const calls = { poke: [] as string[], ack: [] as number[], saved: [] as RegisterInput[] };
  return {
    key: "test",
    calls,
    load: async () => participantState(),
    poke: async (toId) => {
      calls.poke.push(toId);
      return POKE_STATE;
    },
    unpoke: async (toId) => {
      calls.poke.push(`-${toId}`);
      return POKE_STATE;
    },
    ackSeat: async (round) => {
      calls.ack.push(round);
    },
    saveProfile: async (input) => {
      calls.saved.push(input);
      return { ...participantState().me, ...input };
    },
    ...over,
  };
}

/**
 * 확인창 안의 버튼. **명단의 콕 버튼과 글자가 같다** — 라운드 이름이 곧 버튼 이름이라(ADR-34)
 * `getByText` 로는 갈리지 않는다. 창 안의 버튼만 `btn wide` 를 쓴다.
 */
function dialogBtn(label: string) {
  const found = screen
    .getAllByRole("button")
    .find((b) => b.className.includes("btn wide") && b.textContent === label);
  if (!found) throw new Error(`확인창에 "${label}" 버튼이 없다`);
  return found;
}

function renderParticipant(
  source: ParticipantSource,
  profileId?: string,
  onTab: (t: string) => void = () => {},
  tab: "home" | "people" | "me" | "fortune" = "people",
  helpOpen = false,
) {
  return render(
    <MemoryRouter>
      <ParticipantView source={source} tab={tab} profileId={profileId} onTab={onTab} onProfile={() => {}} onEdit={() => {}} onSeat={() => {}} helpOpen={helpOpen} onHelp={() => {}} />
    </MemoryRouter>,
  );
}

// ─────────────────────────────────────────── 실패했을 때

/**
 * 하얀 화면을 남기지 않는다. 실패에도 **다음 할 일**이 있어야 한다 —
 * 그리고 파티장에는 운영자가 눈앞에 있으므로, 막다른 길이 아니라 사람에게 이어진다.
 */
describe("오류 화면", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("★ 망이 끊기면 ApiError 로 감싼다 — 날 TypeError 를 올려보내지 않는다", async () => {
    /*
     * 감싸지 않으면 `userMessage` 가 없어 화면이 `ENTRY.notFound`("그런 회차가 없어요") 로
     * 떨어진다 — 잠깐 끊긴 참가자에게 **"네 링크가 잘못됐다"** 고 말하는 셈이다.
     * 그 사람은 링크를 의심하며 운영자에게 엉뚱한 걸 묻는다.
     */
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(api("/me")).rejects.toMatchObject({ status: 0, userMessage: FAIL.offline });
  });

  it("★ 매달린 요청을 끊는다 — 운세만 더 오래 기다린다", () => {
    /*
     * `fetch` 에는 기본 시간 제한이 없다. 약전계에서 요청이 나갔다 매달리면 브라우저가
     * 포기할 때까지 수십 초에서 몇 분이고, 그동안 참가자는 어두운 빈 화면만 본다 —
     * 오류 화면을 만들어놓고 정작 필요한 때 안 뜨는 셈이다.
     *
     * 운세는 **뒤집는 순간 LLM 을 부른다** (미리 안 만든다 — ADR-20).
     * 서버가 12초에 규칙 문구로 떨어뜨리므로, 짧게 잡으면 정상인 걸 우리가 먼저 끊는다.
     */
    expect(timeoutFor("/me")).toBe(timeoutFor("/poke"));
    expect(timeoutFor("/fortune")).toBeGreaterThan(timeoutFor("/me"));
    // 미션도 같은 경로다
    expect(timeoutFor("/fortune/mission")).toBe(timeoutFor("/fortune"));
    // 서버가 12초에 폴백을 주므로 그보다 넉넉해야 한다
    expect(timeoutFor("/fortune")).toBeGreaterThan(13_000);
  });

  it("★ 망 문제일 때는 '처음으로' 가 아니라 '새로고침' 이다", async () => {
    // 회차를 잘못 찾아온 게 아니라 망이 흔들린 것이다. 할 일은 다시 시도하는 것이다
    vi.useFakeTimers();
    const source = fakeSource({
      load: async () => {
        throw new ApiError(0, "offline", FAIL.offline);
      },
    });
    renderParticipant(source);
    // 곧바로 뜨지 않는다 — 몇 번 더 붙어보고 나서다
    expect(screen.queryByText(FAIL.reconnect)).toBeNull();
    await pump(4000);
    expect(screen.getByText(FAIL.reconnect)).toBeTruthy();
    expect(screen.getByText(new RegExp(FAIL.offline.split("\n")[0]))).toBeTruthy();
    expect(screen.getByText(FAIL.askHost)).toBeTruthy();
    expect(screen.queryByText(BTN.home)).toBeNull();
    vi.useRealTimers();
  });

  it("★ 닿지 못한 실패는 스스로 돌아온다 — 새로고침을 누르게 만들지 않는다", async () => {
    /*
     * 안드로이드는 화면을 끄면 탭을 얼리고 데이터 무선을 내린다. 켜는 순간 앱이
     * 다시 읽는데(ADR-26) 무선이 아직 안 올라와 있어서 거부된다. 망은 1초 뒤에
     * 멀쩡해지는데 화면은 오류에 머물러 있었다 — 참가자가 손으로 새로고침을
     * 눌러야만 빠져나오는 막다른 길이었다.
     */
    vi.useFakeTimers();
    let down = true;
    const source = fakeSource({
      load: async () => {
        if (down) throw new ApiError(0, "offline", FAIL.offline);
        return participantState();
      },
    });
    renderParticipant(source);

    /*
     * 1초짜리 실패에 오류 화면을 보여주면, 사람은 스스로 나은 것을 보지 못하고
     * **고장 난 앱을 본다.** 그 사이에는 평소의 불러오는 화면 그대로여야 한다.
     */
    await act(async () => void (await vi.advanceTimersByTimeAsync(500)));
    expect(screen.queryByText(FAIL.reconnect)).toBeNull();

    // 무선이 올라왔다. 아무것도 누르지 않는다
    down = false;
    await pump(1000);
    expect(screen.getByText(PEOPLE.mine)).toBeTruthy();
    // 오류 화면은 **끝내 한 번도 뜨지 않았다**
    expect(screen.queryByText(FAIL.reconnect)).toBeNull();
    vi.useRealTimers();
  });

  it("★ 보던 화면이 있으면 버리지 않는다 — 다시 읽기가 실패해도 자리를 뺏지 않는다", async () => {
    /*
     * 폰을 켜는 순간의 1초짜리 실패에 **보고 있던 탭과 자리를 통째로 빼앗을** 이유가 없다.
     * 여기서는 아예 오류로 올리지 않는다 — 뒤에서 조용히 다시 붙는다.
     */
    vi.useFakeTimers();
    let down = false;
    const source = fakeSource({
      liveCode: "ABCDEF",
      load: async () => {
        if (down) throw new ApiError(0, "offline", FAIL.offline);
        return participantState();
      },
    });
    renderParticipant(source);
    await pump(100);
    expect(screen.getByText(PEOPLE.mine)).toBeTruthy();

    // 화면을 껐다 켠다. 그 순간 무선이 아직 안 올라와 있다
    down = true;
    document.dispatchEvent(new Event("visibilitychange"));
    await pump(4000);

    // 보던 화면 그대로다
    expect(screen.getByText(PEOPLE.mine)).toBeTruthy();
    expect(screen.queryByText(FAIL.reconnect)).toBeNull();
    vi.useRealTimers();
  });

  it("★ 오류 화면에 갇히지 않는다 — 앱으로 돌아오면 타이머 없이도 다시 붙는다", async () => {
    /*
     * **"가끔 넘어가서 안 돌아온다" 가 여기였다.** 안드로이드는 화면을 끌 때 탭을 얼리는데,
     * 얼어 있는 동안 예약해둔 다시 시도 타이머는 멈추고 깨어날 때 살아 돌아온다는 보장이 없다.
     * 그러면 다시 붙을 길이 하나도 없는 채로 오류 화면에 남는다.
     *
     * 그래서 앱으로 돌아오는 순간을 직접 듣는다. **시계를 한 번도 밀지 않고** 돌아와야 한다.
     */
    vi.useFakeTimers();
    let down = true;
    const source = fakeSource({
      load: async () => {
        if (down) throw new ApiError(0, "offline", FAIL.offline);
        return participantState();
      },
    });
    renderParticipant(source);
    await pump(4000);
    expect(screen.getByText(FAIL.reconnect)).toBeTruthy();

    // 폰을 다시 켰다. 타이머는 얼어 있다고 보고 한 번도 밀지 않는다
    down = false;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => {});
    expect(screen.getByText(PEOPLE.mine)).toBeTruthy();
    vi.useRealTimers();
  });

  it("★ 망 문제에 페이지를 다시 받지 않는다 — 요청 하나만 다시 보낸다", async () => {
    /*
     * `location.reload()` 는 앱을 통째로 버리고 index.html 부터 다시 받는다 —
     * **망이 흔들리는 바로 그 순간에 가장 하면 안 되는 일이다.** 실패하면 브라우저의
     * 오류 화면으로 넘어가고, 거기서는 우리가 할 수 있는 게 없다.
     */
    vi.useFakeTimers();
    let down = true;
    const load = vi.fn(async () => {
      if (down) throw new ApiError(0, "offline", FAIL.offline);
      return participantState();
    });
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    renderParticipant(fakeSource({ load }));
    await pump(4000);

    down = false;
    await act(async () => void fireEvent.click(screen.getByText(FAIL.reconnect)));
    await act(async () => {});
    expect(screen.getByText(PEOPLE.mine)).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("★ 서버가 거절한 실패는 다시 묻지 않는다 — 401 을 무한히 되풀이하지 않는다", async () => {
    // 다시 물어도 같은 답이다. `status 0` 만이 시간이 답인 실패다
    vi.useFakeTimers();
    const load = vi.fn(async () => {
      throw new ApiError(401, "unauthorized", ENTRY.notFound);
    });
    renderParticipant(fakeSource({ load }));
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await pump(5000);
    expect(load).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("★ 서버 탓을 링크 탓으로 돌리지 않는다", async () => {
    /*
     * `apiError()` 는 `message` 를 **선택**으로 둔다. 설명 없이 나가는 실패가 흔한데,
     * 화면이 그때마다 "그런 회차가 없어요" 로 떨어졌다 — 500 도, 401 도, 429 도.
     *
     * 참가자는 멀쩡한 링크를 의심하고 운영자에게 엉뚱한 걸 묻는다.
     * `status 0` 에서 이미 한 번 고친 실수인데 이 경로가 남아 있었다.
     */
    renderParticipant(fakeSource({ load: async () => { throw new ApiError(500, "server_misconfigured"); } }));
    await screen.findByText(FAIL.title);
    expect(screen.queryByText(ENTRY.notFound)).toBeNull();
    // 참가자가 할 수 있는 게 없다. 눈앞의 운영자에게 넘긴다
    expect(screen.getByText(FAIL.askHost)).toBeTruthy();
  });

  it("★ 링크를 탓하는 건 404 하나뿐이다", async () => {
    // 회차는 멀쩡하고 본인이 빠진 것이다 — 그때만 다시 입장할 길을 준다
    renderParticipant(fakeSource({ load: async () => { throw new ApiError(404, "not_found"); } }));
    await screen.findByText(ENTRY.notFound);
    expect(screen.getByText(ENTRY.reenter)).toBeTruthy();
  });

  it("★ 세션이 끊겨도 링크를 탓하지 않는다", async () => {
    // 401 은 회차가 없는 게 아니라 내 세션이 이 회차의 것이 아닌 것이다
    renderParticipant(fakeSource({ load: async () => { throw new ApiError(401, "unauthorized"); } }));
    await screen.findByText(FAIL.title);
    expect(screen.queryByText(ENTRY.notFound)).toBeNull();
    expect(screen.getByText(BTN.home)).toBeTruthy();
  });

  it("★ 번들이 안 붙었을 때의 화면은 **늦게** 나타난다", () => {
    /*
     * `index.html` 안에 있으니 브라우저가 먼저 그리고 React 가 뜨면서 덮는다.
     * 늦추지 않으면 **정상 경로에서 매번 "화면을 불러오지 못했어요" 가 번쩍인다** —
     * 멀쩡히 도는 앱이 매번 실패했다고 말하면, 진짜 실패했을 때 아무도 안 믿는다.
     *
     * 문구와 늦추기는 **짝이다.** 하나만 남으면 거짓 경고가 되거나 화면이 영영 안 뜬다.
     * JS 로 늦추지 않는다 — 번들이 안 붙은 상황을 위한 자리라 스크립트에 기댈 수 없다.
     */
    // vitest 는 저장소 뿌리에서 돈다. happy-dom 안에서는 import.meta.url 이 file: 이 아니다
    const html = readFileSync("index.html", "utf8");
    expect(html).toContain("화면을 불러오지 못했어요");
    expect(html).toMatch(/\.bootFail\s*\{[^}]*opacity:\s*0/);
    expect(html).toMatch(/animation:\s*bootFailIn\s+0s\s+\ds/);
    expect(html).toContain('class="bootFail"');
  });

  it("★ 컴포넌트가 던져도 하얀 화면이 되지 않는다", () => {
    // React 는 컴포넌트가 던지면 트리를 통째로 걷어낸다. 경계가 그 자리를 메운다
    const Bomb = () => {
      throw new Error("boom");
    };
    // 경계가 잡은 오류는 React 가 콘솔에도 찍는다 — 테스트 출력만 조용히 시킨다
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <Boom>
        <Bomb />
      </Boom>,
    );
    expect(screen.getByText(FAIL.title)).toBeTruthy();
    expect(screen.getByText(FAIL.retry)).toBeTruthy();
    expect(screen.getByText(FAIL.askHost)).toBeTruthy();
    quiet.mockRestore();
  });
});

// ─────────────────────────────────────────── 입장

describe("뿌리 화면", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** 세션이 없으면 401. 여기서 할 수 있는 일이 없다는 걸 말해야 한다 */
  const noSession = () =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 })),
    );

  it("★ 코드를 묻지 않는다 — 문은 참가 링크 하나뿐이다", async () => {
    /*
     * 예전에는 여기서 입장 코드 여섯 자리를 물었다. 운영자는 보통 링크만 주므로,
     * 링크를 열었다 뒤로 간 참가자가 **알지도 못하는 코드를 요구받는 막다른 길**이었다.
     */
    noSession();
    render(
      <MemoryRouter>
        <Entry />
      </MemoryRouter>,
    );
    await screen.findByText(ENTRY.linkOnly);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("★ 운영자 진입 버튼을 두지 않는다", async () => {
    // 참가자에게 관리 경로를 광고할 이유가 없다. 운영자는 /host 를 직접 연다
    noSession();
    render(
      <MemoryRouter>
        <Entry />
      </MemoryRouter>,
    );
    await screen.findByText(ENTRY.linkOnly);
    // 이 화면에는 누를 것이 하나도 없다. 관리 경로는 그중에서도 없어야 한다
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("★ 이미 들어가 있는 사람은 자기 회차로 보낸다", async () => {
    // 이미 들어와 있는 사람에게 "링크로 오세요" 라고 하는 건 거짓말이다
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(participantState()), { headers: { "content-type": "application/json" } }),
      ),
    );
    const router = createMemoryRouter(
      [
        { path: "/", element: <Entry /> },
        { path: "/e/:code", element: <div>{SCREEN_TITLE.join}</div> },
      ],
      { initialEntries: ["/"] },
    );
    render(<RouterProvider router={router} />);
    await waitFor(() => expect(router.state.location.pathname).toBe("/e/ABCDEF"));
  });
});

// ─────────────────────────────────────────── 콕

describe("참가자 화면 · 콕", () => {
  it("★ 콕 찌르기는 확인을 거치고, 확인창이 숫자를 보여준다", async () => {
    const source = fakeSource();
    renderParticipant(source);
    await screen.findByText(/그녀/);

    fireEvent.click(screen.getAllByLabelText(POKE.confirm.submit("pre"))[0]);

    // 이미 1회 보냈으므로 "한 번 더" 쪽 문장이다
    await screen.findByText(POKE.confirm.title("pre", 1));
    expect(screen.getByText(POKE.confirm.rowTarget("pre"))).toBeTruthy();
    // 보낸 콕 2회 · 남은 횟수 1회 — 무엇이 어떻게 바뀌는지 숫자로
    expect(screen.getAllByText(UNIT.times(2)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(UNIT.times(1)).length).toBeGreaterThan(0);
    expect(source.calls.poke).toEqual([]);   // 아직 보내지 않았다

    fireEvent.click(dialogBtn(POKE.confirm.submit("pre")));
    await waitFor(() => expect(source.calls.poke).toEqual(["her"]));
  });

  it("★ 확인을 누르면 서버를 기다리지 않고 그 자리에서 바뀐다", async () => {
    /*
     * 예전에는 왕복을 두 번 — 보내고, 화면 전체를 다시 읽고 — 기다린 뒤에야 버튼이 바뀌었다.
     * 그동안 화면이 아무 말도 안 해서 **사람이 다시 눌렀다.** 콕 상한이 있는 앱에서
     * 그건 가벼운 문제가 아니다.
     *
     * 그래서 **서버 응답을 붙잡아둔 채로** 확인한다 — "빨라졌다" 가 아니라
     * "기다리지 않는다" 를 재야 한다.
     */
    let release!: (v: MyPokeState) => void;
    const source = fakeSource({
      poke: async () => new Promise<MyPokeState>((r) => (release = r)),
    });
    renderParticipant(source);
    await screen.findByText(/그녀/);

    fireEvent.click(screen.getAllByLabelText(POKE.confirm.submit("pre"))[0]);
    await screen.findByText(POKE.confirm.title("pre", 1));
    fireEvent.click(dialogBtn(POKE.confirm.submit("pre")));

    // 서버는 아직 답하지 않았다. 그런데 화면은 이미 2회다
    await screen.findByText("2");
    // 남은 콕도 함께 줄어 있다 (3 - 2 = 1)
    expect(screen.getAllByText(UNIT.times(1)).length).toBeGreaterThan(0);

    // 이제 서버가 답한다 — 그 값이 이긴다
    release({ ...POKE_STATE, sentTo: { her: 7 } });
    await screen.findByText("7");
  });

  it("★ 서버가 거절하면 되돌린다 — 쓰지도 않은 콕이 쓴 것으로 남지 않는다", async () => {
    const source = fakeSource({
      poke: async () => {
        throw new ApiError(409, "closed", POKE.blocked.closed("pre"));
      },
    });
    renderParticipant(source);
    await screen.findByText(/그녀/);
    fireEvent.click(screen.getAllByLabelText(POKE.confirm.submit("pre"))[0]);
    await screen.findByText(POKE.confirm.title("pre", 1));
    fireEvent.click(dialogBtn(POKE.confirm.submit("pre")));

    // 잠깐 2회로 보였다가 1회로 돌아온다
    await screen.findByText(POKE.blocked.closed("pre"));
    await waitFor(() => expect(screen.queryByText("2")).toBeNull());
    expect(screen.getByText("1")).toBeTruthy();
  });

  it("★ 보내는 중에는 두 번 보내지 않는다", async () => {
    /*
     * 예전에는 왕복이 **우연히** 막고 있었다 — 느려서가 아니라 버튼이 안 바뀌어서
     * 누를 마음이 안 들었을 뿐이다. 즉시 바뀌게 만들면 그 우연이 사라진다.
     * 이걸 빼면 이 슬라이스는 콕을 두 번 보내는 기능이 된다.
     */
    let release!: (v: MyPokeState) => void;
    const source = fakeSource({
      poke: async (toId) => {
        source.calls.poke.push(toId);
        return new Promise<MyPokeState>((r) => (release = r));
      },
    });
    renderParticipant(source);
    await screen.findByText(/그녀/);
    fireEvent.click(screen.getAllByLabelText(POKE.confirm.submit("pre"))[0]);
    await screen.findByText(POKE.confirm.title("pre", 1));
    fireEvent.click(dialogBtn(POKE.confirm.submit("pre")));
    await waitFor(() => expect(source.calls.poke).toEqual(["her"]));

    // 답이 오기 전에 또 누른다
    fireEvent.click(screen.getAllByLabelText(POKE.confirm.submit("pre"))[0]);
    await screen.findByText(POKE.confirm.title("pre", 2));
    fireEvent.click(dialogBtn(POKE.confirm.submit("pre")));
    await waitFor(() => expect(source.calls.poke).toEqual(["her"]));

    release(POKE_STATE);
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

  it("★ 콕 버튼은 카드와 짝을 이룬다 — 찌른 횟수가 버튼 안에 있다", async () => {
    /*
     * 44px 알약이던 시절에는 74px 카드 옆에서 혼자 작고 동그래서 짝이 안 맞았다.
     * 횟수를 버튼 **밖**에 두면 폭이 흔들리지 않게 자리를 늘 비워둬야 했다 —
     * 안으로 들어오면서 그 문제도 없어졌다.
     */
    renderParticipant(fakeSource());
    await screen.findByText(/그녀/);
    const btn = screen.getAllByLabelText(POKE.confirm.submit("pre"))[0];
    // 이미 1회 보냈다 (sentTo.her = 1). 그 숫자가 버튼 안에 있다
    expect(btn.querySelector(".n")?.textContent).toBe("1");
    expect(btn.classList.contains("on")).toBe(true);
    // 버튼 바깥에 따로 떠 있던 숫자 칸은 없다
    expect(document.querySelector(".pokeCount")).toBeNull();
  });

  it("등록 중에는 콕 버튼이 잠겨 있다", async () => {
    const source = fakeSource({
      load: async () => participantState({ event: { ...participantState().event, phase: "reg" } }),
    });
    renderParticipant(source);
    await screen.findByText(/그녀/);
    expect((screen.getAllByLabelText(POKE.confirm.submit("party"))[0] as HTMLButtonElement).disabled).toBe(true);
  });
});

// ─────────────────────────────────────────── 자리

describe("파티 룰 도움말", () => {
  /**
   * 이 화면의 값어치는 **운영자가 가리킬 곳이 생기는 것**이다 —
   * "앱에서 물음표 눌러보세요" 가 통하려면 찾아 들어가지 않아도 되는 자리에 있어야 한다.
   */
  it("★ 물음표는 어느 탭에서든 보인다", async () => {
    for (const tab of ["home", "people", "me"] as const) {
      cleanup();
      renderParticipant(fakeSource(), undefined, () => {}, tab);
      await screen.findByLabelText(HELP.open);
    }
  });

  it("★ 콕 횟수는 회차 설정에서 온다 — 문구에 숫자를 박아두지 않는다", async () => {
    /*
     * 회차마다 다른 값이다. 도움말이 `3회` 라고 말하는데 실제로 5회면
     * 그 순간 도움말 전체를 못 믿게 된다.
     */
    const state = participantState();
    state.event.config = { maxPre: 7, maxParty: 9 };
    renderParticipant(fakeSource({ load: async () => state }), undefined, () => {}, "home", true);
    await screen.findByText(HELP.qa.count.a(7, 9));
  });

  it("★ 지금 단계를 색이 아니라 글자로도 말한다", async () => {
    // 매칭 표시와 같은 규칙이다 — 색만으로 말하면 화면 낭독기에는 아무 말도 안 된다
    renderParticipant(fakeSource(), undefined, () => {}, "home", true);
    await screen.findByText(HELP.nowHere);
  });

  /** 등록 단계의 상태. 등록을 막 마친 사람이 보는 것이다 */
  function justRegistered() {
    const state = participantState();
    state.event.phase = "reg";
    state.event.fired = { reg: 1 };
    return state;
  }

  it("★ 등록 중이면 `등록` 칸에 `지금` 이 붙는다", async () => {
    /*
     * 예전에는 단계가 셋(사전·파티·발표)뿐이라 **등록 중에는 어디에도 `지금` 이 없었다.**
     * 도움말이 등록 직후 저절로 열리게 된 뒤로는 하필 **처음 읽는 사람이 그때 읽는다** —
     * 자기 위치를 못 찾는 그림은 그림이 아니다.
     */
    renderParticipant(fakeSource({ load: async () => justRegistered() }), undefined, () => {}, "home", true);
    const now = await screen.findByText(HELP.nowHere);
    expect(now.closest("li")?.textContent).toContain(HELP.steps[0].title);
  });

  it("★ 매력 투표 문구에 '콕' 을 쓰지 않는다", async () => {
    /*
     * ADR-34 — 둘은 쓰임이 아예 다르다. 매력 투표는 만나기 전에 프로필만 보고 고르는 것이고,
     * 콕은 만나본 뒤에 고르는 것이며 **발표에 이어지는 건 콕뿐이다.**
     * 같은 말로 부르면 참가자가 "아까 찔렀는데 왜 또?" 가 된다.
     *
     * 실제로 이름만 `매력 투표` 로 바꾸고 이 문구들을 안 고쳐서 한동안 어긋나 있었다 —
     * 도움말은 `콕 찔러요` 라고 했고 홈 카드는 `서로 찔렀을 때만 공개돼요` 라고 했는데
     * **뒤엣것은 사실도 아니었다.** 그래서 사람 눈이 아니라 여기가 지킨다.
     */
    const prevoteStep = HELP.steps.find((v) => v.key === "prevote")!;

    // 지금 하는 일을 이름 붙이는 자리 — 여기엔 `콕` 이 한 글자도 없어야 한다
    for (const [where, text] of [
      ["도움말 단계", prevoteStep.body],
      ["도움말 문답", HELP.qa.prevote.a],
      ["홈 제목", HOME.todo.prevote.title],
      ["다 썼을 때 제목", HOME.spent.prevote.title],
    ] as const) {
      expect(text, `${where}: ${text}`).not.toContain("콕");
    }

    /*
     * 본문은 다르다. **다음 단계를 가리키는 `콕` 은 오히려 있어야 한다** —
     * `파티에서 만나본 뒤에 콕 찌를 기회가 따로 있어요` 가 둘이 다른 일임을 알려준다.
     * 그래서 금지하는 건 낱말이 아니라 **주어**다: `콕` 이 나오는 줄은 `파티` 를 함께 말해야 한다.
     * 그 조건이 없으면 지금 하는 일을 콕이라 부른 것이다.
     */
    for (const [where, text] of [
      ["홈 본문", HOME.todo.prevote.body],
      ["다 썼을 때 본문", HOME.spent.prevote.body],
    ] as const) {
      for (const line of text.split("\n").filter((l) => l.includes("콕"))) {
        expect(line, `${where}: ${line}`).toContain("파티");
      }
    }
  });

  it("★ 매력 투표와 콕 찌르기를 가르는 문답이 있다", async () => {
    // 단계 그림만으로는 "둘이 뭐가 다른가" 가 안 풀린다. 바로 아래에서 풀어준다
    renderParticipant(fakeSource(), undefined, () => {}, "home", true);
    await screen.findByText(HELP.qa.prevote.q);
    await screen.findByText(HELP.qa.poke.q);
    /*
     * **핵심은 "발표에 이어지는 게 어느 쪽이냐" 다.** 두 줄이 이름과 시점만 말하고
     * 이걸 안 말하면, 바로 위 단계 그림을 되풀이한 것에 지나지 않는다.
     */
    expect(HELP.qa.poke.a).toContain("발표");
    // 그리고 투표도 해야 한다는 걸 알려준다 — 안 그러면 "그럼 투표는 왜?" 로 끝난다
    expect(HELP.qa.prevote.a).toContain("파티");
  });

  it("★ 동성에게 못 찌르는 회차에서만 그 줄이 보인다", async () => {
    /*
     * 지금까지는 **눌러봐야** 알았다 (`POKE.blocked.sameGender` 토스트).
     * 그래서 "왜 안 찔러져요?" 가 운영자에게 갔다.
     *
     * 기본값(모두에게)에서는 줄을 만들지 않는다 — "누구에게나 찌를 수 있어요" 는
     * 아무도 안 묻는 답이고, 안 묻는 답을 적는 만큼 묻는 답이 뒤로 밀린다.
     */
    const state = participantState();
    state.event.config = { maxPre: 3, maxParty: 3, allowSameGender: false };
    renderParticipant(fakeSource({ load: async () => state }), undefined, () => {}, "home", true);
    await screen.findByText(HELP.qa.sameGender.a);

    cleanup();
    renderParticipant(fakeSource(), undefined, () => {}, "home", true);
    await screen.findByText(HELP.title);
    expect(screen.queryByText(HELP.qa.sameGender.a)).toBeNull();
  });

  it("★ 반사적으로 닫은 사람이 다시 여는 길은 등록 중에만 카드에 있다", async () => {
    /*
     * 덮치는 화면은 반사적으로 닫힌다 — 자리 확인창에서 이미 겪었고 그때도
     * 홈 카드가 다시 여는 길이 됐다 (슬라이스 12).
     *
     * **사전 콕 찌르기부터는 없다.** 그 자리에 `참가자 보러 가기` 가 서고,
     * 한 카드에 버튼이 둘이면 어느 것이 지금 할 일인지 갈린다. 그 뒤로는 물음표가 맡는다.
     */
    renderParticipant(fakeSource({ load: async () => justRegistered() }), undefined, () => {}, "home");
    await screen.findByText(HOME.guide);

    cleanup();
    renderParticipant(fakeSource(), undefined, () => {}, "home");
    await screen.findByText(HOME.todo.prevote.title);
    expect(screen.queryByText(HOME.guide)).toBeNull();
  });
});

describe("참가자 화면 · 어깨너머 가리기", () => {
  afterEach(() => window.localStorage.clear());

  /** 찌른 버튼과 안 찌른 버튼을 집어온다. POKE_STATE 는 her 를 1회 찔렀다 */
  function pokeButtons() {
    return screen.getAllByRole("button").filter((b) => b.className.includes("pokeBtn"));
  }

  it("★ 되돌리기는 행이 아니라 확인창 안에 있다 (ADR-34)", async () => {
    /*
     * 행에 버튼을 하나 더 두면 카드가 화면 밖으로 밀리고,
     * **가린 동안 그 버튼이 보이면 "이 사람을 골랐다" 가 그대로 샌다** —
     * 이 슬라이스의 불변식이 되돌리기 버튼 하나로 깨진다.
     * 창은 이미 숫자를 보여주고 있으니 거기 둔다.
     */
    renderParticipant(fakeSource());
    await screen.findByText(/그녀/);

    // 행에는 없다 — 버튼은 하나뿐이다
    expect(screen.queryAllByText(POKE.undo.btn)).toHaveLength(0);

    // 이미 찌른 사람의 창을 열면 그 안에 있다 (POKE_STATE 는 her 를 1회 찔렀다)
    const source = fakeSource();
    cleanup();
    renderParticipant(source);
    await screen.findByText(/그녀/);
    fireEvent.click(screen.getAllByLabelText(POKE.confirm.submit("pre"))[0]);
    await screen.findByText(POKE.confirm.title("pre", 1));
    expect(screen.getByText(POKE.undo.btn)).toBeTruthy();

    // 누르면 되돌아간다. 확인을 한 번 더 묻지 않는다 — 되돌리는 것 자체가 되돌리기다
    fireEvent.click(screen.getByText(POKE.undo.btn));
    await waitFor(() => expect(source.calls.poke).toEqual(["-her"]));
  });

  it("★ 가리면 찌른 버튼과 안 찌른 버튼이 구별되지 않는다", async () => {
    /*
     * 이 슬라이스의 **유일한 불변식**이다. 그래서 "숫자가 없다" 가 아니라
     * **"두 버튼이 같다"** 를 잰다 — 숫자만 지우면 .on 의 그라데이션이 그대로 남고,
     * 멀리서 새는 건 숫자가 아니라 그 색이다.
     */
    renderParticipant(fakeSource());
    await screen.findByText(/그녀/);

    // 가리기 전: 찌른 쪽만 다르게 생겼다
    expect(pokeButtons().some((b) => b.className.includes("on"))).toBe(true);
    expect(screen.getByText("1")).toBeTruthy();

    fireEvent.click(screen.getByText(PEOPLE.cover));

    const shapes = new Set(pokeButtons().map((b) => b.className + "|" + b.textContent));
    expect(shapes.size).toBe(1);                                   // 전부 같은 모습이다
    expect(pokeButtons().some((b) => b.className.includes("on"))).toBe(false);
    expect(screen.queryByText("1")).toBeNull();
  });

  it("★ 가린 동안에는 찌를 수 없다 — 확인창도 안 뜬다", async () => {
    // 남이 보는 중에 👉 를 누르면 **지금** 찌르는 상대가 실시간으로 샌다
    const source = fakeSource();
    renderParticipant(source);
    await screen.findByText(/그녀/);
    fireEvent.click(screen.getByText(PEOPLE.cover));

    fireEvent.click(pokeButtons()[0]);
    expect(() => dialogBtn(POKE.confirm.submit("pre"))).toThrow();
    expect(source.calls.poke).toEqual([]);
  });

  it("★ 프로필 시트도 함께 덮인다", async () => {
    // People.tsx 에 같은 컨트롤이 **두 군데**다. 목록만 고치면 눌러본 순간 그대로 보인다
    renderParticipant(fakeSource());
    await screen.findByText(/그녀/);
    fireEvent.click(screen.getByText(PEOPLE.cover));
    cleanup();

    // 가린 채로 프로필을 연다
    renderParticipant(fakeSource(), "her");
    await screen.findByText(PEOPLE.charmTitle);
    expect(screen.queryByLabelText(POKE.confirm.submit("pre"))).toBeNull();
    expect(screen.getAllByLabelText(PEOPLE.coveredPoke).length).toBeGreaterThan(1);
  });

  it("★ 파티가 시작돼 안내문이 사라져도 버튼은 남는다", async () => {
    /*
     * 처음 요청받은 자리가 정확히 그때 사라진다 — agesHidden 이 파티 단계에서 false 다.
     * 그런데 **어깨너머가 가장 위험한 때가 그때다.** 다들 한 테이블에 앉아 있다.
     */
    renderParticipant(fakeSource({ load: async () => participantState({ event: { ...participantState().event, phase: "party" } }) }));
    await screen.findByText(/그녀/);
    expect(screen.queryByText(PEOPLE.agesAtParty)).toBeNull();   // 안내문은 없고
    expect(screen.getByText(PEOPLE.cover)).toBeTruthy();          // 버튼은 있다
  });

  it("★ 기기에 남는다 — 탭을 옮겼다 와도 가려져 있다", async () => {
    // 다시 읽기 한 번에 풀리면 **가린 사람이 그걸 모른 채 다닌다.** 최악의 실패다
    renderParticipant(fakeSource());
    await screen.findByText(/그녀/);
    fireEvent.click(screen.getByText(PEOPLE.cover));
    cleanup();

    renderParticipant(fakeSource());
    await screen.findByText(/그녀/);
    expect(screen.getByText(PEOPLE.uncover)).toBeTruthy();
    expect(pokeButtons().some((b) => b.className.includes("on"))).toBe(false);
  });
});

describe("참가자 화면 · 자리", () => {
  const seat = { round: 1, table: 2, final: false, mates: 6, men: 3, acked: false };

  it("자리가 발행되면 전체 화면으로 확인을 받는다", async () => {
    const source = fakeSource({ load: async () => participantState({ seat }) });
    renderParticipant(source);
    await screen.findByText(SEAT.ack.headline(2));

    fireEvent.click(screen.getByText(SEAT.ack.submit));
    await waitFor(() => expect(source.calls.ack).toEqual([1]));
  });

  it("★ 확인 저장이 실패하면 안내가 그대로 남는다 — 조용히 삼키지 않는다", async () => {
    /*
     * 삼키면 화면에서는 사라지고 서버에는 미확인으로 남아,
     * 운영자가 보는 이동 확인 수가 조용히 모자란다.
     */
    const source = fakeSource({
      load: async () => participantState({ seat }),
      ackSeat: async () => {
        throw new Error("network");
      },
    });
    renderParticipant(source);
    await screen.findByText(SEAT.ack.headline(2));
    fireEvent.click(screen.getByText(SEAT.ack.submit));
    // 되돌아와서 한 번 더 누를 수 있다
    await waitFor(() => expect(screen.getByText(SEAT.ack.submit)).toBeTruthy());
  });

  it("★ 이미 확인한 사람은 홈에서 다시 열 수 있다", async () => {
    /*
     * 늦게 도착해 앱을 처음 켠 사람에게 전체 화면이 덮치면 **반사적으로 누르기 쉽다.**
     * 그때 테이블 번호를 못 읽고 사라진다. 막는 쪽(확인을 어렵게)으로 풀면
     * 나머지 사람이 불편해지므로, 되돌릴 수 있게 한다 (슬라이스 12).
     */
    const opened: boolean[] = [];
    const source = fakeSource({ load: async () => participantState({ seat: { ...seat, acked: true } }) });
    render(
      <MemoryRouter>
        <ParticipantView
          onHelp={() => {}}
          source={source}
          tab="home"
          onTab={() => {}}
          onProfile={() => {}}
          onEdit={() => {}}
          onSeat={(on) => opened.push(on)}
        />
      </MemoryRouter>,
    );
    // 확인했으므로 전체 화면은 안 뜬다
    await screen.findByText(SEAT.banner(2));
    expect(screen.queryByText(SEAT.ack.submit)).toBeNull();

    // 홈의 자리 카드를 누르면 다시 열린다
    fireEvent.click(screen.getByText(SEAT.banner(2)).closest("button")!);
    expect(opened).toEqual([true]);
  });

  it("★ 보여줄 자리가 없는데 주소만 열렸으면 홈으로 갈아끼운다", async () => {
    /*
     * `/e/:code/seat` 를 직접 열거나 새로고침한 뒤 닫으면 뒤로 갈 자리가 없다 —
     * `navigate(-1)` 은 앱을 벗어난다. iOS 는 가장자리 스와이프가 뒤로 가기라 더 쉽게 걸린다.
     * 편집 라우트가 같은 이유로 `replace` 를 쓴다 (ADR-31).
     */
    const calls: Array<[boolean, boolean | undefined]> = [];
    render(
      <MemoryRouter>
        <ParticipantView
          onHelp={() => {}}
          source={fakeSource()}
          tab="home"
          seatOpen
          onTab={() => {}}
          onProfile={() => {}}
          onEdit={() => {}}
          onSeat={(on, opts) => calls.push([on, opts?.replace])}
        />
      </MemoryRouter>,
    );
    // 픽스처에는 자리가 없다 — 뒤로 가기가 아니라 갈아끼우기여야 한다
    await waitFor(() => expect(calls).toEqual([[false, true]]));
  });

  it("★ 다시 연 화면에서는 확인을 다시 받지 않는다", async () => {
    // 이미 센 사람을 또 세면 `acks` 가 "이 자리를 안다" 라는 뜻을 잃는다
    const source = fakeSource({ load: async () => participantState({ seat: { ...seat, acked: true } }) });
    render(
      <MemoryRouter>
        <ParticipantView
          onHelp={() => {}}
          source={source}
          tab="home"
          seatOpen
          onTab={() => {}}
          onProfile={() => {}}
          onEdit={() => {}}
          onSeat={() => {}}
        />
      </MemoryRouter>,
    );
    await screen.findByText(SEAT.ack.headline(2));
    expect(screen.queryByText(SEAT.ack.submit)).toBeNull();
    expect(screen.getByText(BTN.close)).toBeTruthy();
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
        <ParticipantView source={source} tab="fortune" onTab={() => {}} onProfile={() => {}} onEdit={() => {}} onSeat={() => {}} onHelp={() => {}} />
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
    // 미션은 **운세 카드 안**에 있다. 호출이 둘이라고 카드가 둘일 이유는 없다
    expect(screen.getByText("요즘 자주 듣는 노래를 물어보세요")).toBeTruthy();
  });

  it("★ 미션이 아직 없으면 뒤집을 카드가 그 자리에 있다", async () => {
    /*
     * 미션은 **누르는 그 순간에** 만든다. 이미 만들어 둔 걸 감췄다 보여주는 게 아니다 —
     * 여는 동작이 있어야 그 한 줄이 오늘 것처럼 읽힌다 (ADR-20).
     */
    renderFortune(
      party({ fortune: { headline: "천천히 걷는 밤", body: "본문", color: "violet", at: 1 } }),
    );
    await screen.findByText("천천히 걷는 밤");
    expect(screen.getByText(FORTUNE.missionOpen)).toBeTruthy();
    // 아직 만들지 않았으니 열린 미션 블록은 없다
    // (문구로 찾으면 안 된다 — `오늘의 미션 열기` 가 `오늘의 미션` 을 품고 있다)
    expect(document.querySelector(".fortuneMission.opened")).toBeNull();
  });

  it("★ 뒤집으면 그 자리에서 미션을 받아 온다", async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        asked.push(String(url));
        return new Response(
          JSON.stringify({
            headline: "천천히 걷는 밤",
            body: "본문",
            lead: "오늘은 먼저 건넨 한마디가 오래 남아요.",
            mission: "이름을 물어보세요",
            color: "violet",
            at: 1,
          }),
          { headers: { "content-type": "application/json" } },
        );
      }),
    );
    renderFortune(
      party({ fortune: { headline: "천천히 걷는 밤", body: "본문", color: "violet", at: 1 } }),
    );
    fireEvent.click(await screen.findByText(FORTUNE.missionOpen));

    await screen.findByText("이름을 물어보세요");
    expect(asked).toContain("/api/fortune/mission");
    // **왜 오늘 이것인지가 함께 온다.** 한 줄만 던지면 남이 준 숙제로 읽힌다
    expect(screen.getByText("오늘은 먼저 건넨 한마디가 오래 남아요.")).toBeTruthy();
    // 뒤집힌 자리에는 버튼이 없다
    expect(screen.queryByText(FORTUNE.missionOpen)).toBeNull();
    vi.unstubAllGlobals();
  });

  it("★ 옛 저장본에는 이유가 없다 — 그때는 미션 한 줄만 그린다", async () => {
    /*
     * `lead` 는 나중에 생긴 칸이다. 그 전에 열어둔 운세에는 없고,
     * 한 번 연 운세는 다시 만들지 않으므로 (ADR-20) 영영 없다.
     * 빈 자리를 남기거나 대신할 문장을 지어내면 그 순간 거짓말이 된다.
     */
    renderFortune(
      party({ fortune: { headline: "h", body: "b", mission: "이름을 물어보세요", color: "violet", at: 1 } }),
    );
    await screen.findByText("이름을 물어보세요");
    expect(document.querySelector(".missionLead")).toBeNull();
    expect(document.querySelector(".missionLine")).toBeTruthy();
  });

  it("★ 점수를 보여주지 않는다", async () => {
    renderFortune(
      party({
        fortune: {
          headline: "h",
          body: "b",
          mission: "m",
          color: "gold",
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
          charms: ["매력가", "매력나", "매력다"],
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

  /** 매칭 한 건을 통째로 갈아끼운다 — 연락처가 얼마나 열렸는지에 따라 화면이 달라진다 (ADR-37) */
  const revealedWith = (match: MyPokeState["matches"][number]) =>
    fakeSource({
      load: async () =>
        participantState({
          event: { ...participantState().event, phase: "done" },
          poke: { ...matched, matches: [match] },
        }),
    });

  /**
   * 둘 중 한 명이라도 `안 열기` 를 골랐을 때 (ADR-37). 서버가 `contact` 를 아예 안 보낸다 —
   * 화면은 그걸 그대로 그린다.
   */
  it("★ 연락처가 안 열린 매칭에서는 번호도 인스타도 없다", async () => {
    const closed = revealedWith({ ...matched.matches[0], contact: undefined });
    renderParticipant(closed, "her");

    // 먼저 기다린다 — 동기 조회를 앞에 두면 아직 안 그려진 화면을 재게 된다
    await screen.findByText(REVEAL.contactClosed);
    // 매칭 자체는 그대로 보인다 — 좁아진 건 연락처뿐이다
    expect(screen.getAllByText(new RegExp(REVEAL.matchBadge)).length).toBeGreaterThan(0);
    expect(screen.queryByText("01055556666"), "번호가 남아 있다").toBeNull();
    expect(screen.queryByText("@her_gram"), "인스타가 남아 있다").toBeNull();
    // 연락처 라벨 자체가 없다 — 빈 '연락처' 칸은 고장 난 화면으로 읽힌다
    expect(screen.queryByText(REVEAL.contactTitle)).toBeNull();
    // "상대에게도 같은 만큼 보여요" 는 열린 게 있을 때만 참이다
    expect(screen.queryByText(REVEAL.contactNote)).toBeNull();
  });

  it("★ 연락처가 안 열린 이유를 상대 탓으로 말하지 않는다", async () => {
    /*
     * `상대가 열지 않았어요` 는 **이름 붙은 거절**이다. 서로 콕 찌른 사이라 상대가 누구인지
     * 이미 아는 화면이라, 그 한 줄이 이 앱이 없애려는 경험을 그대로 만든다 (ADR-37).
     * 그래서 문구는 **등록할 때 미리 고른 값**이라는 것만 말한다.
     */
    for (const word of ["상대가", "거절", "수락"]) {
      expect(REVEAL.contactClosed, `'${word}' 가 들어 있다`).not.toContain(word);
    }
    expect(REVEAL.contactClosed, "미리 고른 값이라는 걸 말해야 한다").toContain("등록");
  });

  it("★ 인스타까지만 열린 매칭에는 번호 줄이 없다", async () => {
    const igOnly = revealedWith({
      ...matched.matches[0],
      contact: { realName: "이실명", instagram: "her_gram" },
    });
    renderParticipant(igOnly, "her");

    // 인스타는 멀쩡히 열린다 — 좁아진 건 번호뿐이다
    await screen.findByText("@her_gram");
    expect(screen.getByText("이실명")).toBeTruthy();
    expect(screen.queryByText("01055556666"), "번호가 남아 있다").toBeNull();
    expect(screen.queryByText(ME.labels.phone), "번호 줄이 빈 채로 남아 있다").toBeNull();
    // 없는 줄은 그냥 없다 — 왜 없는지 적으면 멀쩡한 인스타가 실패처럼 보인다
    expect(screen.queryByText(REVEAL.contactClosed)).toBeNull();
  });

  it("★ 발표 후에는 콕 버튼이 아예 없다 — 잠긴 버튼도 남기지 않는다", async () => {
    /*
     * 아직 안 열린 것(등록 중 = 잠김)과 끝난 것(발표 후 = 없음)은 다르다.
     * 끝난 뒤의 잠긴 버튼은 "곧 열린다" 는 거짓말이 된다.
     */
    renderParticipant(revealed());
    await screen.findByText(/그녀/);
    expect(screen.queryAllByLabelText(POKE.confirm.submit("pre"))).toHaveLength(0);
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

// ─────────────────────────────────────────── 두 회차

describe("한 폰으로 두 회차", () => {
  /**
   * 한 브라우저에 참가자 세션은 하나뿐이다. 다음 회차에 등록하면 앞의 세션이 덮인다.
   * 그때 앞 회차 주소를 열면 서버가 401 을 준다 (자료 격리는 서버 테스트가 지킨다).
   */
  it("★ 코드로 회차를 되찾지 않는다 — 되돌아가는 길은 참가 링크다", async () => {
    /*
     * 예전에는 여기서 `by-code` 로 코드를 회차 아이디로 바꿔 문 앞에 보냈다.
     * 그 길을 닫았다 — **코드로 회차를 찾는 창구가 곧 링크를 내주는 창구**였기 때문이다.
     * 화면은 이제 그 사실을 말하고 멈춘다.
     */
    const fetched = vi.fn(async (...args: unknown[]) => {
      void args;
      return new Response("{}", { headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetched);
    const source = fakeSource({
      load: async () => {
        throw new ApiError(401, "unauthorized", ENTRY.notFound);
      },
    });
    render(
      <MemoryRouter initialEntries={["/e/ABCDEF"]}>
        <ParticipantView source={source} tab="home" code="ABCDEF" onTab={() => {}} onProfile={() => {}} onEdit={() => {}} onSeat={() => {}} onHelp={() => {}} />
      </MemoryRouter>,
    );

    await screen.findByText(ENTRY.notFound);
    // 코드를 회차로 바꾸려 서버에 묻지 않는다
    for (const call of fetched.mock.calls) expect(String(call[0])).not.toContain("by-code");
  });

  afterEach(() => vi.unstubAllGlobals());
});

// ─────────────────────────────────────────── 참가 링크 재방문

describe("참가 링크", () => {
  /**
   * 링크가 곧 신원이다 (ADR-32). **번호 칸은 없다** —
   * 번호를 아는 사람이 그 사람이 될 수 있던 구멍을 그렇게 닫았다 (ADR-15 후기 2).
   *
   * 운영자는 사람마다 다른 링크를 1:1 로 보내고, 참가자는 그 링크를 계속 다시 연다.
   * 등록을 마친 사람에게 등록 화면을 다시 보여주면 "내가 등록이 안 됐나?" 하고
   * 두 번 등록하려 든다. 실제로 나온 신고다.
   */
  function renderJoin() {
    const router = createMemoryRouter(
      [
        { path: "/j/:id/:token", element: <Join /> },
        { path: "/j/:id/:token/register/:step", element: <div>{SCREEN_TITLE.register}</div> },
        { path: "/e/:code", element: <div>참가자 화면</div> },
      ],
      { initialEntries: ["/j/e1/tok123"] },
    );
    return render(<RouterProvider router={router} />);
  }

  function stubGate(enter: { status: number; body: unknown }) {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
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
    return calls;
  }

  it("★ 번호를 묻지 않는다 — 링크를 열고 누르면 등록으로 간다", async () => {
    stubGate({ status: 200, body: { registered: false } });
    renderJoin();

    // 방이 보인다
    await screen.findByText("테스트 파티");
    // 등록으로 가는 문은 아직 닫혀 있다
    expect(screen.queryByText(SCREEN_TITLE.register)).toBeNull();
    // **번호 칸이 없다.** 있으면 지인이 남의 번호로 그 사람이 될 수 있다
    expect(document.querySelector('input[inputmode="tel"]')).toBeNull();

    fireEvent.click(screen.getByText(ENTRY.start));
    expect(await screen.findByText(SCREEN_TITLE.register)).toBeTruthy();
  });

  it("★ 회차 조회도 토큰을 싣는다 — 아이디만으로 열리면 안 된다", async () => {
    const calls = stubGate({ status: 200, body: { registered: false } });
    renderJoin();
    await screen.findByText("테스트 파티");

    const info = calls.find((u) => u.includes("/events/by-id/"));
    expect(info).toContain("t=tok123");
  });

  it("★ 통하지 않는 링크는 문 앞에서 막힌다", async () => {
    stubGate({ status: 403, body: { error: "not_invited", message: ENTRY.notInvited } });
    renderJoin();
    await screen.findByText("테스트 파티");

    fireEvent.click(screen.getByText(ENTRY.start));

    expect(await screen.findByText(ENTRY.notInvited)).toBeTruthy();
    expect(screen.queryByText(SCREEN_TITLE.register)).toBeNull();
  });

  it("이미 등록한 사람은 등록 폼을 건너뛴다", async () => {
    stubGate({ status: 200, body: { registered: true, code: "ABCDEF" } });
    renderJoin();
    await screen.findByText("테스트 파티");

    fireEvent.click(screen.getByText(ENTRY.start));
    expect(await screen.findByText("참가자 화면")).toBeTruthy();
  });

  it("★ 등록을 마친 뒤 뒤로 가도 등록 폼이 다시 뜨지 않는다", async () => {
    /*
     * 완료할 때 `replace` 로 갈아끼우는 건 **마지막 스텝 한 칸뿐**이다.
     * 스텝은 `push` 로 쌓이므로(`이전` 버튼이 그 히스토리를 쓴다) 1·2 스텝이 남는다.
     * 홈에서 뒤로 가면 그 칸을 밟는데, 다 채워진 것처럼 보이는 폼을 보면 두 번 등록하려 든다.
     */
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/me")
          ? new Response(JSON.stringify(participantState()), {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          : new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
      ),
    );
    const router = createMemoryRouter(
      [
        { path: "/j/:id/:token/register/:step", element: <Register /> },
        { path: "/e/:code", element: <div>참가자 화면</div> },
      ],
      // 뒤로 가서 2스텝을 밟은 상태
      { initialEntries: ["/j/e1/tok123/register/2"] },
    );
    render(<RouterProvider router={router} />);

    await screen.findByText("참가자 화면");
    // 폼은 한 번도 보이지 않는다
    expect(screen.queryByText(SCREEN_TITLE.register)).toBeNull();
  });

  it("★ 세션이 살아 있으면 등록 화면이 아니라 자기 화면으로 간다", async () => {
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
   * 답하는 질문은 하나다 — **"내가 지금 어느 파티의 어느 단계에 있나."**
   * 헤더는 스크롤되지 않아 어느 탭에서든 계속 보이므로 자리값이 비싸다.
   */
  it("★ 회차 이름과 단계는 어느 탭에서든 보인다", async () => {
    for (const tab of ["home", "people", "me"] as const) {
      cleanup();
      renderParticipant(fakeSource(), undefined, () => {}, tab);
      await screen.findByText(PHASE_LABEL.prevote);
      expect(screen.getByText("테스트 파티")).toBeTruthy();
    }
  });

  it("★ 카운트다운은 상단 바에 없다 — 홈의 할 일 카드가 맡는다", async () => {
    /*
     * 카운트다운이 세는 건 늘 **다음에 일어날 일**이지 지금 하는 일의 마감이 아니다
     * (사전 투표 마감은 운영자가 눌러서 셀 수 있는 시각이 없다 — ADR-14).
     * 그건 "지금 무슨 일이고 내가 뭘 하면 되나" 에 답하는 홈의 질문이다.
     *
     * 여기 있던 시절의 대가는 **회차 이름**이 치렀다 — 오른쪽 열이 제 폭을 붙들고 있어
     * 390px 폰에서 이름 칸이 219px 뿐이었다.
     */
    renderParticipant(fakeSource(), undefined, () => {}, "people");
    await screen.findByText(PHASE_LABEL.prevote);
    expect(screen.queryByText(STATUS.untilParty)).toBeNull();
    expect(screen.queryByText(/^\d{2}:\d{2}:\d{2}$/)).toBeNull();
  });
  it("★ 남은 콕은 한 곳에만 — 콕을 찌르는 화면", async () => {
    renderParticipant(fakeSource());
    await screen.findByText(/그녀/);
    // 내 카드 오른쪽 칸 하나뿐이다 (예산 3, 1회 씀 → 2회 남음)
    expect(screen.getAllByText(PEOPLE.pokeLeftLabel("pre"))).toHaveLength(1);
    expect(screen.getAllByText(UNIT.times(2))).toHaveLength(1);
  });

  it("★ 회차 이름이 길어도 옆의 것을 밀어내지 않는다", async () => {
    /*
     * 실기기에서 났던 것 — `108th TONE PARTY🔥 …` 처럼 이름이 길면 옆의 것들이 다 같이
     * 쪼그라들어 `1명` 도 `파티까지` 도 두 줄로 접혔다. **줄어드는 건 이름 하나뿐이어야 한다.**
     *
     * 카운트다운이 홈으로 간 뒤로 옆에 서는 건 도움말 버튼이다. 규칙은 그대로다 —
     * 그 버튼은 손가락이 닿는 크기(`--tap`)를 지켜야 하므로 이름에 양보하면 안 된다.
     */
    renderParticipant(
      fakeSource({
        load: async () =>
          participantState({
            event: { ...participantState().event, name: "108th TONE PARTY🔥 아주아주 긴 회차 이름입니다" },
          }),
      }),
    );
    const name = await screen.findByText(/108th TONE PARTY/);
    // 이름과 도움말이 **다른 칸**에 있다. 한 칸에 있으면 같이 줄어든다
    expect(name.closest(".where")).toBeTruthy();
    const help = screen.getByLabelText(HELP.open);
    expect(help.closest(".where")).toBeNull();
    expect(name.closest(".statusbar")).toBe(help.closest(".statusbar"));
  });

  it("★ 인원 수는 홈 탭에만 있다", async () => {
    /*
     * 상단 바에도, 참가자 탭 필터에도 두지 않는다.
     * 필터가 답하는 건 "누구를 볼까" 하나고, "몇 명 모였나" 는 홈이 맡는다.
     */
    renderParticipant(fakeSource());
    await screen.findByText(/그녀/);
    expect(document.querySelector(".statusbar")?.textContent).not.toContain("2");
    expect(document.querySelector(".choice")?.textContent).not.toContain("2");
  });

  it("켜져 있는 쪽이 먼저 읽힌다 — '전체' 가 왼쪽이다", async () => {
    // 기본값은 전체다 (ADR-17). 기본이 오른쪽에 있으면 눈이 한 번 더 확인한다
    renderParticipant(fakeSource());
    await screen.findByText(/그녀/); // 자료가 올라온 뒤에 센다
    const buttons = [...document.querySelectorAll(".choice button")].map((b) => b.textContent?.trim());
    expect(buttons[0]).toContain(PEOPLE.everyone);
    expect(buttons[1]).toContain(PEOPLE.onlyOpposite);
  });

  it("★ 회차 이름은 상단 바 한 곳에만 있다", async () => {
    // 어느 탭에 있든 보인다 — "내가 지금 어느 파티에 있나" 는 아무 때나 확인하고 싶은 것이다
    const { rerender } = renderParticipant(fakeSource());
    await screen.findByText(PHASE_LABEL.prevote);
    expect(screen.getAllByText("테스트 파티")).toHaveLength(1);

    // 내 정보 탭으로 옮겨도 여전히 한 곳뿐이다 (예전에는 그 탭 안에 또 있었다)
    rerender(
      <MemoryRouter>
        <ParticipantView source={fakeSource()} tab="me" onTab={() => {}} onProfile={() => {}} onEdit={() => {}} onSeat={() => {}} onHelp={() => {}} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getAllByText("테스트 파티")).toHaveLength(1));
  });

  it("★ 내 정보 탭에는 라운드도 보낸 콕도 없다", async () => {
    // 라운드는 상단 바가, 콕 숫자는 참가자 탭이 맡는다
    render(
      <MemoryRouter>
        <ParticipantView source={fakeSource()} tab="me" onTab={() => {}} onProfile={() => {}} onEdit={() => {}} onSeat={() => {}} onHelp={() => {}} />
      </MemoryRouter>,
    );
    await screen.findByText(ME.labels.nickname);
    expect(screen.queryByText(/보낸 콕/)).toBeNull();
    expect(screen.queryByText(/라운드/)).toBeNull();
  });
});

// ─────────────────────────────────────────── 키보드가 가린 높이

/**
 * `position: fixed; bottom: 0` 은 **레이아웃 뷰포트** 기준이라 키보드가 떠도 안 움직인다.
 * 운영자가 입장 명단에 번호를 넣을 때 시트가 통째로 키보드 뒤로 들어갔다.
 *
 * 안드로이드는 뷰포트 메타(`interactive-widget=resizes-content`)가 맡지만
 * **iOS 사파리는 그 속성을 모른다** — 거기서는 이 값이 유일한 단서라 계산이 틀리면 조용히 가려진다.
 */
describe("키보드가 가린 높이", () => {
  function Probe() {
    useKeyboardInset();
    return null;
  }
  const kb = () => document.documentElement.style.getPropertyValue("--kb");

  /** 시각 뷰포트를 흉내낸다. happy-dom 에는 visualViewport 가 없다 */
  function fakeViewport(height: number, offsetTop = 0) {
    const listeners: Array<() => void> = [];
    const vv = {
      height,
      offsetTop,
      addEventListener: (_: string, fn: () => void) => listeners.push(fn),
      removeEventListener: () => {},
      fire: () => listeners.forEach((fn) => fn()),
      set: (h: number, top = 0) => {
        vv.height = h;
        vv.offsetTop = top;
        vv.fire();
      },
    };
    vi.stubGlobal("visualViewport", vv);
    return vv;
  }

  afterEach(() => {
    document.documentElement.style.removeProperty("--kb");
    vi.unstubAllGlobals();
  });

  it("★ 키보드가 뜨면 가린 높이만큼 값이 생긴다", () => {
    const vv = fakeViewport(window.innerHeight);
    render(<Probe />);
    expect(kb()).toBe("0px");

    // 키보드 300px 이 올라왔다
    vv.set(window.innerHeight - 300);
    expect(kb()).toBe("300px");
  });

  it("★ 위로 밀린 만큼을 두 번 세지 않는다", () => {
    /*
     * iOS 는 키보드가 뜰 때 시각 뷰포트를 위로 밀기도 한다. 그만큼은 이미 화면이 스크롤된 것이라
     * 두 번 세면 시트가 필요 이상으로 떠서 위쪽이 화면 밖으로 나간다.
     */
    const vv = fakeViewport(window.innerHeight);
    render(<Probe />);
    vv.set(window.innerHeight - 300, 100);
    expect(kb()).toBe("200px");
  });

  it("키보드가 내려가면 0 으로 돌아온다", () => {
    const vv = fakeViewport(window.innerHeight - 300);
    render(<Probe />);
    expect(kb()).toBe("300px");

    vv.set(window.innerHeight);
    expect(kb()).toBe("0px");
  });

  it("시각 뷰포트를 모르는 브라우저에서도 화면이 죽지 않는다", () => {
    vi.stubGlobal("visualViewport", undefined);
    expect(() => render(<Probe />)).not.toThrow();
  });
});

// ─────────────────────────────────────────── 참가자 탭의 내 카드

/**
 * 필터 위의 내 카드가 답하는 건 **"내가 남들에게 어떻게 보이나"** 하나다.
 * 그래서 남들이 보는 것보다 더 보여주면 그 순간 답이 틀린다.
 */
describe("참가자 탭 · 내 카드", () => {
  const at = (phase: ParticipantState["event"]["phase"]) =>
    renderParticipant(
      fakeSource({
        load: async () =>
          participantState({
            event: { ...participantState().event, phase },
            // 서버는 등록 중에 명단을 아예 안 내려준다 (ADR-21) — 픽스처도 그래야 한다
            ...(phase === "reg" || phase === "prep" ? { roster: [] } : {}),
          }),
      }),
    );

  it("★ 사전 투표에서는 닉네임과 매력만 — 나이·MBTI 는 남들도 못 본다", async () => {
    at("prevote");
    await screen.findByText(PEOPLE.mine);

    // 내 것: 닉네임 "달빛" · 매력 "하나". 나이 30 과 MBTI 는 아직 아무 데도 없다
    expect(screen.getByText("하나")).toBeTruthy();
    expect(screen.queryByText("30")).toBeNull();
    // 실명·전화·인스타는 어느 단계에도 이 탭에 없다
    for (const secret of ["김나", "01000000000", "na_gram"]) {
      expect(screen.queryByText(secret), secret).toBeNull();
    }
  });

  it("★ 파티가 시작되면 나이와 MBTI 도 함께 보인다", async () => {
    at("party");
    await screen.findByText(PEOPLE.mine);
    expect(screen.getAllByText("30").length).toBeGreaterThan(0);
  });

  it("★ 등록 중에는 사전 투표 때 모습을 미리 보여준다", async () => {
    /*
     * toPublic(me, "reg") 를 그대로 부르면 나이가 나온다 — 정작 사전 투표에서는 안 보이는데.
     * "이렇게 보여요" 라고 말하는 자리에서 그러면 거짓말이 된다.
     */
    at("reg");
    await screen.findByText(PEOPLE.mine);
    expect(screen.queryByText("30")).toBeNull();
    // 남의 명단은 여전히 비어 있고, 그 사실을 말하는 문구도 그대로다 (줄바꿈이 있어 첫 줄로 찾는다)
    expect(screen.getByText(new RegExp(PEOPLE.notOpenYet.split("\n")[0]))).toBeTruthy();
    // 볼 사람이 없으면 목록 머리 줄도 없다
    expect(screen.queryByText(PEOPLE.agesAtParty)).toBeNull();
  });

  it("★ 내 카드와 남들 카드의 오른쪽 끝이 맞는다", async () => {
    /*
     * 남들 줄은 [카드][👉], 내 줄은 [카드][남은 콕] 이라 **오른쪽 칸이 양쪽에 다 있다**.
     * 내 줄에만 칸이 없으면 내 카드만 넓어져 목록이 들쭉날쭉해 보인다.
     */
    renderParticipant(fakeSource());
    const mineRow = (await screen.findByText(PEOPLE.mine)).closest(".row");
    expect(mineRow?.querySelector(".mineCell")).toBeTruthy();
    expect(mineRow?.querySelector(".person.grow")).toBeTruthy();
  });

  it("★ '나' 는 아바타에 붙고 이름 줄은 건드리지 않는다", async () => {
    // 이름 줄은 닉네임·나이·MBTI 로 이미 꽉 차 있다. 동물은 그대로 둔다 (ADR-30)
    renderParticipant(fakeSource());
    const tag = await screen.findByText(PEOPLE.mine);
    expect(tag.closest(".avatarMine")).toBeTruthy();
    expect(tag.closest(".name")).toBeNull();
  });

  it("★ 감출 게 없어지면 안내가 사라진다", async () => {
    // 파티가 시작되면 나이·MBTI 를 볼 수 있다 — 그때는 할 말이 없다
    at("party");
    await screen.findByText(PEOPLE.mine);
    expect(screen.queryByText(PEOPLE.agesAtParty)).toBeNull();
  });

  it("★ 이성만 보기를 켜도 내 카드는 사라지지 않는다", async () => {
    renderParticipant(fakeSource());
    await screen.findByText(PEOPLE.mine);

    // 나는 남성이고 목록의 '그녀'는 여성이다 — 필터를 켜면 그녀만 남아야 하지만 나는 남는다
    fireEvent.click(screen.getByText(PEOPLE.onlyOpposite));
    expect(screen.getByText(PEOPLE.mine)).toBeTruthy();
  });

  it("★ 필터는 내 카드 아래, 목록 위에 있다", async () => {
    /*
     * 필터가 다스리지 않는 것(내 카드)이 필터와 목록 사이에 있으면
     * `이성만` 을 눌러도 내가 남아 있어 **필터가 안 먹은 것으로** 읽힌다.
     * 거르는 버튼은 걸러지는 것 바로 위에 있어야 한다.
     */
    const { container } = renderParticipant(fakeSource());
    const mineRow = (await screen.findByText(PEOPLE.mine)).closest(".row")!;
    const filter = container.querySelector(".choice")!;
    const others = screen.getByText("그녀").closest(".row")!;

    // DOCUMENT_POSITION_FOLLOWING(4) — 뒤에 온다
    expect(mineRow.compareDocumentPosition(filter) & 4).toBeTruthy();
    expect(filter.compareDocumentPosition(others) & 4).toBeTruthy();
  });

  it("★ 이성이 하나도 없어도 필터는 남는다 — 돌아갈 길이 있어야 한다", async () => {
    /*
     * 거를 게 없으면 필터를 감추지만, 판단은 **거르기 전 명단**으로 한다.
     * 걸러진 결과가 0명이라고 감추면 `전체` 로 돌아갈 버튼째 사라져 화면이 잠긴다.
     */
    const { container } = renderParticipant(
      fakeSource({
        // 나도 남성, 명단도 남성 하나뿐 — `이성만` 은 0명이 된다
        load: async () =>
          participantState({
            roster: [
              { id: "him", nickname: "그남", age: 31, gender: "M", mbti: "ISTJ", charms: ["매력가", "매력나", "매력다"] },
            ],
          }),
      }),
    );
    await screen.findByText("그남");

    fireEvent.click(screen.getByText(PEOPLE.onlyOpposite));
    expect(screen.queryByText("그남")).toBeNull();
    expect(container.querySelector(".choice")).toBeTruthy();

    // 되돌아갈 수 있다
    fireEvent.click(screen.getByText(PEOPLE.everyone));
    expect(screen.getByText("그남")).toBeTruthy();
  });

  it("★ 볼 명단이 아예 없으면 필터도 없다", async () => {
    // 사전 투표 전에는 명단이 안 내려온다 (ADR-21). 거를 게 없는데 거르는 버튼만 떠 있을 이유가 없다
    const { container } = at("reg");
    await screen.findByText(PEOPLE.mine);
    expect(container.querySelector(".choice")).toBeNull();
  });

  it("★ 내 카드를 누르면 내 정보 탭으로 간다", async () => {
    /*
     * 남들 카드는 눌러서 프로필 시트를 연다. 내 카드는 그 시트를 열 수 없고
     * (시트는 `roster` 에서 상대를 찾는데 거기 나는 없다), 그렇다고 혼자 안 눌리면
     * 여기서 더 보고 싶은 것(매력 전문·내가 낸 것 전부)이 어디 있는지 알 길이 없다.
     */
    const went: string[] = [];
    renderParticipant(fakeSource(), undefined, (t) => went.push(t));
    fireEvent.click((await screen.findByText(PEOPLE.mine)).closest("button")!);
    expect(went).toEqual(["me"]);
  });

  it("★ 어디로 가는지 글자로 말한다 — 카드 내용을 덮지 않는다", async () => {
    /*
     * 화살표를 붙이면 이 줄만 남들 카드보다 더 눌러도 되는 것처럼 보인다.
     * 그렇다고 `aria-label` 로 덮으면 "내가 남들에게 어떻게 보이나" 가
     * 스크린리더에게만 사라진다 — 하필 이 카드가 있는 이유가 그건데.
     */
    renderParticipant(fakeSource());
    const card = (await screen.findByText(PEOPLE.mine)).closest("button")!;
    expect(card.getAttribute("aria-label")).toBeNull();
    expect(card.querySelector(".srOnly")?.textContent).toBe(PEOPLE.mineOpen);
    // 닉네임과 매력은 그대로 읽힌다
    expect(card.textContent).toContain("달빛");
    expect(card.textContent).toContain("하나");
  });

  it("★ 내 카드에는 콕 버튼이 없다", async () => {
    renderParticipant(fakeSource());
    await screen.findByText(PEOPLE.mine);
    // 목록에는 '그녀' 하나뿐이니 콕 버튼도 하나뿐이어야 한다 — 내 것이 생기면 둘이 된다
    expect(screen.getAllByLabelText(POKE.confirm.submit("pre")).length).toBe(1);
  });
});

// ─────────────────────────────────────────── 내 정보 고치기

/**
 * 고치는 길은 **하나뿐이다** (ADR-31). 기본 정보와 매력이 함께 폼이 되고,
 * 사전 투표가 열리면 함께 잠긴다. 전화번호는 그 폼에 들어가지 않는다 (ADR-15).
 */
describe("내 정보 고치기", () => {
  /**
   * 편집은 라우트다 — 진짜 히스토리 위에서 본다.
   * 편집 모드를 화면 상태로만 들면 뒤로 가기가 탭을 벗어나면서 고치던 입력이 사라진다.
   */
  const renderMe = (
    over: Partial<ParticipantState> = {},
    src?: ReturnType<typeof fakeSource>,
    at = "/e/ABCDEF/me",
  ) => {
    const source = src ?? fakeSource({ load: async () => participantState(over) });
    function View() {
      const location = useLocation();
      const navigate = useNavigate();
      return (
        <ParticipantView
          onHelp={() => {}}
          source={source}
          tab="me"
          onSeat={() => {}}
          editing={location.pathname.endsWith("/me/edit")}
          onEdit={(on, opts) =>
            on
              ? navigate("/e/ABCDEF/me/edit")
              : opts?.replace
                ? navigate("/e/ABCDEF/me", { replace: true })
                : navigate(-1)
          }
          onTab={() => {}}
          onProfile={() => {}}
        />
      );
    }
    const router = createMemoryRouter(
      [
        { path: "/e/:code/me", element: <View /> },
        { path: "/e/:code/me/edit", element: <View /> },
      ],
      { initialEntries: [at] },
    );
    render(<RouterProvider router={router} />);
    return { router, source };
  };

  /** 등록 중인 회차. 명단이 아직 열리지 않아 아무도 내 정보를 보지 않았다 */
  const reg = { event: { ...participantState().event, phase: "reg" as const } };

  it("★ 고치기는 하나뿐이고, 기본 정보와 매력이 함께 폼이 된다", async () => {
    renderMe(reg);
    fireEvent.click(await screen.findByText(ME.edit));

    // 한 번 눌렀는데 둘 다 폼이 됐다
    expect(screen.getByLabelText(ME.labels.nickname)).toBeTruthy();
    expect(screen.getByLabelText(`${ME.labels.charms} 1`)).toBeTruthy();
    // 저장도 하나다 — 매력만 따로 저장하는 버튼은 없다
    expect(screen.getAllByText(BTN.save).length).toBe(1);
  });

  it("★ 전화번호는 편집 모드에서도 칸이 아니다", async () => {
    renderMe(reg);
    fireEvent.click(await screen.findByText(ME.edit));

    // 파티의 문이라 고칠 수 없다 — 값은 보이되 입력 칸은 없다
    expect(screen.queryByLabelText(ME.labels.phone)).toBeNull();
    expect(screen.getByText(ME.phoneFixed)).toBeTruthy();
  });

  it("★ 사전 투표가 열린 뒤에는 왜 못 고치는지 말한다", async () => {
    // 버튼만 조용히 사라지면 "내 화면만 이상한가" 가 된다
    renderMe();
    await screen.findByText(ME.locked);
    expect(screen.queryByText(ME.edit)).toBeNull();
  });

  it("★ 뒤로 가기가 곧 취소다 — 탭을 벗어나지 않는다", async () => {
    const { router } = renderMe(reg);
    fireEvent.click(await screen.findByText(ME.edit));
    fireEvent.change(screen.getByLabelText(ME.labels.nickname), { target: { value: "버려질닉" } });

    // 안드로이드 백 버튼. 편집만 닫히고 내 정보 탭에 남는다
    await router.navigate(-1);
    await screen.findByText(ME.edit);
    expect(router.state.location.pathname).toBe("/e/ABCDEF/me");
    expect(screen.queryByLabelText(ME.labels.nickname)).toBeNull();

    // 고치던 입력은 버려졌다 — 취소 버튼과 같다
    fireEvent.click(screen.getByText(ME.edit));
    expect((screen.getByLabelText(ME.labels.nickname) as HTMLInputElement).value).toBe("달빛");
  });

  it("잠긴 뒤에 편집 주소를 열면 내 정보로 되돌린다", async () => {
    // 링크·새로고침·편집 중 단계 전환 — 고칠 수 없는 폼을 띄우지 않는다
    const { router } = renderMe({}, undefined, "/e/ABCDEF/me/edit");
    await screen.findByText(ME.locked);
    expect(screen.queryByLabelText(ME.labels.nickname)).toBeNull();
    await waitFor(() => expect(router.state.location.pathname).toBe("/e/ABCDEF/me"));
  });

  it("고친 것을 저장하면 통로로 나간다", async () => {
    const src = fakeSource({ load: async () => participantState(reg) });
    renderMe(reg, src);
    fireEvent.click(await screen.findByText(ME.edit));

    fireEvent.change(screen.getByLabelText(ME.labels.nickname), { target: { value: "고친닉" } });
    fireEvent.click(screen.getByText(BTN.save));

    await waitFor(() => expect(src.calls.saved.length).toBe(1));
    // 전화번호는 보낸 것에도 없다 — 입력 모양에 자리가 없다
    expect(src.calls.saved[0].nickname).toBe("고친닉");
    expect(Object.keys(src.calls.saved[0])).not.toContain("phone");
  });

  it("취소하면 고치던 입력이 버려진다", async () => {
    renderMe(reg);
    fireEvent.click(await screen.findByText(ME.edit));
    fireEvent.change(screen.getByLabelText(ME.labels.nickname), { target: { value: "버려질닉" } });
    fireEvent.click(screen.getByText(BTN.cancel));

    // 다시 들어가면 저장돼 있던 값이다
    fireEvent.click(await screen.findByText(ME.edit));
    expect((screen.getByLabelText(ME.labels.nickname) as HTMLInputElement).value).toBe("달빛");
  });

  it("닉네임이 겹치면 그 칸에 알리고 입력값은 지우지 않는다", async () => {
    const src = fakeSource({
      load: async () => participantState(reg),
      saveProfile: async () => {
        throw new ApiError(409, "nick_taken", REGISTER.err.nickTaken("겹친닉"));
      },
    });
    renderMe(reg, src);
    fireEvent.click(await screen.findByText(ME.edit));

    const input = screen.getByLabelText(ME.labels.nickname) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "겹친닉" } });
    fireEvent.click(screen.getByText(BTN.save));

    await screen.findByText(REGISTER.err.nickTaken("겹친닉"));
    // 고치던 화면 그대로다 — 입력값이 살아 있어야 한 글자만 바꿔 다시 저장한다
    expect(input.value).toBe("겹친닉");
  });
});

// ─────────────────────────────────────────── 탭 역할 분담

describe("탭 역할 분담", () => {
  /**
   * 같은 정보가 두 탭에 있으면 어느 쪽이 맞는지 눈이 한 번 더 확인한다.
   * 탭마다 답하는 질문이 하나씩이고 겹치지 않아야 한다.
   */
  const withSeat = { round: 1, table: 2, final: false, mates: 6, men: 3, acked: true };

  /** 그 단계의 상태 한 벌. `event` 는 통째로 갈아끼우는 자리라 기본값에서 떠온다 */
  const inPhase = (phase: ParticipantState["event"]["phase"]): Partial<ParticipantState> => ({
    event: { ...participantState().event, phase, fired: { reg: 1 } },
  });
  const fortuneTab = () => screen.getByText(FORTUNE.tab).closest("button")!;

  const renderTab = (t: "home" | "me" | "people", over: Partial<ParticipantState> = {}) =>
    render(
      <MemoryRouter>
        <ParticipantView
          onHelp={() => {}}
          source={fakeSource({ load: async () => participantState(over) })}
          tab={t}
          onTab={() => {}}
          onProfile={() => {}}
          onEdit={() => {}} onSeat={() => {}}
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

  it("★ 발표 배너는 결과가 있는 탭에는 뜨지 않는다 — 서로를 가리키면 안 된다", async () => {
    /*
     * 배너가 "홈으로 가라" 하고 홈 카드가 "참가자 탭으로 가라" 하면 두 화면이 서로를 가리킨다.
     * 결과는 참가자 탭에 있으므로 (ADR-18) 거기서는 배너를 띄우지 않는다.
     */
    const revealed = {
      event: { ...participantState().event, phase: "done" as const, fired: { reg: 1, prevote: 2, done: Date.now() } },
    };

    renderTab("people", revealed);
    await screen.findByText(PEOPLE.everyone);
    expect(screen.queryByText(NOTICE.done.title)).toBeNull();
    cleanup();

    // 결과를 볼 수 없는 탭에서는 그대로 뜬다 — 알림을 없앤 게 아니라 자리를 가린 것이다
    renderTab("me", revealed);
    await screen.findByText(NOTICE.done.title);
  });

  it("★ 콕을 다 쓰면 할 수 없는 일을 시키지 않는다 — 0 도 들이대지 않는다", async () => {
    renderTab("home", { poke: { ...POKE_STATE, budget: { pre: { max: 1, used: 1 }, party: { max: 2, used: 0 } } } });
    await screen.findByText(HOME.spent.prevote.title);
    expect(screen.queryByText(HOME.todo.prevote.title)).toBeNull();
    expect(screen.queryByText(STATUS.pokeLeft("pre", 0))).toBeNull();
    // 명단 구경은 여전히 된다
    expect(screen.getByText(HOME.goPeople)).toBeTruthy();
  });

  it("★ 받은 콕은 한 번에 하나씩 쌓인다 — 합쳐서 세지 않는다", async () => {
    renderTab("home", { poke: { ...POKE_STATE, receivedCount: 3 } });
    await screen.findByText(HOME.news);
    // 세 번 받았으면 세 줄이다. "지금까지 3회" 한 줄이 아니다
    expect(screen.getAllByText(POKE.received)).toHaveLength(3);

    /* '오늘' 은 맨 오른쪽에 붙는다 — 도중에 끼어들면 옆 탭들이 밀린다 */
    expect(TABS_PARTICIPANT.map((t) => t.key)).toEqual(["home", "people", "me", "fortune"]);
    // 매력 투표 중이라 이미 켜져 있다 (ADR-20 후기)
    expect(fortuneTab().getAttribute("aria-disabled")).toBeNull();
  });

  /**
   * '오늘' 탭은 **없다가 생기지 않는다** (ADR-20 후기).
   *
   * 처음부터 자리를 지키고 매력 투표와 함께 켜진다 — 도중에 생기면 넷이 나눠 쓰던 폭이
   * 통째로 다시 나뉘어, 손가락이 기억한 자리가 어긋난다.
   */
  it("★ 매력 투표 전에도 '오늘' 탭은 자리를 지킨다 — 꺼져 있을 뿐이다", async () => {
    renderTab("home", inPhase("reg"));
    await screen.findByText(FORTUNE.tab);

    expect(document.querySelectorAll(".tabbar button")).toHaveLength(TABS_PARTICIPANT.length);
    expect(fortuneTab().getAttribute("aria-disabled")).toBe("true");
  });

  it("★ 꺼진 '오늘' 탭은 언제 열리는지 말한다 — 눌러도 조용하면 고장으로 읽힌다", async () => {
    renderTab("home", inPhase("reg"));
    await screen.findByText(FORTUNE.tab);

    fireEvent.click(fortuneTab());
    expect(await screen.findByText(FORTUNE.closed)).toBeTruthy();
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

    fireEvent.click(screen.getAllByLabelText(POKE.confirm.submit("pre"))[0]);
    await screen.findByText(POKE.confirm.title("pre", 1));

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText(POKE.confirm.title("pre", 1))).toBeNull());
    expect(source.calls.poke).toEqual([]);
  });

  it("확인창에 읽을 수 있는 이름이 붙는다", async () => {
    renderParticipant(fakeSource());
    await screen.findByText(/그녀/);

    fireEvent.click(screen.getAllByLabelText(POKE.confirm.submit("pre"))[0]);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain(POKE.confirm.title("pre", 1));
  });
});

// ─────────────────────────────────────────── 홈 · 남은 시간

describe("홈 · 남은 시간", () => {
  const home = (source: ParticipantSource) => renderParticipant(source, undefined, () => {}, "home");

  it("★ '무엇까지' 가 붙은 카운트다운이 할 일 카드에 있다", async () => {
    home(fakeSource());
    await screen.findByText(HOME.todo.prevote.title);
    // 숫자만 있으면 무엇을 세는지 알 수 없다
    expect(screen.getByText(STATUS.untilParty)).toBeTruthy();
    expect(screen.getByText(/^\d{2}:\d{2}:\d{2}$/)).toBeTruthy();
  });

  const withSchedule = (phase: "reg" | "prevote", schedule: Record<string, number>) =>
    fakeSource({
      load: async () =>
        participantState({
          event: { ...participantState().event, phase, schedule },
          ...(phase === "reg" ? { roster: [] } : {}),
        }),
    });

  it("★ 등록 중에는 사전 투표까지를 센다 — 다음에 일어날 일이다", async () => {
    /*
     * 한동안 내내 파티만 셌다. 등록 기간이 며칠이라 `1일 2시간` 만 계속 보였고,
     * 정작 참가자가 알고 싶은 건 **언제 콕을 찌를 수 있나** 였다.
     */
    home(withSchedule("reg", { prevoteAt: Date.now() + 1_800_000, partyAt: Date.now() + 90_000_000 }));
    await screen.findByText(HOME.todo.reg.title);
    expect(screen.getByText(STATUS.untilPrevote)).toBeTruthy();
    expect(screen.queryByText(STATUS.untilParty)).toBeNull();
  });

  it("★ 사전 투표 시각이 지났는데 아직 등록 중이면 파티를 센다", async () => {
    /*
     * 예약이 걸려 있어도 운영자가 아직 안 넘겼을 수 있다. 지나간 시각을 세면 음수가 뜨고,
     * 사람은 그 숫자를 **자기 시계가 틀린 걸로** 읽는다.
     */
    home(withSchedule("reg", { prevoteAt: Date.now() - 60_000, partyAt: Date.now() + 3_600_000 }));
    await screen.findByText(HOME.todo.reg.title);
    expect(screen.getByText(STATUS.untilParty)).toBeTruthy();
    expect(screen.queryByText(STATUS.untilPrevote)).toBeNull();
  });
});
