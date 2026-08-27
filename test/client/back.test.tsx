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
import { BTN, GENDER, HELP, HOME, MBTI_AXES, ME, REGISTER, SCREEN_TITLE, STATUS, TABS_PARTICIPANT } from "../../src/shared/copy.ts";
import type { ParticipantState } from "../../src/shared/types.ts";
import { PARTICIPANT_ROUTES } from "../../src/client/router.tsx";
import Register from "../../src/client/routes/Register.tsx";

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
    instagram: "gram_a",
    mbti: "ENFP",
    charms: ["하나", "둘", "셋"],
    createdAt: 1,
  },
  roster: [{ id: "her", nickname: "그녀", age: 29, gender: "F", mbti: "ISFJ", charms: ["가", "나", "다"] }],
  poke: { budget: { pre: { max: 3, used: 1 }, party: { max: 3, used: 0 } }, sentTo: {}, received: { pre: 0, party: 0 }, matches: [] },
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

  it("★ 상단 회차 이름을 누르면 홈 탭이고, 발자국이 쌓이지 않는다", async () => {
    /*
     * 어느 탭에 있든 상단 왼쪽이 홈으로 돌아가는 지름길이다 (`StatusBar.tsx`).
     *
     * **하단 홈 탭과 같은 길이어야 한다** — 같은 곳으로 갈 뿐 아니라 히스토리도 같게
     * 쌓여야 한다. 여기서 `navigate` 를 따로 부르면 갈아끼우는 대신 한 칸 밀게 되고,
     * 뒤로 가기가 방금 떠난 탭으로 되돌아간다. 그게 "내 발자국 되감기"다.
     */
    const router = participantRouter();
    render(<RouterProvider router={router} />);
    await screen.findByText(HOME.todo.prevote.title);

    fireEvent.click(tab("people"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/e/ABCDEF/people"));

    /*
     * 이 한 줄이 셋을 함께 잰다 — 누를 수 있는 것이고(버튼), 회차 이름이 **여전히**
     * 낭독기가 읽는 이름이며(`aria-label` 로 덮지 않았다), 그 뒤에 갈 곳이 붙는다.
     * 이름을 덮으면 "내가 어느 파티에 있나" 를 확인할 자리가 낭독기에게만 사라진다.
     */
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`${STATE.event.name}.*${STATUS.toHome}`) }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/e/ABCDEF"));

    // 탭 이동과 같이 **갈아끼운다.** 뒤로 가서 참가자 탭이 나오면 발자국을 되감은 것이다
    await router.navigate(-1);
    expect(router.state.location.pathname).toBe("/e/ABCDEF");
  });

  it("★ 홈 탭에서는 회차 이름이 버튼이 아니다 — 갈 곳이 없으면 누를 것도 없다", async () => {
    /*
     * 눌러도 이미 홈이라 아무 일이 없다. 그런 버튼은 고장으로 읽히고,
     * 눌리면 같은 주소가 히스토리에 한 칸 더 쌓여 뒤로 가기가 헛돈다.
     */
    render(<RouterProvider router={participantRouter()} />);
    await screen.findByText(HOME.todo.prevote.title);
    expect(screen.getByText(STATE.event.name).closest("button")).toBeNull();
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

/**
 * 슬라이스 21 — 등록을 마치면 진행 방식이 **한 번 저절로 열린다.**
 *
 * 도움말은 물음표로 늘 열리지만 그건 *이미 질문이 생긴 사람*의 장치라 늦다.
 * 목표가 "운영자에게 묻는 일을 줄이는 것" 이면 질문이 생기기 전에 한 번 읽혀야 하고,
 * 그 순간은 등록 직후다 — 주의가 가장 높고 화면은 가장 비어 있다.
 *
 * **여기서 보는 건 히스토리다.** 도움말이 등록 3스텝 *위에* 얹히면
 * 뒤로 가기가 다 채워진 폼을 밟고, 그걸 본 사람은 두 번 등록하려 든다.
 */
describe("등록 직후 첫 안내", () => {
  /** 등록 전에는 세션이 없고(401), 마치고 나면 생긴다 — 실제 순서 그대로 */
  function registerRouter() {
    let registered = false;
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/register")) {
          registered = true;
          return json({ state: STATE, resumed: false });
        }
        if (url.includes("/me")) return registered ? json(STATE) : json({ error: "unauthorized" }, 401);
        return json({});
      }),
    );
    /** **진짜 라우터의 표를 쓴다.** 베낀 표는 언젠가 어긋난다 (위 주석과 같은 이유) */
    return createMemoryRouter(
      [{ path: "/j/:id/:token/register/:step", element: <Register /> }, ...PARTICIPANT_ROUTES],
      { initialEntries: ["/j/e1/tok123/register/1"] },
    );
  }

  /** 3스텝을 실제로 통과한다 — 히스토리가 진짜여야 뒤로 가기를 시험할 수 있다 */
  async function fillAndSubmit() {
    const set = (id: string, value: string) =>
      fireEvent.change(document.getElementById(id)!, { target: { value } });

    await screen.findByLabelText(ME.labels.nickname);
    set("nickname", "달빛");
    set("realName", "김나");
    set("age", "30");
    fireEvent.click(screen.getByText(GENDER.M));
    fireEvent.click(screen.getByText(BTN.next));

    await screen.findByLabelText(ME.labels.instagram);
    set("instagram", "na_gram");
    fireEvent.click(screen.getByText(BTN.next));

    await screen.findByText(MBTI_AXES[0].q);
    for (const axis of MBTI_AXES) fireEvent.click(screen.getByText(axis.opts[0][1]));
    for (const i of [0, 1, 2]) set(`charm${i}`, `매력${i}`);
    // 머리글 h1 도 같은 말이라 버튼만 골라낸다
    fireEvent.click(screen.getAllByRole("button").find((b) => b.textContent === SCREEN_TITLE.register)!);
  }

  /**
   * **등록 화면이 하는 약속이 코드와 같아야 한다** (ADR-42, `CLAUDE.md`).
   *
   * 한동안 여기서 `매칭되면 상대에게 열 것` 을 골랐다 (ADR-37). 그 기능을 걷어냈으므로
   * 고르는 자리도, "상대에게 보여요" 라는 말도 남아 있으면 안 된다 —
   * 문구가 코드보다 넓게 말하면 그 순간부터 거짓말이다.
   */
  it("★ 연락처를 고르는 자리가 없고, 운영자만 본다고 말한다", async () => {
    render(<RouterProvider router={registerRouter()} />);
    const set = (id: string, value: string) =>
      fireEvent.change(document.getElementById(id)!, { target: { value } });

    await screen.findByLabelText(ME.labels.nickname);
    set("nickname", "달빛");
    set("realName", "김나");
    set("age", "30");
    fireEvent.click(screen.getByText(GENDER.M));
    fireEvent.click(screen.getByText(BTN.next));

    await screen.findByLabelText(ME.labels.instagram);
    // 고르는 컨트롤이 통째로 없다
    expect(screen.queryAllByRole("radiogroup"), "공개 범위를 고르는 자리가 남아 있다").toHaveLength(0);

    // 약속은 **운영자만 본다** 하나다
    expect(REGISTER.contactNote).toContain("운영자");
    expect(REGISTER.contactNote, "매칭 상대에게 연락처가 간다고 말하면 안 된다").not.toContain("열");
    // 인스타를 왜 받는지 그 자리에서 말한다 — 안 그러면 연락 수단으로 읽는다
    expect(screen.getByText(REGISTER.instaWhy)).toBeTruthy();

    // 아무것도 안 고르고 바로 넘어간다 — 막을 것이 없다
    set("instagram", "na_gram");
    fireEvent.click(screen.getByText(BTN.next));
    await screen.findByText(MBTI_AXES[0].q);
  });

  it("★ 등록을 마치면 진행 방식이 열려 있다", async () => {
    const router = registerRouter();
    render(<RouterProvider router={router} />);
    await fillAndSubmit();

    await screen.findByText(HELP.title);
    await waitFor(() => expect(router.state.location.pathname).toBe("/e/ABCDEF/help"));
  });

  it("★ 뒤로 가면 홈이다 — 다 채워진 등록 폼을 밟지 않는다", async () => {
    /*
     * `등록 완료 → 메인` 은 replace 다 (ROUTES.md). 그 규칙을 지키면서 도움말을 얹으려면
     * **갈아끼운 뒤에 밀어 넣어야** 한다. 순서가 뒤집히면 여기가 3스텝으로 떨어진다 —
     * 다 채워진 것처럼 보이는 폼을 보면 두 번 등록하려 든다.
     */
    const router = registerRouter();
    render(<RouterProvider router={router} />);
    await fillAndSubmit();
    await screen.findByText(HELP.title);

    await router.navigate(-1);
    await waitFor(() => expect(screen.queryByText(HELP.title)).toBeNull());
    expect(router.state.location.pathname).toBe("/e/ABCDEF");
    expect(screen.queryByText(SCREEN_TITLE.register)).toBeNull();
  });

  it("★ 다시 열면 안 뜬다 — 본 적 있다는 기록 없이 '등록 완료' 라는 사건에만 붙는다", async () => {
    /*
     * 읽음 상태를 저장하지 않는다 (ADR-4). 붙일 사건이 없으면 안 뜨는 것이 옳다 —
     * 매번 뜨는 안내는 안내가 아니라 방해다. 다시 보고 싶으면 물음표다.
     */
    render(<RouterProvider router={participantRouter("/e/ABCDEF")} />);
    await screen.findByText(HOME.todo.prevote.title);
    expect(screen.queryByText(HELP.title)).toBeNull();
  });
});
