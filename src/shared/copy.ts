/**
 * 화면에 나가는 모든 한국어 문구.
 *
 * 프로토타입(`reference/poke-party.html`)에서 여러 차례 다듬어 나온 결과다.
 * 컴포넌트에서 문구를 새로 짓지 말고 여기서 가져다 쓴다. 필요한 게 없으면 여기에 추가한다.
 *
 * 이 파일이 지키는 것
 *  1. 본문에 "취소"를 쓰지 않는다 — 옆의 취소 버튼과 헷갈린다. "되돌리기"
 *  2. 확인 문구는 "정말 하시겠습니까?"가 아니라 무엇이 어떻게 바뀌는지 보여준다
 *  3. 참가자에게 "0번"을 들이대지 않는다 — 받은 콕이 0이면 다른 문장을 쓴다
 *  4. 날짜·시간 포매팅은 여기서 하지 않는다. 포맷된 문자열을 받아 조립만 한다
 */

import type { Phase, PokeRound } from "./types.ts";

// ─────────────────────────────────────────── 공통

export const PHASE_LABEL: Record<Phase, string> = {
  prep: "준비 중",
  reg: "등록 중",
  prevote: "사전 투표",
  party: "파티 진행",
  done: "발표 완료",
};

/** MBTI를 16개 중 고르게 하는 대신 4문항으로 물어본다 (모르는 사람도 답할 수 있게) */
export const MBTI_AXES = [
  { q: "사람들과 있을 때 에너지가", opts: [["E", "충전돼요"], ["I", "소모돼요"]] },
  { q: "관심이 더 가는 쪽은", opts: [["N", "가능성·아이디어"], ["S", "현실·경험"]] },
  { q: "결정할 때 더 기대는 건", opts: [["T", "논리·근거"], ["F", "마음·관계"]] },
  { q: "일정은", opts: [["J", "미리 계획하는 편"], ["P", "그때그때 정하는 편"]] },
] as const;

export const BTN = {
  cancel: "취소",
  confirm: "확인",
  delete: "삭제하기",
  back: "이전",
  next: "다음",
  close: "닫기",
  save: "저장",
  saved: "저장했어요",
  home: "처음으로",
} as const;

export const GENDER: Record<"M" | "F", string> = { M: "남성", F: "여성" };

/**
 * 연습용 환경 표시. 파티 당일 운영자가 연습용 콘솔에서 단계를 넘기고
 * "참가자 화면이 왜 안 바뀌지?" 하는 사고를 막는 게 목적이다.
 */
export const ENV_BANNER = (label: string) => `${label} — 연습용이에요. 진짜 파티가 아닙니다`;

/** 사람 수·나이처럼 단위만 붙이는 것들 */
export const UNIT = {
  people: (n: number) => `${n}명`,
  age: (n: number) => `${n}세`,
  times: (n: number) => `${n}회`,
} as const;

const roundName = (r: PokeRound) => (r === "pre" ? "사전 투표" : "파티");

/** 남은 시간·차이 표기. 숫자 계산은 `time.ts` 가 하고 여기서는 조립만 한다 */
export const DURATION = {
  dayHour: (d: number, h: number) => (h ? `${d}일 ${h}시간` : `${d}일`),
  hourMin: (h: number, m: number) => (m ? `${h}시간 ${m}분` : `${h}시간`),
  minOnly: (m: number) => `${m}분`,
} as const;

// ─────────────────────────────────────────── 참가자 · 입장/등록

export const ENTRY = {
  codeLabel: "입장 코드 6자리",
  submit: "입장하기",
  toHost: "운영자로 들어가기",
  notFound: "그런 입장 코드의 회차가 없어요. 다시 확인해주세요.",
  /**
   * 링크는 회차까지만 데려다준다. 문을 여는 건 코드다 —
   * 링크가 단톡방에 돌아도 코드를 아는 사람만 들어온다.
   */
  gateNote: "운영자가 알려준 6자리를 넣으면 등록으로 넘어가요.",
  wrongCode: "이 회차의 코드가 아니에요. 운영자에게 다시 확인해주세요.",
  partyAt: (when: string) => `파티 ${when}`,
  /** 아직 준비 중인 회차 */
  notOpenYet: (opensAt: string) => `${opensAt}부터 등록이 열립니다.`,
  /** 준비 중인데 등록 시각이 아직 정해지지 않은 경우 */
  notOpenYetUnknown: "아직 등록이 열리지 않았어요.",
  finished: "이 회차는 종료되었어요.",
} as const;

export const REGISTER = {
  steps: ["기본 정보", "연락처", "나를 소개"],
  charmHint: "문장으로 써도 좋아요. 세 가지 모두 필요해요.",
  /** 전화번호를 받는 자리에서 언제까지 들고 있을지 밝힌다 */
  retention: (days: number) => `연락처는 운영자만 보고, 파티가 끝나고 ${days}일 뒤에 지워져요.`,
  err: {
    nick: "닉네임을 입력해주세요.",
    name: "이름(실명)을 입력해주세요.",
    age: "나이는 18~99 사이로 입력해주세요.",
    gender: "성별을 선택해주세요.",
    phone: "전화번호를 정확히 입력해주세요.",
    insta: "인스타 아이디는 영문·숫자·마침표·밑줄만 쓸 수 있어요.",
    mbti: "네 가지 질문에 모두 답해주세요.",
    /** i 는 1-based */
    charm: (i: number) => `매력 ${i}번을 채워주세요. 세 가지 모두 필요해요.`,
    /** 닉네임 중복 — 닉네임 칸이 있는 1스텝으로 되돌린 뒤 띄운다 */
    nickTaken: (nick: string) =>
      `'${nick}'은(는) 이 회차에서 이미 사용 중이에요. 다른 닉네임을 골라주세요.`,
  },
  /** 같은 번호로 다시 들어온 경우 */
  welcomeBack: (nick: string) => `${nick}님, 다시 오셨네요 👋`,
  draftGuard: "작성 중인 내용이 사라집니다. 나갈까요?",
} as const;

// ─────────────────────────────────────────── 참가자 · 콕 찌르기

export const POKE = {
  /** 찌를 수 없는 상황 — 버튼을 누르면 뜨는 토스트 */
  blocked: {
    closed: "지금은 콕을 찌를 수 있는 시간이 아니에요",
    sameGender: "이성에게만 찌를 수 있어요",
    noBudget: (max: number) => `이번 라운드 콕을 모두 썼어요 (최대 ${max}회)`,
  },

  /** 확인 다이얼로그 — `+` 에만 붙는다. `−`(되돌리기)에는 붙이지 않는다 */
  confirm: {
    title: (already: number) => (already > 0 ? "한 번 더 콕 찌를까요?" : "이 사람을 콕 찌를까요?"),
    rowTarget: "이 사람에게 보낸 콕",
    rowBudget: (round: PokeRound) => `${roundName(round)} 남은 횟수`,
    count: (n: number) => `${n}회`,
    note: "상대에게는 누가 찔렀는지 보이지 않아요.\n한 번 보낸 콕은 되돌릴 수 없어요.",
    submit: "콕 찌르기",
  },

  sent: (nick: string, total: number, left: number) =>
    `${nick}님에게 콕! ${total > 1 ? `(누적 ${total}회) ` : ""}— 남은 횟수 ${left}회`,

  emptySent: "아직 아무도 찌르지 않았어요.\n찌르지 않아도 괜찮아요 — 선택이에요.",
  /** 익명으로 도착한 콕 */
  received: "누군가 콕! 찔렀어요",
  /** 익명 콕이 쌓이면 정보량 0인 카드가 반복된다 — 하나로 합쳐 세어준다 (UI.md) */
  receivedTotal: (n: number) => `지금까지 ${n}회 받았어요 — 누구인지는 비밀이에요`,
  /** 알림이 하나도 없을 때 */
  none: "아직 알림이 없어요",
} as const;

// ─────────────────────────────────────────── 참가자 · 명단/프로필/내 정보

export const PEOPLE = {
  /** 한 버튼을 껐다 켜면 지금 어느 쪽인지 알 수 없다. 둘 중 하나를 고르게 한다 */
  onlyOpposite: "이성만",
  everyone: "전체",
  empty: "아직 참가자가 없어요",
  /** 프로필 시트에서는 매력 전문을 보여준다 */
  charmTitle: "이 사람의 매력",
  sentSoFar: (n: number) => `내가 보낸 콕 ${n}회`,
} as const;

export const ME = {
  title: "내 정보",
  hidden: "••••••",
  show: "가린 정보 보기",
  hide: "다시 가리기",
  hideNote: "실명과 전화번호는 기본으로 가려둬요. 파티장에서는 어깨너머로 보입니다.",
  labels: {
    nickname: "닉네임",
    realName: "이름",
    age: "나이",
    gender: "성별",
    phone: "전화번호",
    instagram: "인스타",
    mbti: "MBTI",
    charms: "나의 매력",
    event: "회차",
    code: "입장 코드",
  },
} as const;

// ─────────────────────────────────────────── 참가자 · 홈

/**
 * 홈은 "지금 무슨 일이고 내가 뭘 하면 되나"에 답하는 자리다.
 * 단계 이름("사전 투표")은 운영자 용어다 — 참가자에게는 할 일을 문장으로 준다.
 */
export const HOME = {
  todo: {
    prep: { title: "곧 시작해요", body: "운영자가 등록을 열면 알려드릴게요." },
    reg: { title: "사람들이 모이는 중이에요", body: "다 모이면 콕 찌르기가 열려요." },
    prevote: {
      title: "마음이 가는 사람을 콕 찔러보세요",
      body: "상대에게는 누가 찔렀는지 보이지 않아요. 서로 찔렀을 때만 발표 때 공개돼요.",
    },
    party: {
      title: "오늘 만난 사람도 찔러보세요",
      body: "파티 라운드 콕을 새로 받았어요. 사전 투표에서 찌른 건 그대로예요.",
    },
    done: { title: "결과가 나왔어요", body: "서로 찌른 상대를 확인해보세요." },
  },
  news: "지금까지의 소식",
  goPeople: "참가자 보러 가기",
  goResult: "결과 보기",
  matched: (n: number) => `서로 찌른 상대 ${n}명`,
  seatWaiting: "자리가 정해지면 여기에 알려드려요",
} as const;

// ─────────────────────────────────────────── 참가자 · 자리

export const SEAT = {
  /** 자리가 발행되면 전체 화면으로 알리고 확인을 받는다. 발표 후에는 띄우지 않는다 */
  ack: {
    kicker: (round: number, final: boolean) =>
      final ? "마지막 자리예요" : `${round}라운드 자리가 정해졌어요`,
    headline: (table: number) => `${table}번 테이블로 이동해주세요`,
    mates: (total: number, men: number) => `같은 테이블 ${total}명 · 남 ${men} / 여 ${total - men}`,
    submit: "자리로 이동했어요",
    watching: "운영자가 이동 현황을 보고 있어요",
  },
  banner: (table: number) => `${table}번 테이블`,
  sectionTitle: "🪑 자리 안내",
} as const;

// ─────────────────────────────────────────── 참가자 · 발표

export const REVEAL = {
  mutualTitle: "💘 서로 찔렀어요",
  /** 상호 매칭이 없을 때 — 받은 콕이 0이면 숫자를 꺼내지 않는다 */
  noMutual: (received: number) =>
    received === 0
      ? "이번엔 서로 닿지 않았네요.\n오늘 같은 테이블에서 나눈 이야기가 더 오래 남을 수도 있어요."
      : `이번엔 서로 찌른 상대가 없었어요.\n그래도 ${received}번의 콕을 받았답니다 — 누구인지는 끝까지 비밀이에요 😉`,
  /** 매칭 상대에게 주는 힌트. 연락처는 주지 않는다 */
  hintSameTable: (table: number) => `같은 ${table}번 테이블이에요 — 옆자리에서 인사해보세요`,
  hintOther: "파티장에서 직접 인사하고 연락처를 나눠보세요",
  anonTitle: (count: number) => `🔒 익명으로 남은 콕 ${count}회`,
  anonNote: "한쪽만 찌른 경우에는 상대가 누구인지 공개되지 않아요. 서로 찔렀을 때만 알 수 있습니다.",
} as const;

// ─────────────────────────────────────────── 참가자 · 상태 셀 / 알림

export const STATUS = {
  done: "🎊 발표 완료",
  /** 파티 중 참가자가 가장 자주 확인하는 숫자. 상단에 항상 띄운다 */
  pokeLeft: (n: number) => `콕 ${n}회 남음`,
  /**
   * 카운트다운이 향하는 곳은 **파티 시작**뿐이다.
   * 투표 마감과 발표는 운영자가 누르는 것이라 셀 수 있는 시각이 없다 —
   * 없는 마감을 세어 보여주면 참가자가 그 숫자를 믿고 조급해진다.
   */
  untilParty: "파티까지",
  peopleHere: "함께하는 사람",
  pokeClosed: "마감했어요",
  pokeSoon: "곧 시작해요",
} as const;

/** 참가자 알림. `ev.fired` 에서 파생되며 읽음 상태를 따로 저장하지 않는다 */
export const NOTICE = {
  prevote: (maxPre: number) => ({
    icon: "🗳️",
    title: "사전 투표가 시작됐어요",
    body: `1인당 ${maxPre}회씩 콕을 찌를 수 있어요`,
  }),
  party: (maxParty: number) => ({
    icon: "🎉",
    title: "사전 투표가 마감됐어요",
    body: `파티 라운드 콕 ${maxParty}회를 새로 받았어요`,
  }),
  done: {
    icon: "🎊",
    title: "결과가 발표됐어요",
    body: "서로 찌른 상대를 확인해보세요",
  },
  /** 운영자가 발표를 되돌린 경우 */
  unrevealed: {
    icon: "↩︎",
    title: "운영자가 발표를 되돌렸어요",
    body: "결과가 잠시 감춰졌어요. 곧 다시 발표될 수 있어요",
    warn: true,
  },
} as const;

// ─────────────────────────────────────────── 운영자 · 단계 전환

type Fact = readonly [string, string];
export interface ActionCopy {
  btn: string;
  title: string;
  danger?: boolean;
  facts: Fact[];
}

/** 단계 전환 확인. 참가자 전원의 화면이 바뀌므로 무엇이 달라지는지 항목별로 보여준다 */
export function phaseAction(
  to: Phase,
  v: { code: string; maxPre: number; maxParty: number },
): ActionCopy | null {
  switch (to) {
    case "reg":
      return {
        btn: "참가자 등록 시작",
        title: "참가자 등록을 시작할까요?",
        facts: [
          ["참가자", `입장 코드 ${v.code}로 들어와 등록할 수 있게 됩니다`],
          ["콕 찌르기", "아직 잠겨 있어요"],
        ],
      };
    case "prevote":
      return {
        btn: "사전 투표 시작",
        title: "사전 투표를 시작할까요?",
        facts: [
          ["참가자", `1인당 ${v.maxPre}회씩 콕을 찌를 수 있게 됩니다`],
          ["등록", "계속 열려 있어요 — 늦게 온 사람도 참가할 수 있습니다"],
          ["마감", "예약된 마감은 없어요. 파티를 시작할 때 함께 마감됩니다"],
        ],
      };
    case "party":
      return {
        btn: "파티 진행 시작",
        title: "사전 투표를 마감하고 파티를 시작할까요?",
        facts: [
          ["사전 투표", "지금 순위로 마감됩니다"],
          ["콕 예산", `파티용으로 1인당 ${v.maxParty}회가 새로 지급됩니다`],
          ["기존 콕", "사전 투표에서 찌른 건 그대로 남습니다"],
        ],
      };
    case "done":
      return {
        btn: "결과 발표",
        title: "결과를 발표할까요?",
        danger: true,
        facts: [
          ["참가자", "서로 찌른 상대를 바로 확인하게 됩니다"],
          ["콕 찌르기", "즉시 마감됩니다"],
          ["되돌리기", "발표를 취소해도 이미 본 사람에게는 소용이 없어요"],
        ],
      };
    default:
      return null;
  }
}

export const UNREVEAL: ActionCopy = {
  btn: "발표 되돌리기",
  title: "발표를 되돌릴까요?",
  danger: true,
  facts: [
    ["참가자 화면", "결과가 다시 숨겨집니다"],
    ["콕 찌르기", "파티 진행 단계로 돌아가 다시 열립니다"],
    ["이미 본 사람", "되돌릴 수 없어요"],
  ],
};

/**
 * 수동 진행이 예약과 얼마나 어긋나는지 한 줄로. 시간 포맷은 호출부에서 만들어 넘긴다.
 * 예약이 있는 전환은 둘뿐이라 나머지는 null 이다.
 */
export function schedDiff(
  to: Phase,
  v: { atText: string; gapText: string; direction: "early" | "late" | "same" },
): Fact | null {
  const what = { reg: "등록 시작", prevote: "사전 투표 시작" }[to as "reg" | "prevote"];
  if (!what) return null;
  if (v.direction === "early")
    return ["예약과 차이", `예약된 ${what}은 ${v.atText} — ${v.gapText} 일찍 진행됩니다. 남은 예약은 해제돼요.`];
  if (v.direction === "late")
    return ["예약과 차이", `예약된 ${what}(${v.atText})이 ${v.gapText} 지났어요.`];
  return ["예약", `예약 시각(${v.atText})과 거의 같습니다.`];
}

// ─────────────────────────────────────────── 운영자 · 삭제

export const DELETE_PLAYER = {
  title: "이 참가자를 삭제할까요?",
  facts: (v: { sent: number; received: number; rounds: number }): Fact[] => [
    ["보낸 콕", `${v.sent}회 → 삭제`],
    ["받은 콕", `${v.received}회 → 삭제`],
    ["배정된 자리", `${v.rounds}개 라운드 → 해제`],
  ],
  note: "이 참가자가 주고받은 콕 기록이 모두 사라지고 되돌릴 수 없어요.\n이미 발행한 자리에서도 빠집니다.",
} as const;

export const DELETE_EVENT = {
  title: "이 회차를 통째로 삭제할까요?",
  facts: (v: { players: number; pokes: number; rounds: number }): Fact[] => [
    ["참가자", `${v.players}명 → 삭제`],
    ["콕 기록", `${v.pokes}회 → 삭제`],
    ["발행한 자리", `${v.rounds}라운드 → 삭제`],
  ],
  note: "참가자 명단과 연락처, 콕 기록이 모두 사라지고 되돌릴 수 없어요.\n파티가 끝났다면 삭제 대신 발표 완료 상태로 두는 것도 방법이에요.",
} as const;

// ─────────────────────────────────────────── 운영자 · 현황/자리

export const HOST = {
  seating: {
    draftOnly: "초안은 참가자에게 보이지 않아요. 알림을 보내야 자리가 뜹니다.",
    publish: "📣 알림 발송",
    makeFinal: "🏁 마지막 자리 배정",
    reopen: "배정 다시 열기",
    published: (round: number, final: boolean) =>
      final
        ? "🏁 마지막 자리를 참가자 전원에게 알렸어요"
        : `${round}라운드 자리를 참가자 전원에게 알렸어요 📣`,
    discarded: "초안을 삭제했어요",
    tooFewPerTable: "테이블당 2명이 안 됩니다. 테이블 수를 줄여주세요.",
    tooManyPerTable: "테이블당 8명이 넘습니다. 테이블을 늘리는 편이 좋아요.",
    closed: "마지막 자리까지 끝났어요. 배정을 재개하려면 아래에서 다시 열어주세요.",
    afterReveal: "발표가 끝나 자리를 더 바꾸지 않아요",
  },

  ack: {
    confirmed: "자리 이동을 확인했어요 👍",
    progress: (done: number, total: number) => `자리 이동 확인 ${done}/${total}명`,
  },

  pin: {
    wrong: "PIN이 맞지 않아요.",
    codeTaken: "이미 쓰고 있는 입장 코드예요. 다른 코드를 써주세요.",
    saveFailed: "저장하지 못했어요. 값을 다시 확인해주세요.",
  },

  defaults: {
    resetTitle: "콕·일정 기본값 되돌리기",
    resetNote: "운영자 PIN과 이미 만든 회차는 그대로 둡니다.",
  },
} as const;

// ─────────────────────────────────────────── 운영자 · 화면 라벨
//
// 운영자 화면에만 쓰는 짧은 라벨들. 참가자에게 나가는 문장과 섞이지 않게 따로 둔다.

export const HOST_UI = {
  pinLabel: "PIN을 입력해주세요",
  enter: "들어가기",
  logout: "나가기",
  newEvent: "새 회차 만들기",
  noEvents: "아직 만든 회차가 없어요. 첫 회차를 만들어보세요.",
  openDefaults: "회차 기본 설정",
  openEvents: "회차 목록",
  openDemo: "데모 뷰",
  entryLink: "참가 링크",
  copied: "복사했어요",
  /** 링크에는 코드가 없다. 운영자가 그걸 모르면 참가자가 문 앞에서 막힌다 */
  entryLinkNote: (code: string) => `링크에는 코드가 없어요. 입장 코드 ${code}를 따로 알려주세요.`,

  fields: {
    name: "회차 이름",
    code: "입장 코드",
    codeAuto: "비워두면 자동으로 만들어요",
    partyAt: "파티 일시",
    regOpenAt: "등록 시작",
    prevoteAt: "사전 투표 시작",
    /** 예약이 없는 전환을 설정 화면에서 찾지 않도록 그 자리에 이유를 적어둔다 */
    manualNote: "사전 투표 마감 · 파티 시작 · 발표는 예약하지 않아요. 현황 탭에서 직접 넘깁니다.",
    maxPre: "사전 투표 콕 (1~5)",
    maxParty: "파티 콕 (1~10)",
    pokeTarget: "콕을 찌를 수 있는 대상",
    pokeTargetOpposite: "이성에게만",
    pokeTargetAll: "모두에게",
    pokeTargetNote: "'모두에게'로 두면 동성에게도 찌를 수 있어요. 자리 배정의 남녀 정원은 그대로예요.",
    masterPin: "운영자 PIN",
    regOpenBeforeD: "파티 며칠 전에 등록을 열까요",
    prevoteBeforeH: "파티 몇 시간 전에 사전 투표를 시작할까요",
  },

  /** '지금 바로'는 시각이 아니라 토글이다 — datetime-local 이 초를 버린다 */
  nowToggle: "지금 바로",
  pickTime: "시각 지정",
  locked: "이미 지나간 일정이라 바꿀 수 없어요",

  /**
   * 현황 탭이 보여주는 건 둘뿐이다.
   *
   * 성비는 참가자 탭에 명단이 있으니 거기서 보이고, '콕을 못 받은 사람'은
   * 운영자가 알아봐야 할 일이 아니다 — 알면 그 사람을 다르게 대하게 된다.
   * 남는 건 **서로 찌른 커플**과 **사전 투표 1위**, 운영에 실제로 쓰는 둘이다.
   */
  dash: {
    mutualTitle: "서로 찌른 커플",
    mutualNone: "아직 서로 찌른 쌍이 없어요",
    mutualPair: (a: string, b: string) => `${a} ↔ ${b}`,
    prevoteTop: "사전 투표 1위",
    noVotes: "아직 콕이 없어요",
    registered: (n: number) => `등록 ${n}명`,
  },

  players: {
    empty: "아직 등록한 참가자가 없어요",
    received: (n: number) => `받은 콕 ${n}회`,
    sent: (n: number) => `보낸 콕 ${n}회`,
    contact: "연락처",
  },

  seats: {
    tableCount: "테이블 수",
    make: "자리 초안 만들기",
    discard: "초안 삭제",
    swapHint: "같은 성별 두 명을 고르면 자리를 맞바꿔요. 한 명만 옮기는 건 없어요 — 테이블 성비가 깨집니다.",
    tableTitle: (n: number) => `${n}번 테이블`,
    /** 테이블 성비. 색과 같은 정보를 글자로도 준다 */
    men: (n: number) => `남 ${n}`,
    women: (n: number) => `여 ${n}`,
    roundTitle: (round: number, final: boolean) => (final ? "마지막 자리" : `${round}라운드`),
    noRounds: "아직 배정한 자리가 없어요",
    /** 자리를 발행한 뒤 등록한 사람. 다음 배정에서 들어간다 */
    unassigned: (names: string) => `이 라운드에 자리가 없는 사람: ${names}`,
    publishTitle: "이 자리를 참가자 전원에게 알릴까요?",
    publishBtn: "알림 발송",
  },

  deleteEvent: "이 회차 삭제하기",
  /** 자동 파기 안내. 운영자가 모르는 채로 회차가 사라지면 그게 사고다 */
  retention: (days: number) =>
    `파티가 끝나고 ${days}일이 지나면 이 회차와 참가자 정보가 자동으로 삭제돼요.`,

  settings: {
    schedule: "일정",
    rules: "콕 횟수",
    identity: "이름 · 입장 코드",
    danger: "위험한 작업",
  },
} as const;

// ─────────────────────────────────────────── 콕 횟수 안내

/**
 * 1인당 k회일 때 기대 상호 매칭 쌍 수는 파티 규모와 무관하게 k² 에 수렴한다.
 * 운영자가 횟수를 고를 때 이 결과를 미리 보여준다.
 */
export function pokeEstimateLabel(pct: number): { label: string; tone: "rare" | "good" | "common" } {
  if (pct < 3) return { label: "매칭이 드물게 나올 수 있어요", tone: "rare" };
  if (pct <= 15) return { label: "적당해요", tone: "good" };
  return { label: "매칭이 흔해져 특별함이 줄어요", tone: "common" };
}

// ─────────────────────────────────────────── 화면 제목 · 탭

export const SCREEN_TITLE = {
  entry: "입장",
  home: "홈",
  join: "회차 확인",
  register: "참가자 등록",
  people: "참가자",
  alerts: "알림",
  me: "내 정보",
  demo: "데모 뷰",
  notFound: "찾을 수 없어요",
  hostPin: "운영자 PIN",
  hostEvents: "회차 목록",
  hostDefaults: "회차 기본 설정",
  hostWizard: "새 회차 만들기",
  hostConsole: "회차 콘솔",
  dash: "현황",
  players: "참가자",
  seats: "자리",
  settings: "설정",
} as const;

/**
 * 참가자 하단 탭.
 *
 * 탭마다 답하는 질문이 하나씩이고, 겹치지 않는다.
 *   홈      지금 무슨 일이고 내가 뭘 하면 되나  (+ 내 자리)
 *   참가자  누가 왔나 · 누굴 찌를까
 *   알림    무슨 일이 있었나
 *   내 정보 내가 낸 것 · 내 결과
 */
export const TABS_PARTICIPANT = [
  { key: "home", icon: "🏠", label: "홈", path: "" },
  { key: "people", icon: "👥", label: "참가자", path: "people" },
  { key: "me", icon: "🙋", label: "내 정보", path: "me" },
] as const;

/** 운영자 콘솔 탭 */
export const TABS_HOST = [
  { key: "dash", label: "현황", path: "" },
  { key: "players", label: "참가자", path: "players" },
  { key: "seats", label: "자리", path: "seats" },
  { key: "settings", label: "설정", path: "settings" },
] as const;
