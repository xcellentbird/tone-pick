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
  /**
   * **운영자 전용이다** (ADR-42). 참가자 응답에는 어느 단계에서도, 매칭됐어도 나가지 않는다.
   *
   * 받는 이유는 **운영자가 사람을 확인하기 위해서**다 — 명단의 번호와 실제로 온 사람이
   * 같은지 보는 자리. 한동안 "매칭되면 서로에게 공개되는 연락 수단" 이었는데
   * 그 쓰임이 없어졌다 (ADR-42). **등록 화면 문구도 함께 바뀌었다** — 받을 때 한 약속이 먼저다.
   */
  instagram: string;
  mbti: string;              // "ENFP"
  charms: [string, string, string];
  createdAt: number;
}

/**
 * **본인에게만** 내려가는 내 정보 (ADR-47). 남에게 가는 건 `PublicPlayer` 다.
 *
 * 전화번호가 없다는 것이 곧 방어다 — `phone` 을 여기 **다시 넣지 마라.**
 * 인스타는 남는다: 고치는 폼이 그 값을 칸에 다시 채워야 하고, 그 칸이 없으면
 * 오타를 낸 사람이 영영 못 고친다. 다만 **읽기 화면에는 그리지 않는다.**
 */
export type MyProfile = Omit<Player, "phone">;

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

export function toPublic(p: MyProfile, phase: Phase): PublicPlayer {
  const { id, nickname, gender, charms } = p;
  const base = { id, nickname, gender, charms };
  return phase === "prevote" ? base : { ...base, age: p.age, mbti: p.mbti };
}

/**
 * 본인에게 내려가는 내 정보 (ADR-47). `toPublic` 과 같은 규율이다 —
 * **빼는 게 아니라 고른다.** `Player` 에 칸이 하나 늘어도 저절로 참가자에게 흘러가지 않는다.
 *
 * 반환 타입이 `Omit<Player, "phone">` 이라, 칸을 늘리고 여기 안 적으면 **빌드가 깨진다.**
 * 그때 하는 일은 한 줄 더 적는 게 아니라 *이 값이 본인에게 가도 되나* 를 정하는 것이다.
 */
export function toMe(p: Player): MyProfile {
  const { id, nickname, realName, age, gender, instagram, mbti, charms, createdAt } = p;
  return { id, nickname, realName, age, gender, instagram, mbti, charms, createdAt };
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
 * **연락처는 여기 없다** (ADR-42). 전화번호도 인스타도 참가자에게는 어느 경우에도 나가지 않는다 —
 * 매칭된 쌍에게도. 앱이 하는 일은 *서로 마음이 맞았다는 것과 그게 누구인지*를 알려주는 데까지고,
 * 연락은 그 자리에서 두 사람이 직접 한다.
 *
 * ⚠️ **여기에 `phone`·`instagram` 을 다시 넣지 마라.** 이 타입에 자리가 없는 것이 곧 방어다 —
 * 전에는 조건 넷을 지켜야 하는 통로(`contact`)가 있었고, 그 조건이 하나라도 새면 유출이었다.
 * 지금은 **새어나갈 필드 자체가 없다.**
 *
 * `realName` 은 연락 수단이 아니라 **신원**이다. 서로 찌른 쌍이 파티장에서 서로를 찾으려면
 * 닉네임만으로는 모자라서 남긴다. 한쪽만 찌른 상대에게는 발표 뒤에도 끝까지 나가지 않는다.
 */
export interface MatchInfo {
  player: PublicPlayer;
  /** 마지막으로 발행된 자리에서 같은 테이블이면 그 번호 */
  sameTable?: number;
  /** 서로 찌른 상대의 실명. **연락 수단이 아니다** — 전화·인스타는 여기에도 없다 (ADR-42) */
  realName: string;
}

/** 참가자 본인에게만 내려가는 요약. 누가 찔렀는지는 발표 전까지 절대 포함하지 않는다. */
export interface MyPokeState {
  budget: Record<PokeRound, { max: number; used: number }>;
  /**
   * playerId -> **이번 라운드에** 내가 보낸 횟수 (ADR-34).
   *
   * 라운드를 합치지 마라. 매력 투표에서 고른 사람이 파티가 시작되자마자
   * 콕을 이미 찌른 것처럼 보이고, 되돌리기는 지울 것이 없는 채로 뜬다.
   */
  sentTo: Record<string, number>;
  /**
   * **라운드마다 따로** 받은 횟수 (ADR-46 후기). 발신자는 어느 쪽도 익명이다.
   *
   * 한동안 한 수로 합쳤다 — 가르면 *어느 단계에서 받았나* 가 드러나기 때문이었다.
   * 대신 소식 줄이 매력 투표에서도 `콕` 이라고 불렀고, 참가자가 찌른 적 없는 콕을 받은 것이 됐다.
   * **겪는 일과 화면이 갈리는 쪽을 더 나쁘게 봤다** — 대가는 ADR-46 후기에 적었다.
   */
  received: Record<PokeRound, number>;
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
  /**
   * 매력 투표가 닫히는 시각 (ADR-39). 기본은 파티 **1시간 전**.
   *
   * **전환이 아니라 판정이다.** 알람이 울리지 않고 `phase` 도 그대로 `prevote` 다 —
   * `canPoke()` 가 서버 시각과 견줘 답한다. 그건 지금도 그대로다.
   *
   * 운영자가 이 시각을 **앞당길 수 있다** (ADR-39 후기) — 그때 실제로 닫힌 시각은
   * `fired.voteEnd` 에 남고, **여기 적힌 예약은 기록으로 그대로 둔다.**
   * 덮어쓰면 "예약은 20시였는데 19시에 닫았다" 를 말할 수 없게 된다.
   *
   * 시각으로 못 박은 이유는 **현장이 아니라 준비가 이 시각을 쓰기** 때문이다.
   * 마감돼야 자리를 짤 수 있고, 짜는 데 시간이 걸린다 (ADR-14 예외).
   */
  voteEndAt?: number;
  /**
   * 커플 발표가 예약된 시각 (ADR-43). 기본은 파티 **3시간 뒤**.
   *
   * ⚠️ **파티가 시작된 뒤에만 울린다** (`dueTransition`). ADR-14 가 막은 건
   * *현장이 시계를 따라가는 것*인데, 그중에서도 가장 나쁜 건 **아무도 안 온 자리에서
   * 발표가 뜨는 것**이다. 운영자가 `파티 시작` 을 누르기 전에는 이 시각이 지나도 아무 일이 없다 —
   * 시계가 혼자 파티를 끝내지 못한다.
   *
   * 운영자는 언제든 먼저 누를 수 있고(그러면 `fired.done` 이 서서 예약은 울리지 않는다),
   * 파티가 길어지면 **발표 전까지** 이 시각을 미룰 수 있다 (`schedLocked`).
   */
  revealAt?: number;
}

/** 실제로 전환이 일어난 시각. 예약은 여기가 비어 있을 때만 한 번 울린다. (ADR-2) */
export interface FiredMap {
  /**
   * 매력 투표가 **실제로 닫힌 시각** (ADR-39 후기). 운영자가 마감을 앞당겼을 때만 찬다.
   *
   * **단계 전환이 아니다** — 이게 차도 `phase` 는 `prevote` 그대로고, 나이·MBTI(ADR-21)도
   * 파티 콕도 열리지 않는다. 여기 있는 이유는 `fired` 가 *예약과 실제를 가르는 자리*이기 때문이다.
   * `dueTransition` 은 이 값을 보지 않는다.
   */
  voteEnd?: number;
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
  /** 파티 콕을 되돌릴 수 있나 (ADR-34). **없으면 된다** — 잘못 누른 것을 못 무르게 할 이유가 없다 */
  allowUndo?: boolean;
  /** 매력 투표를 되돌릴 수 있나 (ADR-34). **없으면 된다**. 라운드마다 따로 정한다 */
  allowUndoPre?: boolean;
  /**
   * **매력 투표**를 받으면 참가자에게 알릴 것인가 (ADR-43). **없으면 알리지 않는다.**
   *
   * 라운드마다 따로 정한다 — 되돌리기(`allowUndoPre`·`allowUndo`)와 같은 꼴이다.
   * 한동안 `pokeNotify` 하나가 두 라운드를 다 덮었는데, 그 둘은 성격이 다르다:
   * 매력 투표는 **프로필만 보고** 고른 것이고 며칠에 걸쳐 쌓인다.
   * 그 숫자가 실시간으로 보이면 파티 전에 이미 순위가 생긴다.
   *
   * ⚠️ **끄면 `receivedCount` 에서도 빠져야 한다.** 화면에서 감추는 걸로는 부족하다 —
   * 그 숫자 하나가 곧 "지금까지 몇 명이 나를 골랐나" 다 (`visibleReceived`).
   */
  preNotify?: boolean;
  /**
   * **파티 콕**을 받으면 참가자에게 알릴 것인가 (ADR-34). **없으면 알리지 않는다.**
   *
   * 첫 회차에서 받은 콕 0회가 11명(30%)이었다 — 알림이 있으면 그 쏠림이 실시간으로 체감되고,
   * 그건 다음 파티에 안 나오는 이유가 된다. 켜는 회차에서만 켠다.
   *
   * **알림은 파생값이다** (`noticesOf`). 콕을 되돌리면 그 줄이 저절로 사라져,
   * 받지 않았던 상태로 돌아간다 — 지울 메시지가 애초에 저장돼 있지 않다.
   */
  pokeNotify?: boolean;
}

export interface EventMeta {
  id: string;
  name: string;
  /**
   * 파티 장소. **안내문 템플릿에만 쓰인다** (ADR-32) — 참가자 응답에는 싣지 않는다.
   * 지금 운영이 그렇다: 장소는 운영자가 1:1 로 알린다.
   */
  place?: string;
  code: string;      // 6자리 입장 코드 (회차 간 유일)
  phase: Phase;
  fired: FiredMap;
  schedule: EventSchedule;
  config: EventConfig;
  createdAt: number;
}

/**
 * 새 회차의 기본값.
 *
 * **등록 시작은 여기 없다** (ADR-38) — 회차를 만드는 순간 열린다.
 * 남은 예약은 매력 투표 시작 하나뿐이고, 그것도 **파티 일시에서 거꾸로** 잰다.
 */
export interface Defaults extends EventConfig {
  /** 파티 장소. 늘 같은 곳에서 여는 모임이라 여기 둔다 — 회차마다 고칠 수 있다 (ADR-38) */
  place: string;
  prevoteBeforeH: number;   // 파티 N시간 전에 매력 투표 시작
  voteEndBeforeH: number;   // 파티 N시간 전에 매력 투표 마감 (ADR-39)
  /**
   * 파티 N시간 **뒤**에 커플 발표 (ADR-43). 다른 일정과 방향이 반대인 유일한 값이다 —
   * 나머지는 파티 일시에서 거꾸로 재고 이것만 앞으로 잰다.
   */
  revealAfterH: number;
  /**
   * 참가자에게 보낼 안내문 (ADR-32). `{장소}` `{일시}` `{링크}` 를 회차가 채운다.
   * **회차마다 다시 쓰지 않는다** — 회차별 덮어쓰기는 만들지 않았다.
   */
  inviteTemplate: string;
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
  /**
   * 링크를 통과했지만 아직 등록하지 않은 사람. 등록 폼 하나만 열 수 있다.
   *
   * **전화번호를 담지 마라** (ADR-32). 세션은 서명만 하고 암호화하지 않아서,
   * 개발자 도구를 여는 참가자에게 페이로드가 그대로 읽힌다. 번호는 회차 DO 안에서만 푼다 —
   * 참가자가 번호를 치지 않기로 했으면 번호가 브라우저에 남을 이유도 없다.
   */
  | { kind: "invited"; eventId: string; token: string }
  | { kind: "master" };

// ─────────────────────────── 실시간 (WebSocket)

export type ServerEvent =
  | { type: "phase"; phase: Phase; fired: FiredMap }
  /**
   * 명단이 움직였다. **숫자를 싣지 않는다** — 전원에게 나가는 신호라
   * 등록 중에는 몇 명인지가 그대로 새어 나간다. 받는 쪽은 어차피 다시 읽는다 (ADR-26).
   */
  | { type: "roster" }
  | { type: "poke"; received: Record<PokeRound, number> }   // 익명. 발신자 정보 없음
  /**
   * 자리가 확정됐다. **테이블 번호는 싣지 않는다** — 전원에게 나가는 신호라
   * 남의 자리가 개발자 도구에 보이게 된다. 받은 쪽은 다시 읽어 자기 자리를 가져간다.
   */
  | { type: "seating"; round: number }
  /**
   * 운영자 알림이 움직였다 — 새 글·투표·표·닫기·지우기가 전부 이 하나다.
   * **아무것도 싣지 않는다.** 받는 쪽은 어차피 다시 읽는다 (ADR-26).
   */
  | { type: "notice" }
  | { type: "reveal" }                                // 클라이언트가 다시 fetch 한다
  | { type: "pong"; serverTime: number }
  /**
   * 서버가 보내는 게 아니라 **연결이 다시 붙었을 때 클라이언트가 스스로 만드는** 신호다.
   * 끊긴 동안 일어난 일은 서버가 다시 밀어주지 않는다 — 화면이 스스로 따라잡아야 한다.
   */
  | { type: "reconnect" };

export type ClientEvent =
  | { type: "ping" }
  | { type: "ack-seat"; round: number };

// ─────────────────────────── 슬라이스 01 · API 계약
// 공개 표면만 정의한다. 내부 구조(클래스·레이어)는 구현자가 정한다.

/** 회차 생성 입력 */
export interface CreateEventInput {
  name: string;
  /** 파티 장소. 안내문에만 쓰인다 (ADR-32) */
  place?: string;
  /** 생략하면 서버가 만든다. 직접 넘겼는데 이미 쓰는 코드면 거부한다 */
  code?: string;
  /** 파티 일시. 매력 투표 시작이 여기서 거꾸로 계산된다 */
  partyAt: number;
  /**
   * **등록 시작은 받지 않는다** (ADR-38). 회차를 만드는 순간 열린다 —
   * 명단에 없는 사람은 어차피 못 들어오므로(ADR-32) 문을 늦게 열 이유가 없었다.
   */
  prevoteAt: number;
  /** 매력 투표 마감 (ADR-39). 기본은 파티 1시간 전 */
  voteEndAt: number;
  /** 커플 발표 (ADR-43). 기본은 파티 3시간 **뒤**. `partyAt` 보다 뒤여야 한다 */
  revealAt: number;
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
  /**
   * 이 링크의 주인이 이미 등록했나. **자기 자신에 대한 답이라 새어 나갈 게 없다** —
   * 토큰을 가진 사람에게만 이 응답이 열린다 (ADR-32).
   * 화면이 `등록하기` 와 `다시 입장하기` 를 가르는 데 쓴다.
   */
  registered?: boolean;
}

export type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "code_taken"
  | "bad_request"
  // 슬라이스 02~05 에서 늘어난 것
  | "not_invited"    // 403 · 초대 명단에 없는 번호다
  | "too_many"       // 429 · 번호를 너무 여러 번 넣었다
  | "nick_taken"     // 409 · 회차 안에서 닉네임이 겹쳤다
  | "closed"         // 409 · 지금 단계에서는 할 수 없다
  | "no_budget"      // 409 · 이번 라운드 콕을 다 썼다
  | "same_gender"    // 409 · 이성에게만 찌를 수 있다
  | "locked"         // 409 · 콕이 오가기 시작해 굳은 설정이다 (ADR-35)
  | "conflict";      // 409 · 그 밖의 충돌

export interface ApiErrorBody {
  error: ErrorCode;
  /** 사용자에게 보여줄 문구. copy.ts 에서 가져온다 */
  message?: string;
}

// ─────────────────────────── 슬라이스 02~06 · API 계약

/**
 * 회차 설정 수정 (운영자). 넘긴 항목만 바뀐다.
 *
 * **입장 코드는 없다** — 한 번 정해지면 바꾸지 않는다 (ADR-22).
 * 이미 나간 링크와 안내가 어긋나고, 되돌릴 방법이 없다.
 */
export interface EventPatch {
  name?: string;
  /** 장소는 오타가 나기 쉬운 값이라 고칠 길을 함께 둔다 (ADR-32) */
  place?: string;
  config?: EventConfig;
}

/**
 * 참가자가 내는 정보. **등록과 수정이 같은 모양을 쓴다** (ADR-31) —
 * 나중에 고치는 일이라 모양이 갈리면 등록은 통과한 값이 수정에서 막힌다.
 *
 * **전화번호는 여기 없다.** 입장할 때 이미 확인한 값이라 초대 쿠키에서 꺼내 쓴다 —
 * 폼에서 다시 받으면 명단에 없는 번호로 바꿔 낼 수 있다.
 * 이 타입에 phone 을 더하지 마라. 없다는 것이 곧 방어다.
 */
export interface RegisterInput {
  nickname: string;
  realName: string;
  age: number;
  gender: Gender;
  /** 필수. **운영자가 사람을 확인하는 자리다** (ADR-42) — 참가자에게는 나가지 않는다 */
  instagram: string;
  mbti: string;
  charms: [string, string, string];
}

/** 초대 명단 한 줄. 운영자만 본다 */
export interface Invite {
  phone: string;
  addedAt: number;
  /**
   * 이 사람의 참가 링크(`/j/<회차id>/<토큰>`). **번호를 넣는 순간 생긴다** (ADR-32).
   * 운영자 응답에만 실린다 — 참가자에게 남의 토큰이 가면 그 사람이 될 수 있다.
   */
  token: string;
  /** 이미 등록한 사람이면 그 닉네임. 운영자가 누가 왔는지 명단에서 바로 본다 */
  nickname?: string;
}

/** 입장 확인 결과. 명단에 없으면 이 응답 자체가 오지 않는다 (403) */
export interface EnterResult {
  /** 이미 등록을 마친 사람인가. 그러면 등록 폼을 건너뛴다 */
  registered: boolean;
  /** 등록을 마친 사람에게만. 자기 화면 주소(`/e/:code`)로 가는 데 쓴다 */
  code?: string;
  /**
   * 이 탭이 쓸 세션 이름표 (ADR-44). **비밀이 아니다** —
   * 쿠키 여럿 중 어느 것을 읽을지 고르는 값일 뿐이라, 이것만으로는 아무 문도 열리지 않는다.
   * 증명은 끝까지 HttpOnly 쿠키 안에 있다.
   */
  ref: string;
}

/**
 * 회차 DO 가 내리는 입장 판정. **이름표는 여기 없다** —
 * 세션은 Worker 의 일이고, DO 는 쿠키도 탭도 모른다 (설계 경계).
 */
export type EntryOutcome = Omit<EnterResult, "ref">;

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
  /**
   * **인원 수는 여기 없다.** 등록 중에는 몇 명이 왔는지가 참가자에게 나가면 안 된다 —
   * 명단이 사전 투표부터 열리는 것과 같은 이유이고(ADR-21), 인원이 적을수록
   * 그 숫자 하나가 명단만큼 많은 것을 말한다.
   *
   * 사전 투표부터는 `roster` 가 있으니 셀 수 있다. 그래서 이 칸은 어느 단계에도 필요 없다.
   * 화면에서 감추는 것으로는 부족하다 — 개발자 도구를 여는 참가자가 있다.
   */
}

/** 내 자리. 확인(ack)을 받아야 하는지까지 서버가 판단해서 내려준다 */
export interface MySeat {
  round: number;
  table: number;
  mates: number;
  men: number;
  acked: boolean;
}

/** 참가자 화면 한 벌. 이 타입이 참가자 응답의 유일한 형태다 */
// ─────────────────────────── 운영자가 보내는 알림 (슬라이스 14)

export type PollChoice = "a" | "b";

/**
 * **운영자가 보낸 것.** 참가자 소식(`Notice`)은 이것에서 파생된다 — 이름을 겹치게 짓지 마라.
 * 둘을 구분 못 하게 되는 순간 "알림을 저장한다" 로 읽히고, 읽음 플래그가 뒤따라온다.
 *
 * 회차 DO 안에만 둔다. 자유 텍스트라 개인정보가 섞일 수 있고,
 * 파기는 DO 하나 지우는 일로 끝나야 한다.
 */
export interface Announcement {
  id: string;
  at: number;
  /** 텍스트 알림이면 이게 전부. 투표면 질문이다 */
  text: string;
  /** 있으면 A/B 투표다. **선택지에 사람을 넣지 마라** — 시나리오 14 의 첫 규칙이다 */
  poll?: { a: string; b: string; closedAt?: number };
}

/**
 * 참가자에게 내려가는 모양.
 *
 * **누가 무엇을 골랐는지는 여기 없다** — 숫자 둘과 *내* 선택뿐이다.
 * 한 사람 한 표를 지키려 `playerId → choice` 를 저장하긴 하지만,
 * 그 짝은 **어떤 응답에도 실리지 않는다. 운영자 응답에도.**
 * 응답에 없으면 화면이 실수로라도 보여줄 수 없다.
 */
export interface PublicAnnouncement {
  id: string;
  at: number;
  text: string;
  poll?: {
    a: string;
    b: string;
    count: { a: number; b: number };
    /** 아직 안 골랐으면 없다 */
    mine?: PollChoice;
    closed: boolean;
  };
}

/** 운영자 화면용. 집계만 더 붙는다 — 표의 주인은 여전히 아무 데도 안 나온다 */
export interface HostAnnouncement extends Announcement {
  count: { a: number; b: number };
}

/** 운영자가 보낼 때 넘기는 값. `poll` 이 없으면 텍스트 알림이다 */
export interface AnnounceInput {
  text: string;
  poll?: { a: string; b: string };
}

export interface ParticipantState {
  event: PublicEventState;
  /**
   * 본인이 **낸** 값이라 본인에게는 그대로 보여준다.
   *
   * ⚠️ **전화번호만 빠진다** (ADR-47). 그것 하나는 참가자가 낸 값이 아니라
   * 초대 명단에서 온 값이고(ADR-32 — 참가자는 번호를 치지 않는다),
   * 내 정보 탭이 답하는 질문은 *내가 낸 것이 무엇인가* 다.
   * **`Player` 로 되돌리지 마라** — 화면에서 감추는 것과 응답에 없는 것은 다르다.
   */
  me: MyProfile;
  roster: PublicPlayer[];
  poke: MyPokeState;
  seat?: MySeat;
  /** 오늘의 연애운. 한 번 열면 그대로 남는다 — 아직 안 열었으면 없다 */
  fortune?: Fortune;
  /** 운영자가 보낸 알림. 최신순 (슬라이스 14) */
  announcements: PublicAnnouncement[];
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
  /**
   * playerId -> 보낸 횟수. **라운드마다 따로 센다** (ADR-46 과 같은 이유).
   *
   * 합치면 `보낸 콕 N회` 가 매력 투표 표까지 세게 되고, 그 사람이 콕을 한 번도 안 찔렀는데
   * 찌른 것으로 적힌다 — 두 라운드는 쓰임이 다르다 (ADR-34).
   * 참가자에게 가는 수(`receivedCount`)와 달리 **운영자 화면이라 갈라도 새지 않는다.**
   */
  sent: Record<PokeRound, Record<string, number>>;
  /**
   * 받은 수를 **라운드마다 따로** 센다 (ADR-46).
   *
   * ⚠️ **받은 콕은 현황 탭의 순위에서만 쓴다** (ADR-30). 참가자 탭의 개인 행에는 넣지 마라 —
   * 명단을 훑으며 한 사람씩 볼 숫자가 아니다.
   *
   * 합쳐 세면 현황 탭의 `콕 TOP` 에 매력 투표 표가 얹혀서, 운영자가
   * *이 사람이 파티에서 몇 번 받았나* 를 못 읽는다 — 그 둘은 쓰임이 다르다 (ADR-34).
   * 매력 투표는 프로필만 보고 고른 것이고, 콕은 만나보고 고른 것이다.
   *
   * ⚠️ **다시 합치지 마라.** 합계가 필요하면 쓰는 쪽에서 더한다.
   */
  received: Record<PokeRound, Record<string, number>>;
  mutual: Array<[string, string]>;
  pokeCount: Record<PokeRound, number>;
  /** 라운드별로 **한 사람이 가장 많이 쓴 횟수**. 콕 상한을 이 아래로 내릴 수 없다 */
  pokeUsedMax: Record<PokeRound, number>;
  seatings: SeatingRound[];
  /** 초대 명단. 참가자 응답에는 절대 실리지 않는다 */
  invites: Invite[];
  /** 운영자가 보낸 알림. 최신순 */
  announcements: HostAnnouncement[];
}

/**
 * 자리 초안 생성 입력. 테이블 수는 설정이 아니라 이 요청의 값이다 (ADR-5).
 */
export interface SeatingInput {
  tableCount: number;
  /**
   * 이번 라운드에서 뺄 사람 (ADR-45). **이 요청에만 있고 저장되지 않는다** —
   * 사람에게 붙는 상태로 만들면 시간이 지나 틀리고, 틀린 상태가 다음 라운드에서
   * 사람을 조용히 빠뜨린다 (FLOWS.md). 다음 배정은 전원으로 다시 시작한다.
   */
  exclude: string[];
}
