// 목표 얼굴 되찾기 모의 실험 — LLM 없이 (ADR-127)
// node recover.mjs [σ=0.15] [씨앗=7]
//
// 숨은 목표 얼굴 하나(두 인상이면 둘)를 정하고, 모의 사용자는 화면의 얼굴 중 목표와 닮은 쪽(코사인 + 정규 잡음 σ)을
// 1~5개(v1 은 1~3개) 고른다. 끌리는 게 없으면(가장 높은 값이 0.2 아래) 넘긴다. 잰 것은 결과 1위가 목표와 닮은 순서로
// 몇 번째인가다 (목표 자신은 뺀다. 두 인상이면 둘 중 나은 쪽). 앱의 순수 함수(src/shared/ideal.ts)를 그대로 부른다.
//
// ⚠️ 모의 사용자는 **벡터로 고른다** — 벡터가 사람의 인상과 맞는지는 재지 않는다. 그건 지인 평가가 잰다.
//    여기서 재는 것은 같은 벡터 위에서 **고르는 방식**(화면 수 · 고를 수 · 넘기기 · 두 갈래 · 결과 몫)끼리의 차이뿐이다.
//
// 읽는 것: public/faces/v1 · v{IDEAL_ASSET_V}/{f,m}.json
// 쓰는 것: 없음 (표를 찍는다)
// 순서: 규칙을 바꿀 때마다 (validate.mjs 의 LLM 종이 검증과 따로 — 그쪽은 사람 같은 판정을, 이쪽은 되찾기를 잰다)
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_FACES } from "./work.mjs";
import {
  IDEAL_ASSET_V,
  IDEAL_SHAPE,
  decodeVec,
  facesForStart,
  meanOf,
  nearestCelebs,
  pickRound,
  tasteCenters,
} from "../../src/shared/ideal.ts";

const SIGMA = Number(process.argv[2] ?? 0.15);
let seed = Number(process.argv[3] ?? 7);
const PEOPLE = 150; // 풀마다

const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const cos = (a, b) => {
  let s = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) (s += a[i] * b[i]), (x += a[i] * a[i]), (y += b[i] * b[i]);
  return s / Math.sqrt(x * y);
};

function load(v, g) {
  const f = JSON.parse(fs.readFileSync(path.join(DEFAULT_FACES, `v${v}`, `${g}.json`), "utf8"));
  const faces = f.faces.map((x) => ({ id: x.id, level: x.level, vec: decodeVec(x.v, f.dim, f.scale) }));
  const celebs = f.celebs.map((c) => ({ id: c.id, name: c.name, vec: decodeVec(c.v, f.dim, f.scale) }));
  return { faces, celebs, starts: f.starts, vec: new Map(faces.map((x) => [x.id, x.vec])) };
}

/**
 * 고르는 방식 — 판(자산) · 한 화면 · 고를 수 · 넘기기 · 평균 하나로만 볼지 · 3라운드 결과 몫 · 첫 화면 묶음.
 * `starts` 면 사람마다 묶음 번호를 무작위로 집는다 (ADR-136) — 없으면 모두 0번(자산의 단계 그대로)이다
 */
const ARMS = {
  v1: { v: 1, n: 6, pickMax: 3, rerolls: 0, single: true, reserve: 0 },
  v2: { v: IDEAL_ASSET_V, n: 9, pickMax: 5, rerolls: 1, reserve: 0 },
  "v2+남기기3": { v: IDEAL_ASSET_V, n: 9, pickMax: 5, rerolls: 1, reserve: 3 },
  "v2+남기기6": { v: IDEAL_ASSET_V, n: 9, pickMax: 5, rerolls: 1, reserve: 6 },
  "v2+남기기9": { v: IDEAL_ASSET_V, n: 9, pickMax: 5, rerolls: 1, reserve: 9 },
  "v2+남기기6+묶음": { v: IDEAL_ASSET_V, n: 9, pickMax: 5, rerolls: 1, reserve: 6, starts: true },
};

function run(P, arm, targets) {
  return targets.map((ts) => {
    const like = (vec) => Math.max(...ts.map((t) => cos(vec, t.vec)));
    const faces = arm.starts ? facesForStart(P.faces, P.starts, Math.floor(rnd() * IDEAL_SHAPE.starts)) : P.faces;
    const shown = new Set();
    const picks = [];
    for (let r = 1; r <= 3; r++) {
      const centers = r === 1 ? null : tasteCenters(picks.flat().map((id) => P.vec.get(id)));
      for (let flips = 0; ; ) {
        const page = pickRound(faces, r, centers, shown, arm.n, arm.reserve);
        for (const f of page) shown.add(f.id);
        const sc = page.map((f) => ({ f, s: like(f.vec) + SIGMA * gauss() })).sort((a, b) => b.s - a.s);
        if (flips < arm.rerolls && sc[0].s < 0.2) {
          flips++;
          continue;
        }
        picks.push(sc.slice(0, 1 + Math.floor(rnd() * arm.pickMax)).map((x) => x.f.id));
        break;
      }
    }
    const vecs = picks.flat().map((id) => P.vec.get(id));
    const centers = arm.single ? [{ vec: meanOf(vecs), weight: vecs.length }] : tasteCenters(vecs);
    const top = nearestCelebs(P.celebs, centers, shown)[0];
    const tid = new Set(ts.map((t) => t.id));
    return Math.min(...ts.map((t) => 1 + P.celebs.filter((x) => !tid.has(x.id) && cos(x.vec, t.vec) > cos(top.vec, t.vec)).length));
  });
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
for (const two of [false, true]) {
  console.log(`\n${two ? "두 인상" : "한 인상"} · σ ${SIGMA} · 씨앗 ${process.argv[3] ?? 7}`);
  for (const [name, arm] of Object.entries(ARMS)) {
    const ranks = [];
    for (const g of ["f", "m"]) {
      const P = load(arm.v, g);
      const pick = () => P.celebs[Math.floor(rnd() * P.celebs.length)];
      const targets = Array.from({ length: PEOPLE }, () => (two ? [pick(), pick()] : [pick()]));
      ranks.push(...run(P, arm, targets));
    }
    const top5 = ranks.filter((r) => r <= 5).length / ranks.length;
    console.log(`  ${name.padEnd(10)} 결과 1위가 다섯 안 ${(100 * top5).toFixed(0)}% · 순위 중앙 ${median(ranks)}`);
  }
}
