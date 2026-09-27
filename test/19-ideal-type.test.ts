/**
 * 슬라이스 19 — 이상형 찾기의 순수 함수 (테스트를 먼저 쓴다 — buildSeating 과 같은 예외)
 *
 * 표면 문서(19-surface.md)의 불변식을 그대로 박는다. 내부 구조는 모른다 —
 * ideal.ts 가 내보내는 함수와 픽스처 풀만 쓴다.
 *
 *   같은 id 없음 · shown/exclude 절대 안 나옴 (S-B3 · S-C2)
 *   1라운드는 1단계를 자산 순서 그대로, mean 무시 — 모두에게 같다
 *   2라운드는 2단계 후보를 코사인 내림차순
 *   3라운드는 전체에서 코사인 내림차순 + dupCos 닮은꼴 밀어내기. 빈 칸 금지
 *   meanOf 는 고른 벡터 전체의 단순 평균 — 라운드 가중 없음
 *   nearestCelebs 는 retired·exclude 를 새 결과에 넣지 않는다
 *   같은 입력이면 같은 출력
 *
 * 기대 순서는 픽스처 각도에서 손으로 셈했다 — 동률이 없게 각도를 벌려 뒀다
 * (fixtures/faces/pool.ts 머리말). 서버 규칙(저장·verdict·공개 범위)과 화면(% 없음)은
 * 여기가 아니라 그쪽 표면이 생길 때 붙는다.
 */
import { describe, expect, it } from "vitest";
import {
  decodeVec,
  meanOf,
  nearestCelebs,
  pickRound,
  type DecodedCeleb,
  type DecodedFace,
} from "../src/shared/ideal.ts";
import { POOL, b64int8 } from "./fixtures/faces/pool.ts";

const FACES: DecodedFace[] = POOL.faces.map((f) => ({
  id: f.id,
  level: f.level,
  vec: decodeVec(f.v, POOL.dim, POOL.scale),
}));
const CELEBS: DecodedCeleb[] = POOL.celebs.map((c) => ({
  id: c.id,
  name: c.name,
  vec: decodeVec(c.v, POOL.dim, POOL.scale),
}));

const byId = new Map(FACES.map((f) => [f.id, f]));
const vecOf = (id: string) => byId.get(id)!.vec;
const ids = (xs: readonly { id: string }[]) => xs.map((x) => x.id);

/** 1라운드의 여섯 — 자산 순서 그대로 */
const L1 = ["f000", "f060", "f120", "f180", "f240", "f300"];

/** 단위원 위 deg° — 양자화 없는 인라인 벡터 (엣지 케이스용) */
const fvec = (deg: number) => {
  const r = (deg * Math.PI) / 180;
  return new Float32Array([Math.cos(r), Math.sin(r)]);
};

// ─────────────────────────────────────────── decodeVec

describe("decodeVec — 자산 부호화 복원", () => {
  it("int8 을 scale 로 나눈 값 그대로다 — 다시 정규화하지 않는다", () => {
    const v = decodeVec(b64int8([127, -127, 64, 0]), 4, 127);
    expect(v).toHaveLength(4);
    expect(v[0]).toBeCloseTo(1, 6);
    expect(v[1]).toBeCloseTo(-1, 6);
    expect(v[2]).toBeCloseTo(64 / 127, 6);
    expect(v[3]).toBeCloseTo(0, 6);
  });

  it("픽스처 풀 전체가 복원하면 근사 단위 길이다", () => {
    for (const f of FACES) {
      expect(Math.abs(Math.hypot(f.vec[0], f.vec[1]) - 1)).toBeLessThan(0.01);
    }
  });
});

// ─────────────────────────────────────────── meanOf

describe("meanOf — 단순 평균", () => {
  it("하나면 그 방향 그대로, 단위 길이로", () => {
    const m = meanOf([new Float32Array([3, 0])]);
    expect(m[0]).toBeCloseTo(1, 6);
    expect(m[1]).toBeCloseTo(0, 6);
  });

  it("평균 낸 뒤 정규화한다", () => {
    const m = meanOf([fvec(0), fvec(90)]);
    expect(m[0]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(m[1]).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it("고른 벡터 전체의 단순 평균이다 — 라운드 가중 없음", () => {
    // [1,0] 둘 + [0,1] 하나 → 방향 [2,1]
    const m = meanOf([fvec(0), fvec(0), fvec(90)]);
    expect(m[0]).toBeCloseTo(2 / Math.hypot(2, 1), 5);
    expect(m[1]).toBeCloseTo(1 / Math.hypot(2, 1), 5);
  });

  it("정반대 둘이 서로 지워도 NaN 이 나오지 않는다", () => {
    const m = meanOf([vecOf("f000"), vecOf("f180")]);
    for (const x of m) expect(Number.isFinite(x)).toBe(true);
  });
});

// ─────────────────────────────────────────── pickRound

describe("pickRound 1라운드 — 모두에게 같다", () => {
  it("1단계 여섯을 자산 순서 그대로 준다", () => {
    const r1 = pickRound(FACES, 1, null, new Set());
    expect(ids(r1)).toEqual(L1);
    expect(r1.every((f) => f.level === 1)).toBe(true);
  });

  it("mean 이 있어도 무시한다", () => {
    expect(ids(pickRound(FACES, 1, fvec(85), new Set()))).toEqual(L1);
  });
});

describe("pickRound 2라운드 — 평균 근처의 2단계 대표", () => {
  it("코사인 내림차순 여섯, 전부 2단계다", () => {
    const r2 = pickRound(FACES, 2, meanOf([vecOf("f000")]), new Set(L1));
    expect(ids(r2)).toEqual(["f010", "f340", "f040", "f310", "f070", "f280"]);
    expect(r2.every((f) => f.level === 2)).toBe(true);
  });

  it("shown 은 가장 가까워도 절대 나오지 않는다 (S-B3)", () => {
    const r2 = pickRound(FACES, 2, meanOf([vecOf("f000")]), new Set([...L1, "f010"]));
    expect(ids(r2)).toEqual(["f340", "f040", "f310", "f070", "f280", "f100"]);
  });

  it("평균이 0 벡터로 무너져도 여섯을 결정적으로 준다", () => {
    const zero = meanOf([vecOf("f000"), vecOf("f180")]);
    const a = pickRound(FACES, 2, zero, new Set(L1));
    const b = pickRound(FACES, 2, zero, new Set(L1));
    expect(ids(a)).toEqual(ids(b));
    expect(new Set(ids(a)).size).toBe(6);
    expect(a.every((f) => f.level === 2 && !L1.includes(f.id))).toBe(true);
  });
});

describe("pickRound 3라운드 — 전체에서, 닮은꼴은 뒤로", () => {
  const shown12 = new Set([...L1, "f010", "f340", "f040", "f310", "f070", "f280"]);
  const mean12 = meanOf([vecOf("f000"), vecOf("f010")]); // ≈ 5°

  it("가장 가까운 셋(3°·6°·8°)은 닮은꼴이라 하나만 남고, 나머지는 밀려난다", () => {
    const r3 = pickRound(FACES, 3, mean12, shown12);
    expect(ids(r3)).toEqual(["f006", "f330", "f050", "f085", "f265", "f130"]);
  });

  it("2단계도 3라운드 후보다 — 전체에서 뽑는다", () => {
    const r3 = pickRound(FACES, 3, mean12, shown12);
    expect(r3.some((f) => f.level === 2)).toBe(true); // f130
  });

  it("문턱 때문에 못 채우면 문턱을 풀고 채운다 — 빈 칸은 없다", () => {
    // 전부 12° 안 — 일곱이 서로 전부 닮은꼴이다
    const cluster: DecodedFace[] = [0, 2, 4, 6, 8, 10, 12].map((d) => ({
      id: `g${String(d).padStart(3, "0")}`,
      level: 3,
      vec: fvec(d),
    }));
    const out = pickRound(cluster, 3, fvec(0), new Set());
    expect(ids(out)).toEqual(["g000", "g002", "g004", "g006", "g008", "g010"]);
  });
});

// ─────────────────────────────────────────── nearestCelebs

describe("nearestCelebs — 결과 셋", () => {
  it("코사인 내림차순 셋 — exclude 와 retired 는 가장 가까워도 안 나온다 (S-C2)", () => {
    const celebs: DecodedCeleb[] = [
      { id: "c002", name: "nc002", vec: fvec(2) }, // exclude
      { id: "c005", name: "nc005", vec: fvec(5), retired: true },
      { id: "c008", name: "nc008", vec: fvec(8) },
      { id: "c020", name: "nc020", vec: fvec(20) },
      { id: "c050", name: "nc050", vec: fvec(50) },
      { id: "c090", name: "nc090", vec: fvec(90) },
      { id: "c170", name: "nc170", vec: fvec(170) },
    ];
    const out = nearestCelebs(celebs, fvec(0), new Set(["c002"]));
    expect(ids(out)).toEqual(["c008", "c020", "c050"]);
  });
});

// ─────────────────────────────────────────── 세 라운드 흐름

describe("세 라운드 흐름 — 시나리오의 방식 그대로", () => {
  /** f000 → f010 → f006 을 골라 내려가는 한 사람. 화면이 조합할 그 순서다 */
  function runFlow() {
    const shown = new Set<string>();
    const picked: string[] = [];
    const rounds: string[][] = [];
    for (const [round, want] of [
      [1, "f000"],
      [2, "f010"],
      [3, "f006"],
    ] as const) {
      const mean = picked.length ? meanOf(picked.map(vecOf)) : null;
      const faces = pickRound(FACES, round, mean, shown);
      for (const f of faces) shown.add(f.id);
      rounds.push(ids(faces));
      expect(ids(faces)).toContain(want);
      picked.push(want);
    }
    const result = nearestCelebs(CELEBS, meanOf(picked.map(vecOf)), shown);
    return { rounds, shown, result };
  }

  it("같은 얼굴이 두 번 나오지 않는다 (S-B3) — 세 라운드 18개가 전부 다르다", () => {
    const { rounds } = runFlow();
    expect(new Set(rounds.flat()).size).toBe(18);
  });

  it("결과 셋은 본 얼굴이 아니다 (S-C2) — 밀려나 못 본 닮은꼴이 답이 된다", () => {
    const { shown, result } = runFlow();
    expect(ids(result)).toEqual(["f003", "f008", "f100"]);
    for (const c of result) expect(shown.has(c.id)).toBe(false);
  });

  it("같은 입력이면 같은 출력 — 시각·난수에 닿지 않는다", () => {
    const a = runFlow();
    const b = runFlow();
    expect(a.rounds).toEqual(b.rounds);
    expect(ids(a.result)).toEqual(ids(b.result));
  });
});
