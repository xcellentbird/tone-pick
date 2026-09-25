/**
 * 참가자 화면이 자료를 얻는 통로.
 *
 * 화면 컴포넌트와 자료 통로를 갈라둔다. 화면은 "무엇을 그리나" 만 알고,
 * 세션·요청 경로는 이 통로가 안다 — 테스트가 가짜 통로를 끼워 화면만 따로 검사한다.
 */
import type { MyNoteState, MyPokeState, MyProfile, ParticipantState, PollChoice, PublicAnnouncement, RegisterInput, StageKey } from "../../shared/types.ts";
import { api, post, put } from "./api.ts";

export interface ParticipantSource {
  /** 다시 읽기의 기준. 이 값이 바뀌면 화면이 처음부터 다시 불러온다 */
  key: string;
  /** 실시간 구독에 쓸 입장 코드. 없으면 구독하지 않는다 */
  liveCode?: string;
  load(): Promise<ParticipantState>;
  poke(toId: string): Promise<MyPokeState>;
  /** 되돌리기 (ADR-34). 매력 투표는 언제나, 파티 콕은 회차 설정을 따른다 */
  unpoke(toId: string): Promise<MyPokeState>;
  /**
   * 익명 쪽지를 보낸다 (슬라이스 36). **되돌리기가 없다** — 짝이 없는 유일한 보내기다.
   * 콕과 달리 화면을 먼저 바꾸지 않는다: 서버가 돌려준 `MyNoteState` 가 보낸 묶음을 채운다.
   */
  sendNote(toId: string, text: string): Promise<MyNoteState>;
  /**
   * 홈을 열었다 — 안 본 줄을 읽음으로. **덮개가 덮고 있거나 가리기가 켜져 있으면 부르지 마라**
   * (본문을 볼 수 없는 사람을 읽은 것으로 찍으면 배지가 거짓말을 한다).
   */
  seeNotes(): Promise<MyNoteState>;
  /** 받은 줄을 지운다. **발신자에게는 아무것도 안 간다** (ADR-98) */
  removeNote(id: string): Promise<MyNoteState>;
  ackSeat(round: number): Promise<void>;
  /** 단계 안내를 봤다 (ADR-96). 어느 단계를 봤는지 보낸다 — 서버가 지금 단계를 대신 적지 않는다 */
  markStage(stage: StageKey): Promise<void>;
  /** 설문에 답한다 (슬라이스 27). 다시 부르면 옮겨간다. 돌려주는 건 갱신된 그 설문 하나다 */
  vote(id: string, choice: PollChoice): Promise<PublicAnnouncement>;
  /** 내 정보 고치기. 등록과 같은 입력이라 **전화번호는 여기 없다** (ADR-31) */
  saveProfile(input: RegisterInput): Promise<MyProfile>;
}

/**
 * **등록 응답이 곧 첫 화면이다.** 등록은 서버가 방금 만든 참가자 상태를 통째로 돌려주는데(`RegisterResult.state`),
 * 홈으로 넘어가서 그걸 버리고 `/me` 를 또 물으면 가장 설레는 순간에 불러오는 화면을 한 번 더 본다.
 *
 * `lib/boot.ts` 와 같은 약속이다 — **한 번만 받아간다.** 되불러오기는 새 값을 원하는 것이라 이 자리를 쓰면 안 된다.
 * 넘기고 바로 홈으로 가므로 잠깐만 믿는다 — 화면이 못 떠서 남은 값을 한참 뒤에 옛 상태로 그리지 않게.
 */
const SEED_MS = 10_000;
let seed: { code: string; state: ParticipantState; at: number } | null = null;

export function seedParticipant(state: ParticipantState) {
  seed = { code: state.event.code, state, at: Date.now() };
}

function takeSeed(code: string): ParticipantState | null {
  const held = seed;
  if (!held || held.code !== code) return null;
  seed = null;
  return Date.now() - held.at < SEED_MS ? held.state : null;
}

/** 본인 세션. 참가자 식별은 URL 이 아니라 HttpOnly 쿠키로 한다 */
export function sessionSource(code: string): ParticipantSource {
  return {
    key: `me:${code}`,
    liveCode: code,
    load: async () => takeSeed(code) ?? api<ParticipantState>(`/me?code=${encodeURIComponent(code)}`),
    poke: (toId) => post<MyPokeState>("/poke", { toId }),
    unpoke: (toId) => post<MyPokeState>("/unpoke", { toId }),
    sendNote: (toId, text) => post<MyNoteState>("/note", { toId, text }),
    seeNotes: () => post<MyNoteState>("/note/seen", {}),
    removeNote: (id) => post<MyNoteState>("/note/remove", { id }),
    ackSeat: async (round) => {
      await post("/seat/ack", { round });
    },
    markStage: async (stage) => {
      await post("/stage/seen", { stage });
    },
    vote: (id, choice) => post<PublicAnnouncement>("/vote", { id, choice }),
    saveProfile: (input) => put<MyProfile>("/me", input),
  };
}
