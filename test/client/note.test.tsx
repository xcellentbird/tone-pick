/**
 * 슬라이스 36 — 익명 쪽지의 **화면 규칙** (ADR-98).
 *
 * 서버 규칙(예산·발신자 익명·읽음 5분·지워도 발신자 화면 그대로)은 `test/36-anon-note.test.ts` 가 본다.
 * 여기서 보는 것은 화면만이 지킬 수 있는 넷이다 —
 *
 *   · 가리기 중에는 보낸 묶음도 **쓰기 버튼도** 잠긴다 (S-B5)
 *   · 덮개·가리기 아래에서는 **읽음으로 찍지 않는다** (S-B2) — 안 읽고 지우는 길이 거기 있다
 *   · 읽음 배지는 **시트를 연 순간의 값으로 굳는다** (S-B4)
 *   · 받은 줄에 누를 수 있는 것은 **지우기 하나**다 (S-C3)
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router";
import { HOME, NOTE, PEOPLE, POKE as POKE_COPY } from "../../src/shared/copy.ts";
import type { MyNoteState, MyPokeState, ParticipantState } from "../../src/shared/types.ts";
import { ParticipantView } from "../../src/client/routes/Participant.tsx";
import type { ParticipantSource } from "../../src/client/lib/participant.ts";

afterEach(cleanup);
// 가리기는 localStorage 에 남는다 (`useCovered`) — 테스트끼리 물려받지 않게 매번 비운다
beforeEach(() => window.localStorage.clear());

const POKE: MyPokeState = {
  budget: { pre: { max: 3, used: 0 }, party: { max: 2, used: 0 } },
  sentTo: {},
  received: { pre: 0, party: 0 },
  matches: [],
};

const EMPTY: MyNoteState = { budget: { max: 2, used: 0 }, sent: {}, received: [] };

/** 파티 중인 회차. 익명 쪽지가 2장 열려 있다 */
function stateOf(note: MyNoteState = EMPTY): ParticipantState {
  return {
    event: {
      id: "e1",
      name: "테스트 파티",
      code: "ABCDEF",
      phase: "party",
      fired: { reg: 1, prevote: 2, party: 3 },
      schedule: { partyAt: Date.now() - 3600_000 },
      config: { maxPre: 3, maxParty: 2, maxNotes: 2 },
    },
    // 단계 안내는 이미 본 사람으로 둔다 — 덮개 자체는 아래에서 따로 세운다
    me: {
      id: "me",
      nickname: "달빛",
      realName: "김나",
      age: 30,
      gender: "M",
      instagram: "na_gram",
      mbti: "ENFP",
      charms: ["하나", "둘", "셋"],
      createdAt: 1,
      seenStage: "party",
    },
    roster: [{ id: "her", nickname: "그녀", age: 29, gender: "F", mbti: "ISFJ", charms: ["매력가", "매력나", "매력다"] }],
    poke: POKE,
    note,
    announcements: [],
  };
}

function sourceOf(state: ParticipantState) {
  const calls = { seen: 0, removed: [] as string[], sent: [] as Array<[string, string]> };
  const src: ParticipantSource & { calls: typeof calls } = {
    key: "t",
    calls,
    load: async () => state,
    poke: async () => POKE,
    unpoke: async () => POKE,
    sendNote: async (toId, text) => {
      calls.sent.push([toId, text]);
      return state.note;
    },
    seeNotes: async () => {
      calls.seen++;
      return state.note;
    },
    removeNote: async (id) => {
      calls.removed.push(id);
      return state.note;
    },
    ackSeat: async () => {},
    markStage: async () => {},
    vote: async (id, choice) => ({ id, at: 1, text: "", poll: { a: "A", b: "B", mine: choice, closed: false } }),
    saveProfile: async (input) => ({ ...state.me, ...input }),
  };
  return src;
}

function mount(src: ParticipantSource, over: { tab?: "home" | "people"; profileId?: string; noteOpen?: boolean } = {}) {
  return render(
    <MemoryRouter>
      <ParticipantView
        source={src}
        tab={over.tab ?? "people"}
        profileId={over.profileId}
        noteOpen={over.noteOpen}
        onTab={() => {}}
        onProfile={() => {}}
        onNote={() => {}}
        onEdit={() => {}}
        onSeat={() => {}}
        helpOpen={false}
        onHelp={() => {}}
      />
    </MemoryRouter>,
  );
}

/** 화면이 다 그려졌다는 신호 */
const ready = () => waitFor(() => expect(screen.getAllByText("그녀").length).toBeGreaterThan(0));

describe("보내는 쪽 — 프로필 시트", () => {
  it("★ 남은 장 수는 버튼 안에 있다 — 다 쓰면 글자가 바뀌고 잠긴다", async () => {
    const left = sourceOf(stateOf({ budget: { max: 2, used: 1 }, sent: {}, received: [] }));
    mount(left, { profileId: "her" });
    await ready();
    // 버튼 밑에 설명 줄을 두면 `익명 쪽지 쓰기` 와 `닫기` 가 한 묶음으로 안 읽힌다
    expect(screen.getByText(NOTE.write(1)).tagName).toBe("BUTTON");
    cleanup();

    const spent = sourceOf(stateOf({ budget: { max: 2, used: 2 }, sent: {}, received: [] }));
    mount(spent, { profileId: "her" });
    await ready();
    const btn = screen.getByText(NOTE.writeSpent);
    // 왜 못 누르는지를 글자가 스스로 말하므로 죽은 버튼이 아니다
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("★ 보낸 적이 있을 때만 묶음이 선다 — 본문과 읽음 배지", async () => {
    const src = sourceOf(
      stateOf({
        budget: { max: 2, used: 2 },
        sent: { her: [{ text: "아까 웃는 모습이 좋았어요", read: true }, { text: "커피 이야기", read: false }] },
        received: [],
      }),
    );
    mount(src, { profileId: "her" });
    await ready();
    expect(screen.getByText(NOTE.sentTitle)).toBeTruthy();
    expect(screen.getByText("아까 웃는 모습이 좋았어요")).toBeTruthy();
    expect(screen.getByText(NOTE.read)).toBeTruthy();
    expect(screen.getByText(NOTE.unread)).toBeTruthy();
    // 시각은 없다 — `읽음` 이지 `21:05에 읽음` 이 아니다
    expect(screen.getByText(NOTE.read).textContent).toBe(NOTE.read);
  });

  it("★ 안 보낸 사람 자리에는 묶음이 없다", async () => {
    mount(sourceOf(stateOf()), { profileId: "her" });
    await ready();
    expect(screen.queryByText(NOTE.sentTitle)).toBeNull();
  });

  it("★ 가리기 중에는 묶음도 쓰기 버튼도 잠긴다 (S-B5)", async () => {
    const src = sourceOf(
      stateOf({ budget: { max: 2, used: 1 }, sent: { her: [{ text: "새면 안 되는 글", read: false }] }, received: [] }),
    );
    mount(src, { profileId: "her" });
    await ready();

    fireEvent.click(screen.getByText(PEOPLE.cover));
    await waitFor(() => expect(screen.queryByText(NOTE.sentTitle)).toBeNull());
    // 묶음만 감추면 모자라다 — 누르면 시트 제목과 확인창이 상대 이름을 말한다
    expect((screen.getByText(NOTE.write(1)) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("새면 안 되는 글")).toBeNull();
  });

  it("★ 읽음 배지는 시트를 연 순간의 값으로 굳는다 (S-B4)", async () => {
    const state = stateOf({
      budget: { max: 2, used: 1 },
      sent: { her: [{ text: "굳는 글", read: false }] },
      received: [],
    });
    const src = sourceOf(state);
    const view = mount(src, { profileId: "her" });
    await ready();
    expect(screen.getByText(NOTE.unread)).toBeTruthy();

    // 남이 일으킨 변화로 화면이 다시 읽혔다 (공지·자리 발행·소켓 재접속이 전부 이 길이다)
    state.note = { ...state.note, sent: { her: [{ text: "굳는 글", read: true }] } };
    view.rerender(
      <MemoryRouter>
        <ParticipantView
          source={{ ...src, key: "t2" }}
          tab="people"
          profileId="her"
          onTab={() => {}}
          onProfile={() => {}}
          onNote={() => {}}
          onEdit={() => {}}
          onSeat={() => {}}
          helpOpen={false}
          onHelp={() => {}}
        />
      </MemoryRouter>,
    );
    await act(async () => {});
    // 시트를 닫았다 다시 열 때까지 안 바뀐다 — 실시간으로 바뀌면 그 순간을 옆에서 안다 (ADR-64)
    expect(screen.getByText(NOTE.unread)).toBeTruthy();
  });
});

describe("받는 쪽 — 홈", () => {
  const got: MyNoteState = {
    budget: { max: 2, used: 0 },
    sent: {},
    received: [{ id: "n1", text: "아까 웃는 모습이 좋았어요" }],
  };

  it("★ 받은 줄에 누를 수 있는 것은 지우기 하나다 (S-C3)", async () => {
    const src = sourceOf(stateOf(got));
    mount(src, { tab: "home" });
    await waitFor(() => expect(screen.getByText(NOTE.received)).toBeTruthy());
    expect(screen.getByText("아까 웃는 모습이 좋았어요")).toBeTruthy();
    // 답장도 반응도 신고도 없다. 그 셋 중 하나라도 생기면 이것은 채팅이다 (ADR-98)
    const inNews = [...document.querySelectorAll(".banner button")].map((b) => b.textContent);
    expect(inNews).toEqual([NOTE.remove]);
  });

  it("★ 제목이 익명을 말하므로 `누구인지는 비밀이에요` 줄이 없다", async () => {
    mount(sourceOf(stateOf(got)), { tab: "home" });
    await waitFor(() => expect(screen.getByText(NOTE.received)).toBeTruthy());
    expect(screen.queryByText(POKE_COPY.receivedNote)).toBeNull();
  });

  it("★ 홈을 열면 읽음으로 찍힌다 — 가리기 중에는 안 찍는다 (S-B2)", async () => {
    const open = sourceOf(stateOf(got));
    mount(open, { tab: "home" });
    await waitFor(() => expect(open.calls.seen).toBe(1));

    // 가리면 제목만 보인다 — 제목만 본 것은 읽은 것이 아니다. 이것이 안 읽고 지우는 길이다
    fireEvent.click(screen.getByText(PEOPLE.cover));
    await waitFor(() => expect(screen.queryByText("아까 웃는 모습이 좋았어요")).toBeNull());
    // 가려도 제목은 남는다 — 온 줄도 모르면 안 된다
    expect(screen.getByText(NOTE.received)).toBeTruthy();
    cleanup();

    const covered = sourceOf(stateOf(got));
    mount(covered, { tab: "home" });
    await waitFor(() => expect(screen.getByText(NOTE.received)).toBeTruthy());
    await act(async () => {});
    expect(covered.calls.seen, "가린 채로 열었는데 읽음이 찍혔다").toBe(0);
  });

  it("★ 덮개가 덮고 있으면 읽음으로 찍지 않는다 (S-B2)", async () => {
    /*
     * 덮개는 홈을 **가리지만 언마운트하지 않는다** (`{tab === "home" && <Home/>}` 이 덮개와
     * 나란히 산다). 그대로 두면 본문을 볼 수 없는 사람이 읽은 것으로 찍힌다.
     */
    const state = stateOf(got);
    state.me = { ...state.me, seenStage: undefined };
    const src = sourceOf(state);
    mount(src, { tab: "home" });
    await waitFor(() => expect(document.querySelector(".takeover")).toBeTruthy());
    await act(async () => {});
    expect(src.calls.seen, "덮개 아래에서 읽음이 찍혔다").toBe(0);
  });

  it("★ 쪽지 줄이 없으면 가리기 토글도 없다 — 덮을 것이 없다", async () => {
    mount(sourceOf(stateOf()), { tab: "home" });
    await waitFor(() => expect(screen.getByText(HOME.news)).toBeTruthy());
    expect(screen.queryByText(PEOPLE.cover)).toBeNull();
  });
});
