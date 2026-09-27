// 군집 — 구면 k-평균(코사인), 결정적(씨앗 고정 k-means++ · 여러 번 돌려 가장 촘촘한 것).
// 1단계 대표 6 · 2단계 대표 36 = 각 군집의 메도이드(중심에 가장 가까운 실제 얼굴). 나머지는 3단계.
//
// 읽는 것: 없음 (순수 함수)
// 쓰는 것: 없음
// 순서: 공용 — emit.mjs 가 level 1/2/3 을 정할 때 쓴다

export function norm(v) {
  let s = 0;
  for (const x of v) s += x * x;
  s = Math.sqrt(s) || 1;
  return v.map((x) => x / s);
}
export function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
/** Matryoshka — text-embedding-3 은 앞쪽을 잘라 다시 정규화하면 짧은 차원이 된다 (API 의 dimensions 와 같다) */
export function shorten(v, dim) {
  return norm(v.slice(0, dim));
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function kmeans(vecs, k, { seed = 1, restarts = 12, iters = 60 } = {}) {
  let best = null;
  for (let r = 0; r < restarts; r++) {
    const rand = rng(seed * 1000 + r);
    // k-means++ (코사인 거리)
    const cents = [vecs[Math.floor(rand() * vecs.length)]];
    while (cents.length < k) {
      const d = vecs.map((v) => Math.max(0, 1 - Math.max(...cents.map((c) => dot(v, c)))) ** 2);
      const tot = d.reduce((a, b) => a + b, 0);
      let x = rand() * tot;
      let i = 0;
      while (i < d.length - 1 && (x -= d[i]) > 0) i++;
      cents.push(vecs[i]);
    }
    let assign = new Array(vecs.length).fill(-1);
    for (let it = 0; it < iters; it++) {
      let moved = false;
      for (let i = 0; i < vecs.length; i++) {
        let bi = 0;
        let bs = -Infinity;
        for (let c = 0; c < k; c++) {
          const s = dot(vecs[i], cents[c]);
          if (s > bs) {
            bs = s;
            bi = c;
          }
        }
        if (assign[i] !== bi) {
          assign[i] = bi;
          moved = true;
        }
      }
      for (let c = 0; c < k; c++) {
        const mem = vecs.filter((_, i) => assign[i] === c);
        if (!mem.length) {
          // 빈 군집 — 가장 멀리 떨어진 점으로 다시 심는다
          let wi = 0;
          let ws = Infinity;
          for (let i = 0; i < vecs.length; i++) {
            const s = dot(vecs[i], cents[assign[i]]);
            if (s < ws) {
              ws = s;
              wi = i;
            }
          }
          cents[c] = vecs[wi];
          moved = true;
          continue;
        }
        const m = new Array(vecs[0].length).fill(0);
        for (const v of mem) for (let j = 0; j < m.length; j++) m[j] += v[j];
        cents[c] = norm(m);
      }
      if (!moved) break;
    }
    const inertia = vecs.reduce((s, v, i) => s + (1 - dot(v, cents[assign[i]])), 0);
    if (!best || inertia < best.inertia) best = { cents, assign, inertia };
  }
  return best;
}

/**
 * 사람 목록(각 vec 단위 벡터) → level 1/2/3 과 1단계 순서.
 * 1단계 여섯은 큰 군집부터 — "첫 화면" 이 모두에게 같다.
 */
export function levels(people, { k1 = 6, k2 = 36, seed = 7 } = {}) {
  const vecs = people.map((p) => p.vec);
  const lv = new Array(people.length).fill(3);
  const pickMedoids = (km, k, taken) => {
    const out = [];
    const order = [...Array(k).keys()].sort(
      (a, b) => km.assign.filter((x) => x === b).length - km.assign.filter((x) => x === a).length,
    );
    for (const c of order) {
      const mem = people.map((_, i) => i).filter((i) => km.assign[i] === c && !taken.has(i));
      if (!mem.length) continue;
      mem.sort((a, b) => dot(vecs[b], km.cents[c]) - dot(vecs[a], km.cents[c]));
      out.push(mem[0]);
      taken.add(mem[0]);
    }
    return out;
  };
  /**
   * 1단계 여섯 — 모두가 처음 보는 화면이라 **서로 달라 보여야** 한다 (종이 검증 ③).
   * 메도이드(군집 한가운데)는 여섯이 다 '평균 얼굴' 로 모였고(1차 세 쌍), 벡터 거리만 벌리면 판정자가 여전히 닮은 쌍을 찾았다(3차 여 두 쌍).
   * 그래서 **눈에 읽히는 기준을 먼저** 둔다: ① 첫째 동물상이 여섯 모두 다르게 ② 그다음 서로 가장 멀게.
   * 후보는 군집마다 중심에 가까운 앞 60%(대표다움 — 40% 로는 남자 풀의 동물상이 넷에서 다섯뿐이었다), 그중 **정면 사진**이 있으면 정면만 — 첫 화면에 옆으로 누운 사진을 두지 않는다.
   * 순서는 큰 군집부터 (자산 순서가 곧 1라운드 순서다)
   */
  const spreadReps = (km, k, taken) => {
    const order = [...Array(k).keys()].sort(
      (a, b) => km.assign.filter((x) => x === b).length - km.assign.filter((x) => x === a).length,
    );
    const cands = order.map((c) => {
      const mem = people.map((_, i) => i).filter((i) => km.assign[i] === c && !taken.has(i));
      mem.sort((a, b) => dot(vecs[b], km.cents[c]) - dot(vecs[a], km.cents[c]));
      const top = mem.slice(0, Math.max(1, Math.ceil(mem.length * 0.6)));
      const front = top.filter((i) => people[i].front);
      return front.length ? front : top;
    });
    const animal = (i) => people[i].attrs?.animal?.[0] ?? `#${i}`;
    // 목표: (서로 다른 첫째 동물상 수, 가장 닮은 쌍의 유사도의 음수) — 사전식으로 크게
    const score = (pick) => {
      const kinds = new Set(pick.map(animal)).size;
      let worst = -Infinity;
      for (let a = 0; a < pick.length; a++) for (let b = a + 1; b < pick.length; b++) worst = Math.max(worst, dot(vecs[pick[a]], vecs[pick[b]]));
      return [kinds, -worst];
    };
    const better = (x, y) => x[0] !== y[0] ? x[0] > y[0] : x[1] > y[1] + 1e-9;
    const pick = cands.map((m) => m[0]);
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      for (let c = 0; c < pick.length; c++) {
        let best = pick[c], bestScore = score(pick);
        for (const i of cands[c]) {
          const trial = pick.slice();
          trial[c] = i;
          const sc = score(trial);
          if (better(sc, bestScore)) { bestScore = sc; best = i; }
        }
        if (best !== pick[c]) { pick[c] = best; moved = true; }
      }
      if (!moved) break;
    }
    for (const i of pick) taken.add(i);
    return pick;
  };
  const taken = new Set();
  const km1 = kmeans(vecs, k1, { seed });
  const l1 = spreadReps(km1, k1, taken);
  const km2 = kmeans(vecs, k2, { seed: seed + 1 });
  const l2 = pickMedoids(km2, k2, taken);
  // 군집 하나가 1단계 대표 한 명뿐이면 그 군집의 2단계 대표가 비어 36 을 못 채운다 — 계약은 정확히 36 이다.
  // 모자란 만큼 **이미 뽑힌 대표들과 가장 덜 닮은** 얼굴로 채운다 (대표끼리 서로 다른 군집이라는 뜻을 지킨다)
  while (l2.length < k2) {
    const reps = [...l1, ...l2].map((i) => vecs[i]);
    let best = -1, bestSim = Infinity;
    for (let i = 0; i < people.length; i++) {
      if (taken.has(i)) continue;
      const sim = Math.max(...reps.map((r) => dot(vecs[i], r)));
      if (sim < bestSim) { bestSim = sim; best = i; }
    }
    l2.push(best);
    taken.add(best);
  }
  for (const i of l1) lv[i] = 1;
  for (const i of l2) lv[i] = 2;
  return { lv, l1, l2, sizes1: [...Array(k1).keys()].map((c) => km1.assign.filter((x) => x === c).length) };
}
