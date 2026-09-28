/**
 * 이상형 찾기 — 타입과 순수 함수만. DO·요청·시각에 닿지 않는다 (fortune.ts 와 같은 자리).
 *
 * 계산은 전부 기기에서 한다 (S-D3) — 서버는 이 파일의 타입으로 **모양만** 검사하고 저장한다.
 * 벡터를 서버에 들이지 않는 것이 규칙이라, 이 파일이 server/ 를 import 하는 일은 없어야 한다.
 * 알고리즘 교체 = 아래 함수 몸통 교체다. 불변식 테스트(19-ideal-type)는 교체 후에도 통과해야 한다.
 */
import type { Gender } from "./types.ts";

/** 한 사람의 이상형 찾기 한 벌. 회차 DO 에 1인 1행 */
export interface Ideal {
  /** 결과를 만든 한 벌(자산+규칙)의 버전. 규칙만 바뀌어도 올린다 — 반응을 비교하는 열쇠 */
  v: number;
  pool: Gender;
  /** 라운드별 고른 얼굴 id — 셋 묶음, 각 1~3개 (S-C2 가 다시 그릴 재료) */
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
  faces: 6,
  pickMin: 1,
  pickMax: 3,
  results: 3,
  /** 3라운드 닮은꼴 문턱(코사인). 임시값 — 실제 풀에서 종이 검증과 함께 조정한다 */
  dupCos: 0.9,
  id: /^[a-z0-9]{4,16}$/, // copy-ok
} as const;

/**
 * 지금 기기가 새로 찾을 때 쓰는 한 벌의 버전 — 자산 경로 `/faces/v{n}/` 의 n 이다.
 * **저장된 결과는 이 값이 아니라 자기 `v` 로 그린다.** 판이 올라가도 옛 결과는 옛 경로에서
 * 그대로 그려져야 한다 (옛 버전 경로는 지우지 않는다 — 19-surface).
 */
export const IDEAL_ASSET_V = 1;

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

export function pickRound(
  faces: readonly DecodedFace[],
  round: 1 | 2 | 3,
  mean: Float32Array | null,
  shown: ReadonlySet<string>,
  n: number = IDEAL_SHAPE.faces,
): DecodedFace[] {
  // 1라운드는 자산 순서 그대로 — 모두에게 같아야 "첫 화면에서 누구 골랐어?" 가 된다
  if (round === 1) return faces.filter((f) => f.level === 1 && !shown.has(f.id)).slice(0, n);

  const pool = faces.filter((f) => (round === 2 ? f.level === 2 : true) && !shown.has(f.id));
  const ranked = mean ? pool.sort((a, b) => cos(b.vec, mean) - cos(a.vec, mean)) : pool;

  const taken: DecodedFace[] = [];
  const pushed: DecodedFace[] = [];
  for (const f of ranked) {
    if (taken.length === n) break;
    // 3라운드만 닮은꼴을 뒤로 민다 — 2라운드 후보는 군집 대표라 이미 서로 떨어져 있다
    if (round === 3 && taken.some((t) => cos(t.vec, f.vec) >= IDEAL_SHAPE.dupCos)) pushed.push(f);
    else taken.push(f);
  }
  // 문턱 때문에 못 채웠을 때만 문턱을 풀고 채운다 — 빈 칸은 없다
  for (const f of pushed) {
    if (taken.length === n) break;
    taken.push(f);
  }
  return taken;
}

export function nearestCelebs(
  celebs: readonly DecodedCeleb[],
  mean: Float32Array,
  exclude: ReadonlySet<string>,
  j: number = IDEAL_SHAPE.results,
): DecodedCeleb[] {
  return celebs
    .filter((c) => !c.retired && !exclude.has(c.id))
    .sort((a, b) => cos(b.vec, mean) - cos(a.vec, mean))
    .slice(0, j);
}
