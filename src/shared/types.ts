/**
 * 도메인 타입 — 클라이언트와 Worker 가 함께 쓴다.
 *
 * 가장 중요한 규칙은 `PublicPlayer` 다.
 * 참가자에게 나가는 응답에는 실명·전화번호·인스타가 절대 포함되면 안 된다.
 * (기획: 공개 범위 / ADR-1)
 */

import type { Fortune } from "./fortune.ts";

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

/**
 * 참가자에게 내려가는 형태. 이 타입 밖의 필드를 참가자 응답에 넣지 말 것.
 *
 * **나이와 MBTI 는 단계에 따라 없을 수 있다** (ADR-21). 화면은 없는 경우를 그려야 한다.
 */
export type PublicPlayer = Pick<Player, "id" | "nickname" | "gender" | "charms"> &
  Partial<Pick<Player, "age" | "mbti">>;

/**
 * 참가자 명단이 **한 번에 다 열리지 않는다** (ADR-21).
 *
 *   등록 중       명단 자체가 없다 — 몇 명이 왔는지만 안다
 *   사전 투표     닉네임과 매력. 사람을 고를 때 필요한 건 그 둘이다
 *   파티 시작 후  나이와 MBTI 까지. 눈앞에 있는 사람이라 이제 숨길 이유가 없다
 *
 * 성별은 내내 있다 — 이성만 보기와 아바타가 이걸로 그려진다.
 */
export function rosterOpen(phase: Phase): boolean {
  return phase !== "prep" && phase !== "reg";
}

export function toPublic(p: Player, phase: Phase): PublicPlayer {
  const { id, nickname, gender, charms } = p;
  const base = { id, nickname, gender, charms };
  return phase === "prevote" ? base : { ...base, age: p.age, mbti: p.mbti };
}

// ─────────────────────────── 콕

export interface Poke {
  id: string;
  fromId: string;
  toId: string;
  round: PokeRound;   // 예산은 라운드별로 분리된다
  at: number;
}

/**
 * 발표 후, **서로 찌른 쌍에게만** 만들어진다.
 *
 * 연락처가 참가자에게 나가는 **유일한 통로**다 (ADR-19). 조건이 셋 다 맞아야 한다.
 *   ① 발표 단계일 것  ② 서로 찔렀을 것  ③ 그 상대의 것일 것
 * 한쪽만 찌른 상대의 연락처는 발표 뒤에도 끝까지 나가지 않는다.
 */
export interface MatchInfo {
  player: PublicPlayer;
  /** 마지막으로 발행된 자리에서 같은 테이블이면 그 번호 */
  sameTable?: number;
  /** 서로 찌른 상대에게만. 등록할 때 이 공개를 미리 알린다 */
  contact: { realName: string; phone: string; instagram?: string };
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

/**
 * 예약할 수 있는 시각은 **앞의 두 개뿐**이다.
 *
 * 사전 투표 마감 · 파티 시작 · 발표는 예약하지 않는다. 현장에서 사람이 다 모였는지,
 * 이야기가 무르익었는지 보고 운영자가 누른다 — 시각을 미리 박아두면 그 판단을 못 한다.
 *
 * `partyAt` 은 전환을 울리지 않는다. 등록·사전 투표 시작의 기준점이고,
 * 참가자 화면 카운트다운이 향하는 곳이다.
 */
export interface EventSchedule {
  partyAt?: number;
  regOpenAt?: number;
  prevoteAt?: number;
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
  /**
   * 콕을 찌를 수 있는 대상.
   *
   * **없으면 모두에게**다 — 누구에게 마음이 가는지는 앱이 정할 일이 아니다.
   * 이성만으로 좁히고 싶은 회차에서만 `false` 를 적는다.
   * 회차마다 정한다. 파티 성격이 회차마다 다르기 때문이다.
   */
  allowSameGender?: boolean;
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

/** 새 회차의 일정 기본값. 둘 다 **파티 일시에서 거꾸로** 잰다 */
export interface Defaults extends EventConfig {
  regOpenBeforeD: number;   // 파티 N일 전에 등록 시작
  prevoteBeforeH: number;   // 파티 N시간 전에 사전 투표 시작
}

// ─────────────────────────── API
//
// 응답 본문은 자료 그대로다. 서버 시각은 `x-server-time` 헤더로만 싣는다 —
// 본문을 감싸면 모든 응답 타입이 한 겹 두꺼워지는데 얻는 게 없다.

/**
 * 운영자 권한은 하나뿐이다 — 운영자 PIN.
 *
 * 회차마다 PIN 을 따로 두던 때에는 "두 PIN 이 같으면 회차 담당자가 전체 권한을 얻는다"는
 * 사고가 있었다. 권한을 한 종류로 줄여 그 사고의 자리 자체를 없앴다 (ADR-12).
 */
export type AuthScope =
  | { kind: "player"; eventId: string; playerId: string }
  /** 명단 확인을 통과했지만 아직 등록하지 않은 사람. 등록 폼 하나만 열 수 있다 */
  | { kind: "invited"; eventId: string; phone: string }
  | { kind: "master" };

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
  /** 생략하면 서버가 만든다. 직접 넘겼는데 이미 쓰는 코드면 거부한다 */
  code?: string;
  /** 파티 일시. 나머지 일정이 여기서 거꾸로 계산된다 */
  partyAt: number;
  /** "now" 는 '지금 바로'. datetime-local 이 초를 버리는 문제를 피하려고 시각이 아니라 리터럴로 받는다 */
  regOpenAt: number | "now";
  prevoteAt: number;
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

/**
 * 회차 미리보기 — **인증 없이** 누구나 받는다. 여기에 비밀을 넣지 마라.
 *
 * 입장 코드는 절대 넣지 않는다. 참가 링크를 받은 사람이 코드를 **입력해야** 들어오는 구조라,
 * 이 응답에 코드가 실리면 그 문이 그대로 열린다.
 */
export interface PublicEvent {
  id: string;
  name: string;
  phase: Phase;
  /** 파티 일시. 링크를 받은 사람이 "그 파티가 맞나"를 확인하는 값이다 */
  partyAt?: number;
  canRegister: boolean;
  /** 등록할 수 없을 때의 안내. copy.ts 의 ENTRY.* 를 쓴다 */
  message?: string;
}

export type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "code_taken"
  | "schedule_order"
  | "bad_request"
  // 슬라이스 02~05 에서 늘어난 것
  | "not_invited"    // 403 · 초대 명단에 없는 번호다
  | "too_many"       // 429 · 번호를 너무 여러 번 넣었다
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
  code?: string;
  config?: EventConfig;
}

/**
 * 참가자 등록 입력.
 *
 * **전화번호는 여기 없다.** 입장할 때 이미 확인한 값이라 초대 쿠키에서 꺼내 쓴다 —
 * 폼에서 다시 받으면 명단에 없는 번호로 바꿔 낼 수 있다.
 */
export interface RegisterInput {
  nickname: string;
  realName: string;
  age: number;
  gender: Gender;
  instagram?: string;
  mbti: string;
  charms: [string, string, string];
}

/** 초대 명단 한 줄. 운영자만 본다 */
export interface Invite {
  phone: string;
  addedAt: number;
  /** 이미 등록한 사람이면 그 닉네임. 운영자가 누가 왔는지 명단에서 바로 본다 */
  nickname?: string;
}

/** 입장 확인 결과. 명단에 없으면 이 응답 자체가 오지 않는다 (403) */
export interface EnterResult {
  /** 이미 등록을 마친 사람인가. 그러면 등록 폼을 건너뛴다 */
  registered: boolean;
  /** 등록을 마친 사람에게만. 자기 화면 주소(`/e/:code`)로 가는 데 쓴다 */
  code?: string;
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
  /** 오늘의 연애운. 한 번 열면 그대로 남는다 — 아직 안 열었으면 없다 */
  fortune?: Fortune;
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
  /** 초대 명단. 참가자 응답에는 절대 실리지 않는다 */
  invites: Invite[];
}

/** 자리 초안 생성 입력. 테이블 수는 설정이 아니라 이 요청의 값이다 (ADR-5) */
export interface SeatingInput {
  tableCount: number;
  final: boolean;
}
