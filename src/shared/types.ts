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

/** 발표 후에만 만들어진다. 연락처는 주지 않는다 — 힌트는 "같은 테이블"까지다. */
export interface MatchInfo {
  player: PublicPlayer;
  /** 마지막으로 발행된 자리에서 같은 테이블이면 그 번호 */
  sameTable?: number;
}

/** 참가자 본인에게만 내려가는 요약. 누가 찔렀는지는 발표 전까지 절대 포함하지 않는다. */
export interface MyPokeState {
  budget: Record<PokeRound, { max: number; used: number }>;
  sentTo: Record<string, number>;   // playerId -> 내가 보낸 횟수 (라운드 합계)
  receivedCount: number;            // 받은 횟수만. 발신자는 익명
  matches: MatchInfo[];             // 발표 후에만 채워진다
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
//
// 응답 본문은 자료 그대로다. 서버 시각은 `x-server-time` 헤더로만 싣는다 —
// 본문을 감싸면 모든 응답 타입이 한 겹 두꺼워지는데 얻는 게 없다.

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

// ─────────────────────────── 슬라이스 01 · API 계약
// 공개 표면만 정의한다. 내부 구조(클래스·레이어)는 구현자가 정한다.

/** 회차 생성 입력 */
export interface CreateEventInput {
  name: string;
  pin: string;
  /** 생략하면 서버가 만든다. 직접 넘겼는데 이미 쓰는 코드면 거부한다 */
  code?: string;
  /** "now" 는 '지금 바로'. datetime-local 이 초를 버리는 문제를 피하려고 시각이 아니라 리터럴로 받는다 */
  regOpenAt: number | "now";
  voteCloseAt: number;
  config: EventConfig;
  /** 멱등키. 같은 값으로 두 번 오면 같은 회차를 돌려준다 */
  requestId: string;
}

/** 회차 목록용. PIN 은 절대 포함하지 않는다 */
export interface EventSummary {
  id: string;
  name: string;
  code: string;
  phase: Phase;
  playerCount: number;
  createdAt: number;
}

/** 입장 코드 조회 응답 — **인증 없이** 누구나 받는다. 여기에 비밀을 넣지 마라 */
export interface PublicEvent {
  id: string;
  name: string;
  phase: Phase;
  canRegister: boolean;
  /** 등록할 수 없을 때의 안내. copy.ts 의 ENTRY.* 를 쓴다 */
  message?: string;
}

export type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "pin_collision"
  | "code_taken"
  | "schedule_order"
  | "bad_request"
  // 슬라이스 02~05 에서 늘어난 것
  | "nick_taken"     // 409 · 회차 안에서 닉네임이 겹쳤다
  | "closed"         // 409 · 지금 단계에서는 할 수 없다
  | "no_budget"      // 409 · 이번 라운드 콕을 다 썼다
  | "same_gender"    // 409 · 이성에게만 찌를 수 있다
  | "conflict";      // 409 · 그 밖의 충돌

export interface ApiErrorBody {
  error: ErrorCode;
  /** 사용자에게 보여줄 문구. copy.ts 에서 가져온다 */
  message?: string;
}

// ─────────────────────────── 슬라이스 02~06 · API 계약

/** 회차 설정 수정 (운영자). 넘긴 항목만 바뀐다 */
export interface EventPatch {
  name?: string;
  pin?: string;
  code?: string;
  config?: EventConfig;
}

/** 참가자 등록 입력. 전화번호는 재접속 키라서 응답에 되돌려주지 않는다 */
export interface RegisterInput {
  nickname: string;
  realName: string;
  age: number;
  gender: Gender;
  phone: string;
  instagram?: string;
  mbti: string;
  charms: [string, string, string];
}

/**
 * 참가자에게 내려가는 회차 상태.
 * 여기에 참가자 명단·콕 발신자·PIN 이 섞이면 안 된다. `players` 는 `PublicPlayer` 뿐이다.
 */
export interface PublicEventState {
  id: string;
  name: string;
  code: string;
  phase: Phase;
  fired: FiredMap;
  schedule: EventSchedule;
  config: EventConfig;
  playerCount: number;
}

/** 내 자리. 확인(ack)을 받아야 하는지까지 서버가 판단해서 내려준다 */
export interface MySeat {
  round: number;
  table: number;
  final: boolean;
  mates: number;
  men: number;
  acked: boolean;
}

/** 참가자 화면 한 벌. 이 타입이 참가자 응답의 유일한 형태다 */
export interface ParticipantState {
  event: PublicEventState;
  me: Player;              // 본인이 입력한 값이므로 본인에게는 그대로 보여준다
  roster: PublicPlayer[];
  poke: MyPokeState;
  seat?: MySeat;
}

/** 등록 응답. 같은 번호로 다시 들어온 경우 `resumed` 로 알린다 (REGISTER.welcomeBack) */
export interface RegisterResult {
  state: ParticipantState;
  resumed: boolean;
}

/** 운영자 콘솔 한 벌. 운영자만 전체를 본다 */
export interface HostState {
  meta: EventMeta;
  players: Player[];
  /** playerId -> 받은 콕 / 보낸 콕 */
  received: Record<string, number>;
  sent: Record<string, number>;
  /** 사전 투표에서 받은 콕 순위 (내림차순) */
  prevoteRank: Array<{ id: string; count: number }>;
  mutual: Array<[string, string]>;
  pokeCount: Record<PokeRound, number>;
  seatings: SeatingRound[];
}

/** 자리 초안 생성 입력. 테이블 수는 설정이 아니라 이 요청의 값이다 (ADR-5) */
export interface SeatingInput {
  tableCount: number;
  final: boolean;
}
