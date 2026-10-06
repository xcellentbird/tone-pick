/**
 * 슬라이스 19 — 이상형 찾기의 순수 함수 (테스트를 먼저 쓴다 — buildSeating 과 같은 예외)
 *
 * 표면 문서(19-surface.md)의 불변식을 그대로 박는다. 내부 구조는 모른다 —
 * ideal.ts 가 내보내는 함수와 픽스처 풀만 쓴다.
 *
 *   같은 id 없음 · shown/exclude 절대 안 나옴 (S-B3 · S-C2)
 *   1라운드는 1단계를 자산 순서 그대로, 중심 무시 — 모두에게 같다. 두 번째 쪽은 shown 이 첫 쪽을 품을 때
 *   2라운드는 2단계 후보를 코사인 내림차순
 *   3라운드는 전체에서 코사인 내림차순 + dupCos 닮은꼴 밀어내기. 빈 칸 금지
 *   meanOf 는 고른 벡터 전체의 단순 평균 — 라운드 가중 없음
 *   tasteCenters 는 멀리 갈린 두 무리만 둘로 본다 — 한 무리·한 장짜리 무리는 평균 하나
 *   중심이 둘이면 자리를 무게로 나눠 번갈아 놓고, 결과는 [A 1위, B 1위, A 2위]
 *   nearestCelebs 는 retired·exclude 를 새 결과에 넣지 않는다
 *   같은 입력이면 같은 출력
 *
 * 기대 순서는 픽스처 각도에서 손으로 셈했다 — 동률이 없게 각도를 벌려 뒀다
 * (fixtures/faces/pool.ts 머리말). 픽스처 풀은 v1 크기(한 화면 여섯)라 그 풀을 쓰는 테스트는
 * `n = 6` 을 적어 부른다 — 기대 순서가 v1 에서 셈한 그대로다. 아홉·두 쪽은 인라인 풀로 본다.
 * 서버 규칙(저장·verdict·공개 범위)은 `19-ideal-server.test.ts` 가 본다.
 */
import { describe, expect, it } from "vitest";
import {
  IDEAL_SHAPE,
  TRAIT_SHAPE,
  decodeVec,
  idealTraits,
  meanOf,
  normalizeIdeal,
  nearestCelebs,
  parseIdealStory,
  pickRound,
  readIdealInput,
  shownPages,
  tasteCenters,
  type DecodedCeleb,
  type DecodedFace,
  type Ideal,
  type TasteCenter,
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

/** 픽스처 풀은 한 화면 여섯(v1)으로 셈해 뒀다 — 그 풀을 쓰는 테스트는 이 수로 부른다 */
const N6 = 6;
/**
 * 3라운드의 결과 몫(ADR-127)을 두지 않고 부른다 — 픽스처 풀의 기대 순서는 그 규칙 전에 셈했다.
 * 결과 몫은 아래 `3라운드 — 결과 몫` 이 인라인 풀로 본다
 */
const R0 = 0;

/** 단위원 위 deg° — 양자화 없는 인라인 벡터 (엣지 케이스용) */
const fvec = (deg: number) => {
  const r = (deg * Math.PI) / 180;
  return new Float32Array([Math.cos(r), Math.sin(r)]);
};

/** 중심 하나 — v1 과 같은 길 */
const one = (vec: Float32Array, weight = 1): TasteCenter[] => [{ vec, weight }];

/** 벡터의 각도(°, 0~360) — 중심이 어느 쪽을 향하는지 읽는다 */
const degOf = (v: Float32Array) => ((Math.atan2(v[1], v[0]) * 180) / Math.PI + 360) % 360;

/** 인라인 얼굴 — id 는 `<접두><각도 세 자리>` */
const face = (prefix: string, deg: number, level: 1 | 2 | 3 = 2): DecodedFace => ({
  id: `${prefix}${String(deg).padStart(3, "0")}`,
  level,
  vec: fvec(deg),
});

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
    const r1 = pickRound(FACES, 1, null, new Set(), N6);
    expect(ids(r1)).toEqual(L1);
    expect(r1.every((f) => f.level === 1)).toBe(true);
  });

  it("중심이 있어도 무시한다 — 하나든 둘이든", () => {
    expect(ids(pickRound(FACES, 1, one(fvec(85)), new Set(), N6))).toEqual(L1);
    const two: TasteCenter[] = [
      { vec: fvec(85), weight: 3 },
      { vec: fvec(265), weight: 2 },
    ];
    expect(ids(pickRound(FACES, 1, two, new Set(), N6))).toEqual(L1);
  });
});

describe("pickRound 2라운드 — 평균 근처의 2단계 대표", () => {
  it("코사인 내림차순 여섯, 전부 2단계다", () => {
    const r2 = pickRound(FACES, 2, one(meanOf([vecOf("f000")])), new Set(L1), N6);
    expect(ids(r2)).toEqual(["f010", "f340", "f040", "f310", "f070", "f280"]);
    expect(r2.every((f) => f.level === 2)).toBe(true);
  });

  it("shown 은 가장 가까워도 절대 나오지 않는다 (S-B3)", () => {
    const r2 = pickRound(FACES, 2, one(meanOf([vecOf("f000")])), new Set([...L1, "f010"]), N6);
    expect(ids(r2)).toEqual(["f340", "f040", "f310", "f070", "f280", "f100"]);
  });

  it("평균이 0 벡터로 무너져도 여섯을 결정적으로 준다", () => {
    const zero = meanOf([vecOf("f000"), vecOf("f180")]);
    const a = pickRound(FACES, 2, one(zero, 2), new Set(L1), N6);
    const b = pickRound(FACES, 2, one(zero, 2), new Set(L1), N6);
    expect(ids(a)).toEqual(ids(b));
    expect(new Set(ids(a)).size).toBe(6);
    expect(a.every((f) => f.level === 2 && !L1.includes(f.id))).toBe(true);
  });
});

describe("pickRound 3라운드 — 전체에서, 닮은꼴은 뒤로", () => {
  const shown12 = new Set([...L1, "f010", "f340", "f040", "f310", "f070", "f280"]);
  const mean12 = one(meanOf([vecOf("f000"), vecOf("f010")]), 2); // ≈ 5°

  it("가장 가까운 셋(3°·6°·8°)은 닮은꼴이라 하나만 남고, 나머지는 밀려난다", () => {
    const r3 = pickRound(FACES, 3, mean12, shown12, N6, R0);
    expect(ids(r3)).toEqual(["f006", "f330", "f050", "f085", "f265", "f130"]);
  });

  it("2단계도 3라운드 후보다 — 전체에서 뽑는다", () => {
    const r3 = pickRound(FACES, 3, mean12, shown12, N6, R0);
    expect(r3.some((f) => f.level === 2)).toBe(true); // f130
  });

  it("문턱 때문에 못 채우면 문턱을 풀고 채운다 — 빈 칸은 없다", () => {
    // 전부 12° 안 — 일곱이 서로 전부 닮은꼴이다
    const cluster: DecodedFace[] = [0, 2, 4, 6, 8, 10, 12].map((d) => ({
      id: `g${String(d).padStart(3, "0")}`,
      level: 3,
      vec: fvec(d),
    }));
    const out = pickRound(cluster, 3, one(fvec(0)), new Set(), N6, R0);
    expect(ids(out)).toEqual(["g000", "g002", "g004", "g006", "g008", "g010"]);
  });
});

describe("pickRound 3라운드 — 가장 가까운 얼굴은 결과 몫으로 남긴다 (ADR-127)", () => {
  /** 0° 에서 9° 간격 스무 명. 서로 닮은꼴(dupCos)이라 화면 안의 순서는 문턱이 정한다 — 여기서는 누가 빠지는지만 본다 */
  const line: DecodedFace[] = Array.from({ length: 20 }, (_, i) => ({
    id: `h${String(i * 9).padStart(3, "0")}`,
    level: 3,
    vec: fvec(i * 9),
  }));
  const asCeleb = (f: DecodedFace): DecodedCeleb => ({ id: f.id, name: f.id, vec: f.vec });

  it("중심에 가장 가까운 reserve 명은 3라운드에 안 나오고, 결과가 그 사람들이다", () => {
    const r3 = pickRound(line, 3, one(fvec(0)), new Set(), 3, 3);
    expect(r3).toHaveLength(3);
    for (const kept of ["h000", "h009", "h018"]) expect(ids(r3)).not.toContain(kept);
    const result = nearestCelebs(line.map(asCeleb), one(fvec(0)), new Set(ids(r3)));
    expect(ids(result)).toEqual(["h000", "h009", "h018"]);
  });

  it("기본값은 IDEAL_SHAPE.reserve 다", () => {
    const r3 = pickRound(line, 3, one(fvec(0)), new Set(), 3);
    for (const kept of line.slice(0, IDEAL_SHAPE.reserve)) expect(ids(r3)).not.toContain(kept.id);
    expect(ids(r3)).toContain(line[IDEAL_SHAPE.reserve].id);
  });

  it("중심이 둘이면 중심마다 남긴다", () => {
    const two = [
      { vec: fvec(0), weight: 2 },
      { vec: fvec(171), weight: 2 },
    ];
    const r3 = pickRound(line, 3, two, new Set(), 4, 2);
    for (const kept of ["h000", "h009", "h171", "h162"]) expect(ids(r3)).not.toContain(kept);
  });

  it("2라운드는 남기지 않는다 — 결과 몫은 마지막 라운드의 일이다", () => {
    const l2 = line.map((f) => ({ ...f, level: 2 as const }));
    expect(ids(pickRound(l2, 2, one(fvec(0)), new Set(), 3, 3))).toEqual(["h000", "h009", "h018"]);
  });

  it("남기고 나서 한 화면이 안 차면 남기지 않는다 — 빈 칸은 없다", () => {
    const few = line.slice(0, 5);
    const r3 = pickRound(few, 3, one(fvec(0)), new Set(), 3, 3);
    expect(r3).toHaveLength(3);
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
    const out = nearestCelebs(celebs, one(fvec(0)), new Set(["c002"]));
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
      // 화면이 조합하는 그대로 — 고른 셋은 두 무리가 될 수 없어(splitMin × 2 미만) 중심 하나다
      const centers = picked.length ? tasteCenters(picked.map(vecOf)) : null;
      const faces = pickRound(FACES, round, centers, shown, N6, R0);
      for (const f of faces) shown.add(f.id);
      rounds.push(ids(faces));
      expect(ids(faces)).toContain(want);
      picked.push(want);
    }
    const result = nearestCelebs(CELEBS, tasteCenters(picked.map(vecOf)), shown);
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

// ─────────────────────────────────────────── v2 — 두 갈래 취향

describe("tasteCenters — 멀리 갈린 두 무리만 둘로 본다", () => {
  /*
   * v1 4차 검증에서 두 인상을 오가며 고른 사람은 2:3 이었다 — 평균이 두 무리 **사이**로 떨어져
   * 둘 다 아닌 얼굴이 나온다. 그래서 갈리면 둘을 따로 따라간다. 반대로 한 무리를 억지로 쪼개면
   * 한 취향이 반으로 줄어든 채 엉뚱한 쪽을 끌어온다 — 갈라지지 않는 입력이 더 중요하다.
   */
  const near = (v: Float32Array, w: Float32Array) => {
    expect(v[0]).toBeCloseTo(w[0], 5);
    expect(v[1]).toBeCloseTo(w[1], 5);
  };

  it("멀리 떨어진 두 무리는 둘이다 — 큰 무리가 먼저, 무게는 고른 수, 벡터는 그 무리의 평균", () => {
    const out = tasteCenters([0, 10, 20, 140, 150].map(fvec));
    expect(out.map((c) => c.weight)).toEqual([3, 2]);
    near(out[0].vec, meanOf([0, 10, 20].map(fvec)));
    near(out[1].vec, meanOf([140, 150].map(fvec)));
    expect(degOf(out[0].vec)).toBeCloseTo(10, 3);
    expect(degOf(out[1].vec)).toBeCloseTo(145, 3);
  });

  it("작은 무리가 앞에 와도 큰 무리가 먼저다", () => {
    const out = tasteCenters([150, 140, 0, 10, 20].map(fvec));
    expect(out.map((c) => c.weight)).toEqual([3, 2]);
    expect(degOf(out[0].vec)).toBeCloseTo(10, 3);
    expect(degOf(out[1].vec)).toBeCloseTo(145, 3);
  });

  it("두 무리가 같은 수면 첫 시작점(가장 덜 닮은 쌍의 앞) 쪽이 먼저다", () => {
    // 가장 덜 닮은 쌍은 160°·0° — 앞에 선 160° 쪽이 A
    const a = tasteCenters([150, 160, 0, 10].map(fvec));
    expect(a.map((c) => Math.round(degOf(c.vec)))).toEqual([155, 5]);
    // 순서를 뒤집으면 0°·160° — 이번에는 0° 쪽이 A
    const b = tasteCenters([0, 10, 150, 160].map(fvec));
    expect(b.map((c) => Math.round(degOf(c.vec)))).toEqual([5, 155]);
  });

  it("한 무리로 모여 있으면 쪼개지 않는다 — 평균 하나, 무게는 전체", () => {
    const vecs = [0, 5, 10, 15, 20].map(fvec);
    const out = tasteCenters(vecs);
    expect(out).toHaveLength(1);
    expect(out[0].weight).toBe(5);
    near(out[0].vec, meanOf(vecs));
  });

  it("두 무리의 평균이 90° 안이면(splitCos 이상) 하나다", () => {
    // 5° 와 65° — 갈라 보면 둘이지만 같은 쪽을 향한다
    const out = tasteCenters([0, 10, 60, 70].map(fvec));
    expect(out).toHaveLength(1);
    expect(out[0].weight).toBe(4);
  });

  it("문턱은 splitCos(−0.3) — 95° 벌어진 두 무리는 하나, 110° 는 둘", () => {
    // 평균이 5° · 100° (95° 차, cos ≈ −0.09) → 하나
    expect(tasteCenters([0, 10, 95, 105].map(fvec))).toHaveLength(1);
    // 평균이 5° · 115° (110° 차, cos ≈ −0.34) → 둘
    expect(tasteCenters([0, 10, 110, 120].map(fvec))).toHaveLength(2);
  });

  it("작은 무리가 한 장이면 갈라지지 않는다 — 잘못 누른 것일 수 있다", () => {
    const vecs = [0, 5, 10, 15, 180].map(fvec);
    const out = tasteCenters(vecs);
    expect(out).toHaveLength(1);
    expect(out[0].weight).toBe(5);
    near(out[0].vec, meanOf(vecs));
  });

  it("고른 것이 splitMin × 2 보다 적으면 멀어도 평균 하나다", () => {
    const vecs = [0, 180, 90].map(fvec);
    const out = tasteCenters(vecs);
    expect(out).toHaveLength(1);
    expect(out[0].weight).toBe(3);
    near(out[0].vec, meanOf(vecs));
  });

  it("같은 벡터뿐이어도(두 번째 무리가 비어도) 하나다", () => {
    const out = tasteCenters([fvec(30), fvec(30), fvec(30), fvec(30)]);
    expect(out).toHaveLength(1);
    expect(out[0].weight).toBe(4);
    expect(degOf(out[0].vec)).toBeCloseTo(30, 3);
  });

  it("같은 입력이면 같은 출력 — 난수에 닿지 않는다", () => {
    const degs = [0, 170, 10, 190, 20, 200, 35, 160];
    const a = tasteCenters(degs.map(fvec));
    const b = tasteCenters(degs.map(fvec));
    expect(a.map((c) => c.weight)).toEqual(b.map((c) => c.weight));
    expect(a.map((c) => [...c.vec])).toEqual(b.map((c) => [...c.vec]));
    expect(a).toHaveLength(2);
  });
});

describe("pickRound 1라운드 — 모두에게 같은 두 쪽 (아홉 + 아홉)", () => {
  /** 1단계 열여덟 — 자산 순서가 각도 순서가 아니다 (정렬하지 않는다는 것을 보려고) */
  const PAGES: DecodedFace[] = [
    ...Array.from({ length: IDEAL_SHAPE.level1 }, (_, i): DecodedFace => ({
      id: `p${String(i + 1).padStart(3, "0")}`,
      level: 1,
      vec: fvec((i * 97) % 360),
    })),
    face("q", 5),
    face("q", 185),
  ];
  const PAGE1 = ids(PAGES.slice(0, 9));
  const PAGE2 = ids(PAGES.slice(9, 18));

  it("1단계 수는 한 화면 × (1 + 다른 얼굴 보기)", () => {
    expect(IDEAL_SHAPE.level1).toBe(IDEAL_SHAPE.faces * (1 + IDEAL_SHAPE.rerolls));
    expect(IDEAL_SHAPE.faces).toBe(9);
  });

  it("첫 쪽은 자산 순서 앞의 아홉 — 중심이 있어도 같다", () => {
    expect(ids(pickRound(PAGES, 1, null, new Set()))).toEqual(PAGE1);
    expect(ids(pickRound(PAGES, 1, one(fvec(185)), new Set()))).toEqual(PAGE1);
  });

  it("shown 이 첫 쪽을 품으면 둘째 쪽 아홉이 나온다", () => {
    expect(ids(pickRound(PAGES, 1, null, new Set(PAGE1)))).toEqual(PAGE2);
  });

  it("두 쪽을 다 봤으면 1단계는 더 없다 — 2단계로 넘치지 않는다", () => {
    expect(pickRound(PAGES, 1, null, new Set([...PAGE1, ...PAGE2]))).toEqual([]);
  });
});

describe("pickRound 중심 둘 — 자리를 무게로 나눠 번갈아 놓는다", () => {
  /*
   * A 쪽 열(0° 근처) · B 쪽 열(180° 근처). 서로 140° 넘게 떨어져 있어 각 중심의 목록은
   * 제 쪽 얼굴이 전부 앞에 선다 — 몇 칸을 받았는지가 A/B 접두로 바로 읽힌다.
   */
  const SIDE_A = [2, 6, 10, 14, 18, 22, 26, 30, 34, 38].map((d) => face("a", d));
  const SIDE_B = [182, 186, 190, 194, 198, 202, 206, 210, 214, 218].map((d) => face("b", d));
  const BOTH = [...SIDE_A, ...SIDE_B];
  const two = (wA: number, wB: number): TasteCenter[] => [
    { vec: fvec(0), weight: wA },
    { vec: fvec(180), weight: wB },
  ];

  it("3:2 → B 넷 · A 다섯, A 부터 번갈아", () => {
    expect(ids(pickRound(BOTH, 2, two(3, 2), new Set()))).toEqual([
      "a002", "b182", "a006", "b186", "a010", "b190", "a014", "b194", "a018",
    ]);
  });

  it("8:2 → B 둘 (round(1.8))", () => {
    expect(ids(pickRound(BOTH, 2, two(8, 2), new Set()))).toEqual([
      "a002", "b182", "a006", "b186", "a010", "a014", "a018", "a022", "a026",
    ]);
  });

  it("작은 쪽은 적어도 한 칸 — round 가 0 이어도", () => {
    expect(ids(pickRound(BOTH, 2, two(20, 1), new Set()))).toEqual([
      "a002", "b182", "a006", "a010", "a014", "a018", "a022", "a026", "a030",
    ]);
  });

  it("B 는 절반(내림)을 넘지 않는다 — 같은 무게여도, B 가 더 무거워도 A 가 다섯", () => {
    const want = ["a002", "b182", "a006", "b186", "a010", "b190", "a014", "b194", "a018"];
    expect(ids(pickRound(BOTH, 2, two(2, 2), new Set()))).toEqual(want);
    expect(ids(pickRound(BOTH, 2, two(2, 3), new Set()))).toEqual(want);
  });

  it("shown 은 어느 쪽 1위여도 안 나온다 (S-B3)", () => {
    expect(ids(pickRound(BOTH, 2, two(3, 2), new Set(["a002", "b182"])))).toEqual([
      "a006", "b186", "a010", "b190", "a014", "b194", "a018", "b198", "a022",
    ]);
  });

  it("한쪽 근처가 모자라면 그 쪽 목록의 다음 얼굴로 채운다 — 빈 칸이 없다", () => {
    // B 근처는 하나뿐 — B 의 둘째부터는 180° 에서 가까운 A 쪽 끝(30°·26°·22°)이다
    const pool = [...SIDE_A.slice(0, 8), SIDE_B[0]];
    const out = pickRound(pool, 2, two(3, 2), new Set());
    expect(ids(out)).toEqual(["a002", "b182", "a006", "a030", "a010", "a026", "a014", "a022", "a018"]);
  });

  it("후보가 아홉보다 적으면 있는 만큼 — 같은 id 없이", () => {
    const pool = [SIDE_A[0], SIDE_A[1], SIDE_B[0], SIDE_B[1], SIDE_A[2]];
    expect(ids(pickRound(pool, 2, two(3, 2), new Set()))).toEqual(["a002", "b182", "a006", "b186", "a010"]);
  });

  it("픽스처 풀 2·3라운드 — 어떤 두 중심에서도 같은 id 없음 · shown 안 나옴 · 칸이 찬다", () => {
    const shown = new Set(L1);
    for (const [da, db] of [
      [5, 185],
      [0, 120],
      [45, 250],
      [300, 100],
    ]) {
      const centers: TasteCenter[] = [
        { vec: fvec(da), weight: 3 },
        { vec: fvec(db), weight: 2 },
      ];
      for (const round of [2, 3] as const) {
        const out = pickRound(FACES, round, centers, shown, N6);
        const got = ids(out);
        expect(got, `${round}R ${da}/${db}`).toHaveLength(N6);
        expect(new Set(got).size).toBe(N6);
        for (const id of got) expect(shown.has(id)).toBe(false);
        if (round === 2) expect(out.every((f) => f.level === 2)).toBe(true);
      }
    }
  });

  it("같은 입력이면 같은 출력", () => {
    const a = pickRound(FACES, 3, [{ vec: fvec(5), weight: 3 }, { vec: fvec(185), weight: 2 }], new Set(L1), N6);
    const b = pickRound(FACES, 3, [{ vec: fvec(5), weight: 3 }, { vec: fvec(185), weight: 2 }], new Set(L1), N6);
    expect(ids(a)).toEqual(ids(b));
  });
});

describe("nearestCelebs 중심 둘 — [A 1위, B 1위, A 2위]", () => {
  const celeb = (deg: number, extra: Partial<DecodedCeleb> = {}): DecodedCeleb => ({
    id: `c${String(deg).padStart(3, "0")}`,
    name: `n${deg}`,
    vec: fvec(deg),
    ...extra,
  });

  it("큰 무리가 첫 자리를 든다 — retired·exclude 는 어느 쪽 1위여도 빠진다", () => {
    const celebs = [
      celeb(0, { retired: true }),
      celeb(1),
      celeb(3), // exclude
      celeb(4),
      celeb(9),
      celeb(90),
      celeb(180), // exclude
      celeb(181),
      celeb(185),
    ];
    const centers: TasteCenter[] = [
      { vec: fvec(0), weight: 3 },
      { vec: fvec(180), weight: 2 },
    ];
    expect(ids(nearestCelebs(celebs, centers, new Set(["c003", "c180"])))).toEqual(["c001", "c181", "c004"]);
  });

  it("두 중심의 1위가 같은 사람이면 한 번만 — B 는 제 다음 사람을 든다", () => {
    // 40° 는 0° 에서 40, 90° 에서 50 — 둘 다의 1위다
    const celebs = [celeb(40), celeb(200), celeb(300)];
    const centers: TasteCenter[] = [
      { vec: fvec(0), weight: 3 },
      { vec: fvec(90), weight: 2 },
    ];
    expect(ids(nearestCelebs(celebs, centers, new Set()))).toEqual(["c040", "c200", "c300"]);
  });
});

describe("readIdealInput — 라운드마다 1~5", () => {
  const base = {
    v: 2,
    pool: "F",
    picks: [["zz0001"], ["zz0002", "zz0003", "zz0004", "zz0005"], ["zz0006", "zz0007", "zz0008", "zz0009", "zz0010"]],
    result: ["zz0101", "zz0102", "zz0103"],
  };

  it("넷·다섯은 받는다", () => {
    expect(readIdealInput(base)?.picks).toEqual(base.picks);
  });

  it("여섯은 막는다 — 비어도 막는다", () => {
    expect(readIdealInput({ ...base, picks: [base.picks[0], base.picks[1], [...base.picks[2], "zz0011"]] })).toBeNull();
    expect(readIdealInput({ ...base, picks: [[], base.picks[1], base.picks[2]] })).toBeNull();
  });
});

// ─────────────────────────────────────────── 끌린 얼굴의 특징 (ADR-127)

describe("idealTraits — 고른 얼굴의 절반 이상이 가졌고, 풀보다 두드러진 낱말만", () => {
  /** 풀 열 명 — 고양이상 둘 · 강아지상 여덟. 균형 잡힌 이목구비는 모두가 가졌다 */
  const pool: string[][] = [
    ["animal.cat", "vibe.chic", "features.balanced"],
    ["animal.cat", "vibe.chic", "features.balanced", "gaze.sharp"],
    ...Array.from({ length: 8 }, () => ["animal.dog", "vibe.warm", "features.balanced"]),
  ];

  it("고른 얼굴의 절반 이상이 가졌고 풀보다 흔하면 남는다", () => {
    const t = idealTraits([pool[0], pool[1], pool[2]], pool);
    expect(t.animal).toEqual(["cat"]);
    expect(t.vibe).toEqual(["chic"]);
  });

  it("모두가 가진 낱말은 아무의 취향도 말하지 않는다 — 빠진다", () => {
    expect(idealTraits([pool[0], pool[1]], pool).features).toBeUndefined();
  });

  it("한 장만 가진 낱말은 빠진다 — 절반이어도 둘은 돼야 한다", () => {
    // gaze.sharp 는 둘 중 한 장(절반)이지만 한 장뿐이다
    expect(idealTraits([pool[0], pool[1]], pool).gaze).toBeUndefined();
    expect(TRAIT_SHAPE.minCount).toBe(2);
  });

  it("절반에 못 미치면 빠진다", () => {
    const t = idealTraits([pool[0], pool[1], pool[2], pool[3], pool[4]], pool);
    expect(t.animal).toBeUndefined(); // 고양이상 다섯 중 둘
  });

  it("칸마다 max 개까지, 풀보다 더 두드러진 순서로", () => {
    const p2: string[][] = [
      ["vibe.chic", "vibe.cold", "vibe.elegant"],
      ["vibe.chic", "vibe.cold", "vibe.elegant"],
      ["vibe.chic", "vibe.cold", "vibe.elegant"],
      ["vibe.elegant"],
      ["vibe.cold", "vibe.elegant"],
      ["vibe.warm"],
      ["vibe.warm"],
      ["vibe.warm"],
    ];
    // 셋을 고르면 chic(풀 3/8) · cold(4/8) · elegant(5/8) 가 모두 셋 다 — 풀에서 드문 chic 이 먼저, 둘까지
    expect(idealTraits(p2.slice(0, 3), p2).vibe).toEqual(["chic", "cold"]);
    expect(TRAIT_SHAPE.max.vibe).toBe(2);
  });

  it("두드러진 것이 없으면 빈 객체다 — 점수로 채우지 않는다", () => {
    expect(idealTraits([pool[2], pool[3]], pool)).toEqual({});
    expect(idealTraits([], pool)).toEqual({});
  });

  it("같은 입력이면 같은 출력", () => {
    const pick = [pool[0], pool[1], pool[5]];
    expect(idealTraits(pick, pool)).toEqual(idealTraits(pick, pool));
  });
});

describe("normalizeIdeal — v2 까지의 한 명짜리 정답을 배열로 편다", () => {
  const base: Ideal = { v: 2, pool: "F", picks: [["a1"], ["b1"], ["c1"]], result: ["r1", "r2", "r3"], at: 1 };

  it("옛 모양 { chosen: 'id' } 은 [id] 가 된다", () => {
    const old = { ...base, verdict: { chosen: "r2" } } as unknown as Ideal;
    expect(normalizeIdeal(old).verdict).toEqual({ chosen: ["r2"] });
  });

  it("지금 모양과 없음 · 무응답은 그대로다", () => {
    for (const v of [{ chosen: ["r1", "r3"] }, { none: true as const }, undefined]) {
      const row = { ...base, ...(v ? { verdict: v } : {}) } as Ideal;
      expect(normalizeIdeal(row)).toEqual(row);
    }
  });
});

// ─────────────────────────────────────────── 설명글 (ADR-134)

describe("shownPages — 고른 얼굴만으로 그 사람이 본 화면을 다시 세운다 (ADR-134)", () => {
  /*
   * 지금 판의 모양(한 화면 아홉 · 1단계 두 쪽 · 결과 몫)으로 돌아야 한다 — 픽스처 풀은 여섯(v1)으로 셈해 둬서 넘긴 쪽이 비어 버린다.
   * 그래서 인라인 풀이다: 1단계 18 · 2단계 36 · 3단계 72 가 원 위에 고루 선다
   */
  const POOL9: DecodedFace[] = [
    ...Array.from({ length: 18 }, (_, i) => face("a", i * 20, 1)),
    ...Array.from({ length: 36 }, (_, i) => face("b", i * 10 + 5, 2)),
    ...Array.from({ length: 72 }, (_, i) => face("c", i * 5 + 1, 3)),
  ];
  const vecs = new Map(POOL9.map((f) => [f.id, f.vec]));

  /** 화면이 라운드를 세우는 그대로(`roundsOf`) — 라운드마다 `다른 얼굴 보기` 를 flips[r] 번 누르고, 그 쪽에서 고른다 */
  function play(flips: readonly number[], pick: (page: string[]) => string[]) {
    const shown = new Set<string>();
    const picks: string[][] = [];
    const pages: string[][] = [];
    for (let r = 1; r <= IDEAL_SHAPE.rounds; r++) {
      const centers = r === 1 ? null : tasteCenters(picks.flat().map((id) => vecs.get(id)!));
      let page: DecodedFace[] = [];
      for (let k = 0; k <= flips[r - 1]; k++) {
        page = pickRound(POOL9, r as 1 | 2 | 3, centers, shown);
        for (const f of page) shown.add(f.id);
      }
      pages.push(ids(page));
      picks.push(pick(ids(page)));
    }
    return { picks, pages };
  }

  it("★ 넘긴 쪽까지 — 고른 얼굴이 첫 쪽에 없으면 둘째 쪽을 본 것이다. 저장된 것(고른 얼굴)만으로 화면이 그대로 선다", () => {
    for (const flips of [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 1],
      [1, 1, 1],
    ]) {
      for (const pick of [(p: string[]) => [p[1], p[4]], (p: string[]) => [p[8]], (p: string[]) => p.slice(0, 5)]) {
        const { picks, pages } = play(flips, pick);
        expect(pages.every((p) => p.length === IDEAL_SHAPE.faces)).toBe(true);
        expect(shownPages(POOL9, vecs, picks), `넘김 ${flips.join(",")}`).toEqual(pages);
      }
    }
  });
});

describe("parseIdealStory — LLM 의 답에서 글을 꺼낸다 (ADR-134)", () => {
  const text = "같은 화면의 다른 얼굴보다 눈꼬리가 살짝 올라간 얼굴을 더 골랐어요. 사람들은 이런 얼굴에서 또렷한 인상을 먼저 받아요.";

  it("JSON 이면 글을 꺼낸다 — 코드 울타리를 벗기고, 공백을 한 칸으로 모은다", () => {
    expect(parseIdealStory(JSON.stringify({ text }))).toBe(text);
    expect(parseIdealStory("```json\n" + JSON.stringify({ text: text.replace(". ", ".\n\n  ") }) + "\n```")).toBe(text);
  });

  it("형식이 어긋나거나 길이가 밖이면 버린다 — 화면에 올리지 않는다", () => {
    expect(parseIdealStory("그냥 문장")).toBeNull();
    expect(parseIdealStory(JSON.stringify({ story: text }))).toBeNull();
    expect(parseIdealStory(JSON.stringify({ text: "짧다" }))).toBeNull();
    expect(parseIdealStory(JSON.stringify({ text: text.repeat(4) }))).toBeNull();
  });
});
