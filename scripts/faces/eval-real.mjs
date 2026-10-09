// 실제 참가자의 이상형 찾기 결과로 판을 잰다 — 검수 · 정답 확인 · 다음 라운드 맞히기 (ADR-133)
// node eval-real.mjs <결과 파일> [--space 3,4,3*0.5+4*0.5] [--seed 7]
//
// 결과 파일은 회차 저장소(EventDO)의 `ideals` 표를 Cloudflare 대시보드의 Data Studio 로 꺼낸 것이다 —
//   SELECT json_remove(json, '$.at') AS ideal FROM ideals ORDER BY random();
// JSON 배열이든, CSV 든, 표를 복사한 글이든 안에 든 Ideal JSON(`{"v":…,"picks":…}`)을 찾아 읽는다.
// **참가자 id · 시각은 꺼내지 않는다** — 그 쿼리가 이미 뺀다. 파일은 저장소에 넣지 않는다 (tmp/ 는 .gitignore 다)
//
// 재는 것
//   1. 검수 — 모양 · 판 · id 가 그 판의 자산에 있는가 · 라운드를 그대로 다시 세울 수 있는가 · 저장된 결과가 다시 센 결과와 같은가.
//      라운드는 결정적이라 첫 화면 묶음 번호(`start`, v6 부터 — ADR-136)와 고른 얼굴만으로 그 사람이 본 아홉을 다시 세운다.
//      `다른 얼굴 보기` 는 저장되지 않아 고른 얼굴이 첫 쪽에 없으면 둘째 쪽을 본 것으로 읽는다
//   2. 정답 확인 — 답한 비율 · 셋 중에 있었다 · 없음 · 자리(1 · 2 · 3위)마다 골린 비율. 그 판(대개 v3)의 만족도다
//   3. 다음 라운드 맞히기 — 2 · 3라운드의 화면 아홉에서 그 사람이 실제로 고른 얼굴을, 앞 라운드에 고른 얼굴로 맞히는가.
//      공간(v3 낱말 · v4 얼굴 …)마다 같은 화면을 다시 줄 세워 AUC 를 낸다 (0.5 가 무작위). **공간끼리 견주는 공정한 자리다** —
//      같은 사람이 같은 아홉 앞에서 한 선택이다. 화면이 그 판의 공간으로 골라졌다는 치우침은 모든 공간이 함께 진다
//   4. 정답과의 거리 — `진짜 이상형` 으로 고른 연예인이 공간마다 몇 등에 서는가 (본 얼굴을 뺀 후보 중 백분위).
//      그 판의 공간은 그 사람을 이미 1~3위에 세웠으니 견주지 않는다 — 다른 공간이 그 답에 얼마나 동의하나만 본다
//   5. 1라운드 — 얼굴마다 첫 쪽에 보인 수와 골린 비율. v5 까지는 모두에게 같은 아홉이었고, v6 부터는 묶음마다 다르다 (ADR-136)
//   6. 직업 · 출생 연도 — 화면에 보였을 때 골린 비율, 결과에 선 횟수와 정답 (roles.json · v{n}-sources.json)
//   7. 인기로 맞히기 — 다른 세션에서 그 얼굴이 골린 비율로 맞히는 AUC. 3 과 견준다 — 닮음이 인기를 못 넘으면
//      사람들은 앞에서 고른 얼굴을 닮은 얼굴보다 모두가 고르는 얼굴을 고른 것이다
//   8. 결과 쏠림 — 한 사람이 몇 세션의 결과에 서나. 같은 고른 얼굴로 공간마다 다시 낸 결과와 함께
//
// **정답 확인(2)은 인기에 섞인다** (ADR-133) — 모두가 끌리는 사람이 결과에 서면 `셋 중에 있었다` 가 는다.
// 판끼리 견줄 때 그 비만 보지 말고 결과 쏠림(8)을 함께 본다
//
// 읽는 것: 결과 파일, public/faces/v{n}/{f,m}.json, scripts/faces/roles.json · v{n}-sources.json (연예인의 이름 · 출생 연도 · 직업)
// 쓰는 것: 표준 출력에 집계만 — 참가자마다의 줄은 찍지 않는다
// 순서: 판을 내고 실전을 치른 뒤. 다음 판의 벡터 · 규칙을 고르는 재료다
import fs from "node:fs";
import path from "node:path";
import { decodeVec, facesForStart, IDEAL_SHAPE, nearestCelebs, pickRound, tasteCenters } from "../../src/shared/ideal.ts";
import { DEFAULT_FACES, HERE } from "./work.mjs";

/**
 * 판마다 그때의 규칙 — 다시 세우려면 그 판이 돌던 규칙 그대로여야 한다 (ADR-122 · 123 · 127 · 132).
 * split: 두 갈래 문턱(`splitCos`), null 이면 평균 하나(v1). reserve: 3라운드의 결과 몫
 */
export const RULES = {
  1: { n: 6, pickMax: 3, rerolls: 0, reserve: 0, split: null },
  2: { n: 9, pickMax: 5, rerolls: 1, reserve: 0, split: -0.2 },
  3: { n: 9, pickMax: 5, rerolls: 1, reserve: 6, split: -0.2 },
  4: { n: 9, pickMax: 5, rerolls: 1, reserve: 6, split: -0.3 },
  5: { n: 9, pickMax: 5, rerolls: 1, reserve: 6, split: -0.3 }, // v4 와 같은 규칙에 사람만 늘었다 (ADR-135)
  6: { n: 9, pickMax: 5, rerolls: 1, reserve: 6, split: -0.3 }, // v5 에 첫 화면 묶음만 더했다 — 묶음은 자산의 starts (ADR-136)
};

/** 그 판의 문턱으로 잠깐 바꿔 부른다. 동기 호출 안에서만 바뀐다 */
export function withSplit(split, fn) {
  const save = IDEAL_SHAPE.splitCos;
  IDEAL_SHAPE.splitCos = split ?? -Infinity;
  try {
    return fn();
  } finally {
    IDEAL_SHAPE.splitCos = save;
  }
}

/** 판 하나의 풀 — 자산 파일에서 */
export function loadPool(v, g, root = DEFAULT_FACES) {
  const f = JSON.parse(fs.readFileSync(path.join(root, `v${v}`, `${g}.json`), "utf8"));
  const faces = f.faces.map((x) => ({ id: x.id, level: x.level, vec: decodeVec(x.v, f.dim, f.scale) }));
  const celebs = f.celebs.map((c) => ({ id: c.id, name: c.name, vec: decodeVec(c.v, f.dim, f.scale), ...(c.retired ? { retired: true } : {}) }));
  return { v, g, faces, celebs, starts: f.starts, vec: new Map(celebs.map((c) => [c.id, c.vec])) };
}

/**
 * 견줄 공간 — `4` 는 그 판의 벡터, `3*0.5+4*0.5` 처럼 적으면 판들의 벡터를 무게대로 이어 붙인 공간이다
 * (각자 단위 길이로 맞춘 뒤 √무게를 곱해 잇는다 — 코사인이 곧 두 코사인의 가중 합). 모든 판에 있는 사람만 든다
 */
export function spaceOf(spec, g, poolOf) {
  const terms = String(spec).split("+").map((t) => {
    const [v, w = "1"] = t.replace(/^v/, "").split("*");
    return { P: poolOf(Number(v), g), w: Number(w) };
  });
  if (terms.length === 1) return { name: `v${terms[0].P.v}`, vec: terms[0].P.vec, split: RULES[terms[0].P.v].split };
  const total = terms.reduce((a, t) => a + t.w, 0);
  const vec = new Map();
  for (const id of terms[0].P.vec.keys()) {
    if (!terms.every((t) => t.P.vec.has(id))) continue;
    const parts = terms.flatMap((t) => {
      const v = t.P.vec.get(id);
      const n = Math.hypot(...v) || 1;
      return [...v].map((x) => (x / n) * Math.sqrt(t.w / total));
    });
    vec.set(id, Float32Array.from(parts));
  }
  // 섞은 공간은 얼굴 공간처럼 흩어진다 — 두 갈래 문턱은 v4 의 것을 쓴다
  return { name: spec, vec, split: RULES[4].split };
}

/**
 * 붙여 넣은 글에서 Ideal 을 찾는다. JSON 배열 · 줄마다 JSON · CSV(`""` 로 감싼 따옴표) · 표 복사 모두 받는다.
 * 고르는 칸만 새로 짓는다 — 모르는 키는 버린다. 첫 화면 묶음 번호(`start`, v6 부터)는 고르는 칸이다 — 버리면 묶음을 집은
 * 사람의 화면을 자산 그대로 다시 세워 거의 모든 줄이 `다시 세우지 못했다` 로 걸린다 (ADR-136)
 */
export function readRows(text) {
  const t = text.replace(/""/g, '"');
  const rows = [];
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== "{") continue;
    let depth = 0;
    let inStr = false;
    for (let j = i; j < t.length; j++) {
      const c = t[j];
      if (inStr) {
        if (c === "\\") j++;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        try {
          const o = JSON.parse(t.slice(i, j + 1));
          if (o && Array.isArray(o.picks) && Array.isArray(o.result)) {
            rows.push({
              v: o.v,
              pool: o.pool,
              picks: o.picks,
              result: o.result,
              ...(Number.isInteger(o.start) ? { start: o.start } : {}),
              ...(o.verdict ? { verdict: o.verdict } : {}),
            });
            i = j;
          }
        } catch {
          /* 이 괄호는 Ideal 이 아니다 — 다음 `{` 부터 본다 */
        }
        break;
      }
    }
  }
  return rows;
}

const subset = (xs, page) => xs.every((id) => page.some((f) => f.id === id));

/**
 * 그 사람이 본 화면을 다시 세운다. 라운드마다 고른 얼굴이 첫 쪽에 없으면 `다른 얼굴 보기` 로 둘째 쪽을 본 것이다.
 * 1 · 2단계는 그 결과의 첫 화면 묶음(`start`)으로 붙인다 (ADR-136) — 번호가 없으면(v5 까지) 자산 그대로다.
 * 돌려주는 것: 라운드마다 고른 화면(page) · 넘긴 횟수 · 본 얼굴 전부 · 다시 센 결과 · 세울 수 있었나
 */
export function reconstruct(row, P) {
  const rule = RULES[row.v];
  const faces = facesForStart(P.faces, P.starts, row.start);
  return withSplit(rule.split, () => {
    const shown = new Set();
    const rounds = [];
    let ok = true;
    for (let r = 1; r <= 3; r++) {
      const centers = r === 1 ? null : tasteCenters(row.picks.slice(0, r - 1).flat().map((id) => P.vec.get(id)));
      let page = pickRound(faces, r, centers, shown, rule.n, rule.reserve);
      let flips = 0;
      while (!subset(row.picks[r - 1], page) && flips < rule.rerolls) {
        for (const f of page) shown.add(f.id);
        page = pickRound(faces, r, centers, shown, rule.n, rule.reserve);
        flips++;
      }
      if (!subset(row.picks[r - 1], page)) ok = false;
      for (const f of page) shown.add(f.id);
      rounds.push({ page: page.map((f) => f.id), flips });
    }
    const result = nearestCelebs(P.celebs, tasteCenters(row.picks.flat().map((id) => P.vec.get(id))), shown).map((c) => c.id);
    return { ok, rounds, shown, result, same: result.join() === row.result.join() };
  });
}

/** 판정 하나의 모양 — v2 까지의 `{ chosen: "id" }` 도 편다 */
export function verdictOf(row) {
  const v = row.verdict;
  if (!v) return null;
  if (v.none === true) return { none: true };
  const chosen = typeof v.chosen === "string" ? [v.chosen] : Array.isArray(v.chosen) ? v.chosen : null;
  return chosen ? { chosen } : null;
}

const cos = (a, b) => {
  let s = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) (s += a[i] * b[i]), (x += a[i] * a[i]), (y += b[i] * b[i]);
  return x && y ? s / Math.sqrt(x * y) : 0;
};

/**
 * 맞히는 법 — 앞 라운드에 고른 얼굴(벡터들)로 화면의 얼굴 하나에 점수를 준다.
 *   center: 앱이 쓰는 것 — 취향 중심(1개 또는 2개)과의 코사인 중 큰 것
 *   knn:    고른 얼굴 중 가장 닮은 하나와의 코사인 — 평균을 내지 않는 쪽
 */
export const SCORERS = {
  center: (picked, split) => {
    const centers = withSplit(split, () => tasteCenters(picked));
    return (vec) => Math.max(...centers.map((c) => cos(vec, c.vec)));
  },
  knn: (picked) => (vec) => Math.max(...picked.map((p) => cos(vec, p))),
};

/** 고른 것(pos)이 안 고른 것(neg)보다 점수가 높을 확률. 같으면 반 */
export function auc(pos, neg) {
  if (!pos.length || !neg.length) return null;
  let w = 0;
  for (const p of pos) for (const n of neg) w += p > n ? 1 : p === n ? 0.5 : 0;
  return w / (pos.length * neg.length);
}

/**
 * 다음 라운드 맞히기 — 한 사람의 2 · 3라운드 화면에서 AUC. space 는 id → 벡터 (Map). 공간에 없는 얼굴은 뺀다 —
 * 견주는 공간들의 **공통 얼굴**만 쓰려면 keep 으로 거른다
 */
export function nextPickAuc(row, rec, space, { scorer = "center", split = -0.2, keep = null } = {}) {
  const out = [];
  for (let r = 2; r <= 3; r++) {
    const prev = row.picks.slice(0, r - 1).flat().filter((id) => space.has(id)).map((id) => space.get(id));
    if (!prev.length) continue;
    const score = SCORERS[scorer](prev, split);
    const page = rec.rounds[r - 1].page.filter((id) => space.has(id) && (!keep || keep.has(id)));
    const picked = new Set(row.picks[r - 1]);
    const a = auc(page.filter((id) => picked.has(id)).map((id) => score(space.get(id))), page.filter((id) => !picked.has(id)).map((id) => score(space.get(id))));
    if (a != null) out.push({ round: r, auc: a });
  }
  return out;
}

/** 정답이 공간마다 몇 등인가 — 본 얼굴을 뺀 후보 중 백분위(0 이 맨 앞). 공간에 없는 사람은 뺀다 */
export function answerPercentile(row, rec, space, ids, { split = -0.2 } = {}) {
  const v = verdictOf(row);
  if (!v?.chosen) return [];
  const picked = row.picks.flat().filter((id) => space.has(id)).map((id) => space.get(id));
  if (!picked.length) return [];
  const score = SCORERS.center(picked, split);
  const cands = ids.filter((id) => space.has(id) && !rec.shown.has(id));
  const scored = cands.map((id) => [id, score(space.get(id))]).sort((a, b) => b[1] - a[1]);
  const rank = new Map(scored.map(([id], i) => [id, i]));
  return v.chosen.filter((id) => rank.has(id)).map((id) => rank.get(id) / Math.max(1, scored.length - 1));
}

/** 사람(세션) 단위로 다시 뽑아 평균의 95% 구간 — 씨앗이 같으면 같다 */
export function bootstrap(groups, { seed = 7, n = 2000 } = {}) {
  const flat = (gs) => gs.flat();
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const all = flat(groups);
  if (!all.length) return null;
  let s = seed >>> 0;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const ms = [];
  for (let k = 0; k < n; k++) {
    const pick = Array.from({ length: groups.length }, () => groups[Math.floor(rnd() * groups.length)]);
    const xs = flat(pick);
    if (xs.length) ms.push(mean(xs));
  }
  ms.sort((a, b) => a - b);
  return { mean: mean(all), lo: ms[Math.floor(0.025 * ms.length)], hi: ms[Math.floor(0.975 * ms.length)], n: all.length };
}

/**
 * 사람의 이름 · 출생 연도 · 직업 — 판마다의 출처 목록(`v{n}-sources.json`)과 `roles.json` 에서. id 는 판끼리 같다
 */
export function peopleMeta(root = HERE) {
  const rolesPath = path.join(root, "roles.json");
  const roles = fs.existsSync(rolesPath) ? JSON.parse(fs.readFileSync(rolesPath, "utf8")) : {};
  const meta = new Map();
  for (const f of fs.readdirSync(root).filter((f) => /^v\d+-sources\.json$/.test(f)).sort())
    for (const s of JSON.parse(fs.readFileSync(path.join(root, f), "utf8")))
      if (!meta.has(s.id)) meta.set(s.id, { name: s.name, born: s.born, role: roles[`${s.name}|${s.born}`] ?? "?" });
  return meta;
}

/**
 * 인기로 맞히기 — 같은 풀의 **다른 세션들**에서 그 얼굴이 보였을 때 골린 비율을 점수로 준다 (자기 세션은 뺀다).
 * 닮음(3)이 인기보다 못 맞히면, 사람들은 앞에서 고른 얼굴을 닮은 얼굴보다 **모두가 고르는 얼굴**을 고른 것이다.
 * 1라운드는 넘기지 않은 세션만 센다 — 첫 쪽끼리 견준다. 비율은 얼굴마다 **보인 수**로 나누니 묶음마다 첫 쪽이 달라도(v6, ADR-136) 그대로 선다
 */
export function popularityAuc(xs) {
  const r1 = [];
  const r23 = [];
  for (const x of xs) {
    const shown = new Map();
    const picked = new Map();
    for (const y of xs) {
      if (y === x) continue;
      y.rec.rounds.forEach((rd, k) => {
        for (const id of rd.page) {
          shown.set(id, (shown.get(id) ?? 0) + 1);
          if (y.row.picks[k].includes(id)) picked.set(id, (picked.get(id) ?? 0) + 1);
        }
      });
    }
    const prior = (id) => ((picked.get(id) ?? 0) + 0.2) / ((shown.get(id) ?? 0) + 1);
    const one = (k) => {
      const page = x.rec.rounds[k].page;
      const pk = new Set(x.row.picks[k]);
      return auc(page.filter((id) => pk.has(id)).map(prior), page.filter((id) => !pk.has(id)).map(prior));
    };
    if (x.rec.rounds[0].flips === 0) r1.push([one(0)].filter((a) => a != null));
    r23.push([one(1), one(2)].filter((a) => a != null));
  }
  return { r1, r23 };
}

const pct = (x, d = 0) => `${(100 * x).toFixed(d)}%`;
const fmt = (b) => (b ? `${b.mean.toFixed(3)} [${b.lo.toFixed(3)}, ${b.hi.toFixed(3)}] (n=${b.n})` : "—");

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const args = process.argv.slice(2);
  const flags = {};
  const pos = [];
  for (let i = 0; i < args.length; i++) args[i].startsWith("--") ? (flags[args[i].slice(2)] = args[++i]) : pos.push(args[i]);
  const file = pos[0];
  const opt = (k, d) => flags[k] ?? d;
  if (!file) throw new Error("usage: node eval-real.mjs <결과 파일> [--space 3,4,3*0.5+4*0.5] [--seed 7]");
  const seed = Number(opt("seed", 7));
  const specs = opt("space", "3,4").split(",");
  const rows = readRows(fs.readFileSync(file, "utf8"));
  const pools = new Map();
  const poolOf = (v, g) => {
    const k = `${v}/${g}`;
    if (!pools.has(k)) pools.set(k, loadPool(v, g));
    return pools.get(k);
  };

  // ── 1. 검수
  console.log(`\n== 검수 — 읽은 결과 ${rows.length}줄`);
  const good = [];
  const why = {};
  const bad = (k) => (why[k] = (why[k] ?? 0) + 1);
  for (const row of rows) {
    const g = row.pool === "F" ? "f" : row.pool === "M" ? "m" : null;
    if (!g) { bad("풀이 F · M 이 아니다"); continue; }
    if (!RULES[row.v] || !fs.existsSync(path.join(DEFAULT_FACES, `v${row.v}`, `${g}.json`))) { bad(`없는 판 v${row.v}`); continue; }
    if (row.picks.length !== 3 || row.picks.some((p) => !Array.isArray(p) || !p.length || p.length > RULES[row.v].pickMax)) { bad("고른 얼굴의 모양이 판의 규칙과 다르다"); continue; }
    const P = poolOf(row.v, g);
    if (![...row.picks.flat(), ...row.result].every((id) => P.vec.has(id))) { bad("그 판의 자산에 없는 id"); continue; }
    const rec = reconstruct(row, P);
    if (!rec.ok) bad("라운드를 다시 세우지 못했다(고른 얼굴이 그 화면에 없다)");
    if (!rec.same) bad("다시 센 결과가 저장된 결과와 다르다");
    good.push({ row, g, P, rec });
  }
  const byV = {};
  for (const x of good) byV[`v${x.row.v} ${x.row.pool}`] = (byV[`v${x.row.v} ${x.row.pool}`] ?? 0) + 1;
  console.log("  판 · 풀:", JSON.stringify(byV));
  console.log("  걸린 것:", Object.keys(why).length ? JSON.stringify(why) : "없음");
  const usable = good.filter((x) => x.rec.ok);
  const flips = [0, 1, 2].map((r) => usable.filter((x) => x.rec.rounds[r].flips > 0).length);
  const perRound = [0, 1, 2].map((r) => (usable.reduce((a, x) => a + x.row.picks[r].length, 0) / Math.max(1, usable.length)).toFixed(1));
  console.log(`  다시 세운 세션 ${usable.length} · 결과까지 같은 세션 ${usable.filter((x) => x.rec.same).length}`);
  console.log(`  라운드마다 고른 수 평균 ${perRound.join(" · ")} · '다른 얼굴 보기' 를 쓴 라운드 ${flips.join(" · ")}`);

  // ── 2. 정답 확인
  console.log("\n== 정답 확인 (그 판의 만족도)");
  for (const v of [...new Set(good.map((x) => x.row.v))].sort()) {
    const xs = good.filter((x) => x.row.v === v);
    const vs = xs.map((x) => verdictOf(x.row));
    const answered = vs.filter(Boolean);
    const chosen = answered.filter((d) => d.chosen);
    const pos = [0, 1, 2].map((i) => xs.filter((x) => verdictOf(x.row)?.chosen?.includes(x.row.result[i])).length);
    console.log(`  v${v}: 결과 ${xs.length} · 답함 ${answered.length} (${pct(answered.length / Math.max(1, xs.length))})` +
      ` · 셋 중에 있었다 ${chosen.length} (${pct(chosen.length / Math.max(1, answered.length))}) · 없음 ${answered.length - chosen.length}` +
      ` · 자리별 ${pos.map((p, i) => `${i + 1}위 ${p}`).join(" ")} · 고른 수 평균 ${(chosen.reduce((a, d) => a + d.chosen.length, 0) / Math.max(1, chosen.length)).toFixed(2)}`);
  }

  // ── 3. 다음 라운드 맞히기 — 공간마다, 공통 얼굴만
  console.log("\n== 다음 라운드 맞히기 (AUC, 0.5 = 무작위) — 같은 화면 · 같은 선택 · 공간마다 줄 세우기");
  for (const g of ["f", "m"]) {
    const xs = usable.filter((x) => x.g === g);
    if (!xs.length) continue;
    const spaces = specs.map((spec) => spaceOf(spec, g, poolOf));
    const keep = new Set([...spaces[0].vec.keys()].filter((id) => spaces.every((s) => s.vec.has(id))));
    for (const s of spaces) for (const scorer of ["center", "knn"]) {
      const groups = xs.map((x) => nextPickAuc(x.row, x.rec, s.vec, { scorer, split: s.split, keep }).map((o) => o.auc));
      console.log(`  ${g} ${s.name.padEnd(12)} ${scorer.padEnd(6)} ${fmt(bootstrap(groups, { seed }))}`);
    }
  }

  // ── 4. 정답과의 거리
  console.log("\n== '진짜 이상형' 으로 고른 연예인의 백분위 (0 = 맨 앞, 본 얼굴 뺌)");
  for (const g of ["f", "m"]) {
    const xs = usable.filter((x) => x.g === g && verdictOf(x.row)?.chosen);
    if (!xs.length) continue;
    for (const spec of specs) {
      const s = spaceOf(spec, g, poolOf);
      const groups = xs.map((x) => answerPercentile(x.row, x.rec, s.vec, [...s.vec.keys()], { split: s.split }));
      const note = xs.every((x) => `v${x.row.v}` === s.name) ? " ← 그 판의 공간이라 1~3위가 당연하다" : "";
      console.log(`  ${g} ${s.name.padEnd(12)} ${fmt(bootstrap(groups, { seed }))}${note}`);
    }
  }

  // ── 5. 1라운드 첫 쪽 — 얼굴마다 보인 수와 골린 수. v5 까지는 모두에게 같은 아홉, v6 부터는 묶음마다 다르다 (ADR-136)
  console.log("\n== 1라운드 첫 쪽 — 얼굴마다 골린 수 / 보인 수 (골린 비율 순 열둘)");
  for (const g of ["f", "m"]) {
    for (const v of [...new Set(usable.filter((x) => x.g === g).map((x) => x.row.v))]) {
      const xs = usable.filter((x) => x.g === g && x.row.v === v && x.rec.rounds[0].flips === 0);
      if (!xs.length) continue;
      const name = new Map(poolOf(v, g).celebs.map((c) => [c.id, c.name]));
      const seen = new Map();
      for (const x of xs) {
        for (const id of x.rec.rounds[0].page) {
          const s = seen.get(id) ?? { shown: 0, picked: 0 };
          s.shown++;
          if (x.row.picks[0].includes(id)) s.picked++;
          seen.set(id, s);
        }
      }
      const rate = [...seen]
        .sort((a, b) => b[1].picked / b[1].shown - a[1].picked / a[1].shown || b[1].shown - a[1].shown)
        .slice(0, 12);
      const starts = new Set(xs.map((x) => x.row.start ?? 0)).size;
      console.log(
        `  ${g} v${v} (${xs.length}명 · 묶음 ${starts}가지 · 얼굴 ${seen.size}): ` +
          rate.map(([id, s]) => `${name.get(id)} ${s.picked}/${s.shown}`).join(" · "),
      );
    }
  }

  // ── 6. 직업 · 나이 — 화면에 보였을 때 골린 비율, 결과에 선 횟수와 정답
  const meta = peopleMeta();
  const bucket = (y) => (!y ? "?" : y < 1985 ? "~1984" : y < 1995 ? "1985~1994" : "1995~");
  console.log("\n== 직업 · 출생 연도 — 화면에 보였을 때 골린 비율 · 결과에 선 횟수");
  for (const [label, keyOf] of [["직업", (id) => meta.get(id)?.role ?? "?"], ["출생", (id) => bucket(meta.get(id)?.born)]]) {
    const t = {};
    const bump = (k, f) => ((t[k] ??= { shown: 0, picked: 0, result: 0, chosen: 0, passed: 0 })[f]++);
    for (const x of usable) {
      x.rec.rounds.forEach((rd, k) => rd.page.forEach((id) => (bump(keyOf(id), "shown"), x.row.picks[k].includes(id) && bump(keyOf(id), "picked"))));
      const vd = verdictOf(x.row);
      for (const id of x.row.result) {
        bump(keyOf(id), "result");
        if (vd?.chosen?.includes(id)) bump(keyOf(id), "chosen");
        else if (vd) bump(keyOf(id), "passed");
      }
    }
    for (const [k, s] of Object.entries(t).sort((a, b) => b[1].shown - a[1].shown))
      console.log(`  ${label} ${k.padEnd(11)} 보임 ${String(s.shown).padStart(4)} · 골림 ${pct(s.picked / Math.max(1, s.shown)).padStart(4)}` +
        ` · 결과 ${s.result} (정답 ${s.chosen} · 답했는데 안 고름 ${s.passed})`);
  }

  // ── 7. 인기 대 닮음 — 남들이 고른 얼굴인가로 맞히기. 3 의 AUC 와 견준다
  console.log("\n== 인기로 맞히기 (AUC) — 다른 세션에서 그 얼굴이 골린 비율. 3 의 닮음보다 높으면 고르는 동기는 인기다");
  for (const g of ["f", "m"]) {
    const xs = usable.filter((x) => x.g === g);
    if (xs.length < 2) continue;
    const { r1, r23 } = popularityAuc(xs);
    console.log(`  ${g} 1라운드 ${fmt(bootstrap(r1, { seed }))} · 2 · 3라운드 ${fmt(bootstrap(r23, { seed }))}`);
  }

  // ── 8. 결과 쏠림 — 한 사람이 몇 세션의 결과에 서나. 같은 고른 얼굴로 공간마다 다시 낸 것과 함께 (후보는 모든 공간에 있는 사람)
  console.log("\n== 결과 쏠림 — 결과 칸 수 · 다른 사람 수 · 가장 많이 선 사람");
  const spread = (lists) => {
    const n = new Map();
    for (const ids of lists) for (const id of ids) n.set(id, (n.get(id) ?? 0) + 1);
    const top = [...n].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, k]) => `${meta.get(id)?.name ?? id} ×${k}`);
    return `${lists.length * 3}칸 중 ${n.size}명 · ${top.join(" · ")}`;
  };
  for (const g of ["f", "m"]) {
    const xs = usable.filter((x) => x.g === g);
    if (!xs.length) continue;
    console.log(`  ${g} 저장된 결과 ${spread(xs.map((x) => x.row.result))}`);
    const spaces = specs.map((spec) => spaceOf(spec, g, poolOf));
    const common = [...spaces[0].vec.keys()].filter((id) => spaces.every((s) => s.vec.has(id)));
    for (const s of spaces) {
      const celebs = common.map((id) => ({ id, name: id, vec: s.vec.get(id) }));
      const lists = xs.flatMap((x) => {
        const picked = x.row.picks.flat().filter((id) => s.vec.has(id));
        if (!picked.length) return [];
        const centers = withSplit(s.split, () => tasteCenters(picked.map((id) => s.vec.get(id))));
        return [nearestCelebs(celebs, centers, new Set(x.row.picks.flat())).map((c) => c.id)];
      });
      console.log(`  ${g} ${s.name.padEnd(12)} 같은 고른 얼굴 · 후보 ${common.length}명: ${spread(lists)}`);
    }
  }
}
