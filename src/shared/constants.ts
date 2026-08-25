import type { Defaults } from "./types.ts";
import { INVITE_TEMPLATE } from "./copy.ts";

/**
 * 등록은 **회차를 만드는 순간** 열린다 (ADR-38). 예약이 남은 건 매력 투표뿐이다 —
 * 파티 **20시간 전**에 열어, 참가자가 전날 밤에 명단을 훑어볼 수 있게 한다.
 *
 * 장소는 **빈 값이 기본**이다. 늘 같은 곳에서 여는 모임이면 한 번 적어두고 쓴다.
 */
export const DEFAULTS: Defaults = {
  maxPre: 1,
  maxParty: 2,
  place: "",
  prevoteBeforeH: 20,
  /**
   * 매력 투표는 파티 **1시간 전**에 닫힌다 (ADR-39).
   * 그 한 시간이 운영자가 첫 자리를 짜고 손보고 내보내는 시간이다.
   */
  voteEndBeforeH: 1,
  /**
   * 커플 발표는 파티 **3시간 뒤** (ADR-43). 두세 시간이면 라운드가 다 돌고
   * 이야기도 한 바퀴 돈다 — 그보다 이르면 아직 안 만나본 사람이 남는다.
   *
   * **예약이 있어도 운영자가 먼저 누를 수 있다.** 이 값은 "안 누르면 이때" 이지
   * "이때 끝난다" 가 아니다.
   */
  revealAfterH: 3,
  inviteTemplate: INVITE_TEMPLATE,
};

/**
 * 저장된 기본값을 지금 모양으로 맞춰 읽는다.
 *
 * 저장된 자료는 코드보다 오래 산다. 일정 기준을 "만든 지 N시간 뒤"에서
 * "파티 N일 전"으로 바꿨을 때, 이미 저장돼 있던 옛 모양이 그대로 화면에 올라와
 * 숫자 칸이 **NaN** 이 됐다. 없는 항목은 조용히 기본값으로 채운다.
 *
 * 모르는 항목은 버린다 — 옛 키를 들고 다니면 다음 사람이 그게 쓰이는 줄 안다.
 */
export function withDefaults(saved: Partial<Defaults> | null | undefined): Defaults {
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  const text = (v: unknown, fallback: string) => (typeof v === "string" && v.trim() ? v : fallback);
  return {
    maxPre: num(saved?.maxPre, DEFAULTS.maxPre),
    maxParty: num(saved?.maxParty, DEFAULTS.maxParty),
    // 장소는 **비워두는 것도 뜻이 있다** — 회차마다 다른 곳에서 연다는 뜻이다
    place: text(saved?.place, DEFAULTS.place),
    prevoteBeforeH: num(saved?.prevoteBeforeH, DEFAULTS.prevoteBeforeH),
    voteEndBeforeH: num(saved?.voteEndBeforeH, DEFAULTS.voteEndBeforeH),
    revealAfterH: num(saved?.revealAfterH, DEFAULTS.revealAfterH),
    inviteTemplate: text(saved?.inviteTemplate, DEFAULTS.inviteTemplate),
  };
}

export const LIMITS = {
  maxPre: { min: 1, max: 5 },
  maxParty: { min: 1, max: 10 },
  charms: 3,
  nicknameMin: 1,
  nicknameMax: 15,
  /** 인스타 아이디 실제 상한과 같다. 서버·화면이 같이 본다 */
  instagramMax: 30,
  /** 실명 상한. 여권식 긴 이름도 들어오게 넉넉히 — 좌석 칩·연락 카드가 견디는 크기까지만 */
  realNameMax: 20,
  /** 매력 한 줄 상한. 문장으로 써도 좋지만 명단 카드가 견디는 크기까지만 */
  charmMax: 100,
  tableMax: 12,
  /**
   * 한 회차 초대 명단 상한. 붙여넣기 사고로 수만 줄이 들어오는 걸 막는다.
   * 파티 규모의 상한이 아니다 — 100명 파티 + 시연·리허설 여유가 들어가는 크기로 둔다.
   */
  inviteMax: 150,
  /** 장소 상한. 안내문에 한 줄로 들어가는 값이라 한 줄이 견디는 크기까지만 */
  placeMax: 60,
  /** 안내문 문구 상한. 문자 한 통에 들어가는 크기를 훌쩍 넘기지 않게 (ADR-32) */
  inviteTemplateMax: 500,
  /** 테이블당 인원이 이 범위를 벗어나면 운영자에게 경고 */
  seatPerTable: { warnBelow: 2, warnAbove: 8 },
} as const;

/** 자리 배정 벌점 가중치. 상세는 문서 `자리배정-알고리즘.md` */
/**
 * 자리 배정 가중치. 낮을수록 좋은 자리다 (벌점), 음수는 끌어당기는 힘이다.
 *
 * **끌림은 표 하나하나가 만든다** (ADR-40). 예전에는 상호냐 단방향이냐 **두 칸**뿐이라,
 * 한 사람에게 세 번 투표한 것과 한 번 투표한 것이 똑같이 −4 였다.
 * 매력 투표를 여러 표로 열어둔 회차에서는 그 표들이 자리에 아무 말도 하지 않았다.
 */
export const SEAT_W = {
  AGE: 30,          // 10살 이상 차이 — 가장 무겁다
  REP: 8,           // 재회 (라운드마다 증가, AGE*0.75 상한)
  IE: 4,            // I·E 쏠림
  VOTE: 4,          // **표 하나당** 끌림. 어느 쪽이 보냈든 같다
  MUTUAL: 8,        // 서로 보냈다는 사실에 **얹는** 부가 점수
} as const;

/**
 * 끌림의 상한. **나이차 벌점(30)을 넘지 못한다.**
 *
 * 넘게 두면 한 쌍이 나이차를 통째로 밀어내고 그 테이블만 이상해진다 (ADR-11).
 *
 * 서로 좋아하는데 나이차가 큰 쌍은 **이 식이 못 붙인다.** 붙이는 일은 운영자가 한다 —
 * 자리 탭이 쌍을 💘 로 짚어주고 맞교환으로 옮긴다 (ADR-51).
 * 한동안 마지막 라운드가 구조로 붙였는데, 그 라운드를 걷어내면서 여기로 왔다.
 */
export const PULL_CAP = 24;

export const AGE_GAP = 10;
export const REP_CAP_RATIO = 0.75;

/**
 * 입장 문을 두드리는 횟수 제한.
 *
 * 명단 확인은 인증 없이 열리는 문이라 **"이 번호가 이 파티에 있나"를 되묻는 창구**가 된다.
 * 참가 링크를 손에 넣은 사람이 주소록을 통째로 넣어보면 누가 소개팅 파티에 갔는지 알아낼 수 있다 —
 * 이 앱이 가장 막아야 하는 종류의 유출이다.
 *
 * 그래서 회차마다, 접속지마다 실패 횟수를 센다. 사람이 자기 번호를 잘못 치는 건 두세 번이다.
 */
export const ENTRY_TRIES = { max: 8, windowMs: 10 * 60_000 } as const;

/** 초대 확인은 통과했지만 아직 등록하지 않은 상태의 수명. 등록 폼을 채울 시간이면 충분하다 */
export const INVITE_TTL = 60 * 60_000;

/**
 * 전화번호 정규화 — 숫자만 남긴다.
 *
 * 운영자는 `010-1234-5678` 로 붙여넣기도 하고 `01012345678` 로 치기도 한다.
 * 같은 번호가 다른 값으로 저장되면 같은 사람이 명단에 두 줄이 되고, 토큰도 두 개가 된다 —
 * 어느 링크를 보냈는지 아무도 모른다.
 */
export function normalizePhone(s: string): string {
  return String(s ?? "").replace(/[^0-9]/g, "");
}

/**
 * 보여줄 때만 하이픈을 넣는다. **상태와 전송은 숫자 그대로다** (`normalizePhone` 과 짝).
 *
 * 끊는 자리는 **언제나 3-4-4** 다. 자리 수를 세어 3-3-4 로 바꾸면 열한 번째를 치는 순간
 * 하이픈이 한 칸 밀려서 칸이 흔들린다 — 마지막 글자에서 화면이 움직이는 건 오타처럼 보인다.
 * 열 자리 옛 번호(011)는 `011-2345-678` 로 조금 어색하게 끊기지만 읽는 데 지장이 없다.
 *
 * 치는 도중에도 있는 만큼만 끊어 준다 — 몇 자리를 넣었는지 눈으로 세어진다.
 */
/**
 * 전화번호 칸에 미리 들어가 있는 세 글자. **여덟 자리만 치면 된다.**
 *
 * 번호를 치는 칸은 이제 **운영자 명단 하나뿐이다** (ADR-32) — 참가자는 번호를 치지 않는다.
 * 그래서 여기서 틀리면 조용하다: 그 줄에도 토큰이 생기고 링크도 나가므로 화면에 티가 안 나고,
 * 엉뚱한 사람에게 링크를 보낸 것을 파티 당일에야 안다.
 * 지우고 `011` 로 고쳐 칠 수 있다 (서버 문턱은 아홉 자리다).
 */
export const PHONE_SEED = "010";

/**
 * 입력칸에서 온 값을 **저장할 숫자**로 줄인다. 칸에는 `010` 이 미리 들어가 있다.
 *
 * 사람이 번호를 넣는 길은 치는 것만이 아니다. 그래서 세 가지를 편다.
 *
 * **① 국가번호.** iPhone 연락처는 한국 번호를 `+82 10-1234-5678` 로 저장하고,
 * 사파리 자동완성과 붙여넣기가 그 모양으로 들어온다. 숫자만 남기면 `821012345678` 이고
 * 앞에서 열한 자리를 자르면 `82101234567` — **틀린 번호가 그대로 통과한다.**
 * 명단에는 아무에게도 닿지 않는 번호가 조용히 들어가고, 그 줄의 링크는 갈 곳이 없다.
 * (안드로이드는 보통 `01012345678` 로 줘서 이 문제가 안 보였다.)
 *
 * **② 씨앗 뒤 붙여넣기.** 미리 든 `010` 뒤에 커서를 두고 붙여넣으면 앞이 겹친다.
 *
 * **③ 그래도 길면 뒤에서 센다.** 열한 자리를 넘겼는데 뒤쪽 열한 자리가 `01` 로 시작하면
 * 그게 진짜 번호다. 길이 조건이 있어야 `010-0104-5678` 같은 진짜 번호를 안 건드린다.
 *
 * 자르는 곳은 여기 한 곳이다 — 칸에 `maxLength` 를 걸지 마라.
 * 브라우저가 붙여넣기를 먼저 잘라버리면 무엇이 겹쳤는지 알아볼 길이 없어진다.
 */
export function typedPhone(raw: string): string {
  let d = normalizePhone(raw);
  // 씨앗 뒤에 국가번호째로 붙여넣은 경우. 씨앗을 버리고 아래 규칙에 맡긴다
  if (d.length > 11 && d.startsWith(PHONE_SEED + "82")) d = d.slice(PHONE_SEED.length);
  // +82 10-… → 010-…  (국가번호 뒤의 0 은 있기도 없기도 하다)
  if (d.startsWith("82")) d = "0" + d.slice(2).replace(/^0+/, "");
  if (d.length > 11 && d.slice(-11).startsWith("01")) d = d.slice(-11);
  return d.slice(0, 11);
}

export function formatPhone(digits: string): string {
  const d = digits.slice(0, 11);
  return [d.slice(0, 3), d.slice(3, 7), d.slice(7)].filter(Boolean).join("-");
}

/**
 * 인스타 아이디 정규화 — 붙여넣은 껍데기를 벗긴다.
 *
 * 가장 흔한 "유효하지 않은 값"은 오타가 아니라 `@아이디` 나 프로필 URL 붙여넣기다.
 * 의도가 명백한 것을 오류로 돌려주지 않는다 — 오류 문구는 진짜 오타에만 쓴다.
 */
export function normalizeInstagram(raw: string): string {
  const s = String(raw ?? "").trim();
  const url = s.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  if (url) {
    // 게시물·릴스·스토리 URL 의 첫 세그먼트는 아이디가 아니라 예약 경로다.
    // 아이디인 척 저장되면 매칭 상대의 연락 카드에 존재하지 않는 계정이 뜬다 —
    // 원문을 돌려줘 검증 오류로 떨어뜨리는 쪽이 조용히 틀리는 것보다 낫다.
    if (IG_RESERVED.has(url[1].toLowerCase())) return s;
    return url[1];
  }
  return s.replace(/^@+/, "");
}

/** instagram.com/<첫 세그먼트> 가 계정이 아닌 경로들 */
const IG_RESERVED = new Set([
  "p", "reel", "reels", "stories", "tv", "explore", "accounts", "share", "direct", "about", "legal", "web",
]);

/** 닉네임 비교용 정규화 — 공백 제거 + 소문자 */
export function normalizeNickname(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

/**
 * 검증·저장 전에 문자열을 한 벌로 만든다 — NFC 정규화 + 트림.
 *
 * macOS·iOS 의 일부 경로(Finder·메모에서 복사, 일부 IME)는 한글을 자소 분리형(NFD)으로 준다.
 * 눈에는 같은 "달빛"인데 코드포인트가 달라 정규식·길이·유일성 비교가 전부 어긋난다.
 * 문자열이 아닌 값(배열·불리언)은 빈 문자열로 — 코어션으로 눙치면 `true` 가 이름으로 등록된다.
 * 폼을 우회해 API 로 바로 쏘는 참가자가 있다.
 */
export function cleanName(s: unknown): string {
  return typeof s === "string" ? s.normalize("NFC").trim() : "";
}

/**
 * 닉네임 규칙 — 한글·영문만. 숫자·공백·특수문자는 받지 않고, 길이는 LIMITS 가 정한다.
 * 화면과 서버가 이 함수 하나를 같이 본다. 화면은 반환 코드로 자리별 문구를 고른다.
 */
export function nicknameProblem(s: unknown): "empty" | "short" | "long" | "chars" | null {
  const t = cleanName(s);
  if (!t) return "empty";
  if (t.length < LIMITS.nicknameMin) return "short";
  if (t.length > LIMITS.nicknameMax) return "long";
  // copy-ok
  return /^[A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ]+$/.test(t) ? null : "chars";
}

/** 실명 규칙 — 비어 있을 수 없고, 숫자를 넣을 수 없고, 길이는 LIMITS 가 정한다 */
export function realNameProblem(s: unknown): "empty" | "digit" | "long" | null {
  const t = cleanName(s);
  if (!t) return "empty";
  if (t.length > LIMITS.realNameMax) return "long";
  return /[0-9]/.test(t) ? "digit" : null;
}

/**
 * 1인당 콕 k회일 때 기대 상호 매칭 쌍 수는 파티 규모와 무관하게 k² 에 수렴한다.
 * '드묾' 문턱은 1% — 기본값(사전 1회, 8×8 기준 1.6%)이 자기 자신에게 경고하지 않게.
 * 문구 쪽 문턱은 copy.ts `pokeEstimateLabel` 에 있다. 바꾸면 둘을 같이 바꾼다.
 */
export function pokeEstimate(m: number, w: number, k: number) {
  const pairs = m * w;
  const exp = Math.min(pairs, k * k);
  const pct = pairs ? (exp / pairs) * 100 : 0;
  const tone = pct < 1 ? "rare" : pct > 15 ? "common" : "good";
  return { pairs, exp, pct, tone } as const;
}

/**
 * 아바타에 쓰는 동물 24마리 — **작은 원(30~62px)에서 읽히는 것만.**
 *
 * 40마리에서 줄였다. 🦙🦒🐢🦢🐿️ 같은 전신 동물은 21px 에서 형체가 안 읽혔다 —
 * 얼굴형 이모지는 애초에 작은 크기용 "큰 머리"로 그려져 있어 살아남는다.
 * 수가 줄어 같은 성별 안에서 겹칠 확률은 올라가지만, 알아볼 수 없는 40마리보다
 * 알아볼 수 있는 24마리가 낫다 — 아바타는 소프트 식별자다.
 *
 * 남긴 기준: 얼굴형이거나 실루엣이 굵을 것 · 귀여울 것 · 같은 종 두 번 금지 ·
 * 사람을 닮거나 표정이 강한 것 금지 (참가자를 특정 인상으로 대신 말하게 되면 안 된다).
 */
export const ANIMALS = [
  "🐶", "🐱", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮", "🐷",
  "🐸", "🦄", "🦝", "🐔", "🐧", "🐥", "🦆", "🦉", "🐙", "🐬", "🐠", "🐢",
] as const;
