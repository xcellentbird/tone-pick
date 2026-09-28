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
  at: number;
}

export type IdealVerdict = { chosen: string } | { none: true };

/** 기기가 보내는 것. verdict 는 따로 온다 — 결과를 본 뒤에야 생기는 값이다 (S-C4) */
export type IdealInput = Omit<Ideal, "verdict" | "at">;

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
  /** 3라운드 닮은꼴 문턱(코사인). 임시값 — 실제 풀에서 종이 검증과 함께 조정한다 */
  dupCos: 0.9,
  /**
   * 두 무리의 평균끼리 코사인이 이보다 작으면 두 갈래다 — 반대쪽으로 **꽤** 벌어질 때만(약 102° 넘게) 가른다.
   * 0 으로 두면 다섯씩 고르는 한 인상이 절반 가까이 쪼개졌다 — 다섯 중엔 목표에서 먼 얼굴이 섞여서다 (ADR-123 문턱 표).
   * 한 인상을 쪼개는 것이 두 인상을 못 가르는 것보다 나쁘다. 종이 검증 **전에** 정했다
   */
  splitCos: -0.2,
  /** 작은 무리가 이만큼은 돼야 두 갈래로 친다 — 한 장짜리는 잘못 누른 것일 수 있다 */
  splitMin: 2,
  id: /^[a-z0-9]{4,16}$/, // copy-ok
} as const;

/**
 * 지금 기기가 새로 찾을 때 쓰는 한 벌의 버전 — 자산 경로 `/faces/v{n}/` 의 n 이다.
 * **저장된 결과는 이 값이 아니라 자기 `v` 로 그린다.** 판이 올라가도 옛 결과는 옛 경로에서
 * 그대로 그려져야 한다 (옛 버전 경로는 지우지 않는다 — 19-surface).
 */
export const IDEAL_ASSET_V = 2;

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
 * 정답 확인의 모양 (S-C4). **결과 셋 중 하나** 또는 **없었어요** — 둘 중 정확히 하나다.
 * 둘 다 오거나 다른 값이면 null. 여기도 새 객체를 짓는다 (위와 같은 이유).
 */
export function readIdealVerdict(raw: unknown, result: readonly string[]): IdealVerdict | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.chosen !== undefined && r.none !== undefined) return null;
  if (r.none === true) return { none: true };
  if (typeof r.chosen === "string" && result.includes(r.chosen)) return { chosen: r.chosen };
  return null;
}

/** 자산 JSON 의 모양. base64 int8×dim — decodeVec() 으로 복원하면 단위 길이다 */
export interface FacePoolFile {
  version: number; // 경로의 v{n} 과 같아야 한다
  dim: number;
  scale: number;
  celebs: { id: string; name: string; v: string; retired?: true }[];
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
 */
export function pickRound(
  faces: readonly DecodedFace[],
  round: 1 | 2 | 3,
  centers: readonly TasteCenter[] | null,
  shown: ReadonlySet<string>,
  n: number = IDEAL_SHAPE.faces,
): DecodedFace[] {
  // 1라운드는 자산 순서 그대로 — 모두에게 같아야 "첫 화면에서 누구 골랐어?" 가 된다
  if (round === 1) return faces.filter((f) => f.level === 1 && !shown.has(f.id)).slice(0, n);

  const pool = faces.filter((f) => (round === 2 ? f.level === 2 : true) && !shown.has(f.id));
  // 중심이 없으면(0 벡터로 무너진 평균과 같이) 자산 순서 — 안정 정렬이라 결정적이다
  const lists = centers?.length
    ? centers.map((c) => [...pool].sort((a, b) => cos(b.vec, c.vec) - cos(a.vec, c.vec)))
    : [pool];

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
