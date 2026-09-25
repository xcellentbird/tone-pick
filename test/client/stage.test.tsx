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
import { Overlays, useOverlay } from "../../src/client/ui/Overlays.tsx";

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

/**
 * **덮개와 시트가 겹칠 때.** 시트는 Radix 모달이라 열려 있는 동안 그 밖의 모든 것에서 손가락을 뺏는다
 * (`body` 에 `pointer-events: none`). 덮개(`.takeover`)는 그 위에 **그려지기만 하고 눌리지 않았다** —
 * 누른 손가락은 뒤에 가려진 시트에 닿았다. 등록을 마치면 도움말이 저절로 열려서(슬라이스 21),
 * 매력 투표·파티 중에 온 사람은 `참가자 보러 가기` 가 아무 일도 안 하는 화면에 갇혔다.
 *
 * 여기서는 손가락을 흉내 낼 수 없어서(happy-dom 은 가려진 것을 안 가린다) **덮개가 떠 있는 동안
 * 모달이 열려 있지 않은지**를 본다. 실제 브라우저에서 가려진 버튼을 누르는 것은 PR 에 적었다.
 */
describe("시트와 겹칠 때", () => {
  function mountWith(src: ParticipantSource, over: Partial<Parameters<typeof ParticipantView>[0]>, onTab: (t: string) => void = () => {}) {
    return render(
      <MemoryRouter>
        <ParticipantView source={src} tab="home" onTab={onTab} onProfile={() => {}} onNote={() => {}} onEdit={() => {}} onSeat={() => {}} helpOpen={false} onHelp={() => {}} {...over} />
      </MemoryRouter>,
    );
  }
  const dialogs = () => document.querySelectorAll("[role=dialog]").length;

  it("★ 도움말이 열려 있으면 단계 안내는 도움말을 닫은 뒤에 뜬다 — 둘이 겹치지 않는다", async () => {
    /*
     * 등록을 마치면 도움말이 저절로 열린다 (슬라이스 21). 매력 투표·파티 중에 온 사람에게는 단계 안내도 뜨는데,
     * 둘이 겹치면 안내의 버튼이 눌리지 않는다. **도움말이 먼저다** — 안내는 설명이라 기다릴 수 있다.
     */
    const src = sourceOf(stateOf("prevote"));
    const tabs: string[] = [];
    const r = mountWith(src, { helpOpen: true }, (t) => tabs.push(t));
    await waitFor(() => expect(dialogs()).toBe(1));
    expect(document.querySelector(".takeover"), "도움말 위에 단계 안내가 겹쳤다").toBeNull();

    // 도움말을 닫으면 안내가 선다 — 그리고 눌린다
    r.rerender(
      <MemoryRouter>
        <ParticipantView source={src} tab="home" onTab={(t) => tabs.push(t)} onProfile={() => {}} onNote={() => {}} onEdit={() => {}} onSeat={() => {}} helpOpen={false} onHelp={() => {}} />
      </MemoryRouter>,
    );
    const t = await shown();
    expect(dialogs()).toBe(0);
    fireEvent.click(t.getByRole("button", { name: STAGE.go }));
    await waitFor(() => expect(src.seen).toEqual(["prevote"]));
    await waitFor(() => expect(tabs).toContain("people"));
  });

  it("★ 프로필을 보던 중에 자리가 나와도 자리 확인이 눌린다 — 그동안 프로필 시트는 닫혀 있다", async () => {
    mountWith(sourceOf(stateOf("party", { seenStage: "party", seat: SEAT_UNACKED })), { tab: "people", profileId: "her" });
    const seat = await shown();
    expect(seat.getByText(SEAT.ack.headline(3, true))).toBeTruthy();
    expect(dialogs(), "자리 확인 뒤에 프로필 모달이 열려 있다").toBe(0);

    // 확인하면 보던 프로필이 제 라우트대로 돌아온다
    fireEvent.click(seat.getByRole("button", { name: SEAT.ack.submit(true) }));
    await waitFor(() => expect(dialogs()).toBe(1));
  });

  it("★ 확인창이 열려 있을 때 덮개가 뜨면 확인창은 취소된다 — 단계가 바뀐 뒤에 옛 행동을 실행하지 않는다", async () => {
    /*
     * 시트는 라우트라 덮개를 닫으면 돌아오지만, 확인창은 돌려놓지 않는다. 매력 투표 확인창을 띄운 채로
     * 파티가 열리면, 그 `찌르기` 는 이제 파티 콕이다 — 사람이 고른 것과 다른 일을 하게 된다.
     */
    const ran: string[] = [];
    function Asker() {
      const { confirm } = useOverlay();
      return (
        <button onClick={() => confirm({ btn: "찌르기", title: "찌를까요?", facts: [] }, () => void ran.push("run"))}>
          열기
        </button>
      );
    }
    const view = (suspend: boolean) => (
      <MemoryRouter>
        <Overlays suspend={suspend}>
          <Asker />
        </Overlays>
      </MemoryRouter>
    );
    const r = render(view(false));
    fireEvent.click(screen.getByText("열기"));
    await waitFor(() => expect(dialogs()).toBe(1));

    r.rerender(view(true));
    await waitFor(() => expect(dialogs()).toBe(0));
    r.rerender(view(false));
    await new Promise((res) => setTimeout(res, 50));
    expect(dialogs(), "덮개가 걷히자 옛 확인창이 되살아났다").toBe(0);
    expect(ran).toEqual([]);
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
