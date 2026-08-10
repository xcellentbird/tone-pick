/**
 * 도메인 타입 — 클라이언트와 Worker 가 함께 쓴다.
 *
 * 가장 중요한 규칙은 `PublicPlayer` 다.
 * 참가자에게 나가는 응답에는 실명·전화번호·인스타가 절대 포함되면 안 된다.
 * (기획: 공개 범위 / ADR-1)
 */

export type Gender = "M" | "F";
export type Phase = "prep" | "reg" | "prevote" | "party" | "done";
export type PokeRound = "pre" | "party";

// ─────────────────────────── 참가자

export interface Player {
  id: string;
  nickname: string;          // 회차 내 유일. 공백·대소문자 정규화 후 비교
  realName: string;          // 운영자 전용
  age: number;
  gender: Gender;
  phone: string;             // 운영자 전용 · 재접속 키
  instagram?: string;        // 운영자 전용 · 선택
  mbti: string;              // "ENFP"
  charms: [string, string, string];
  noShow?: boolean;
  createdAt: number;
}

/** 참가자에게 내려가는 형태. 이 타입 밖의 필드를 참가자 응답에 넣지 말 것. */
export type PublicPlayer = Pick<
  Player,
  "id" | "nickname" | "age" | "gender" | "mbti" | "charms"
>;

export function toPublic(p: Player): PublicPlayer {
  const { id, nickname, age, gender, mbti, charms } = p;
  return { id, nickname, age, gender, mbti, charms };
}

// ─────────────────────────── 콕

export interface Poke {
  id: string;
  fromId: string;
  toId: string;
  round: PokeRound;   // 예산은 라운드별로 분리된다
  at: number;
}

/** 참가자 본인에게만 내려가는 요약. 누가 찔렀는지는 발표 전까지 절대 포함하지 않는다. */
export interface MyPokeState {
  budget: Record<PokeRound, { max: number; used: number }>;
  sentTo: Record<string, number>;   // playerId -> 내가 보낸 횟수
  receivedCount: number;            // 받은 횟수만. 발신자는 익명
  matches: PublicPlayer[];          // 발표 후에만 채워진다
}

// ─────────────────────────── 자리

export interface Seat {
  playerId: string;
  table: number;      // 1-based
}

export interface SeatingRound {
  round: number;
  tableCount: number;       // 라운드마다 다를 수 있으므로 함께 저장 (ADR-5)
  final: boolean;
  status: "draft" | "published";
  seats: Seat[];
  acks: string[];           // 자리 이동을 확인한 playerId
  createdAt: number;
  publishedAt?: number;
}

// ─────────────────────────── 회차

export interface EventSchedule {
  regOpenAt?: number;
  voteCloseAt?: number;
  revealAt?: number;
}

/** 실제로 전환이 일어난 시각. 예약은 여기가 비어 있을 때만 한 번 울린다. (ADR-2) */
export interface FiredMap {
  reg?: number;
  prevote?: number;
  party?: number;
  done?: number;
}

export interface EventConfig {
  maxPre: number;    // 1~5
  maxParty: number;  // 1~10
}

export interface EventMeta {
  id: string;
  name: string;
  code: string;      // 6자리 입장 코드 (회차 간 유일)
  phase: Phase;
  fired: FiredMap;
  schedule: EventSchedule;
  config: EventConfig;
  createdAt: number;
}

/** 운영자 콘솔용. pinHash 는 절대 응답에 포함하지 않는다. */
export interface EventSecret {
  pinHash: string;
}

export interface Defaults extends EventConfig {
  regOpenAfterH: number;   // 회차 생성 후 N시간 뒤 등록 시작 (0 이면 '지금 바로')
  voteWindowH: number;     // 등록 시작 후 N시간 뒤 사전 투표 마감
}

// ─────────────────────────── API

/** 모든 응답에 서버 시각을 실어 보낸다. 클라이언트 시계를 믿지 않기 위해. */
export interface Envelope<T> {
  data: T;
  serverTime: number;
}

export type AuthScope =
  | { kind: "player"; eventId: string; playerId: string }
  | { kind: "host"; eventId: string }        // 회차 PIN
  | { kind: "master" };                      // 공통 PIN

// ─────────────────────────── 실시간 (WebSocket)

export type ServerEvent =
  | { type: "phase"; phase: Phase; fired: FiredMap }
  | { type: "roster"; count: number }
  | { type: "poke"; receivedCount: number }          // 익명. 발신자 정보 없음
  | { type: "seating"; round: number; table: number }
  | { type: "reveal" }                                // 클라이언트가 다시 fetch 한다
  | { type: "pong"; serverTime: number };

export type ClientEvent =
  | { type: "ping" }
  | { type: "ack-seat"; round: number };
