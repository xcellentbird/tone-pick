/**
 * 이상형 찾기 — 타입과 순수 함수만. DO·요청·시각에 닿지 않는다 (fortune.ts 와 같은 자리).
 *
 * 계산은 전부 기기에서 한다 (S-D3) — 서버는 이 파일의 타입으로 **모양만** 검사하고 저장한다.
 * 벡터를 서버에 들이지 않는 것이 규칙이라, 이 파일이 server/ 를 import 하는 일은 없어야 한다.
 * 알고리즘 교체 = 아래 함수 몸통 교체다. 불변식 테스트(19-ideal-type)는 교체 후에도 통과해야 한다.
 *
 * **v2 — 고른 얼굴이 두 무리로 갈리면 두 무리를 각각 따라간다** (SPEC v2, 2026-09-28).
 * v1 은 고른 얼굴 전체의 평균 하나를 따라갔다. 4차 검증에서 두 인상을 오가며 고른 사람은
 * 무작위 대조에 2:3 으로 졌다 — 두 무리의 평균은 두 무리 **사이**로 떨어져 둘 다 아닌 얼굴을 가리킨다.
 * 그래서 `tasteCenters` 가 중심을 하나 또는 둘로 내고, 라운드 후보와 결과가 그 중심들을 나눠 따른다.
 * 갈라 보는 문턱은 둘이다 — 두 평균이 반대쪽을 향할 것(`splitCos`), 작은 무리도 두 장 이상일 것(`splitMin`).
 * 한 무리를 억지로 쪼개면 한 취향이 반으로 줄어든 채 엉뚱한 쪽을 끌어온다 — 둘 중 그쪽이 더 나쁘다.
 * 중심이 하나면 모든 함수가 v1 과 **똑같이** 돈다 (불변식 테스트가 그 길로 부른다).
 *
 * **v4 — 벡터가 얼굴 모델의 특징이 됐다** (ADR-132). v1~v3 은 LLM 이 사진마다 정해진 낱말을 고른 속성 벡터였다.
 * v4 는 얼굴 인식(SFace)과 얼굴 메시(MediaPipe)의 특징이다 — 고른 얼굴의 평균에 가장 가까운 연예인을 고르는 것은 그대로다.
 * 함수는 바뀌지 않았다. 바뀐 것은 공간이고, 공간에 매인 문턱(`splitCos` · `dupCos`)의 뜻이다 — 아래 각 칸에 적었다.
 */
import type { Gender } from "./types.ts";

/** 한 사람의 이상형 찾기 한 벌. 회차 DO 에 1인 1행 */
export interface Ideal {
  /** 결과를 만든 한 벌(자산+규칙)의 버전. 규칙만 바뀌어도 올린다 — 반응을 비교하는 열쇠 */
  v: number;
  pool: Gender;
  /** 라운드별 고른 얼굴 id — 셋 묶음, 각 1~5개 (S-C2 가 다시 그릴 재료. v1 행은 1~3개) */
  picks: string[][];
  /** 가까운 순서의 연예인 id 셋 (S-C1) */
  result: string[];
  /** 결과 확정 (S-C4). 한 번 채워지면 그대로 — 없으면 아직 무응답이다 */
  verdict?: IdealVerdict;
  /**
   * 설명글 (ADR-134) — 같은 화면에서 고르지 않은 얼굴과 견줘 LLM 이 쓴 두 문장. **결과마다 한 번** 만들고 그대로다 —
   * 다시 찾으면 새 결과와 함께 없어진다. 서버만 적는다 — 저장 요청에 실어 보내도 `readIdealInput` 이 버린다
   */
  story?: string;
  at: number;
}

/**
 * 정답 (S-C4). **결과 셋 중 진짜 이상형이 있었던 사람 전부**(1~3명) 또는 없음 (ADR-127 · 130).
 * v2 까지는 한 명이었다 — 그때 저장된 `{ chosen: "id" }` 는 읽을 때 `normalizeIdeal` 이 배열로 편다.
 * 여럿을 받는 까닭은 평가 자료다: 결과 셋이 저마다 맞았는지가 결과 1위만 맞았는지보다 많이 말한다
 */
export type IdealVerdict = { chosen: string[] } | { none: true };

/** 기기가 보내는 것. verdict 는 따로 온다 — 결과를 본 뒤에야 생기는 값이다 (S-C4). 설명글은 서버가 만든다 (ADR-134) */
export type IdealInput = Omit<Ideal, "verdict" | "story" | "at">;

export const IDEAL_SHAPE = {
  rounds: 3,
  /** 한 화면 3×3. 360px 에서 한 칸 100px 이상은 3열이 한계라 여덟이 아니라 아홉이다 */
  faces: 9,
  pickMin: 1,
  /** 상한이 '그중 가장' 이라는 우선순위를 만든다 — 다 고르면 평균이 흐려진다 */
  pickMax: 5,
  results: 3,
  /** 라운드마다 `다른 얼굴 보기` 횟수 — 억지로 고른 '덜 싫은 얼굴' 이 평균을 흐리지 않게 */
  rerolls: 1,
  /** 1단계 수 = 한 화면 × (1 + rerolls). 1라운드는 모두에게 같은 두 쪽(아홉 + 아홉)이다 */
  level1: 18,
  /** 2라운드 후보(군집 대표) 수. 아홉 × 두 쪽을 넉넉히 덮는다 — check:faces 가 자산과 맞춰 본다 */
  level2: 36,
  /**
   * 3라운드 닮은꼴 문턱(코사인). 임시값 — 실제 풀에서 종이 검증과 함께 조정한다.
   * v1~v3 의 속성 벡터는 낱말이 같으면 벡터도 같아서(코사인 1.00) 이 문턱이 판박이를 밀었다. v4 의 얼굴 벡터에서는
   * 서로 다른 두 사람이 가장 닮아도 0.46 · 0.52 라 걸리지 않는다 — 같은 사람이 두 번 실린 자산을 막는 자리로 남는다 (ADR-132)
   */
  dupCos: 0.9,
  /**
   * 3라운드가 **보여주지 않고 결과 몫으로 남기는** 가장 가까운 얼굴 수 — 중심마다 (ADR-127).
   * 본 얼굴은 결과에 안 나온다(S-C2). 3라운드가 중심에 가장 가까운 아홉을 보여주면 답이 될 얼굴을
   * 화면이 먼저 써버려, 결과 1위가 열 번째쯤으로 밀렸다. 남기면 모의 실험(recover.mjs)의 여섯 줄 모두 11~17점 오른다 —
   * 3 · 6 · 9 끼리는 2점 안이고 6 이 넷에서 가장 높거나 같았다
   */
  reserve: 6,
  /**
   * 두 무리의 평균끼리 코사인이 이보다 작으면 두 갈래다 — 반대쪽으로 **꽤** 벌어질 때만 가른다.
   * 한 인상을 쪼개는 것이 두 인상을 못 가르는 것보다 나쁘다. **공간에 매인 값이다** — 판을 바꾸면 다시 잰다.
   * v1~v3(속성 벡터)은 −0.2 였다 — 다섯씩 고르는 한 인상을 11~15% 만 쪼갰다 (ADR-123 문턱 표).
   * v4(얼굴 벡터)에서 −0.2 는 다섯씩 고르는 한 인상을 여 16% · 남 2% 쪼개면서 두 인상은 29% · 5% 만 가른다 — 서로 다른 얼굴이
   * 반대쪽이 아니라 직각으로 흩어지는 공간이라(두 사람의 코사인 중앙값 −0.01) 갈림이 대개 잡음이다.
   * −0.3 에서 한 인상 2% · 0%, 두 인상 7% · 0% — 거의 언제나 평균 하나다. 운영자가 말한 방식이 그것이다 (ADR-132)
   */
  splitCos: -0.3,
  /** 작은 무리가 이만큼은 돼야 두 갈래로 친다 — 한 장짜리는 잘못 누른 것일 수 있다 */
  splitMin: 2,
  id: /^[a-z0-9]{4,16}$/, // copy-ok
} as const;

/**
 * 지금 기기가 새로 찾을 때 쓰는 한 벌의 버전 — 자산 경로 `/faces/v{n}/` 의 n 이다.
 * **저장된 결과는 이 값이 아니라 자기 `v` 로 그린다.** 판이 올라가도 옛 결과는 옛 경로에서
 * 그대로 그려져야 한다 (옛 버전 경로는 지우지 않는다 — 19-surface).
 */
export const IDEAL_ASSET_V = 5;

/**
 * `v` 의 윗끝. 기기가 보낸 값이 그대로 지표 blob 으로 흘러가서(`pulse` 의 ideal) 막아둔다 —
 * 판이 만 번 오를 일은 없고, 아무 숫자나 거기 쌓이면 판별 비교가 뜻을 잃는다.
 */
const V_MAX = 9999;

const isId = (x: unknown): x is string => typeof x === "string" && IDEAL_SHAPE.id.test(x);

/** 서로 다른 id 가 lo~hi 개 든 배열인가 */
function idList(x: unknown, lo: number, hi: number): x is string[] {
  return Array.isArray(x) && x.length >= lo && x.length <= hi && x.every(isId) && new Set(x).size === x.length;
}

/**
 * 기기가 보낸 결과의 **모양만** 본다 (S-D3). 가까운지는 안 본다 — 벡터를 서버에 들이지 않는다.
 *
 * ⚠️ **요청 본문을 펼쳐 담지 마라.** 고른 칸으로 새 객체를 짓는다 — 펼치면 기기가 보낸 모르는 키가
 * 저장돼 `ParticipantState.ideal` 로 매번 되돌아 나간다 (S-D1). 정답(`verdict`)·시각(`at`)을
 * 저장 요청에 실어 미리 박는 길도 같은 구멍이다.
 */
export function readIdealInput(raw: unknown): IdealInput | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { v, pool, picks, result } = raw as Record<string, unknown>;
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1 || v > V_MAX) return null;
  if (pool !== "M" && pool !== "F") return null;
  // 라운드 수는 고정이다 — 저장 모양과 화면이 셋 묶음을 들고 있다 (시나리오 '숫자')
  if (!Array.isArray(picks) || picks.length !== IDEAL_SHAPE.rounds) return null;
  if (!picks.every((p) => idList(p, IDEAL_SHAPE.pickMin, IDEAL_SHAPE.pickMax))) return null;
  if (!idList(result, IDEAL_SHAPE.results, IDEAL_SHAPE.results)) return null;
  return { v, pool, picks: (picks as string[][]).map((p) => [...p]), result: [...result] };
}

/**
 * 다시 찾기가 가리키는 결과 — 지금 저장된 결과의 `at` (ADR-125). 서버가 적은 시각이라 양의 정수뿐이다.
 * 없으면 `undefined`(처음 찾기), 모양이 어긋나면 `null`(400). **저장하지 않는다** — 요청에만 있는 값이다.
 * 가리킨 결과가 지금 것이 아니면 서버는 바꾸지 않고 저장된 행을 돌려준다 (S-E2 를 다시 찾기로 넓힌 것).
 */
export function readIdealReplaces(raw: unknown): number | undefined | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = (raw as Record<string, unknown>).replaces;
  if (r === undefined) return undefined;
  return typeof r === "number" && Number.isSafeInteger(r) && r > 0 ? r : null;
}

/**
 * 정답 확인의 모양 (S-C4). **결과 셋 중 1~3명**(겹치지 않게) 또는 **없음** — 둘 중 정확히 하나다 (ADR-127).
 * 한 명을 문자열로 보내도 받는다 — 배포 전에 열어 둔 탭이 옛 모양으로 보낸다.
 * 저장은 **결과 순서대로** 한다 — 누른 순서는 뜻이 없고, 같은 답이 같은 모양이어야 센다.
 * 둘 다 오거나 다른 값이면 null. 여기도 새 객체를 짓는다 (위와 같은 이유).
 */
export function readIdealVerdict(raw: unknown, result: readonly string[]): IdealVerdict | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.chosen !== undefined && r.none !== undefined) return null;
  if (r.none === true) return { none: true };
  const chosen = typeof r.chosen === "string" ? [r.chosen] : r.chosen;
  if (!Array.isArray(chosen) || !chosen.length || new Set(chosen).size !== chosen.length) return null;
  if (!chosen.every((c) => typeof c === "string" && result.includes(c))) return null;
  return { chosen: result.filter((id) => chosen.includes(id)) };
}

/**
 * 저장된 행을 지금 모양으로 편다 — v2 까지의 정답(`{ chosen: "id" }`)은 한 명짜리 배열이 된다.
 * 행을 고쳐 쓰지 않는다. 읽을 때마다 편다 (옛 회차의 행이 그대로 남아 있어도 되게)
 */
export function normalizeIdeal(ideal: Ideal): Ideal {
  const v = ideal.verdict as { chosen?: unknown } | undefined;
  if (v && typeof v.chosen === "string") return { ...ideal, verdict: { chosen: [v.chosen] } };
  return ideal;
}

// ─────────────────────────────────────────── 설명글 (ADR-134)

/**
 * 설명글이 견주는 라운드 — 2 · 3라운드. **1라운드는 뺀다** — 모두에게 같은 아홉이라 누구나 가장 눈에 띄는 얼굴을 고르고
 * (114회차: 남들이 고른 비율로 AUC 0.83 · 0.85, ADR-133), 그 차이를 물으면 `더 눈에 띄는 얼굴` 이라는 뻔한 답만 나온다.
 * 2 · 3라운드는 이미 비슷한 얼굴끼리라 고른 것과 안 고른 것의 차이가 그 사람의 몫이다
 */
export const STORY_ROUNDS = [2, 3] as const;

/** 설명글의 길이(자). 프롬프트가 두 문장 70~110자를 청한다 — 이 밖이면 형식이 어긋난 것이라 버린다 */
export const STORY_LEN = { min: 20, max: 240 } as const;

/**
 * 고른 얼굴만으로 그 사람이 본 화면을 다시 세운다 — 라운드마다 아홉 (ADR-133 의 `reconstruct` 와 같은 규칙).
 * `다른 얼굴 보기` 는 저장되지 않는다 — **고른 얼굴이 첫 쪽에 없으면 둘째 쪽을 본 것이다.** 넘긴 쪽과 다음 쪽은 겹치지 않아서
 * 둘이 갈린다. **지금 판의 규칙**(`IDEAL_SHAPE`)으로 센다 — 옛 판의 결과에는 쓰지 않는다. 같은 입력이면 같은 출력
 */
export function shownPages(
  faces: readonly DecodedFace[],
  vecs: ReadonlyMap<string, Float32Array>,
  picks: readonly (readonly string[])[],
): string[][] {
  const shown = new Set<string>();
  const pages: string[][] = [];
  for (let r = 1; r <= IDEAL_SHAPE.rounds; r++) {
    const picked = picks[r - 1] ?? [];
    const before = picks.slice(0, r - 1).flat().map((id) => vecs.get(id)).filter((v): v is Float32Array => !!v);
    const centers = r === 1 ? null : tasteCenters(before);
    const round = r as 1 | 2 | 3;
    let page = pickRound(faces, round, centers, shown);
    for (let k = 0; k < IDEAL_SHAPE.rerolls && !picked.every((id) => page.some((f) => f.id === id)); k++) {
      for (const f of page) shown.add(f.id);
      page = pickRound(faces, round, centers, shown);
    }
    for (const f of page) shown.add(f.id);
    pages.push(page.map((f) => f.id));
  }
  return pages;
}

/**
 * 설명글에 쓸 화면 — `STORY_ROUNDS` 의 화면을 하나씩. 기기가 `shownPages` 로 다시 세워 보낸다 (서버는 벡터를 모른다, S-D3).
 * **모양만 본다** — 화면마다 서로 다른 id 1~9개, 그 라운드에 고른 얼굴이 모두 그 화면에 있고, 고르지 않은 얼굴이 하나는 있다
 * (견줄 것이 있어야 한다). 새 배열을 짓는다 — 본문을 펼치지 않는다 (`readIdealInput` 과 같은 이유). 어긋나면 null
 */
export function readIdealStoryPages(raw: unknown, picks: readonly (readonly string[])[]): string[][] | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const pages = (raw as Record<string, unknown>).pages;
  if (!Array.isArray(pages) || pages.length !== STORY_ROUNDS.length) return null;
  const out: string[][] = [];
  for (const [i, r] of STORY_ROUNDS.entries()) {
    const page: unknown = pages[i];
    if (!idList(page, 1, IDEAL_SHAPE.faces)) return null;
    const picked = picks[r - 1] ?? [];
    if (!picked.length || !picked.every((id) => page.includes(id)) || page.length <= picked.length) return null;
    out.push([...page]);
  }
  return out;
}

/**
 * LLM 의 답에서 설명글을 꺼낸다 — `{"text": "…"}`. 첫 `{` 부터 끝 `}` 까지만 읽는다 — 코드 울타리나 앞뒤 말이 붙어 와도 된다.
 * 공백을 한 칸으로 모은다. 길이가 `STORY_LEN` 밖이면 버린다 — 형식이 어긋난 것을 화면에 올리지 않는다
 */
export function parseIdealStory(raw: string): string | null {
  const a = raw.indexOf("{");
  const b = raw.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    const t = (JSON.parse(raw.slice(a, b + 1)) as { text?: unknown }).text;
    if (typeof t !== "string") return null;
    const text = t.replace(/\s+/g, " ").trim();
    return text.length >= STORY_LEN.min && text.length <= STORY_LEN.max ? text : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────── 끌리는 얼굴의 특징 (ADR-127)

/**
 * 결과 화면에 한 줄로 쓰는 얼굴 특징의 어휘 — 자산 파이프라인(`scripts/faces/attrs.mjs`)이 사진마다
 * 고른 낱말의 **부분집합**이다. v3 까지는 벡터가 이 낱말들로 만들어져서 고른 얼굴의 낱말이 곧 벡터의 말이었다.
 * v4 부터 벡터는 얼굴 모델의 것이고(ADR-132) 낱말은 **고른 얼굴을 설명하는 데만** 쓴다 — 고른 얼굴을 세니 여전히 맞는 말이다.
 * 화면 글은 `copy.ts` 의 `IDEAL.traits` 에 있다 — 여기는 부호뿐이다.
 *
 * **빼둔 칸** — 피부 톤 · 광대 · 코 · 나이 느낌 · 쌍꺼풀 · 눈썹 · 입술 · 얼굴형 · 눈 크기.
 * 파티에서 화면을 나란히 본다. 몸의 한 부분을 집는 말은 평가처럼 읽히고, 테이블의 누군가를 가리킨다.
 * 인상을 말하는 다섯 칸만 쓴다. **점수 · % · 순위는 붙이지 않는다** (ADR-20).
 */
export const IDEAL_TRAITS = {
  animal: ["dog", "cat", "fox", "rabbit", "deer", "bear", "wolf", "dino", "squirrel", "hamster", "horse", "snake", "tofu", "chick"],
  vibe: ["pure", "cute", "bubbly", "chic", "haughty", "elegant", "sexy", "smart", "warm", "soft", "cold", "strong", "manly", "androgynous", "boyish", "exotic", "plain", "glam", "mature", "playful"],
  gaze: ["gentle", "clear", "sharp", "sleepy", "smiling"],
  jaw: ["slim", "curved", "angular", "round"],
  features: ["soft", "balanced", "bold"],
} as const;
export type TraitKey = keyof typeof IDEAL_TRAITS;
export const TRAIT_KEYS = Object.keys(IDEAL_TRAITS) as TraitKey[];

/** 고른 얼굴들에서 뽑은 특징 — 칸마다 부호. 비어 있는 칸은 뚜렷하지 않았던 것이다 */
export type IdealTraits = { [K in TraitKey]?: (typeof IDEAL_TRAITS)[K][number][] };

export const TRAIT_SHAPE = {
  /** 고른 얼굴 중 이만큼은 그 낱말을 가져야 한다 — 절반. 그리고 적어도 둘 (한 장은 우연이다) */
  share: 0.5,
  minCount: 2,
  /**
   * 풀 전체보다 이만큼 더 자주 나와야 한다. 흔한 낱말(`균형 잡힌 이목구비` 처럼 풀 절반이 가진 것)은
   * 누구의 취향도 설명하지 않는다 — 빼지 않으면 마흔 명이 같은 문장을 받는다 (모의 실험: 1.5 에서 200명 중 94~117가지)
   */
  lift: 1.5,
  /** 칸마다 몇 낱말까지. 동물상 · 분위기는 사진마다 여럿을 골랐다 */
  max: { animal: 2, vibe: 2, gaze: 1, jaw: 1, features: 1 } as Record<TraitKey, number>,
} as const;

/** 부호 하나 — `animal.cat` 꼴. 자산의 `t` 가 이 모양의 목록이다 */
export const traitToken = (k: TraitKey, code: string) => `${k}.${code}`;

/**
 * 고른 얼굴들의 특징 (ADR-127). `picked` 는 고른 얼굴마다의 부호 목록, `pool` 은 그 풀 전체의 것이다.
 * 칸마다 **고른 얼굴의 절반 이상이 가졌고, 풀보다 `lift` 배 이상 자주 나온** 낱말을, 풀보다 더 자주 나온 순서로
 * (같으면 어휘 순서로) `max` 개까지. 결과 연예인이 아니라 **본인이 고른 얼굴**을 센다 — 결과가 빗나가도 이건 빗나가지 않는다.
 * 같은 입력이면 같은 출력.
 */
export function idealTraits(picked: readonly (readonly string[])[], pool: readonly (readonly string[])[]): IdealTraits {
  const out: IdealTraits = {};
  if (!picked.length || !pool.length) return out;
  const share = (rows: readonly (readonly string[])[], tok: string) => rows.filter((r) => r.includes(tok)).length;
  const need = Math.max(TRAIT_SHAPE.minCount, Math.ceil(picked.length * TRAIT_SHAPE.share));
  for (const k of TRAIT_KEYS) {
    const got = IDEAL_TRAITS[k]
      .map((code, i) => {
        const tok = traitToken(k, code);
        const n = share(picked, tok);
        const base = share(pool, tok) / pool.length;
        const lift = base > 0 ? n / picked.length / base : 0;
        return { code, i, n, lift };
      })
      .filter((x) => x.n >= need && x.lift >= TRAIT_SHAPE.lift)
      .sort((a, b) => b.lift - a.lift || a.i - b.i)
      .slice(0, TRAIT_SHAPE.max[k])
      .map((x) => x.code);
    if (got.length) (out as Record<string, string[]>)[k] = got;
  }
  return out;
}

/** 자산 JSON 의 모양. base64 int8×dim — decodeVec() 으로 복원하면 단위 길이다 */
export interface FacePoolFile {
  version: number; // 경로의 v{n} 과 같아야 한다
  dim: number;
  scale: number;
  /** `t` — 그 사람의 특징 부호(`animal.cat` 꼴, v3 부터). 없으면 그 판은 특징을 말하지 않는다 */
  celebs: { id: string; name: string; v: string; retired?: true; t?: string[] }[];
  faces: { id: string; v: string; level: 1 | 2 | 3 }[];
}

/** 복원된 런타임 모양 */
export interface DecodedFace {
  id: string;
  vec: Float32Array;
  level: 1 | 2 | 3;
}

export interface DecodedCeleb {
  id: string;
  name: string;
  vec: Float32Array;
  retired?: true;
  t?: string[];
}

export function decodeVec(v: string, dim: number, scale: number): Float32Array {
  const raw = atob(v);
  const out = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    const b = raw.charCodeAt(i);
    // 정규화는 하지 않는다 — 길이 ≈ 1 은 자산의 성질이고 check:faces 가 본다
    out[i] = (b >= 128 ? b - 256 : b) / scale;
  }
  return out;
}

/**
 * 코사인. 양자화로 길이가 1 에서 살짝 벗어나 있어 내적만으로는 순서가 뒤집힐 수 있다 —
 * 길이로 나눈다. 평균이 0 벡터로 무너진 극단(정반대 둘)에서는 NaN 대신 0 —
 * 전부 동률이 되고, 안정 정렬이라 자산 순서가 남는다. 같은 입력이면 같은 출력.
 */
function cos(a: Float32Array, b: Float32Array): number {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  const n = Math.sqrt(aa * bb);
  return n < 1e-9 ? 0 : ab / n;
}

export function meanOf(vecs: readonly Float32Array[]): Float32Array {
  const dim = vecs[0]?.length ?? 0;
  const m = new Float32Array(dim);
  for (const v of vecs) for (let i = 0; i < dim; i++) m[i] += v[i];
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    m[i] /= vecs.length;
    norm += m[i] * m[i];
  }
  norm = Math.sqrt(norm);
  // 정반대 둘이 지워지면 0 벡터다 — 그대로 돌려준다 (NaN 을 만들지 않는다)
  if (norm > 1e-9) for (let i = 0; i < dim; i++) m[i] /= norm;
  return m;
}

/**
 * 취향의 중심 하나. `weight` 는 그 무리에서 고른 얼굴 수다 — 라운드 자리를 나누는 무게가 된다.
 * `vec` 는 `meanOf` 가 낸 단위 벡터다.
 */
export interface TasteCenter {
  vec: Float32Array;
  weight: number;
}

/** 2-평균을 몇 번 돌리나. 고른 얼굴이 많아야 열다섯이라 이 안에 선다 — 고정해 두어 결정적이다 */
const SPLIT_ITERS = 10;

/**
 * 고른 벡터를 취향의 중심 1개 또는 2개로 (큰 무리가 먼저).
 *
 * 두 갈래로 보는 것은 **멀리 갈렸고, 작은 쪽도 우연이 아닐 때**뿐이다. 그 밖은 전체 평균 하나 —
 * v1 과 같은 길이다. 난수를 쓰지 않는다: 시작점은 서로 가장 덜 닮은 두 얼굴(같은 값이면 앞의 쌍),
 * 같은 거리의 점은 A 로, 반복 수는 고정이다. 같은 입력이면 같은 출력.
 */
export function tasteCenters(picked: readonly Float32Array[]): TasteCenter[] {
  // 고른 게 없으면 따라갈 곳도 없다 — pickRound 는 이것을 null 처럼 다룬다
  if (picked.length === 0) return [];
  const whole = (): TasteCenter[] => [{ vec: meanOf(picked), weight: picked.length }];
  if (picked.length < IDEAL_SHAPE.splitMin * 2) return whole();

  // 시작점 — 서로 가장 덜 닮은 두 얼굴. 엄격히 작을 때만 바꿔 같은 값이면 앞의 쌍이 남는다
  let si = 0;
  let sj = 1;
  let worst = Infinity;
  for (let i = 0; i < picked.length; i++) {
    for (let j = i + 1; j < picked.length; j++) {
      const c = cos(picked[i], picked[j]);
      if (c < worst) [worst, si, sj] = [c, i, j];
    }
  }

  let ca: Float32Array = picked[si];
  let cb: Float32Array = picked[sj];
  let side: boolean[] = []; // true = A (첫 시작점 쪽)
  for (let it = 0; it < SPLIT_ITERS; it++) {
    const next = picked.map((v) => cos(v, ca) >= cos(v, cb));
    const settled = next.every((x, i) => x === side[i]);
    side = next;
    // 한쪽이 비면 두 무리가 아니다 — 같은 벡터뿐인 입력이 여기로 온다
    if (next.every(Boolean) || !next.some(Boolean)) return whole();
    if (settled) break;
    ca = meanOf(picked.filter((_, i) => side[i]));
    cb = meanOf(picked.filter((_, i) => !side[i]));
  }

  const a = picked.filter((_, i) => side[i]);
  const b = picked.filter((_, i) => !side[i]);
  const ma = meanOf(a);
  const mb = meanOf(b);
  if (cos(ma, mb) >= IDEAL_SHAPE.splitCos) return whole();
  if (Math.min(a.length, b.length) < IDEAL_SHAPE.splitMin) return whole();
  const first = { vec: ma, weight: a.length };
  const second = { vec: mb, weight: b.length };
  // 큰 무리가 먼저 — 결과의 첫 사람(S-C1)을 그쪽이 든다. 같으면 첫 시작점 쪽
  return b.length > a.length ? [second, first] : [first, second];
}

/**
 * 한 라운드의 얼굴들. `centers` 는 `tasteCenters` 의 결과(1라운드는 null).
 *
 * 1라운드는 중심을 보지 않는다 — 자산 순서 그대로 앞에서 n. 1단계는 두 쪽(`level1`)이고
 * 둘째 쪽은 `shown` 이 첫 쪽을 품을 때(다른 얼굴 보기) 나온다.
 * 2·3라운드는 중심마다 코사인 내림차순 목록을 세우고, 중심이 둘이면 자리를 무게로 나눠
 * **번갈아** 놓는다 (A, B, A, B …). 작은 쪽도 적어도 한 칸, 많아야 절반(내림) —
 * 두 갈래라도 큰 무리가 그 사람의 주된 취향이다.
 *
 * 3라운드는 중심마다 가장 가까운 `reserve` 명을 **건너뛴다** (ADR-127) — 결과의 몫이다. 본 얼굴은 결과에
 * 안 나오므로(S-C2), 여기서 보여주면 답이 될 얼굴이 사라진다. 남기고도 한 화면이 안 차면 남기지 않는다 — 빈 칸은 없다.
 */
export function pickRound(
  faces: readonly DecodedFace[],
  round: 1 | 2 | 3,
  centers: readonly TasteCenter[] | null,
  shown: ReadonlySet<string>,
  n: number = IDEAL_SHAPE.faces,
  reserve: number = IDEAL_SHAPE.reserve,
): DecodedFace[] {
  // 1라운드는 자산 순서 그대로 — 모두에게 같아야 "첫 화면에서 누구 골랐어?" 가 된다
  if (round === 1) return faces.filter((f) => f.level === 1 && !shown.has(f.id)).slice(0, n);

  const pool = faces.filter((f) => (round === 2 ? f.level === 2 : true) && !shown.has(f.id));
  // 중심이 없으면(0 벡터로 무너진 평균과 같이) 자산 순서 — 안정 정렬이라 결정적이다
  let lists = centers?.length
    ? centers.map((c) => [...pool].sort((a, b) => cos(b.vec, c.vec) - cos(a.vec, c.vec)))
    : [pool];
  if (round === 3 && centers?.length && reserve > 0) {
    const kept = new Set(lists.flatMap((l) => l.slice(0, reserve).map((f) => f.id)));
    if (pool.length - kept.size >= n) lists = lists.map((l) => l.filter((f) => !kept.has(f.id)));
  }

  let quota = [n];
  if (centers && centers.length === 2) {
    const [wa, wb] = [centers[0].weight, centers[1].weight];
    const nb = Math.min(Math.max(Math.round((n * wb) / (wa + wb)), 1), Math.floor(n / 2));
    quota = [n - nb, nb];
  }

  const got: DecodedFace[][] = lists.map(() => []);
  const taken: DecodedFace[] = [];
  const used = new Set<string>();
  // 3라운드만 닮은꼴을 뒤로 민다 — 2라운드 후보는 군집 대표라 이미 서로 떨어져 있다.
  // 닮은꼴은 어느 쪽이 가져간 얼굴과도 따진다 — 한 화면에 같은 얼굴 둘이 서는 것을 막는 문턱이다
  const near = (f: DecodedFace) => round === 3 && taken.some((t) => cos(t.vec, f.vec) >= IDEAL_SHAPE.dupCos);
  /** s 쪽 목록에서 아직 안 쓴 첫 얼굴을 가져온다. strict 면 닮은꼴은 건너뛴다 */
  const step = (s: number, strict: boolean): boolean => {
    for (const f of lists[s]) {
      if (used.has(f.id) || (strict && near(f))) continue;
      used.add(f.id);
      taken.push(f);
      got[s].push(f);
      return true;
    }
    return false;
  };
  // 문턱을 지키며 번갈아 채우고, 그래도 못 채웠을 때만 문턱을 풀고 채운다 — 빈 칸은 없다.
  // 두 목록은 같은 후보의 두 순서라, 한쪽 근처가 모자라면 그 쪽 목록의 다음(곧 다른 쪽에 가까운) 얼굴이 선다
  for (const strict of [true, false]) {
    for (let moved = true; moved; ) {
      moved = false;
      for (let s = 0; s < lists.length; s++) if (got[s].length < quota[s] && step(s, strict)) moved = true;
    }
  }
  // 목록마다 제 순위대로 두고 번갈아 놓는다 — 한 쪽 얼굴이 화면 위에 몰리지 않게
  if (got.length === 1) return got[0];
  const out: DecodedFace[] = [];
  for (let i = 0; i < Math.max(got[0].length, got[1].length); i++) {
    if (i < got[0].length) out.push(got[0][i]);
    if (i < got[1].length) out.push(got[1][i]);
  }
  return out;
}

/**
 * 결과 셋. 중심이 하나면 가까운 순서 j 명. 둘이면 번갈아 — `[A 의 1위, B 의 1위, A 의 2위]`.
 * 첫 사람이 답이라는 약속(S-C1)은 큰 무리(A)가 지킨다. 한 사람이 두 중심의 윗자리에 다 서면
 * 한 번만 — 뒤에 온 쪽은 제 다음 사람을 든다. retired·exclude 는 어느 쪽에도 안 나온다 (S-C2).
 */
export function nearestCelebs(
  celebs: readonly DecodedCeleb[],
  centers: readonly TasteCenter[],
  exclude: ReadonlySet<string>,
  j: number = IDEAL_SHAPE.results,
): DecodedCeleb[] {
  const pool = celebs.filter((c) => !c.retired && !exclude.has(c.id));
  if (centers.length < 2) {
    const c = centers[0]?.vec;
    return (c ? pool.sort((a, b) => cos(b.vec, c) - cos(a.vec, c)) : pool).slice(0, j);
  }
  const lists = centers.map((c) => [...pool].sort((a, b) => cos(b.vec, c.vec) - cos(a.vec, c.vec)));
  const out: DecodedCeleb[] = [];
  const used = new Set<string>();
  for (let turn = 0; out.length < j && turn < j * lists.length; turn++) {
    const next = lists[turn % lists.length].find((c) => !used.has(c.id));
    if (!next) continue;
    used.add(next.id);
    out.push(next);
  }
  return out;
}
