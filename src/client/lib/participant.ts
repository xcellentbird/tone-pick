/**
 * 참가자 화면이 자료를 얻는 통로.
 *
 * 화면 컴포넌트와 자료 통로를 갈라둔다. 화면은 "무엇을 그리나" 만 알고,
 * 세션·요청 경로는 이 통로가 안다 — 테스트가 가짜 통로를 끼워 화면만 따로 검사한다.
 */
import type { MyPokeState, ParticipantState, Player, RegisterInput } from "../../shared/types.ts";
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
  ackSeat(round: number): Promise<void>;
  /** 내 정보 고치기. 등록과 같은 입력이라 **전화번호는 여기 없다** (ADR-31) */
  saveProfile(input: RegisterInput): Promise<Player>;
}

/** 본인 세션. 참가자 식별은 URL 이 아니라 HttpOnly 쿠키로 한다 */
export function sessionSource(code: string): ParticipantSource {
  return {
    key: `me:${code}`,
    liveCode: code,
    load: () => api<ParticipantState>(`/me?code=${encodeURIComponent(code)}`),
    poke: (toId) => post<MyPokeState>("/poke", { toId }),
    unpoke: (toId) => post<MyPokeState>("/unpoke", { toId }),
    ackSeat: async (round) => {
      await post("/seat/ack", { round });
    },
    saveProfile: (input) => put<Player>("/me", input),
  };
}
