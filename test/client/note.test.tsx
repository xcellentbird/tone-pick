/**
 * 슬라이스 36 — 익명 쪽지의 **화면 규칙** (ADR-98, 후기 3 의 익명 쪽지함).
 *
 * 서버 규칙(예산·발신자 익명·읽음 5분·지워도 발신자 화면 그대로·안 읽은 수)은
 * `test/36-anon-note.test.ts` 가 본다. 여기서 보는 것은 화면만이 지킬 수 있는 것들이다 —
 *
 *   · 쓰는 입구는 프로필 시트의 ✉️ 하나다. 가리기 중에는 잠긴다 (S-B5)
 *   · 받은 쪽지는 **익명 쪽지함에만** 있다 — 홈 소식에는 없다
 *   · 읽음은 **쪽지함을 열 때** 찍힌다. 덮개·가리기 아래에서는 안 찍는다 (S-B2)
 *   · 보낸 쪽지의 읽음 배지는 **쪽지함을 연 순간의 값으로 굳는다** (S-B4)
 *   · 받은 줄에 누를 수 있는 것은 **지우기 하나**다 (S-C3)
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router";
import { NOTE, PEOPLE, POKE as POKE_COPY } from "../../src/shared/copy.ts";
import type { MyNoteState, MyPokeState, ParticipantState, Phase } from "../../src/shared/types.ts";
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

const EMPTY: MyNoteState = { budget: { max: 2, used: 0 }, sent: {}, received: [], unread: 0 };

/** 파티 중인 회차. 익명 쪽지가 2장 열려 있다 */
function stateOf(note: MyNoteState = EMPTY, over: { phase?: Phase; maxNotes?: number } = {}): ParticipantState {
  const phase = over.phase ?? "party";
  return {
    event: {
      id: "e1",
      name: "테스트 파티",
      code: "ABCDEF",
      phase,
      fired: phase === "party" ? { reg: 1, prevote: 2, party: 3 } : { reg: 1, prevote: 2 },
      schedule: { partyAt: Date.now() - 3600_000 },
      config: { maxPre: 3, maxParty: 2, maxNotes: over.maxNotes ?? 2 },
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
      seenStage: phase === "party" ? "party" : "prevote",
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
      return { ...state.note, unread: 0 };
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

interface Mount {
  tab?: "home" | "people";
  profileId?: string;
  notesOpen?: boolean;
  onNote?: (on: boolean) => void;
  key?: string;
}

function view(src: ParticipantSource, over: Mount = {}) {
  return (
    <MemoryRouter>
      <ParticipantView
        source={over.key ? { ...src, key: over.key } : src}
        tab={over.tab ?? "people"}
        profileId={over.profileId}
        notesOpen={over.notesOpen}
        onTab={() => {}}
        onProfile={() => {}}
        onNote={over.onNote ?? (() => {})}
        onNotes={() => {}}
        onEdit={() => {}}
        onSeat={() => {}}
        helpOpen={false}
        onHelp={() => {}}
      />
    </MemoryRouter>
  );
}

const mount = (src: ParticipantSource, over: Mount = {}) => render(view(src, over));

/** 화면이 다 그려졌다는 신호 — 상단 바의 회차 이름 */
const ready = () => screen.findByText("테스트 파티");

const inboxBtn = () => screen.queryByRole("button", { name: new RegExp(NOTE.inbox.open) });

// ─────────────────────────────────────────── 보내는 쪽 — 프로필 시트

describe("쓰는 입구 — 프로필 시트의 ✉️", () => {
  it("★ 👉 옆의 ✉️ 하나다 — 긴 버튼도 보낸 본문도 프로필 시트에는 없다", async () => {
    const src = sourceOf(
      stateOf({ budget: { max: 2, used: 1 }, sent: { her: [{ text: "아까 웃는 모습이 좋았어요", read: true }] }, received: [], unread: 0 }),
    );
    mount(src, { profileId: "her" });
    await ready();
    const btn = screen.getByRole("button", { name: NOTE.writeLabel });
    // 숫자는 이 사람에게 보낸 장 수다 — 👉 안의 숫자와 같은 문법
    expect(btn.textContent).toContain("1");
    // 보낸 본문과 읽음은 익명 쪽지함으로 갔다 (ADR-98 후기 3)
    expect(screen.queryByText("아까 웃는 모습이 좋았어요")).toBeNull();
    expect(screen.queryByText(NOTE.read)).toBeNull();
  });

  it("★ 누르면 작성 시트로 간다", async () => {
    const opened: boolean[] = [];
    mount(sourceOf(stateOf()), { profileId: "her", onNote: (on) => opened.push(on) });
    await ready();
    fireEvent.click(screen.getByRole("button", { name: NOTE.writeLabel }));
    expect(opened).toEqual([true]);
  });

  it("★ 다 썼으면 작성 시트가 안 열리고, 누른 자리에서 이유를 말한다", async () => {
    const opened: boolean[] = [];
    mount(sourceOf(stateOf({ budget: { max: 2, used: 2 }, sent: {}, received: [], unread: 0 })), {
      profileId: "her",
      onNote: (on) => opened.push(on),
    });
    await ready();
    const btn = screen.getByRole("button", { name: NOTE.writeLabel });
    // `disabled` 로 두면 누른 것 자체가 안 와서 왜 안 되는지 말할 수 없다 — 재미 탭과 같다
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(btn);
    expect(await screen.findByText(NOTE.writeSpent)).toBeTruthy();
    expect(opened).toEqual([]);
  });

  it("★ 가리기 중에는 잠기고 숫자도 안 보인다 (S-B5)", async () => {
    const src = sourceOf(stateOf({ budget: { max: 2, used: 1 }, sent: { her: [{ text: "글", read: false }] }, received: [], unread: 0 }));
    mount(src, { profileId: "her" });
    await ready();
    fireEvent.click(screen.getByText(PEOPLE.cover));
    const btn = await screen.findByRole("button", { name: NOTE.writeLabel });
    // 누르면 시트 제목과 확인창이 상대 이름을 말하고 그 사이 내내 글을 친다 — 콕보다 오래 드러난다
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(btn.textContent).not.toMatch(/\d/);
  });

  it("★ 파티 전에는 없다 — 잠긴 버튼을 미리 세우지 않는다", async () => {
    mount(sourceOf(stateOf(EMPTY, { phase: "prevote" })), { profileId: "her" });
    await ready();
    expect(screen.queryByRole("button", { name: NOTE.writeLabel })).toBeNull();
  });
});

// ─────────────────────────────────────────── 상단 바 — 익명 쪽지함 ✉️

describe("상단 바의 익명 쪽지함", () => {
  it("★ 배지는 안 읽은 쪽지 수다 — 없으면 배지도 없다", async () => {
    const two: MyNoteState = { ...EMPTY, received: [{ id: "n1", text: "a" }, { id: "n2", text: "b" }], unread: 2 };
    mount(sourceOf(stateOf(two)), { tab: "home" });
    await ready();
    expect(inboxBtn()!.querySelector(".count")?.textContent).toBe("2");
    cleanup();

    mount(sourceOf(stateOf({ ...two, unread: 0 })), { tab: "home" });
    await ready();
    expect(inboxBtn(), "읽은 쪽지뿐이어도 쪽지함은 있다").toBeTruthy();
    expect(inboxBtn()!.querySelector(".count")).toBeNull();
  });

  it("★ 파티 전에는 없고, 쪽지를 끈 회차에도 없다 — 이미 주고받은 것이 있으면 남는다", async () => {
    mount(sourceOf(stateOf(EMPTY, { phase: "prevote" })), { tab: "home" });
    await ready();
    expect(inboxBtn()).toBeNull();
    cleanup();

    mount(sourceOf(stateOf(EMPTY, { maxNotes: 0 })), { tab: "home" });
    await ready();
    expect(inboxBtn()).toBeNull();
    cleanup();

    // 운영자가 0 으로 내린 회차가 곧 괴롭힘이 있었던 회차다 — 온 쪽지는 지울 수 있어야 한다
    mount(sourceOf(stateOf({ ...EMPTY, received: [{ id: "n1", text: "a" }], unread: 1 }, { maxNotes: 0 })), { tab: "home" });
    await ready();
    expect(inboxBtn()).toBeTruthy();
  });
});

// ─────────────────────────────────────────── 익명 쪽지함

describe("익명 쪽지함 — 받은 쪽지", () => {
  const got: MyNoteState = {
    budget: { max: 2, used: 0 },
    sent: {},
    received: [{ id: "n1", text: "아까 웃는 모습이 좋았어요" }],
    unread: 1,
  };

  it("★ 홈 소식에는 쪽지가 없다 — 홈을 열어도 읽음으로 찍지 않는다", async () => {
    const src = sourceOf(stateOf(got));
    mount(src, { tab: "home" });
    await ready();
    await act(async () => {});
    expect(screen.queryByText("아까 웃는 모습이 좋았어요")).toBeNull();
    // 홈의 가리기 토글은 쪽지 본문 때문에 있던 것이다 — 덮을 것이 없다
    expect(screen.queryByText(PEOPLE.cover)).toBeNull();
    expect(src.calls.seen).toBe(0);
  });

  it("★ 쪽지함을 열면 읽음으로 찍힌다 (S-B2)", async () => {
    const src = sourceOf(stateOf(got));
    mount(src, { tab: "home", notesOpen: true });
    expect(await screen.findByText("아까 웃는 모습이 좋았어요")).toBeTruthy();
    await waitFor(() => expect(src.calls.seen).toBe(1));
  });

  it("★ 가리기 중에는 본문을 덮고 읽음으로 찍지 않는다 — 안 읽고 지우는 길이다 (S-B2)", async () => {
    const open = sourceOf(stateOf(got));
    mount(open, { tab: "home", notesOpen: true });
    await screen.findByText("아까 웃는 모습이 좋았어요");
    fireEvent.click(screen.getByText(PEOPLE.cover));
    await waitFor(() => expect(screen.queryByText("아까 웃는 모습이 좋았어요")).toBeNull());
    // 가려도 줄은 남는다 — 온 줄도 모르면 안 된다. 지우기도 그대로다
    expect(screen.getByText(NOTE.inbox.covered)).toBeTruthy();
    expect(screen.getByText(NOTE.remove)).toBeTruthy();
    cleanup();

    const covered = sourceOf(stateOf(got));
    mount(covered, { tab: "home", notesOpen: true });
    await screen.findByText(NOTE.inbox.covered);
    await act(async () => {});
    expect(covered.calls.seen, "가린 채로 열었는데 읽음이 찍혔다").toBe(0);
  });

  it("★ 덮개가 덮고 있으면 읽음으로 찍지 않는다 (S-B2)", async () => {
    const state = stateOf(got);
    state.me = { ...state.me, seenStage: undefined };
    const src = sourceOf(state);
    mount(src, { tab: "home", notesOpen: true });
    await waitFor(() => expect(document.querySelector(".takeover")).toBeTruthy());
    await act(async () => {});
    expect(src.calls.seen, "덮개 아래에서 읽음이 찍혔다").toBe(0);
  });

  it("★ 누를 수 있는 것은 지우기 하나다 — `누구인지는 비밀이에요` 줄도 없다 (S-C3)", async () => {
    mount(sourceOf(stateOf(got)), { tab: "home", notesOpen: true });
    await screen.findByText("아까 웃는 모습이 좋았어요");
    // 답장도 반응도 신고도 없다. 그 셋 중 하나라도 생기면 이것은 채팅이다 (ADR-98)
    const inList = [...document.querySelectorAll(".inbox .banner button")].map((b) => b.textContent);
    expect(inList).toEqual([NOTE.remove]);
    expect(screen.queryByText(POKE_COPY.receivedNote)).toBeNull();
  });

  it("★ 빈 쪽지함은 없다고 말하지 않는다 — `아무도 안 보냈다` 로 읽힌다", async () => {
    mount(sourceOf(stateOf()), { tab: "home", notesOpen: true });
    expect(await screen.findByText(NOTE.inbox.empty)).toBeTruthy();
  });
});

describe("익명 쪽지함 — 보낸 쪽지", () => {
  const mine: MyNoteState = {
    budget: { max: 2, used: 2 },
    sent: { her: [{ text: "아까 웃는 모습이 좋았어요", read: true }, { text: "커피 이야기", read: false }] },
    received: [],
    unread: 0,
  };

  it("★ 본문과 읽음 배지가 받는 사람별로 선다 — 시각은 없다", async () => {
    mount(sourceOf(stateOf(mine)), { tab: "home", notesOpen: true });
    fireEvent.click(await screen.findByText(NOTE.inbox.sent));
    expect(await screen.findByText("아까 웃는 모습이 좋았어요")).toBeTruthy();
    expect(screen.getByText(NOTE.inbox.to("그녀"))).toBeTruthy();
    // `읽음` 이지 `21:05에 읽음` 이 아니다
    expect(screen.getByText(NOTE.read).textContent).toBe(NOTE.read);
    expect(screen.getByText(NOTE.unread)).toBeTruthy();
  });

  it("★ 가리기 중에는 보낸 쪽지가 통째로 안 보인다", async () => {
    mount(sourceOf(stateOf(mine)), { tab: "home", notesOpen: true });
    fireEvent.click(await screen.findByText(NOTE.inbox.sent));
    await screen.findByText("커피 이야기");
    fireEvent.click(screen.getByText(PEOPLE.cover));
    await waitFor(() => expect(screen.queryByText("커피 이야기")).toBeNull());
    // 누구에게 보냈는지가 본문보다 먼저 샌다
    expect(screen.queryByText(NOTE.inbox.to("그녀"))).toBeNull();
  });

  it("★ 읽음 배지는 쪽지함을 연 순간의 값으로 굳는다 (S-B4)", async () => {
    const state = stateOf({ ...mine, sent: { her: [{ text: "굳는 글", read: false }] } });
    const src = sourceOf(state);
    const v = mount(src, { tab: "home", notesOpen: true });
    fireEvent.click(await screen.findByText(NOTE.inbox.sent));
    expect(await screen.findByText(NOTE.unread)).toBeTruthy();

    // 남이 일으킨 변화로 화면이 다시 읽혔다 (공지·자리 발행·소켓 재접속이 전부 이 길이다)
    state.note = { ...state.note, sent: { her: [{ text: "굳는 글", read: true }] } };
    v.rerender(view(src, { tab: "home", notesOpen: true, key: "t2" }));
    await act(async () => {});
    // 쪽지함을 닫았다 다시 열 때까지 안 바뀐다 — 실시간으로 바뀌면 그 순간을 옆에서 안다 (ADR-64)
    expect(screen.getByText(NOTE.unread)).toBeTruthy();
  });
});
