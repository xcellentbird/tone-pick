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
import { MemoryRouter } from "react-router";
import { ENTRY, POKE, SEAT } from "../../src/shared/copy.ts";
import type { MyPokeState, ParticipantState } from "../../src/shared/types.ts";
import Entry from "../../src/client/routes/Entry.tsx";
import { ParticipantView } from "../../src/client/routes/Participant.tsx";
import type { ParticipantSource } from "../../src/client/lib/participant.ts";
import { Overlays } from "../../src/client/ui/Overlays.tsx";

afterEach(cleanup);

// ─────────────────────────────────────────── 재료

const POKE_STATE: MyPokeState = {
  budget: { pre: { max: 3, used: 1 }, party: { max: 3, used: 0 } },
  sentTo: { her: 1 },
  sentThisRound: { her: 1 },
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
  calls: { poke: string[]; unpoke: string[]; ack: number[] };
} {
  const calls = { poke: [] as string[], unpoke: [] as string[], ack: [] as number[] };
  return {
    key: "test",
    calls,
    load: async () => participantState(),
    poke: async (toId) => {
      calls.poke.push(toId);
      return POKE_STATE;
    },
    unpoke: async (toId) => {
      calls.unpoke.push(toId);
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

  it("★ 되돌리기(−)에는 확인창이 없다 — 다시 찌르면 복구되니까", async () => {
    const source = fakeSource();
    renderParticipant(source);
    await screen.findByText(/그녀/);

    fireEvent.click(screen.getAllByLabelText(POKE.confirm.rowTarget)[0]);
    await waitFor(() => expect(source.calls.unpoke).toEqual(["her"]));
    expect(screen.queryByText(POKE.confirm.title(1))).toBeNull();
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
