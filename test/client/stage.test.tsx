/**
 * 슬라이스 34 — 단계가 열릴 때의 안내 화면 (ADR-96). **언제 뜨고 무엇이 적혀 있는지.**
 * 봤다는 표시가 서버에 남는지는 워커 테스트(`test/34-stage-guide.test.ts`)가 본다.
 *
 * 새 행동이 열리는 순간이 둘뿐이라 매력 투표와 파티만이다. 자리 확인이 먼저고, 발표 뒤에는 안 뜬다.
 * 다음 단계 얘기는 없다 — 그 단계는 그 단계가 열릴 때 말한다.
 *
 * 조회는 **전체 화면 안으로 좁힌다** (`.takeover`). 홈 카드에도 `참가자 보러 가기` 가 있고
 * 소식 줄에도 단계 이름이 서서, 화면 전체로 찾으면 둘을 잡는다.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router";
import { SEAT, STAGE } from "../../src/shared/copy.ts";
import type { MyPokeState, ParticipantState, StageKey } from "../../src/shared/types.ts";
import { ParticipantView } from "../../src/client/routes/Participant.tsx";
import type { ParticipantSource } from "../../src/client/lib/participant.ts";

afterEach(cleanup);

const POKE: MyPokeState = {
  budget: { pre: { max: 3, used: 0 }, party: { max: 2, used: 0 } },
  sentTo: {},
  received: { pre: 0, party: 0 },
  matches: [],
};

type Phase = ParticipantState["event"]["phase"];

function stateOf(
  phase: Phase,
  over: {
    seenStage?: StageKey;
    pokeNotify?: boolean;
    seat?: ParticipantState["seat"];
    /** 옛 회차에 적혀 있던 매력 투표 마감 시각 (ADR-39). 이제 읽지 않는다 (ADR-100) */
    voteEndAt?: number;
  } = {},
): ParticipantState {
  return {
    event: {
      id: "e1",
      name: "테스트 파티",
      code: "ABCDEF",
      phase,
      fired: {
        reg: 1,
        prevote: 2,
        ...(phase === "party" || phase === "done" ? { party: 3 } : {}),
      },
      schedule: { partyAt: Date.now() + 3600_000, ...(over.voteEndAt ? { voteEndAt: over.voteEndAt } : {}) },
      config: { maxPre: 3, maxParty: 2, ...(over.pokeNotify === undefined ? {} : { pokeNotify: over.pokeNotify }) },
    },
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
      ...(over.seenStage ? { seenStage: over.seenStage } : {}),
    },
    roster: [{ id: "her", nickname: "그녀", age: 29, gender: "F", mbti: "ISFJ", charms: ["매력가", "매력나", "매력다"] }],
    poke: POKE,
    note: { budget: { max: 0, used: 0 }, sent: {}, received: [], unread: 0 },
    ...(over.seat ? { seat: over.seat } : {}),
    announcements: [],
  };
}

function sourceOf(state: ParticipantState) {
  const seen: StageKey[] = [];
  const src: ParticipantSource & { seen: StageKey[] } = {
    key: "t",
    seen,
    sendNote: async () => state.note,
    seeNotes: async () => state.note,
    removeNote: async () => state.note,
    load: async () => state,
    poke: async () => POKE,
    unpoke: async () => POKE,
    ackSeat: async () => {},
    markStage: async (s) => {
      seen.push(s);
    },
    vote: async (id, choice) => ({ id, at: 1, text: "", poll: { a: "A", b: "B", mine: choice, closed: false } }),
    saveProfile: async (input) => ({ ...state.me, ...input }),
  };
  return src;
}

function mount(src: ParticipantSource, onTab: (t: string) => void = () => {}) {
  return render(
    <MemoryRouter>
      <ParticipantView source={src} tab="home" onTab={onTab} onProfile={() => {}} onNote={() => {}} onEdit={() => {}} onSeat={() => {}} helpOpen={false} onHelp={() => {}} />
    </MemoryRouter>,
  );
}

/** 화면이 다 그려졌다는 신호 — 탭바는 상태를 읽은 뒤에 선다 */
const loaded = () =>
  waitFor(() => {
    if (!document.querySelector(".tabbar")) throw new Error("아직 안 그려졌다");
  });
/** 전체 화면 안으로 좁힌 조회. 자리 확인 화면도 같은 틀이라 **그 순간 떠 있는 것**을 잡는다 */
const takeover = () => {
  const el = document.querySelector(".takeover");
  if (!el) throw new Error("전체 화면이 없다");
  return within(el as HTMLElement);
};
const shown = async () => {
  await waitFor(() => {
    if (!document.querySelector(".takeover")) throw new Error("아직 안 떴다");
  });
  return takeover();
};
const none = () => expect(document.querySelector(".takeover")).toBeNull();

const SEAT_UNACKED: ParticipantState["seat"] = { round: 1, table: 3, mates: 5, men: 3, acked: false, mateIds: [] };

describe("언제 뜨나 (ADR-96)", () => {
  it("★ 매력 투표가 열렸고 아직 안 봤으면 그 단계 안내가 뜬다", async () => {
    mount(sourceOf(stateOf("prevote")));
    const t = await shown();
    expect(t.getByText(STAGE.prevote.title)).toBeTruthy();
    expect(t.getByText(STAGE.prevote.what)).toBeTruthy();
    expect(t.getByText(STAGE.prevote.why)).toBeTruthy();
    expect(t.getByRole("button", { name: STAGE.go })).toBeTruthy();
    // 다음 단계 얘기는 없다 — 그 단계는 그 단계가 열릴 때 말한다
    expect(t.queryByText(STAGE.party.what)).toBeNull();
  });

  it("★ 누르면 어느 단계를 봤는지 보내고 참가자 탭으로 간다 — 그리고 다시 안 뜬다", async () => {
    const src = sourceOf(stateOf("prevote"));
    const tabs: string[] = [];
    mount(src, (t) => tabs.push(t));
    const t = await shown();
    fireEvent.click(t.getByRole("button", { name: STAGE.go }));
    await waitFor(() => expect(src.seen).toEqual(["prevote"]));
    await waitFor(() => expect(tabs).toContain("people"));
    await waitFor(none);
  });

  it("★ 파티가 시작되면 매력 투표 안내를 봤든 안 봤든 파티 안내가 뜬다", async () => {
    mount(sourceOf(stateOf("party", { seenStage: "prevote" })));
    const t = await shown();
    expect(t.getByText(STAGE.party.title)).toBeTruthy();
    expect(t.getByText(STAGE.party.what)).toBeTruthy();
    expect(t.getByText(STAGE.party.why)).toBeTruthy();
    // 횟수는 회차 설정에서 온다
    expect(t.getByText(STAGE.party.fresh(2))).toBeTruthy();
    // 투표 얘기는 없다
    expect(t.queryByText(STAGE.prevote.what)).toBeNull();
  });

  it("★ 이미 본 단계는 다시 안 뜬다", async () => {
    mount(sourceOf(stateOf("party", { seenStage: "party" })));
    await loaded();
    none();
  });

  it("★ 자리 확인이 먼저다 — 확인한 뒤에 안내가 온다", async () => {
    mount(sourceOf(stateOf("party", { seat: SEAT_UNACKED })));
    const seat = await shown();
    expect(seat.getByText(SEAT.ack.headline(3, true))).toBeTruthy();
    expect(seat.queryByText(STAGE.party.title)).toBeNull();
    fireEvent.click(seat.getByRole("button", { name: SEAT.ack.submit(true) }));
    await waitFor(() => expect(takeover().queryByText(STAGE.party.title)).toBeTruthy());
    expect(screen.queryByText(SEAT.ack.headline(3, true))).toBeNull();
  });

  it("★ 등록 중과 발표 뒤에는 뜨지 않는다", async () => {
    for (const phase of ["reg", "done"] as const) {
      const { unmount } = mount(sourceOf(stateOf(phase)));
      await loaded();
      none();
      unmount();
    }
  });

  /**
   * 매력 투표는 **파티 시작에 닫힌다** (ADR-100). 옛 회차에 마감 시각이 적혀 있고 그 시각이 지났어도
   * 투표는 열려 있으므로 안내도 뜬다 — 여기와 참가자 탭의 버튼은 같은 판정(`canPoke`)을 쓴다.
   */
  it("★ 옛 마감 시각이 지나도 매력 투표 안내가 뜬다 (ADR-100)", async () => {
    mount(sourceOf(stateOf("prevote", { voteEndAt: Date.now() - 60_000 })));
    const t = await shown();
    expect(t.getByText(STAGE.prevote.what)).toBeTruthy();
  });
});

describe("무엇이 적혀 있나", () => {
  it("★ 알림을 켠 회차와 끈 회차의 마지막 줄이 다르다", async () => {
    const on = mount(sourceOf(stateOf("party", { pokeNotify: true })));
    let t = await shown();
    expect(t.getByText(STAGE.party.notify(true))).toBeTruthy();
    expect(t.queryByText(STAGE.party.notify(false))).toBeNull();
    on.unmount();

    mount(sourceOf(stateOf("party", { pokeNotify: false })));
    t = await shown();
    expect(t.getByText(STAGE.party.notify(false))).toBeTruthy();
    expect(t.queryByText(STAGE.party.notify(true))).toBeNull();
  });

  it("★ 매력 투표 안내에는 횟수도 알림 줄도 없다 — 참가자 탭과 확인창이 말한다", async () => {
    mount(sourceOf(stateOf("prevote", { pokeNotify: true })));
    const t = await shown();
    expect(t.queryByText(STAGE.party.fresh(2))).toBeNull();
    expect(t.queryByText(STAGE.party.notify(true))).toBeNull();
  });

  it("★ 버튼은 확인이 아니라 다음 할 일이다", async () => {
    mount(sourceOf(stateOf("prevote")));
    const t = await shown();
    expect(t.queryByRole("button", { name: /^확인/ })).toBeNull();
    expect(t.getAllByRole("button")).toHaveLength(1);
    expect(t.getByRole("button", { name: STAGE.go })).toBeTruthy();
  });
});
