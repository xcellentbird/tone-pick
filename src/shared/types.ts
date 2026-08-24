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

/**
 * 매칭됐을 때 상대에게 **무엇까지 열지.** 본인이 등록할 때 고른다 (ADR-37).
 *
 * **이름은 여기 없다 — 늘 열린다.** 매칭된 상대에게 이름조차 안 주면 앱이 해줄 게 없고,
 * 그건 ADR-19 이전으로 돌아가는 것이다. 고르는 건 **연락 수단 둘**이고, 서로 독립이다.
 *
 *   이름만 · 이름+전화번호 · 이름+인스타 · 이름+전화번호+인스타
 *
 * 한 쌍이 서로 다르게 골랐으면 `minShare()` 가 **칸마다 따로** 둘 다 허락한 것만 남긴다.
 * 아무도 자기가 낸 것보다 더 받지 않는다.
 *
 * ⚠️ **발표 뒤에 고르게 만들지 마라.** 그 순간 이 값은 "이 사람에게 열까" 가 되고,
 * 안 여는 것이 **이름 붙은 거절**이 된다 — 이 앱이 없애려는 바로 그 경험이다 (ADR-37).
 * 프로필과 **같은 때 굳는다** (ADR-31) — 누가 나를 골랐는지 알기 전에 정해져 있어야 한다.
 */
export interface ContactShare {
  phone: boolean;
  instagram: boolean;
}

export interface Player {
  id: string;
  nickname: string;          // 회차 내 유일. 공백·대소문자 정규화 후 비교
  realName: string;          // 운영자 전용
  age: number;
  gender: Gender;
  phone: string;             // 운영자 전용 · 재접속 키
  /**
   * 운영자 전용 + 발표 후 서로 찌른 상대에게 (ADR-19).
   * **필수다** — 매칭되면 서로에게 공개되는 연락 수단이라 없으면 매칭이 반쪽이 된다.
   * (한동안 선택이었다. 필수가 되기 전에 등록한 행이 남아 있었기 때문인데,
   * 그 자료는 1.0.0 기준선에서 사라졌다.)
   */
  instagram: string;
  mbti: string;              // "ENFP"
  charms: [string, string, string];
  /**
   * 매칭 상대에게 전화번호·인스타를 열지 (ADR-37). **등록할 때 둘 다 반드시 고른다.**
   * 옛 회차의 행에는 이 칸이 없다 — 그때 한 약속이 "발표 때 열린다" 였으므로 **둘 다 열림**으로 읽는다.
   */
  contactShare: ContactShare;
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
 * 연락처가 참가자에게 나가는 **유일한 통로**다 (ADR-19). 조건이 셋 다 맞아야 열리고,
 * 그 안에서 **무엇까지** 열리는지는 넷째가 정한다.
 *   ① 발표 단계일 것  ② 서로 찔렀을 것  ③ 그 상대의 것일 것
 *   ④ **두 사람이 고른 `contactShare` 를 칸마다 겹쳐, 둘 다 허락한 것만** (ADR-37)
 * 한쪽만 찌른 상대의 연락처는 발표 뒤에도 끝까지 나가지 않는다.
 */
export interface MatchInfo {
  player: PublicPlayer;
  /** 마지막으로 발행된 자리에서 같은 테이블이면 그 번호 */
  sameTable?: number;
  /**
   * 서로 찌른 상대에게만. **`realName` 은 늘 있다** — 이름은 고르는 값이 아니다 (ADR-37).
   *
   * `phone`·`instagram` 은 **두 사람이 다 열기로 했을 때만** 각각 실린다.
   * 둘 다 없으면 이름만 간다 — 화면은 그 경우를 그려야 한다.
   */
  contact: { realName: string; phone?: string; instagram?: string };
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
  /**
   * 매력 투표가 닫히는 시각 (ADR-39). 기본은 파티 **1시간 전**.
   *
   * **전환이 아니라 판정이다.** 알람이 울리지 않고 `phase` 도 그대로 `prevote` 다 —
   * `canPoke()` 가 서버 시각과 견줘 답할 뿐이다. 그래서 `fired` 에 짝이 없다.
   *
   * 시각으로 못 박은 이유는 **현장이 아니라 준비가 이 시각을 쓰기** 때문이다.
   * 마감돼야 자리를 짤 수 있고, 짜는 데 시간이 걸린다 (ADR-14 예외).
   */
  voteEndAt?: number;
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
  /** 파티 콕을 되돌릴 수 있나 (ADR-34). **없으면 된다** — 잘못 누른 것을 못 무르게 할 이유가 없다 */
  allowUndo?: boolean;
  /** 매력 투표를 되돌릴 수 있나 (ADR-34). **없으면 된다**. 라운드마다 따로 정한다 */
  allowUndoPre?: boolean;
  /**
   * 콕을 받으면 참가자에게 알릴 것인가 (ADR-34). **없으면 알리지 않는다.**
   *
   * 첫 회차에서 받은 콕 0회가 11명(30%)이었다 — 알림이 있으면 그 쏠림이 실시간으로 체감되고,
   * 그건 다음 파티에 안 나오는 이유가 된다. 켜는 회차에서만 켠다.
   *
   * **알림은 파생값이다** (`noticesOf`). 콕을 되돌리면 그 줄이 저절로 사라져,
   * 받지 않았던 상태로 돌아간다 — 지울 메시지가 애초에 저장돼 있지 않다.
   */
  pokeNotify?: boolean;
}

/**
 * 참석 상태 (ADR-33). **없으면 `안 옴`** — 값을 셋 두는 대신 둘만 저장한다.
 *
 * `나감` 은 도착했던 사람만 될 수 있어서 순서가 있는 한 축이다.
 * 시각 둘(`arrivedAt`·`leftAt`)로 두면 "나갔는데 온 적 없음" 같은 조합이 생긴다.
 */
export type Attendance = "arrived" | "left";

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
  | { type: "poke"; receivedCount: number }          // 익명. 발신자 정보 없음
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
  /** 필수. 매칭되면 서로에게 공개되는 연락 수단이라 (ADR-19) 없이는 매칭이 반쪽이 된다 */
  instagram: string;
  mbti: string;
  charms: [string, string, string];
  /**
   * **기본값을 두지 않는다** (ADR-37). 둘 중 하나라도 안 고르면 등록이 막힌다 —
   * 연락처를 여는 동의라서, 안 고른 것을 허락으로 읽으면 그건 동의가 아니다.
   *
   * ⚠️ `contactShare.phone` 은 **번호를 받는 칸이 아니다** (ADR-31). 서버가 토큰에서 꺼내 둔
   * 번호를 **열지 말지** 정하는 참·거짓이다. `RegisterInput` 에 번호 문자열을 두지 마라.
   */
  contactShare: ContactShare;
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
  /** 운영자가 안내문을 보냈다고 표시한 시각. 없으면 아직 안 보냈다 */
  sentAt?: number;
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
  final: boolean;
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
  me: Player;              // 본인이 입력한 값이므로 본인에게는 그대로 보여준다
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
   * playerId -> 보낸 콕 / 받은 콕.
   *
   * 받은 콕은 **현황 탭의 순위**에서만 쓴다 (ADR-30).
   * 참가자 탭의 개인 행에는 넣지 않는다 — 명단을 훑으며 한 사람씩 볼 숫자가 아니다.
   */
  sent: Record<string, number>;
  received: Record<string, number>;
  /** 사전 투표에서 받은 콕 순위 (내림차순) */
  prevoteRank: Array<{ id: string; count: number }>;
  mutual: Array<[string, string]>;
  pokeCount: Record<PokeRound, number>;
  /** 라운드별로 **한 사람이 가장 많이 쓴 횟수**. 콕 상한을 이 아래로 내릴 수 없다 */
  pokeUsedMax: Record<PokeRound, number>;
  seatings: SeatingRound[];
  /**
   * 참석 상태 (ADR-33). **운영자만 본다** — `sent`·`received` 와 같은 모양으로 여기 둔다.
   * `Player` 에 넣으면 `me` 로 참가자에게 따라 나간다. 없는 키는 `안 옴` 이다.
   */
  attendance: Record<string, Attendance>;
  /** 초대 명단. 참가자 응답에는 절대 실리지 않는다 */
  invites: Invite[];
  /** 운영자가 보낸 알림. 최신순 */
  announcements: HostAnnouncement[];
}


/**
 * 자리 초안 생성 입력. 테이블 수는 설정이 아니라 이 요청의 값이다 (ADR-5).
 *
 * **뺄 사람을 받지 않는다** (ADR-41). 빠지는 건 `나감` 으로 찍힌 사람뿐이고,
 * 그건 서버가 참석 상태에서 읽는다 — 화면이 보낸 목록은 낡을 수 있다.
 */
export interface SeatingInput {
  tableCount: number;
  final: boolean;
}
