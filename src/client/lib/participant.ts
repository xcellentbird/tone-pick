/**
 * 참가자 화면이 자료를 얻는 통로.
 *
 * 구현이 둘이라서 인터페이스를 만든다 (그 전에는 만들지 않는다).
 *   · 본인이 자기 폰으로 보는 화면 — 세션 쿠키
 *   · 데모 뷰에서 운영자가 대신 보는 화면 — 운영자 권한으로 대리 호출
 *
 * 화면 컴포넌트는 한 벌뿐이고 이 통로만 갈아끼운다. 데모용 화면을 따로 만들면
 * 두 벌이 갈라져 데모가 거짓말을 하게 된다 (ADR-7).
 */
import type { MyPokeState, ParticipantState } from "../../shared/types.ts";
import { api, del, post } from "./api.ts";

export interface ParticipantSource {
  /** 화면 구분용. 데모 뷰에서 폰마다 다르다 */
  key: string;
  /** 실시간 구독에 쓸 입장 코드. 없으면 구독하지 않는다 */
  liveCode?: string;
  load(): Promise<ParticipantState>;
  poke(toId: string): Promise<MyPokeState>;
  unpoke(toId: string): Promise<MyPokeState>;
  ackSeat(round: number): Promise<void>;
}

/** 본인 세션. 참가자 식별은 URL 이 아니라 HttpOnly 쿠키로 한다 */
export function sessionSource(code: string): ParticipantSource {
  return {
    key: `me:${code}`,
    liveCode: code,
    load: () => api<ParticipantState>(`/me?code=${encodeURIComponent(code)}`),
    poke: (toId) => post<MyPokeState>("/poke", { toId }),
    unpoke: (toId) => del<MyPokeState>(`/poke/${toId}`),
    ackSeat: async (round) => {
      await post("/seat/ack", { round });
    },
  };
}

/** 데모 뷰 — 운영자가 자기 권한으로 특정 참가자의 화면을 대신 본다 */
export function demoSource(eventId: string, playerId: string): ParticipantSource {
  const base = `/host/events/${eventId}/as/${playerId}`;
  return {
    key: `demo:${eventId}:${playerId}`,
    load: () => api<ParticipantState>(base),
    poke: (toId) => post<MyPokeState>(`${base}/poke`, { toId }),
    unpoke: (toId) => del<MyPokeState>(`${base}/poke/${toId}`),
    ackSeat: async (round) => {
      await post(`${base}/seat/ack`, { round });
    },
  };
}
