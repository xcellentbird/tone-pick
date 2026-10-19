// 실제 참가자의 이상형 찾기 결과로 판을 잰다 — 미리 정한 주 지표 (ADR-139) · 검수 · 정답 확인 · 다음 라운드 맞히기 (ADR-133)
// node eval-real.mjs <결과 파일> [--space 3,4,3*0.5+4*0.5] [--seed 7] [--runs last|first|all] [--prereg auto|on|off]
//
// 결과 파일은 회차 저장소(EventDO)를 Cloudflare 대시보드의 Data Studio 로 꺼낸 것이다. 두 모양을 다 읽는다 —
//   평가 기록 (ADR-137 부터, 찾기마다 본 화면째 · 사람마다 한 줄 `{"runs":[…]}`) — src/shared/ideal.ts 의 IDEAL_RUNS_SQL 그대로 돌린다
//   (기록이 생기기 전에 찾고 다시 찾지 않은 사람도 결과 행에서 지어 `prior` 로 싣는다)
//   그 전의 회차 (ADR-133, 사람마다 마지막 결과 하나):
//     SELECT json_remove(json, '$.at') AS ideal FROM ideals ORDER BY random();
// `--runs` — 1~8 이 사람마다 어느 찾기를 쓰나. 기본 `last`(마지막 하나)는 ADR-133 의 꺼낸 것과 같은 모양이라 114 와 견줄 수 있다.
// `first` 는 결과를 보기 전의 찾기, `all` 은 전부다 — `all` 에서 2 · 6 · 8 은 찾기마다 센다(다시 찾은 사람이 여러 번 든다).
// **0 은 이것을 따르지 않는다** — 사람마다 v7 의 처음 찾기로 정해져 있다 (ADR-139). `--seed` 도 따르지 않는다
// `--prereg` — 0 을 찍을지. 기본 `auto` 는 본 화면이 기록된 찾기나 섞인 화면(v7~)의 찾기가 하나라도 있을 때만 찍는다.
// `on` 은 늘 찍는다 — 옛 회차(114)도 `참고` 칸으로 잰다(실험실 값과 맞춰 볼 때). `off` 는 찍지 않는다
// JSON 배열이든, CSV 든, 표를 복사한 글이든 안에 든 JSON 을 찾아 읽는다.
// **참가자 id · 시각은 꺼내지 않는다** — 그 쿼리가 이미 뺀다. 파일은 저장소에 넣지 않는다 (tmp/ 는 .gitignore 다)
//
// 재는 것
//   0. 미리 정한 주 지표 (ADR-139) — 아래 `미리 정한 것`. 사람마다 섞인 화면(v7~)의 처음 찾기로만 판정하고, v6 까지는 `참고` 칸에 따로 찍는다
//   1. 검수 — 모양 · 판 · id 가 그 판의 자산에 있는가 · 라운드를 그대로 다시 세울 수 있는가 · 저장된 결과가 다시 센 결과와 같은가.
//      평가 기록에는 그 사람이 **본 화면**(넘긴 쪽 · 화면 순서까지)이 있다 — 있으면 그것을 쓰고, 다시 세운 화면과 다르면 센다.
//      없으면(ADR-133 의 모양 · 화면을 보내지 않은 탭) 라운드가 결정적이라 첫 화면 묶음 번호(`start`, v6 부터 — ADR-136)와 고른 얼굴만으로
//      다시 세운다 — 고른 얼굴이 첫 쪽에 없으면 `다른 얼굴 보기` 로 둘째 쪽을 본 것으로 읽는다.
//      **v7 부터 기기는 쪽의 아홉을 무작위 자리에 세운다** (ADR-139) — 기록된 쪽의 순서는 닮음과 무관하다. 그 판부터는 쪽마다
//      **같은 얼굴인지만** 견주고(순서까지 견주면 모든 찾기가 `다르다` 로 걸린다), 가까운 순(`pickRound` 의 순서) 그대로인 쪽을 따로 센다 —
//      섞였으면 아홉짜리 쪽이 그대로일 확률은 9! 에 하나다. 모든 쪽이 그대로인 찾기가 한 줌(셋)을 넘으면 경고한다. v6 까지는 순서까지 견준다.
//      **구간은 사람 단위로 다시 뽑는다** — 같은 사람의 여러 찾기를 여러 사람으로 세지 않는다
//   2. 정답 확인 — 답한 비율 · 셋 중에 있었다 · 없음 · 자리(1 · 2 · 3위)마다 골린 비율. 그 판(대개 v3)의 만족도다
//   3. 다음 라운드 맞히기 — 2 · 3라운드의 화면 아홉에서 그 사람이 실제로 고른 얼굴을, 앞 라운드에 고른 얼굴로 맞히는가.
//      공간(v3 낱말 · v4 얼굴 …)마다 같은 화면을 다시 줄 세워 AUC 를 낸다 (0.5 가 무작위). **공간끼리 견주는 공정한 자리다** —
//      같은 사람이 같은 아홉 앞에서 한 선택이다. 화면이 그 판의 공간으로 골라졌다는 치우침은 모든 공간이 함께 진다.
//      ⚠️ 하나는 함께 지지 않는다 — v6 까지 2 · 3라운드는 그 판의 공간에서 **가까운 순으로 왼쪽 위부터** 서고 섞지 않는다. 윗줄을 더 고르는
//      버릇이 있으면 화면을 짠 공간 쪽으로 기운다(`center` 가 더). 기록된 자리로도 그 버릇은 못 가른다 — 자리가 곧 그 공간의 닮음 순위다
//      (1라운드는 자리가 곧 무리다). v3 낱말로 짠 114 는 얼굴 공간끼리에는 이 치우침이 없다 (ADR-137 남은 일).
//      v7 부터는 기기가 섞어 보인다(ADR-139) — 자리가 닮음과 무관해져 버릇은 이 치우침이 아니라 잡음이 되고, 0 이 따로 잰다.
//      그래서 한 풀에 v6 까지의 찾기와 v7 부터의 찾기가 함께 있으면 **따로 낸다** — 섞어 견주지 않는다 (ADR-139). 3 과 견주는 7 도 같이 가른다
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
// 미리 정한 것 (0, ADR-139) — v7 은 화면을 대칭+0.15 로 짠다. 그 뒤의 파티 기록은 v7 을 **반박만** 할 수 있고 확인은 못 한다
// (저장소 밖 tone-pick-faces/lab/real-114 README). 그래서 반박의 규칙 하나를 기록이 쌓이기 전에 정해 둔다 — 바꾸려면 ADR 부터 고친다
//   무엇 — 고른 얼굴 묶음 C(중심), 실험실 d-cluster.py 의 C_cen 그대로다. 라운드 r 마다 S = 그 라운드의 마지막 쪽(고른 쪽), P = 고른 얼굴,
//          H = 앞 라운드들에 고른 얼굴(뒤 라운드는 쓰지 않는다). S 의 얼굴 x 마다 K(x) = H ∪ (P − {x}), 점수 = cos(x, K(x) 합의 방향).
//          고른 것 대 안 고른 것의 AUC 에서 **같은 쪽에서 고른 표시만 섞은 기댓값**(|S| 개 중 |P| 개를 고르는 모든 경우, H 는 그대로)을 빼고 0.5 를 더한다 —
//          0.5 가 우연이다. 고른 것 · 안 고른 것이 다 있고 모든 K(x) 가 비지 않는 라운드만 센다(1라운드는 둘 이상 골라야 한다).
//          찾기 = 셈한 라운드(세 라운드 모두)의 평균. 견주는 공간 모두에 있는 얼굴만 센다(버린 수를 찍는다)
//   공간 — 제 판(v7 = 대칭+0.15) · v6(메시 0.3 — cur) · sface(v6 의 앞 128칸 = SFace 만). 자산의 int8 을 풀어 단위 길이로 맞춘 벡터다
//   어느 찾기 — **사람마다 v7 의 처음 찾기 하나**(v7~ 찾기 중 `n` 이 가장 작은 것). `--runs` 를 따르지 않는다 — 결과를 본 뒤의 다시 찾기는
//          앞의 결과(v7 이 낸 것)에 끌려 v7 쪽으로 기운다. 그래서 **그 앞에 v6 까지로 찾은 사람은 뺀다**(배포 전의 찾기 · 열어 둔 탭) —
//          그 v7 찾기는 옛 판의 결과에 끌린 다시 찾기라 v7 을 반박하는 쪽으로 기운다. 그 옛 찾기는 `참고` 칸에 든다.
//          그 찾기가 검수(1)에 걸리거나 셀 라운드가 없으면 **그 사람을 뺀다** — 다음 v7 찾기로 바꾸지 않는다(그것은 다시 찾기다).
//          사람은 그 찾기의 풀 하나로만 든다(두 풀을 찾았어도). 처음인지 모르는 줄 — `prior`(기록 밖의 결과) · 옛 모양(ADR-133)의 결과 행 —
//          이 그 사람의 처음 것이면 그 사람도 뺀다(평가 기록으로 꺼내야 든다)
//   대비 — 사람마다 하나. **주 대비는 제 판 − v6 하나다.** 제 판 − sface 는 서술이다(구간만 — p 를 내지 않는다).
//          여 · 남, 그리고 모두 — 풀을 층으로: 사람마다의 차이를 모든 사람에 걸쳐 평균하고, 구간은 풀 안에서 다시 뽑는다
//   판정 — 모두의 `제 판 − v6 < 0`(v6 이 낫다)에 단측 부호 뒤집기 p. 사람이 20 이하면 모두 세고, 넘으면 10만 번 뽑는다(씨앗 고정).
//          **p < 0.01 이면 대칭+0.15 를 다시 본다. 아니면 그대로 간다** — 이 기록에는 v7 이 낫다고 확정하는 길이 없다
//   보는 때 — 파티가 끝날 때마다 그때까지 쌓인 기록 전부로 다시 본다. 여러 번 보므로 문턱이 0.01 이다 — 같은 크기의 파티를
//          열 번 보면 거짓 경보가 모두 합쳐 ≈4.4%, 스무 번이면 ≈5.8% 다(정규 근사 — 수치 적분, 2백만 경로의 모의와 맞는다).
//          v7 회차마다 IDEAL_RUNS_SQL 로 꺼낸 파일을 **이어 붙여 하나로** 넣는다. 같은 파일이 두 번 들면 같은 사람이 둘로 센다 —
//          섞인 화면이 기록된 사람 줄이 똑같으면 남이 아니니 하나만 세고 경고한다(그 밖의 똑같은 줄은 세기만 한다)
//   왜 C — 윗줄을 더 고르는 버릇이 있으면 다음 라운드 맞히기(3)는 화면을 짠 공간 쪽으로 실제 차이만큼 기운다. C 는 0.003 이하로만
//          움직인다(같은 README). v7 부터 화면을 섞어(ADR-139) 자리가 닮음을 말하지 않으니, 그 버릇은 따로 서술로만 잰다(`윗줄 버릇`)
//   둘째 검정 — 미리 정한 것은 **풀 교호 하나**다: 제 판 − v6 의 여 평균 − 남 평균, 풀 표지를 섞는 양측 p. 그 밖의 칸은 서술이다
//          (제 판 − sface · 풀마다의 p · 윗줄 버릇)
//   v6 까지의 찾기(섞이지 않은 화면)는 판정에 넣지 않는다 — `참고` 칸에 제 판 대신 v7 로 같은 것을 잰다. 사람마다 그 칸의 처음 찾기이고,
//          처음인지 모르는 줄도 든다 — 옛 모양은 줄마다 결과 하나다(114 로 실험실 값과 맞춰 본다)
//   구간 — 사람을 다시 뽑는 부트스트랩 95%, B 10000 · 씨앗 7 고정(`--seed` 를 따르지 않는다)
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
  7: { n: 9, pickMax: 5, rerolls: 1, reserve: 6, split: -0.3 }, // v6 의 규칙에 공간(대칭 메시 0.15, ADR-138)과 화면 섞기(ADR-139)만 바뀌었다
};

/**
 * 쪽의 아홉을 무작위 자리에 세우는 첫 판 (ADR-139). 이 판부터 기록된 쪽의 순서는 닮음과 무관하다 — 쪽은 순서 없이 견주고(1),
 * 0 의 판정은 이 판부터의 찾기로만 한다. 고르는 함수(`pickRound`)의 순서는 그대로 가까운 순이다
 */
export const SHUFFLED_FROM = 7;

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

/** 찾기 한 벌의 고르는 칸만 새로 짓는다. who 는 같은 사람의 찾기를 묶는 열쇠 — 평가 기록의 한 줄이 한 사람이다 (ADR-137) */
function rowOf(o, who) {
  if (!o || !Array.isArray(o.picks) || !Array.isArray(o.result)) return null;
  return {
    v: o.v,
    pool: o.pool,
    picks: o.picks,
    result: o.result,
    ...(Number.isInteger(o.start) ? { start: o.start } : {}),
    ...(o.verdict ? { verdict: o.verdict } : {}),
    ...(Array.isArray(o.pages) ? { pages: o.pages } : {}),
    ...(Number.isInteger(o.n) ? { n: o.n } : {}),
    ...(o.prior === true ? { prior: true } : {}),
    ...(who ? { who } : {}),
  };
}

/**
 * 사람마다 어느 찾기를 쓰나 (ADR-137) — `last`: 마지막 하나(ADR-133 의 꺼낸 모양, 결과 행 하나와 같다 — 114 와 견줄 때) ·
 * `first`: 처음 하나(결과를 보기 전 — `prior` 면 그 앞이 기록에 없다) · `all`: 전부(구간은 사람 단위로 다시 뽑는다).
 * 옛 모양(사람 열쇠가 없다)은 줄마다 한 사람이라 셋이 같다. 0 은 `--runs` 와 따로 v7~ 찾기에서 `first` 로 고른다(`preregRuns`)
 */
export function pickRuns(rows, mode) {
  if (mode === "all") return rows;
  const best = new Map();
  const out = [];
  for (const row of rows) {
    if (!row.who) {
      out.push(row);
      continue;
    }
    const cur = best.get(row.who);
    const better = !cur || (mode === "first" ? (row.n ?? 0) < (cur.n ?? 0) : (row.n ?? 0) > (cur.n ?? 0));
    if (better) best.set(row.who, row);
  }
  return [...out, ...best.values()];
}

/** 찾기 묶음에 든 사람 수 — 옛 모양은 줄마다 한 사람 */
const peopleIn = (xs) => new Set(xs.map((x, i) => x.row.who ?? `s${i}`)).size;

/**
 * 섞이지 않은 화면(v6 까지)의 찾기와 섞인 화면(v7~)의 찾기를 가른다 — **둘 다 있을 때만**. 3 · 7 이 둘을 섞어 견주지 않는다 (ADR-139 대가).
 * 돌려주는 것: [표지, 찾기들] 의 목록. 한쪽뿐이면 표지 없이(null) 하나 — 그때 찍는 것은 가르기 전과 같다
 */
export function byScreen(xs) {
  const old = xs.filter((x) => !(x.row.v >= SHUFFLED_FROM));
  const mixed = xs.filter((x) => x.row.v >= SHUFFLED_FROM);
  return old.length && mixed.length
    ? [
        [`v${SHUFFLED_FROM - 1} 까지 · 섞이지 않은 화면`, old],
        [`v${SHUFFLED_FROM}~ · 섞인 화면`, mixed],
      ]
    : [[null, xs]];
}

/**
 * 붙여 넣은 글에서 찾기를 찾는다. JSON 배열 · 줄마다 JSON · CSV(`""` 로 감싼 따옴표) · 표 복사 모두 받는다.
 * 평가 기록(`{"runs":[…]}`, ADR-137)은 찾기마다 한 줄로 펴고 사람 열쇠(`who`)를 붙인다 — 옛 모양(ADR-133)은 줄마다 한 사람이다.
 * 고르는 칸만 새로 짓는다 — 모르는 키는 버린다. 첫 화면 묶음 번호(`start`, v6 부터)는 고르는 칸이다 — 버리면 묶음을 집은
 * 사람의 화면을 자산 그대로 다시 세워 거의 모든 줄이 `다시 세우지 못했다` 로 걸린다 (ADR-136)
 */
export function readRows(text) {
  const t = text.replace(/""/g, '"');
  const rows = [];
  let people = 0;
  // 똑같은 사람 줄 (ADR-139 — 회차 파일을 이어 붙여 넣는다). 섞인 화면이 기록된 줄은 찾기마다 칸이 달라 남끼리 같을 수 없다 — 하나만 센다
  const seenPeople = new Set();
  const dupes = { skipped: 0, kept: 0 };
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
          if (o && Array.isArray(o.runs)) {
            const key = JSON.stringify(o.runs);
            if (seenPeople.has(key)) {
              const shuffledScreen = o.runs.some((r) => r && r.v >= SHUFFLED_FROM && Array.isArray(r.pages));
              dupes[shuffledScreen ? "skipped" : "kept"]++;
              if (shuffledScreen) {
                i = j;
                break;
              }
            }
            seenPeople.add(key);
            const who = `p${++people}`;
            for (const r of o.runs) {
              const row = rowOf(r, who);
              if (row) rows.push(row);
            }
            i = j;
          } else {
            const row = rowOf(o);
            if (row) {
              rows.push(row);
              i = j;
            }
          }
        } catch {
          /* 이 괄호는 Ideal 이 아니다 — 다음 `{` 부터 본다 */
        }
        break;
      }
    }
  }
  return Object.defineProperty(rows, "dupes", { value: dupes });
}

const subset = (xs, page) => xs.every((id) => page.some((f) => f.id === id));

/** 두 쪽이 같은 얼굴들인가 — 순서는 보지 않는다. b 는 기록에서 온 값이라 모양부터 본다 */
const sameSet = (a, b) => Array.isArray(b) && a.length === b.length && new Set(b).size === b.length && a.every((id) => b.includes(id));
/** 라운드 · 쪽의 모양이 같고 쪽마다 같은 얼굴인가 (섞인 화면, ADR-139) */
const sameAsSets = (a, b) =>
  Array.isArray(b) && a.length === b.length && a.every((ps, r) => Array.isArray(b[r]) && ps.length === b[r].length && ps.every((p, k) => sameSet(p, b[r][k])));

/**
 * 그 사람이 본 화면을 다시 세운다. 라운드마다 고른 얼굴이 첫 쪽에 없으면 `다른 얼굴 보기` 로 둘째 쪽을 본 것이다.
 * 1 · 2단계는 그 결과의 첫 화면 묶음(`start`)으로 붙인다 (ADR-136) — 번호가 없으면(v5 까지) 자산 그대로다.
 * **기록에 본 화면(`pages`, ADR-137)이 있으면 그것이 그 사람이 본 화면이다** — 다시 세운 화면과 견주기만 하고(`pagesSame`) 그것을 쓴다.
 * 섞인 판(`SHUFFLED_FROM` 부터, ADR-139)은 쪽마다 같은 얼굴인지만 견준다 — 다시 세운 쪽은 가까운 순이고 기기는 섞어 보였다.
 * 그 판에서는 기록된 쪽이 가까운 순 그대로인지도 쪽마다 돌려준다(`inOrder`, 라운드 · 쪽 모양) — 섞였으면 거의 모두 false 다.
 * 돌려주는 것: 라운드마다 고른 화면(page) · 넘긴 횟수 · 본 쪽 전부(pages) · 본 얼굴 전부 · 다시 센 결과 · 세울 수 있었나 ·
 * 기록된 화면인가(stored) · 그 화면이 다시 세운 화면과 같은가(pagesSame) · 가까운 순 그대로인 쪽(inOrder, 섞인 판에서 같을 때만 · 그 밖은 null)
 */
export function reconstruct(row, P) {
  const rule = RULES[row.v];
  const faces = facesForStart(P.faces, P.starts, row.start);
  return withSplit(rule.split, () => {
    let shown = new Set();
    let rounds = [];
    let ok = true;
    for (let r = 1; r <= 3; r++) {
      const centers = r === 1 ? null : tasteCenters(row.picks.slice(0, r - 1).flat().map((id) => P.vec.get(id)));
      let page = pickRound(faces, r, centers, shown, rule.n, rule.reserve);
      const pages = [];
      let flips = 0;
      while (!subset(row.picks[r - 1], page) && flips < rule.rerolls) {
        for (const f of page) shown.add(f.id);
        pages.push(page.map((f) => f.id));
        page = pickRound(faces, r, centers, shown, rule.n, rule.reserve);
        flips++;
      }
      if (!subset(row.picks[r - 1], page)) ok = false;
      for (const f of page) shown.add(f.id);
      pages.push(page.map((f) => f.id));
      rounds.push({ page: page.map((f) => f.id), flips, pages });
    }
    const stored = Array.isArray(row.pages);
    let pagesSame = null;
    let inOrder = null;
    if (stored) {
      const rebuilt = rounds.map((rd) => rd.pages);
      if (row.v >= SHUFFLED_FROM) {
        pagesSame = sameAsSets(rebuilt, row.pages);
        if (pagesSame) inOrder = row.pages.map((ps, r) => ps.map((p, k) => p.join() === rebuilt[r][k].join()));
      } else pagesSame = JSON.stringify(rebuilt) === JSON.stringify(row.pages);
      rounds = row.pages.map((ps) => ({ page: ps[ps.length - 1], flips: ps.length - 1, pages: ps }));
      shown = new Set(row.pages.flat(2));
      ok = rounds.every((rd, k) => row.picks[k].every((id) => rd.page.includes(id)));
    }
    const result = nearestCelebs(P.celebs, tasteCenters(row.picks.flat().map((id) => P.vec.get(id))), shown).map((c) => c.id);
    return { ok, rounds, shown, result, same: result.join() === row.result.join(), stored, pagesSame, inOrder };
  });
}

/**
 * 1 의 검수 하나 — 쓸 수 없는 줄이면 `{ fail }`(까닭 하나), 아니면 `{ x: { row, g, P, rec }, flags }`.
 * flags 는 다시 세운 것과 어긋난 까닭들이다 — 1 은 세기만 하고 그 찾기를 쓰고, 0 은 하나라도 있으면 뺀다
 */
export function checkRow(row, poolOf) {
  const g = row.pool === "F" ? "f" : row.pool === "M" ? "m" : null;
  if (!g) return { fail: "풀이 F · M 이 아니다" };
  if (!RULES[row.v] || !fs.existsSync(path.join(DEFAULT_FACES, `v${row.v}`, `${g}.json`))) return { fail: `없는 판 v${row.v}` };
  if (row.picks.length !== 3 || row.picks.some((p) => !Array.isArray(p) || !p.length || p.length > RULES[row.v].pickMax))
    return { fail: "고른 얼굴의 모양이 판의 규칙과 다르다" };
  const P = poolOf(row.v, g);
  if (![...row.picks.flat(), ...row.result].every((id) => P.vec.has(id))) return { fail: "그 판의 자산에 없는 id" };
  const rec = reconstruct(row, P);
  const flags = [];
  if (!rec.ok) flags.push("라운드를 다시 세우지 못했다(고른 얼굴이 그 화면에 없다)");
  if (!rec.same) flags.push("다시 센 결과가 저장된 결과와 다르다");
  // 기록된 화면은 그 사람이 본 것이라 그대로 쓴다 — 다시 세운 화면과 다르면 기기의 잘못이거나 지어낸 요청이다 (ADR-137).
  // 섞인 판(v7~)은 쪽마다 같은 얼굴인지만 견준다 (ADR-139)
  if (rec.stored && !rec.pagesSame) flags.push("기록된 화면이 다시 세운 화면과 다르다");
  return { x: { row, g, P, rec }, flags };
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

/**
 * 찾기마다의 값을 **사람마다** 한 묶음으로 — 같은 사람의 여러 찾기(ADR-137)를 여러 사람으로 세지 않는다.
 * 옛 모양(ADR-133)은 줄마다 한 사람이라 찾기 하나가 한 묶음이다
 */
export function byPerson(xs, f) {
  const m = new Map();
  xs.forEach((x, i) => {
    const k = x.row.who ?? `s${i}`;
    m.set(k, [...(m.get(k) ?? []), ...f(x)]);
  });
  return [...m.values()];
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
 * 1라운드는 넘기지 않은 세션만 센다 — 첫 쪽끼리 견준다. 비율은 얼굴마다 **보인 수**로 나누니 묶음마다 첫 쪽이 달라도(v6, ADR-136) 그대로 선다.
 * **같은 사람의 다른 찾기도 뺀다** (ADR-137) — 다시 찾은 사람의 선택이 제 인기로 세지면 인기가 부푼다. 돌려주는 묶음은 사람마다다
 */
export function popularityAuc(xs) {
  const r1 = new Map();
  const r23 = new Map();
  const add = (m, k, vs) => m.set(k, [...(m.get(k) ?? []), ...vs]);
  for (const [i, x] of xs.entries()) {
    const shown = new Map();
    const picked = new Map();
    for (const y of xs) {
      if (y === x || (x.row.who && y.row.who === x.row.who)) continue;
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
    const k = x.row.who ?? `s${i}`;
    if (x.rec.rounds[0].flips === 0) add(r1, k, [one(0)].filter((a) => a != null));
    add(r23, k, [one(1), one(2)].filter((a) => a != null));
  }
  return { r1: [...r1.values()], r23: [...r23.values()] };
}

// ── 0. 미리 정한 주 지표 (ADR-139) — 머리의 `미리 정한 것`

/** 0 의 고정값 — 판정 문턱 · 씨앗 · 다시 뽑는 수 · 섞이지 않은 찾기를 몇까지 봐주나. 바꾸려면 ADR-139 부터 고친다 */
export const PREREG = { alpha: 0.01, seed: 7, B: 10000, exactMax: 20, R: 100000, handful: 3 };

/** v4 부터 벡터의 앞 128칸이 SFace 다 — √(1 − 메시 무게) 배(v6 √0.7 · v7 √0.85)라 단위 길이로 맞추면 SFace 만의 공간이다 */
const SFACE_DIM = 128;
const SPACES0 = ["own", "v6", "sface"];
const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
/** 씨앗이 같으면 같은 수열 — bootstrap 과 같은 선형 합동 */
const lcg = (seed) => {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
};

/** 앞 dim 칸을 단위 길이로 */
function unitOf(v, dim = v.length) {
  const out = new Float64Array(dim);
  let s = 0;
  for (let i = 0; i < dim; i++) s += v[i] * v[i];
  const n = Math.sqrt(s) || 1;
  for (let i = 0; i < dim; i++) out[i] = v[i] / n;
  return out;
}

/**
 * 0 이 쓰는 찾기 (ADR-139) — `--runs` 와 따로, 사람마다 그 칸의 **처음 찾기** 하나(`n` 이 가장 작은 것). 1 의 검수보다 먼저 고른다 —
 * 고른 찾기가 검수에 걸리면 그 사람이 빠지고, 다음 찾기로 바꾸지 않는다. shuffled: 판정 칸(섞인 화면, v7~) · 아니면 참고 칸(v6 까지).
 * 판정 칸은 처음인지 모르는 줄 — `prior`(기록 밖의 결과) · 옛 모양(ADR-133)의 결과 행 · `n` 이 없는 줄 — 이 그 사람의 처음 것이면
 * 그 사람을 뺀다(unknown). **v7 의 처음 찾기 앞에 섞이지 않은 화면으로 찾은 사람도 뺀다**(before — 배포 전의 찾기 · 열어 둔 탭).
 * 그 찾기는 참고 칸에 든다. 참고 칸은 그대로 둔다. 돌려주는 것: 고른 찾기(runs) · unknown · 쓰지 않은 뒤의 찾기 수(later) · before
 */
export function preregRuns(read, shuffled) {
  const xs = read.filter((r) => (r.v >= SHUFFLED_FROM) === shuffled);
  const first = pickRuns(xs, "first");
  const unknown = shuffled ? first.filter((r) => r.prior || !r.who || !Number.isInteger(r.n)) : [];
  const known = first.filter((r) => !unknown.includes(r));
  // 그 앞에 섞이지 않은 화면으로 찾은 사람은 판정에서 뺀다 — 그 v7 찾기는 이미 본 결과에 끌린 다시 찾기다 (ADR-139 ②)
  const seen = shuffled ? known.filter((r) => read.some((o) => o.who === r.who && !(o.v >= SHUFFLED_FROM) && (o.n ?? 0) < r.n)) : [];
  const runs = known.filter((r) => !seen.includes(r));
  return { runs, unknown: unknown.length, later: xs.length - first.length, before: seen.length };
}

/**
 * 0 이 견주는 공간 셋 — 제 판(own) · v6 · sface(v6 의 SFace 칸), 모두 단위 길이. 셋 모두에 있는 얼굴(keep)만 센다
 * (d-cluster.py 의 `cands faces only`). own 은 v 판의 자산이다 — 섞이지 않은 찾기(`참고`)에는 v7 을 넘긴다
 */
export function preregSpaces(v, g, poolOf) {
  const at = (P, dim) => new Map([...P.vec].map(([id, x]) => [id, unitOf(x, dim)]));
  const cur = poolOf(6, g);
  const s = { own: at(poolOf(v, g)), v6: at(cur), sface: at(cur, SFACE_DIM) };
  return { ...s, keep: new Set([...s.own.keys()].filter((id) => s.v6.has(id) && s.sface.has(id))) };
}

/** auc 와 같되 1e-9 안의 차이는 같다고 본다 — d-cluster.py 와 같은 셈 */
function aucTol(pos, neg) {
  if (!pos.length || !neg.length) return null;
  let w = 0;
  for (const p of pos) for (const n of neg) w += p - n > 1e-9 ? 1 : Math.abs(p - n) <= 1e-9 ? 0.5 : 0;
  return w / (pos.length * neg.length);
}

/**
 * C(중심)의 라운드 하나 — 관측한 AUC(obs)와 **같은 쪽에서 고른 표시만 섞은 기댓값**(perm: |S| 개 중 |P| 개를 고르는 모든 경우의 평균, H 는 그대로).
 * S 그 라운드의 마지막 쪽 · P 그중 고른 얼굴 · H 앞 라운드들에 고른 얼굴, vec 은 id → 단위 벡터. 얼굴 x 의 점수는 cos(x, K(x) 합의 방향),
 * K(x) = H ∪ (P − {x}). 셀 수 없으면 null — 고른 것 · 안 고른 것이 다 있고 모든 K(x) 가 비지 않아야 한다(1라운드는 둘 이상 골라야 한다)
 */
export function clusterRound(S, P, H, vec) {
  const n = S.length;
  const k = P.length;
  const h = H.length;
  if (k < 1 || n - k < 1 || h + k - 1 < 1) return null;
  if (n > 20) throw new Error(`한 쪽이 ${n}명 — 표지를 모두 섞을 수 없다`);
  const V = [...S, ...H].map((id) => vec.get(id));
  const G = V.map((a) => V.map((b) => a.reduce((s, x, i) => s + x * b[i], 0)));
  // H 의 몫은 표지와 무관하다 — 미리 더해 둔다
  const rowH = G.slice(0, n).map((g) => g.slice(n).reduce((a, x) => a + x, 0));
  let totH = 0;
  for (let a = n; a < n + h; a++) for (let b = n; b < n + h; b++) totH += G[a][b];
  const aucOf = (L) => {
    const inL = new Array(n).fill(false);
    let tot = totH;
    for (const l of L) {
      inL[l] = true;
      tot += 2 * rowH[l];
      for (const l2 of L) tot += G[l][l2];
    }
    const pos = [];
    const neg = [];
    for (let x = 0; x < n; x++) {
      let s = rowH[x];
      for (const l of L) s += G[x][l];
      // 고른 얼굴이면 K(x) 에서 자기를 뺀다 — |Σ(K)|² = |Σ(H ∪ L)|² − 2 x · Σ(H ∪ L) + |x|²
      const dot = inL[x] ? s - G[x][x] : s;
      const norm2 = inL[x] ? tot - 2 * s + G[x][x] : tot;
      (inL[x] ? pos : neg).push(dot / Math.sqrt(Math.max(norm2, 1e-18)));
    }
    return aucTol(pos, neg);
  };
  const at = new Map(S.map((id, i) => [id, i]));
  const obs = aucOf(P.map((id) => at.get(id)));
  let sum = 0;
  let ways = 0;
  for (let mask = 0; mask < 1 << n; mask++) {
    const L = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) L.push(i);
    if (L.length !== k) continue;
    sum += aucOf(L);
    ways++;
  }
  return { obs, perm: sum / ways };
}

/**
 * 찾기 하나의 C — 공간마다 셈한 라운드의 (관측 − 기댓값) 평균(`vals`, 셀 라운드가 없으면 null). 라운드의 쪽은 고른 쪽(마지막 쪽)이다 —
 * 넘긴 쪽은 쓰지 않는다. sp 는 `preregSpaces`. 공간 셋 모두에 있지 않아 버린 얼굴의 수도 함께 — 고른 얼굴 · 쪽의 얼굴
 */
export function clusterRun(row, rec, sp) {
  const acc = Object.fromEntries(SPACES0.map((s) => [s, []]));
  const drop = { picks: 0, pickAll: 0, faces: 0, faceAll: 0 };
  let H = [];
  for (let r = 0; r < 3; r++) {
    const page = rec.rounds[r].page;
    const S = page.filter((id) => sp.keep.has(id));
    const P = row.picks[r].filter((id) => sp.keep.has(id));
    drop.faces += page.length - S.length;
    drop.faceAll += page.length;
    drop.picks += row.picks[r].length - P.length;
    drop.pickAll += row.picks[r].length;
    for (const s of SPACES0) {
      const c = clusterRound(S, P, H, sp[s]);
      if (c) acc[s].push(c.obs - c.perm);
    }
    H = [...H, ...P];
  }
  const rounds = acc.own.length;
  return { vals: rounds ? Object.fromEntries(SPACES0.map((s) => [s, avg(acc[s])])) : null, rounds, drop };
}

/**
 * 부호 뒤집기 p — 사람마다의 차이 d 의 합이, 사람마다 부호를 무작위로 뒤집은 합들 가운데 어디에 서나.
 * tail: `less`(차이 < 0 쪽) · `greater` · `two`(절댓값). 사람이 exactMax 이하면 2^n 가지를 모두 세고, 넘으면 R 번 뽑는다(씨앗 고정)
 */
export function signFlipP(d, tail, { seed = PREREG.seed, R = PREREG.R, exactMax = PREREG.exactMax } = {}) {
  const n = d.length;
  if (!n) return null;
  const obs = d.reduce((a, b) => a + b, 0);
  const hit = (s) => (tail === "less" ? s <= obs + 1e-12 : tail === "greater" ? s >= obs - 1e-12 : Math.abs(s) >= Math.abs(obs) - 1e-12);
  let c = 0;
  if (n <= exactMax) {
    for (let mask = 0; mask < 2 ** n; mask++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += mask & (1 << i) ? -d[i] : d[i];
      if (hit(s)) c++;
    }
    return { p: c / 2 ** n, exact: true };
  }
  const rnd = lcg(seed);
  for (let r = 0; r < R; r++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += rnd() < 0.5 ? -d[i] : d[i];
    if (hit(s)) c++;
  }
  return { p: (c + 1) / (R + 1), exact: false };
}

/** 층(풀)마다 사람을 다시 뽑아 모든 사람의 평균 — 95% 구간. 층이 하나면 보통의 사람 부트스트랩이다 */
export function strataBoot(strata, { seed = PREREG.seed, B = PREREG.B } = {}) {
  const xs = strata.flat();
  if (!xs.length) return null;
  const rnd = lcg(seed);
  const ms = new Float64Array(B);
  for (let b = 0; b < B; b++) {
    let s = 0;
    for (const st of strata) for (let i = 0; i < st.length; i++) s += st[Math.floor(rnd() * st.length)];
    ms[b] = s / xs.length;
  }
  ms.sort();
  return { mean: avg(xs), lo: ms[Math.floor(0.025 * B)], hi: ms[Math.floor(0.975 * B)], n: xs.length };
}

const choose = (n, k) => {
  let c = 1;
  for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i;
  return Math.round(c);
};

/**
 * 풀 교호 — a 의 평균 − b 의 평균, 풀 표지를 섞는 양측 p. 나누는 경우의 수가 exactLimit 이하면 모두 세고(ways), 넘으면 R 번 뽑는다(씨앗 고정)
 */
export function poolPermP(a, b, { seed = PREREG.seed, R = PREREG.R, exactLimit = 1e6 } = {}) {
  if (!a.length || !b.length) return null;
  const xs = [...a, ...b];
  const n = xs.length;
  const na = a.length;
  const tot = xs.reduce((s, x) => s + x, 0);
  const stat = (sa) => sa / na - (tot - sa) / (n - na);
  const obs = stat(a.reduce((s, x) => s + x, 0));
  const hit = (sa) => Math.abs(stat(sa)) >= Math.abs(obs) - 1e-12;
  const ways = choose(n, na);
  let c = 0;
  if (ways <= exactLimit) {
    // na 명을 고르는 모든 경우 — 고른 쪽의 합만 쌓아 간다
    const walk = (from, left, sa) => {
      if (!left) return void (hit(sa) && c++);
      for (let i = from; i <= n - left; i++) walk(i + 1, left - 1, sa + xs[i]);
    };
    walk(0, na, 0);
    return { diff: obs, p: c / ways, ways };
  }
  const rnd = lcg(seed);
  const idx = xs.map((_, i) => i);
  for (let r = 0; r < R; r++) {
    // 앞의 na 자리만 섞는다 (Fisher–Yates 의 앞부분)
    let sa = 0;
    for (let i = 0; i < na; i++) {
      const j = i + Math.floor(rnd() * (n - i));
      [idx[i], idx[j]] = [idx[j], idx[i]];
      sa += xs[idx[i]];
    }
    if (hit(sa)) c++;
  }
  return { diff: obs, p: (c + 1) / (R + 1), ways: null };
}

/**
 * 윗줄 버릇 — 화면 순서의 한 쪽에서 고른 얼굴의 줄(자리 0~2 윗줄 · 3~5 · 6~8). AUC 는 위일수록 높은 점수(−줄)로 고른 것 대 안 고른 것.
 * expTop 은 자리만큼 고를 때 윗줄에 설 기대 수다(아홉짜리 쪽이면 고른 수의 ⅓)
 */
export function rowHabit(page, picks) {
  const picked = new Set(picks);
  const pos = [];
  const neg = [];
  page.forEach((id, i) => (picked.has(id) ? pos : neg).push(-Math.floor(i / 3)));
  return { auc: aucTol(pos, neg), top: pos.filter((r) => r === 0).length, k: pos.length, expTop: (pos.length * Math.min(3, page.length)) / page.length };
}

/**
 * 0 을 찍는다 — 섞인 화면(판정)과 섞이지 않은 화면(참고). read 는 읽은 찾기 전부다(`--runs` 로 고르기 전).
 * 사람마다 그 칸의 처음 찾기(`preregRuns`)를 1 과 같은 검수(`checkRow`)에 넣고, 하나라도 걸리면 그 사람을 뺀다
 */
function printPrereg(read, poolOf) {
  const cache = new Map();
  const spaces = (v, g) => {
    const k = `${v}/${g}`;
    if (!cache.has(k)) cache.set(k, preregSpaces(v, g, poolOf));
    return cache.get(k);
  };
  const sg = (x) => `${x >= 0 ? "+" : ""}${x.toFixed(3)}`;
  const pv = (t) => (!t ? "—" : t.p < 0.001 ? t.p.toExponential(1) : t.p.toFixed(3));
  const lv = (b) => (b ? `${(0.5 + b.mean).toFixed(3)} [${(0.5 + b.lo).toFixed(3)}, ${(0.5 + b.hi).toFixed(3)}] n${b.n}` : "—");
  const dl = (b) => (b ? `${sg(b.mean)} [${sg(b.lo)}, ${sg(b.hi)}] n${b.n}` : "—");
  const tie = 1e-12;

  console.log(
    `\n== 0. 미리 정한 주 지표 (ADR-139) — 고른 얼굴 묶음 C(중심) · 판정은 사람마다 섞인 화면(v${SHUFFLED_FROM}~)의 처음 찾기로만 (--runs 를 따르지 않는다)`,
  );
  console.log("  라운드마다 고른 쪽에서, 앞 라운드에 고른 얼굴과 같은 쪽의 다른 고른 얼굴로 묶음 중심을 짓고 고른 얼굴이 안 고른 얼굴보다 가까운가(AUC).");
  console.log("  같은 쪽에서 고른 표시만 섞은 기댓값을 빼고 0.5 를 더한다(0.5 = 우연). 찾기 = 셈한 라운드의 평균 · 사람마다 찾기 하나");
  console.log(`  벡터는 자산의 int8 을 풀어 단위 길이로 맞춘 것 — sface 는 v6 의 앞 ${SFACE_DIM}칸(SFace)이다. 구간은 사람을 다시 뽑는다(모두는 풀 안에서)`);
  for (const ref of [false, true]) {
    const { runs, unknown, later, before } = preregRuns(read, !ref);
    if (ref && !runs.length) continue;
    const own = ref ? `v${SHUFFLED_FROM}` : [...new Set(runs.map((r) => r.v))].sort((a, b) => a - b).map((v) => `v${v}`).join("·") || `v${SHUFFLED_FROM}`;
    console.log(
      ref
        ? `\n  [참고 — 섞이지 않은 화면] v${SHUFFLED_FROM} 전의 찾기 — 판정에 넣지 않는다. 제 판 대신 ${own}(대칭+0.15)로 같은 것을 잰다 · 사람마다 그 칸의 처음 찾기(옛 모양은 줄마다 하나)`
        : `\n  [섞인 화면 — 판정] 사람마다 v${SHUFFLED_FROM}~ 의 처음 찾기 하나 · 제 판 ${own}`,
    );
    if (!runs.length && !unknown) {
      console.log(`    섞인 화면의 찾기가 아직 없다 — 판정하지 않는다`);
      continue;
    }
    // 1 과 같은 검수 — 하나라도 걸리면 그 사람을 뺀다. 그 사람의 다음 찾기로 바꾸지 않는다(그것은 다시 찾기다)
    const clean = [];
    let failed = 0;
    for (const row of runs) {
      const c = checkRow(row, poolOf);
      if (c.fail || c.flags.length) failed++;
      else clean.push(c.x);
    }
    const U = [];
    const drop = { picks: 0, pickAll: 0, faces: 0, faceAll: 0 };
    let none = 0;
    for (const x of clean) {
      const c = clusterRun(x.row, x.rec, spaces(ref ? SHUFFLED_FROM : x.row.v, x.g));
      for (const k of Object.keys(drop)) drop[k] += c.drop[k];
      if (c.vals) U.push({ pool: x.row.pool, vals: c.vals });
      else none++;
    }
    const byPool = (f) => ["F", "M"].map((p) => U.filter((u) => u.pool === p).map(f));
    const [nF, nM] = byPool(() => 1).map((a) => a.length);
    console.log(`    사람 ${U.length} (여 ${nF} · 남 ${nM}) — 사람은 고른 찾기의 풀 하나로 든다 · 쓰지 않은 뒤의 찾기 ${later}`);
    console.log(
      `    뺀 사람${ref ? "" : "(다음 찾기로 바꾸지 않는다)"} — 고른 찾기가 검수(1)에 걸림 ${failed} · 셈할 라운드가 없음 ${none}` +
        (unknown ? ` · 맨 앞이 처음인지 모르는 줄(prior · 옛 모양의 결과 행) ${unknown}` : "") +
        (before ? ` · 그 앞에 v${SHUFFLED_FROM - 1} 까지로 찾음 ${before}(다시 찾기다 — 그 찾기는 참고 칸에)` : ""),
    );
    if (unknown) console.log("    처음인지 모르는 줄은 판정에 넣지 않는다 — 평가 기록(IDEAL_RUNS_SQL)으로 꺼내야 든다");
    console.log(`    버린 얼굴(세 공간 모두에 있는 얼굴만 센다): 고른 얼굴 ${drop.picks}/${drop.pickAll} · 쪽의 얼굴 ${drop.faces}/${drop.faceAll}`);
    if (!U.length) {
      if (!ref) console.log("    셀 사람이 없다 — 판정하지 않는다");
      continue;
    }
    const label = { own: ref ? `${own} 대칭+0.15` : `${own} 제 판`, v6: "v6 cur", sface: "sface" };
    console.log("    수준 (0.5 + 보정)");
    for (const s of SPACES0) {
      const [F, M] = byPool((u) => u.vals[s]);
      console.log(`      ${label[s].padEnd(12)} 여 ${lv(strataBoot([F]))} · 남 ${lv(strataBoot([M]))} · 모두 ${lv(strataBoot([F, M]))}`);
    }
    // 주 대비(− v6)만 p 를 낸다. − sface 는 서술이다 (ADR-139 — 미리 정한 둘째 검정은 풀 교호 하나뿐이다)
    console.log(`    사람마다 차이 — 나음/같음/못함 = ${own} 이 나은 사람 수 · p 는 주 대비만(단측, v6 이 ${own} 보다 낫다 = 차이 < 0)`);
    for (const [s, primary] of [["v6", true], ["sface", false]]) {
      const [F, M] = byPool((u) => u.vals.own - u.vals[s]);
      const all = [...F, ...M];
      const n3 = `${all.filter((d) => d > tie).length}/${all.filter((d) => Math.abs(d) <= tie).length}/${all.filter((d) => d < -tie).length}`;
      const p = (xs) => (primary ? ` p ${pv(signFlipP(xs, "less"))}` : "");
      console.log(
        `      ${`${own} − ${s} (${primary ? "주" : "서술"})`.padEnd(18)} 여 ${dl(strataBoot([F]))}${p(F)} · 남 ${dl(strataBoot([M]))}${p(M)}` +
          ` · 모두 ${dl(strataBoot([F, M]))}${p(all)} (${n3})`,
      );
    }
    const [dF, dM] = byPool((u) => u.vals.own - u.vals.v6);
    if (!ref) {
      const t = signFlipP([...dF, ...dM], "less");
      console.log(`    판정: v6(cur) 가 ${own} 보다 낫다 — 단측 p = ${pv(t)} (문턱 ${PREREG.alpha}, 파티마다 누적으로 본다)`);
      console.log(t.p < PREREG.alpha ? `      → 대칭+0.15 를 다시 본다 (ADR-139)` : `      → 아직 아니다. 이 기록으로는 ${own} 이 낫다고 확정하지 않는다 (ADR-139)`);
    }
    const it = poolPermP(dF, dM);
    console.log(
      `    풀 교호${ref ? "" : " (미리 정한 둘째 검정 하나)"}: ${own} − v6 의 여 − 남 = ${it ? sg(it.diff) : "—"} · 양측 p ${pv(it)}` +
        (!it ? " (두 풀이 다 있어야 잰다)" : it.ways ? ` (풀 표지를 나누는 ${it.ways}가지를 모두 셌다)` : ` (풀 표지 섞기 ${PREREG.R}번)`),
    );
    if (ref) continue;
    // 윗줄 버릇 — 같은 찾기들(사람마다 v7 의 처음 찾기, 검수를 거친 것)에서. 기록된 화면 순서가 있어야 잰다.
    // 가까운 순 그대로인 쪽(섞이지 않은 쪽)은 뺀다. 사람마다 쪽 AUC 의 평균 하나
    for (const [name, rs] of [["모든 라운드", [0, 1, 2]], ["2 · 3라운드", [1, 2]]]) {
      const um = [];
      let top = 0;
      let k = 0;
      let expTop = 0;
      let pages = 0;
      for (const x of clean) {
        if (!x.rec.inOrder) continue;
        const aucs = [];
        for (const r of rs) {
          const ps = x.row.pages[r];
          const last = ps.length - 1;
          if (ps[last].length > 1 && x.rec.inOrder[r][last]) continue;
          const hb = rowHabit(ps[last], x.row.picks[r]);
          top += hb.top;
          k += hb.k;
          expTop += hb.expTop;
          pages++;
          if (hb.auc != null) aucs.push(hb.auc);
        }
        if (aucs.length) um.push({ pool: x.row.pool, v: avg(aucs) });
      }
      if (!pages) {
        console.log(`    윗줄 버릇 (섞인 화면, 서술만) ${name}: 화면 순서가 기록된 쪽이 없다`);
        continue;
      }
      const b = strataBoot(["F", "M"].map((p) => um.filter((u) => u.pool === p).map((u) => u.v)));
      console.log(
        `    윗줄 버릇 (섞인 화면, 서술만) ${name}: 고른 얼굴 중 윗줄 ${pct(top / k, 1)} (자리만큼이면 ${pct(expTop / k, 1)})` +
          ` · AUC(위일수록) ${b ? `${b.mean.toFixed(3)} [${b.lo.toFixed(3)}, ${b.hi.toFixed(3)}] n${b.n}` : "—"} · 쪽 ${pages}`,
      );
    }
  }
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
  if (!file) throw new Error("usage: node eval-real.mjs <결과 파일> [--space 3,4,3*0.5+4*0.5] [--seed 7] [--runs last|first|all] [--prereg auto|on|off]");
  const seed = Number(opt("seed", 7));
  const specs = opt("space", "3,4").split(",");
  // 사람마다 어느 찾기를 쓰나 (ADR-137) — 기본은 마지막 하나다. ADR-133 의 꺼낸 것(사람마다 결과 행 하나)과 같은 모양이라 114 와 견줄 수 있다.
  // 1~8 만 따른다 — 0 은 사람마다 v7 의 처음 찾기로 정해져 있다 (ADR-139)
  const mode = opt("runs", "last");
  if (!["last", "first", "all"].includes(mode)) throw new Error("--runs 는 last · first · all 중 하나");
  // 0 을 찍을지 (ADR-139) — auto: 본 화면이 기록된 찾기나 섞인 화면의 찾기가 있을 때만
  const prereg = opt("prereg", "auto");
  if (!["auto", "on", "off"].includes(prereg)) throw new Error("--prereg 는 auto · on · off 중 하나");
  const read = readRows(fs.readFileSync(file, "utf8"));
  const { skipped, kept } = read.dupes;
  if (skipped || kept) {
    console.log(
      `⚠️ 똑같은 사람 줄 ${skipped + kept} — 같은 회차 파일을 두 번 넣었나. 섞인 화면이 기록된 줄 ${skipped} 은 하나만 센다` +
        (kept ? ` · 그 밖의 ${kept} 은 그대로 센다(남끼리 같을 수 있다)` : ""),
    );
  }
  const rows = pickRuns(read, mode);
  const pools = new Map();
  const poolOf = (v, g) => {
    const k = `${v}/${g}`;
    if (!pools.has(k)) pools.set(k, loadPool(v, g));
    return pools.get(k);
  };

  // ── 0. 미리 정한 주 지표 (ADR-139) — 본 화면이 기록된 찾기나 섞인 화면의 찾기가 있을 때 (`--prereg on` 이면 늘).
  // 읽은 찾기 전부에서 스스로 고른다(사람마다 v7 의 처음 찾기) — `--runs` 로 고른 줄을 쓰지 않는다
  if (prereg === "on" || (prereg === "auto" && read.some((r) => Array.isArray(r.pages) || r.v >= SHUFFLED_FROM))) printPrereg(read, poolOf);

  // ── 1. 검수 — 걸린 까닭을 센다. 쓸 수 없는 줄(풀 · 판 · 모양 · id)만 빼고, 다시 세운 것과 어긋난 줄은 세기만 한다
  // (3~8 은 라운드를 다시 세운 줄만 쓴다)
  const good = [];
  const why = {};
  const bad = (k) => (why[k] = (why[k] ?? 0) + 1);
  for (const row of rows) {
    const c = checkRow(row, poolOf);
    if (c.fail) {
      bad(c.fail);
      continue;
    }
    c.flags.forEach(bad);
    good.push(c.x);
  }

  // ── 1. 검수
  console.log(`\n== 검수 — 읽은 결과 ${rows.length}줄`);
  const byV = {};
  for (const x of good) byV[`v${x.row.v} ${x.row.pool}`] = (byV[`v${x.row.v} ${x.row.pool}`] ?? 0) + 1;
  console.log("  판 · 풀:", JSON.stringify(byV));
  console.log("  걸린 것:", Object.keys(why).length ? JSON.stringify(why) : "없음");
  const whoOf = (r, i) => r.who ?? `s${i}`;
  const readPeople = new Set(read.map(whoOf)).size;
  const again = [...read.reduce((m, r, i) => m.set(whoOf(r, i), (m.get(whoOf(r, i)) ?? 0) + 1), new Map()).values()].filter((k) => k > 1).length;
  console.log(`  읽은 찾기 ${read.length} · 사람 ${readPeople} · 다시 찾은 사람 ${again} · 기록 전 결과(prior) ${read.filter((r) => r.prior).length}` +
    ` — 쓰는 것: ${mode === "all" ? "찾기 전부" : `사람마다 ${mode === "last" ? "마지막" : "처음"} 하나`} (--runs ${mode})`);
  const stored = good.filter((x) => x.rec.stored).length;
  console.log(`  사람 ${peopleIn(good)} · 찾기 ${good.length} · 본 화면이 기록된 찾기 ${stored} (나머지는 고른 얼굴로 다시 세웠다)`);
  const usable = good.filter((x) => x.rec.ok);
  const flips = [0, 1, 2].map((r) => usable.filter((x) => x.rec.rounds[r].flips > 0).length);
  const perRound = [0, 1, 2].map((r) => (usable.reduce((a, x) => a + x.row.picks[r].length, 0) / Math.max(1, usable.length)).toFixed(1));
  console.log(`  다시 세운 세션 ${usable.length} · 결과까지 같은 세션 ${usable.filter((x) => x.rec.same).length}`);
  console.log(`  라운드마다 고른 수 평균 ${perRound.join(" · ")} · '다른 얼굴 보기' 를 쓴 라운드 ${flips.join(" · ")}`);
  // 섞인 화면 (ADR-139) — 기록된 쪽이 가까운 순 그대로면 기기가 섞지 않은 것이다. 섞였으면 n 명짜리 쪽이 그대로일 확률은 n! 에 하나
  const mixed = good.filter((x) => x.rec.inOrder);
  if (mixed.length) {
    const fact = (n) => (n <= 1 ? 1 : n * fact(n - 1));
    const pagesOf = (x) => x.row.pages.flatMap((ps, r) => ps.map((p, k) => ({ n: p.length, same: x.rec.inOrder[r][k] }))).filter((p) => p.n > 1);
    const pages = mixed.flatMap(pagesOf);
    const flat = mixed.filter((x) => pagesOf(x).length && pagesOf(x).every((p) => p.same)).length;
    console.log(
      `  섞인 화면(v${SHUFFLED_FROM}~) — 기록된 쪽 ${pages.length} 중 가까운 순 그대로 ${pages.filter((p) => p.same).length}` +
        ` (섞였으면 기대 ${pages.reduce((a, p) => a + 1 / fact(p.n), 0).toFixed(4)}) · 모든 쪽이 그대로인 찾기 ${flat} / ${mixed.length}`,
    );
    if (flat > PREREG.handful)
      console.log(`  ⚠️ 섞이지 않은 찾기 ${flat} — 기기가 화면을 섞지 않았다 (ADR-139). C(0)는 순서를 보지 않지만 윗줄 버릇(0) · 다음 라운드 맞히기(3)는 화면을 짠 공간 쪽으로 기울 수 있다`);
  }

  // ── 2. 정답 확인
  console.log("\n== 정답 확인 (그 판의 만족도)" + (mode === "all" ? " — 찾기마다 센다 (--runs all)" : ""));
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

  // ── 3. 다음 라운드 맞히기 — 공간마다, 공통 얼굴만. 섞인 화면과 섞이지 않은 화면이 함께 있으면 따로 낸다 (ADR-139)
  console.log("\n== 다음 라운드 맞히기 (AUC, 0.5 = 무작위) — 같은 화면 · 같은 선택 · 공간마다 줄 세우기");
  for (const g of ["f", "m"]) {
    const all = usable.filter((x) => x.g === g);
    if (!all.length) continue;
    const spaces = specs.map((spec) => spaceOf(spec, g, poolOf));
    const keep = new Set([...spaces[0].vec.keys()].filter((id) => spaces.every((s) => s.vec.has(id))));
    for (const [label, xs] of byScreen(all)) {
      if (label) console.log(`  ${g} — ${label} (사람 ${peopleIn(xs)} · 찾기 ${xs.length})`);
      for (const s of spaces) for (const scorer of ["center", "knn"]) {
        const groups = byPerson(xs, (x) => nextPickAuc(x.row, x.rec, s.vec, { scorer, split: s.split, keep }).map((o) => o.auc));
        console.log(`  ${g} ${s.name.padEnd(12)} ${scorer.padEnd(6)} ${fmt(bootstrap(groups, { seed }))}`);
      }
    }
  }

  // ── 4. 정답과의 거리
  console.log("\n== '진짜 이상형' 으로 고른 연예인의 백분위 (0 = 맨 앞, 본 얼굴 뺌)");
  for (const g of ["f", "m"]) {
    const xs = usable.filter((x) => x.g === g && verdictOf(x.row)?.chosen);
    if (!xs.length) continue;
    for (const spec of specs) {
      const s = spaceOf(spec, g, poolOf);
      const groups = byPerson(xs, (x) => answerPercentile(x.row, x.rec, s.vec, [...s.vec.keys()], { split: s.split }));
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
      const who = peopleIn(xs) === xs.length ? `${xs.length}명` : `${peopleIn(xs)}명 · 찾기 ${xs.length}`;
      console.log(
        `  ${g} v${v} (${who} · 묶음 ${starts}가지 · 얼굴 ${seen.size}): ` +
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

  // ── 7. 인기 대 닮음 — 남들이 고른 얼굴인가로 맞히기. 3 의 AUC 와 견준다 — 3 처럼 섞인 화면과 섞이지 않은 화면은 따로(인기도 그 안에서 센다)
  console.log("\n== 인기로 맞히기 (AUC) — 다른 세션에서 그 얼굴이 골린 비율. 3 의 닮음보다 높으면 고르는 동기는 인기다");
  for (const g of ["f", "m"]) {
    for (const [label, xs] of byScreen(usable.filter((x) => x.g === g))) {
      // 다른 사람이 있어야 센다 — 한 사람의 찾기끼리는 서로를 빼므로 인기가 없다
      if (peopleIn(xs) < 2) continue;
      const { r1, r23 } = popularityAuc(xs);
      console.log(`  ${g}${label ? ` (${label})` : ""} 1라운드 ${fmt(bootstrap(r1, { seed }))} · 2 · 3라운드 ${fmt(bootstrap(r23, { seed }))}`);
    }
  }

  // ── 8. 결과 쏠림 — 한 사람이 몇 세션의 결과에 서나. 같은 고른 얼굴로 공간마다 다시 낸 것과 함께 (후보는 모든 공간에 있는 사람)
  console.log(
    "\n== 결과 쏠림 — 결과 칸 수 · 다른 사람 수 · 가장 많이 선 사람" +
      (mode === "all" ? " (찾기마다 센다 — 다시 찾은 사람이 여러 번 든다. 사람마다 하나로 보려면 --runs last)" : ""),
  );
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
