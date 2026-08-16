/**
 * 오늘의 연애운 — 순수 함수만 모아둔 곳.
 *
 * 여기 있는 건 전부 **입력만 보고 답이 정해지는** 것들이다. 그래서 LLM 이 없어도,
 * 키가 없어도, 파티 당일에 외부 서비스가 죽어도 화면은 산다.
 * 실제 호출은 Worker 가 하고 (`server/fortune.ts`), 결과는 회차 DO 에 한 번만 저장된다.
 *
 * ⚠️ **LLM 에 보내는 값은 `fortuneInput()` 이 만드는 것뿐이다.**
 *    실명·전화번호·인스타는 절대 넣지 마라. 다른 참가자에게도 안 주는 걸
 *    외부 서비스에 보내는 건 더 나쁘다 (ADR-20).
 */
import type { Gender } from "./types.ts";

/** 카드 배경에 쓰는 색. 테마 토큰 이름이라 어떤 결과가 나와도 화면이 깨지지 않는다 */
export type FortuneColor = "violet" | "gold" | "teal" | "coral";

export interface Fortune {
  /** 이 화면의 주인공. 한 줄이다 */
  headline: string;
  /** 오늘의 나를 말하는 **3~5문단**. 문단 사이는 빈 줄이다 */
  body: string;
  /** 오늘의 기운에서 이어지는 작은 미션. 30분 안에 해볼 수 있고 실패해도 티가 나지 않는 것 */
  mission: string;
  color: FortuneColor;
  /** 오늘 말이 잘 통할 결. 규칙으로 정한다 (LLM 아님) */
  matchTypes: [string, string];
  at: number;
  /** 파티에서 상대에게 바로 건넬 수 있는 첫 문장 2~3개. 옛 운세에는 없다 — 화면이 조건부로 그린다 */
  starters?: string[];
  /** 오늘 하루 지니고 다닐 한 문장 */
  oneLiner?: string;
  /** 잘 통할 결 두 MBTI 가 오늘 왜 잘 맞는지 한 줄 */
  matchNote?: string;
  /** 규칙으로 만든 문구인가. 화면에서는 구분하지 않고, 운영자가 원인을 찾을 때 쓴다 */
  fallback?: boolean;
}

/**
 * LLM 에 보내는 값. **이 함수가 개인정보 경계다.**
 *
 * 여기 담기는 건 전부 이미 다른 참가자에게 보이는 것들이다 —
 * 닉네임·나이·성별·MBTI·매력 3가지. 그 밖의 것은 담지 않는다.
 */
export interface FortuneInput {
  nickname: string;
  age: number;
  gender: "M" | "F";
  mbti: string;
  charms: string[];
  /**
   * 여는 순간 본인이 넣는 생년월일. **전송에만 쓰고 저장하지 않는다** —
   * 운세와 함께 남기면 실명·전화와 나란히 놓이는 가장 무거운 신원 정보가 된다.
   */
  birth?: { year: number; month: number; day: number };
}

/**
 * DO 를 거쳐 오면 튜플이 배열로 풀린다. 여기서 좁히지 말고 넓게 받는다 —
 * 이 함수가 하는 일은 **덜어내는 것**이지 모양을 맞추는 게 아니다.
 */
export function fortuneInput(
  p: {
    nickname: string;
    age: number;
    gender: Gender;
    mbti: string;
    charms: readonly string[];
  },
  birth?: { year: number; month: number; day: number },
): FortuneInput {
  return {
    nickname: p.nickname,
    age: p.age,
    gender: p.gender,
    mbti: p.mbti,
    charms: [...p.charms],
    ...(birth ? { birth } : {}),
  };
}

/**
 * 생년월일이 진짜 달력의 날인가. 이름표(별자리·띠)를 뽑을 수 있으면 통과다 —
 * 나이와 맞는지는 따지지 않는다. 운세는 재미지 신원 확인이 아니다.
 */
export function validBirth(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 1900 || y > 2099) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * 별자리 번호 (0=물병 … 11=염소). 이름은 `copy.ts` 가 갖는다 — 이 파일에는 한국어를 두지 않는다.
 * 그 달의 경계일 이후면 그 달의 별자리, 전이면 앞 달 것이다.
 */
const ZODIAC_CUT = [20, 19, 21, 20, 21, 22, 23, 23, 24, 23, 23, 25];
export function zodiacIndex(month: number, day: number): number {
  return day >= ZODIAC_CUT[month - 1] ? month - 1 : (month + 10) % 12;
}

/** 띠 번호 (0=쥐 … 11=돼지) */
export function animalIndex(year: number): number {
  return (((year - 4) % 12) + 12) % 12;
}

/**
 * 사람마다 다르되 **매번 같은** 값을 뽑는 씨앗.
 * 운세가 열 때마다 달라지면 그 순간 전부 거짓말이 된다.
 */
export function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const COLORS: FortuneColor[] = ["violet", "gold", "teal", "coral"];

export function pickColor(seed: number): FortuneColor {
  return COLORS[seed % COLORS.length];
}

/**
 * 오늘 말이 잘 통할 결.
 *
 * 과학이 아니라 운세다. 다만 **아무 말이나 하지는 않는다** —
 * 세상을 보는 방식(N/S)이 같으면 이야기가 붙고, 에너지(E/I)가 다르면
 * 한쪽이 말하고 한쪽이 듣는다. 그 두 가지만 규칙으로 쓴다.
 */
export function matchTypes(mbti: string): [string, string] {
  const m = /^[EI][NS][TF][JP]$/.test(mbti) ? mbti : "ENFP";
  const flip = (c: string, a: string, b: string) => (c === a ? b : a);
  const same = m[1];
  return [
    `${flip(m[0], "E", "I")}${same}${m[2]}${m[3]}`,
    `${flip(m[0], "E", "I")}${same}${flip(m[2], "T", "F")}${flip(m[3], "J", "P")}`,
  ];
}

/**
 * LLM 없이 만드는 운세.
 *
 * 키가 없을 때만 쓰는 임시 문구가 아니다 — 파티 당일 외부 서비스가 느리거나 죽어도
 * **이 화면은 반드시 뜬다.** 그래서 이쪽 문장도 읽을 만해야 한다.
 * 본인이 쓴 매력 한 줄을 그대로 안아 쓴다. 남이 지어준 말보다 잘 맞는다.
 */
export function fallbackFortune(input: FortuneInput, now: number, lines: FallbackLines): Fortune {
  const seed = seedOf(`${input.nickname}:${input.mbti}`);
  const charm = input.charms[seed % input.charms.length] ?? "";
  const pick = <T,>(list: readonly T[], shift: number) => list[(seed >> shift) % list.length];
  return {
    headline: lines.headline[seed % lines.headline.length],
    body: lines.body(charm, input.mbti[0] === "E"),
    mission: lines.mission[(seed >> 3) % lines.mission.length],
    // 스타터 둘 — 같은 문장이 두 번 나오지 않게 서로 다른 자리에서 뽑는다
    starters: [...new Set([pick(lines.starters, 2), pick(lines.starters, 5)])],
    oneLiner: pick(lines.oneLiner, 4),
    matchNote: pick(lines.matchNote, 6),
    color: pickColor(seed),
    matchTypes: matchTypes(input.mbti),
    at: now,
    fallback: true,
  };
}

/** 문구는 `copy.ts` 에서 넘겨받는다. 이 파일에는 한국어를 두지 않는다 */
export interface FallbackLines {
  headline: readonly string[];
  mission: readonly string[];
  starters: readonly string[];
  oneLiner: readonly string[];
  matchNote: readonly string[];
  body: (charm: string, outgoing: boolean) => string;
}

/**
 * 저장돼 있던 운세를 지금 모양으로 읽는다.
 *
 * 저장된 자료는 코드보다 오래 산다 — '오늘의 한 걸음'(`step`)이 '오늘의 미션'(`mission`)이 됐을 때
 * 이미 저장된 운세가 그대로 올라오면 미션 칸이 빈다. 기본값 NaN 사고와 같은 자리다.
 */
export function readFortune(saved: unknown): Fortune {
  const { step, ...rest } = saved as Fortune & { step?: string };
  return { ...rest, mission: rest.mission || step || "" };
}

/**
 * 문단을 나눈다. 빈 줄이 문단 경계다 — 모델이 한 문단만 줘도 그대로 한 덩어리로 그린다.
 */
export function paragraphs(body: string): string[] {
  return body.split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean);
}

/**
 * LLM 응답을 읽는다. 모델이 무엇을 뱉든 **화면에 들어갈 수 있는 모양**만 통과시킨다.
 * 하나라도 비면 통째로 버리고 규칙 문구를 쓴다 — 반쯤 채워진 운세가 제일 이상하다.
 */
export function parseFortune(raw: string, input: FortuneInput, now: number): Fortune | null {
  const text = raw.trim().replace(/^```(?:json)?/, "").replace(/```$/, "");
  let data: {
    headline?: unknown;
    body?: unknown;
    mission?: unknown;
    step?: unknown;
    starters?: unknown;
    oneLiner?: unknown;
    matchNote?: unknown;
  };
  try {
    data = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    return null;
  }
  const str = (v: unknown, max: number) =>
    typeof v === "string" && v.trim().length > 0 && v.length <= max ? v.trim() : null;

  const headline = str(data.headline, 60);
  // 3~5문단 자유 길이 — 다섯 문단이 넉넉히 들어가는 크기까지
  const body = str(data.body, 2600);
  // 이름을 바꾸기 전 모델이 `step` 으로 답하는 일이 있다. 뜻이 같으면 받아준다
  const mission = str(data.mission, 160) ?? str(data.step, 160);
  if (!headline || !body || !mission) return null;

  // 새로 추가된 항목들은 **없어도 운세를 버리지 않는다** — 화면이 조건부로 그린다.
  // 옛 저장본과 새 저장본이 같은 코드로 읽혀야 한다
  const starters = Array.isArray(data.starters)
    ? data.starters
        .filter((v): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 90)
        .map((v) => v.trim())
        .slice(0, 3)
    : [];
  const oneLiner = str(data.oneLiner, 70);
  const matchNote = str(data.matchNote, 90);

  return {
    headline,
    body,
    mission,
    ...(starters.length ? { starters } : {}),
    ...(oneLiner ? { oneLiner } : {}),
    ...(matchNote ? { matchNote } : {}),
    color: pickColor(seedOf(`${input.nickname}:${input.mbti}`)),
    matchTypes: matchTypes(input.mbti),
    at: now,
  };
}
