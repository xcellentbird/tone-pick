// 종이 검증(모의) — 취향을 가진 페르소나(gpt-6-luna)가 실제 순수 함수로 세 라운드를 고르고,
// 눈을 가린 심판이 결과 셋 vs 무작위 셋(못 본 얼굴 중)을 견준다. 팔(arm)마다: text(묘사 임베딩) · sface(인식 모델)
// node validate.mjs <facesRoot> <arm> <tag> [personasPerPool=16] [version=IDEAL_ASSET_V] [--personas <파일>] [--first-only]
// 앱과 같은 순수 함수(src/shared/ideal.ts)를 부른다 — Node 가 타입을 벗겨 읽는다 (22.18+/23.6+)
// v2 흐름: 라운드마다 아홉(3×3), 1~5 고르기 또는 라운드마다 한 번 '없음'(= 다른 얼굴 보기 → 같은 규칙의 다음 아홉).
//   둘째 쪽에서는 1~5 를 꼭 고른다. 라운드 후보와 결과는 tasteCenters(고른 벡터 전부) 의 중심(하나 또는 둘)으로 — 앱과 같다
// --personas <파일>: 페르소나를 만들지 않고 그 파일을 쓴다 (두 인상 패널 같은 진단용). 파일 이름에 `{g}` 가 있으면 풀마다
//   바꿔 읽는다(`personas2-{g}.json`) — 없으면 `{ "f": [...], "m": [...] }` 한 파일. 상대 경로는 지금 폴더, 없으면 ${WORK}/out/ 에서 찾는다
// --first-only: ③ 첫 쪽 아홉만 묻는다 (풀마다 SIM_CALLS 번 · 과반). 페르소나도 세션도 없다
//
// 읽는 것: <facesRoot>/v{n}/{f,m}.json · {id}.webp, ${WORK}/out/personas-{g}.json (없으면 만든다) 또는 --personas, OPENAI_API_KEY
// 쓰는 것: ${WORK}/out/personas-{g}.json, ${WORK}/out/val-<tag>/ (라운드 격자 · sessions.json · report.json)
// 순서: 10 — emit 다음. report.json 을 그 판의 「종이 검증」 기준에 댄다 — v1 은 ADR-122, v2 부터는 ADR-123
//   (③ 첫 쪽 아홉에서 풀마다 많아야 두 쌍). 두 인상 패널(--personas)은 진단용이라 기준에 넣지 않는다. 못 넘으면 그 판은 싣지 않는다
import fs from "node:fs";
import sharp from "sharp";
import { luna, pool as runPool } from "./luna.mjs";
import path from "node:path";
import { decodeVec, tasteCenters, pickRound, nearestCelebs, IDEAL_SHAPE, IDEAL_ASSET_V } from "../../src/shared/ideal.ts";
import { OUT } from "./work.mjs";

const FIRST_ONLY = process.argv.includes("--first-only");
const argv = process.argv.slice(2).filter((a) => a !== "--first-only");
const opt = argv.indexOf("--personas");
const personasArg = opt < 0 ? null : argv[opt + 1];
if (opt >= 0 && !personasArg) throw new Error("--personas 뒤에 파일을 준다");
const pos = opt < 0 ? argv : [...argv.slice(0, opt), ...argv.slice(opt + 2)];
const [root, arm, tag, perArg = "16", version = String(IDEAL_ASSET_V)] = pos;
const PER = Number(perArg);
const { faces: N, pickMin: PICK_MIN, pickMax: PICK_MAX, rerolls: REROLLS } = IDEAL_SHAPE;
const VAL = `${OUT}val-${tag}`;
fs.mkdirSync(VAL, { recursive: true });

// ── 페르소나 (풀마다 한 번 만들어 모든 팔이 같은 것을 쓴다)
const PERSONA_SCHEMA = {
  type: "object", additionalProperties: false, required: ["personas"],
  properties: { personas: { type: "array", items: { type: "object", additionalProperties: false,
    required: ["id", "kind", "taste"], properties: { id: { type: "string" }, kind: { type: "string", enum: ["one", "two", "vague"] }, taste: { type: "string" } } } } },
};
async function personas(g) {
  if (personasArg) {
    const name = personasArg.replaceAll("{g}", g);
    const file = [path.resolve(name), path.join(OUT, name)].find((x) => fs.existsSync(x));
    if (!file) throw new Error(`--personas ${name} 가 없다 (지금 폴더에도 ${OUT} 에도)`);
    const d = JSON.parse(fs.readFileSync(file));
    const list = personasArg.includes("{g}") ? d : d[g];
    if (!Array.isArray(list)) throw new Error(`${file} 에 ${g} 풀의 페르소나 배열이 없다`);
    return list;
  }
  const p = `${OUT}personas-${g}.json`;
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p));
  const who = g === "f" ? "여성" : "남성";
  const r = await luna({
    effort: "medium", schema: PERSONA_SCHEMA, name: "personas",
    text: `솔로 파티 참가자 ${PER}명의 '끌리는 ${who} 얼굴' 취향을 만든다. 한 사람당 2~3문장, 한국어, 외모(얼굴형·눈매·이목구비·인상·분위기·동물상)로만.
- one: 한 가지 인상이 뚜렷한 사람 (${PER - 5}명) · two: 서로 다른 두 인상에 끌리는 사람 (3명) · vague: '딱히 없는데 이런 쪽이 좋다' 정도로 흐릿한 사람 (2명)
- 서로 겹치지 않게 넓게 퍼뜨린다. 흔한 '청순·귀여움' 에 몰리지 않게 — 날카로운·성숙한·강인한·중성적·이국적·순한·차가운 등도.
- 연예인 이름·실존 인물 언급 금지. id 는 p1, p2, …`,
  });
  fs.writeFileSync(p, JSON.stringify(r.value.personas, null, 1));
  return r.value.personas;
}

// ── 자산 읽기
function load(g) {
  const f = JSON.parse(fs.readFileSync(`${root}/v${version}/${g}.json`));
  const faces = f.faces.map((x) => ({ id: x.id, level: x.level, vec: decodeVec(x.v, f.dim, f.scale) }));
  const celebs = f.celebs.map((x) => ({ id: x.id, name: x.name, vec: decodeVec(x.v, f.dim, f.scale) }));
  return { faces, celebs };
}
const photo = (id) => `${root}/v${version}/${id}.webp`;

// ── 번호 붙인 격자 이미지
async function grid(ids, cols, file) {
  const W = 240, H = 300, PAD = 8, rows = Math.ceil(ids.length / cols);
  const comps = [];
  for (const [i, id] of ids.entries()) {
    const x = PAD + (i % cols) * (W + PAD), y = PAD + Math.floor(i / cols) * (H + PAD);
    comps.push({ input: photo(id), left: x, top: y });
    const badge = Buffer.from(`<svg width="44" height="44"><circle cx="22" cy="22" r="20" fill="black" fill-opacity="0.75"/><text x="22" y="30" font-size="24" font-family="Arial" font-weight="bold" fill="white" text-anchor="middle">${i + 1}</text></svg>`);
    comps.push({ input: badge, left: x + 6, top: y + 6 });
  }
  await sharp({ create: { width: PAD + cols * (W + PAD), height: PAD + rows * (H + PAD), channels: 3, background: "#ffffff" } })
    .composite(comps).jpeg({ quality: 85 }).toFile(file);
  return file;
}

const PICK_SCHEMA = { type: "object", additionalProperties: false, required: ["picks", "why"],
  properties: { picks: { type: "array", items: { type: "integer" } }, why: { type: "string" } } };
const AB_SCHEMA = { type: "object", additionalProperties: false, required: ["better", "why"],
  properties: { better: { type: "string", enum: ["A", "B", "same"] }, why: { type: "string" } } };
const ONE_SCHEMA = { type: "object", additionalProperties: false, required: ["pick", "why"],
  properties: { pick: { type: "integer" }, why: { type: "string" } } };
const HIT_SCHEMA = { type: "object", additionalProperties: false, required: ["match", "which", "why"],
  properties: { match: { type: "boolean" }, which: { type: "integer" }, why: { type: "string" } } };

function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
}

async function session(g, P, pi) {
  const { faces, celebs } = load(g);
  const byId = new Map(faces.map((f) => [f.id, f]));
  const shown = new Set(), picked = [], rounds = [];
  const centersOf = () => tasteCenters(picked.map((id) => byId.get(id).vec));
  for (const round of [1, 2, 3]) {
    // 라운드 후보는 그 라운드에 들어설 때의 중심으로 — 다른 얼굴 보기도 같은 중심에서 다음 아홉이다 (앱과 같다)
    const centers = round === 1 ? null : centersOf();
    const pages = [];
    let ids = [], why = "", forced = false, capped = false;
    for (let left = REROLLS; ; left--) {
      const page = pickRound(faces, round, centers, shown);
      page.forEach((f) => shown.add(f.id));
      pages.push(page.map((f) => f.id));
      const img = await grid(page.map((f) => f.id), 3, `${VAL}/${g}-${P.id}-r${round}${pages.length > 1 ? `p${pages.length}` : ""}.jpg`);
      const canSkip = left > 0;
      const r = await luna({ effort: "low", schema: PICK_SCHEMA, name: "pick", images: [img],
        text: `당신은 솔로 파티 참가자다. 당신의 취향: "${P.taste}"
사진 속 ${page.length}명의 얼굴(번호 1~${page.length}) 중 이 취향에 **끌리는 얼굴을 ${PICK_MIN}~${PICK_MAX}개** 고른다. 누구인지 알아보려 하지 말고 얼굴만 본다. 번호로.
${canSkip ? "끌리는 얼굴이 **하나도 없으면** 빈 배열을 낸다 — 그러면 다른 얼굴들이 나온다(이 라운드에 한 번뿐). 억지로 고르지 않아도 된다." : "이번에는 반드시 1개 이상 고른다 — 그중 가장 가까운 얼굴을."}` });
      const valid = [...new Set(r.value.picks.filter((n) => Number.isInteger(n) && n >= 1 && n <= page.length))];
      why = r.value.why;
      if (!valid.length && canSkip) continue; // 없음 → 다른 얼굴 보기
      capped = valid.length > PICK_MAX; // 앱은 여섯째를 막는다 — 앞의 다섯만 받는다
      const nums = valid.slice(0, PICK_MAX);
      if (!nums.length) { nums.push(1); forced = true; } // 둘째 쪽에서도 없음 — 앱에서는 다음으로 못 간다. 1번으로 채우고 적어 둔다
      ids = nums.map((n) => page[n - 1].id);
      break;
    }
    picked.push(...ids);
    rounds.push({ pages, rerolled: pages.length > 1, centers: centers?.length ?? 0, picks: ids, why, forced, capped });
  }
  const centers = centersOf();
  const res = nearestCelebs(celebs, centers, shown).map((c) => c.id);
  // 대조군 — 못 본 얼굴 중 무작위 셋 (페르소나마다 고정 씨앗)
  const rand = seeded(1000 * (g === "f" ? 1 : 2) + pi);
  const unseen = celebs.filter((c) => !shown.has(c.id) && !res.includes(c.id)).map((c) => c.id);
  const ctrl = [];
  while (ctrl.length < 3) { const x = unseen[Math.floor(rand() * unseen.length)]; if (!ctrl.includes(x)) ctrl.push(x); }
  const algoFirst = rand() < 0.5;
  const [A, B] = algoFirst ? [res, ctrl] : [ctrl, res];
  const img = await grid([...A, ...B], 3, `${VAL}/${g}-${P.id}-ab.jpg`);
  const ab = await luna({ effort: "medium", schema: AB_SCHEMA, name: "ab", images: [img],
    text: `어떤 사람의 끌리는 얼굴 취향: "${P.taste}"
사진 윗줄(1~3)이 A 묶음, 아랫줄(4~6)이 B 묶음이다. 어느 묶음이 이 취향에 더 가까운가? 묶음 전체로 판단한다. 비슷하면 same. 누구인지는 따지지 않는다.` });
  const hitImg = await grid(res, 3, `${VAL}/${g}-${P.id}-res.jpg`);
  const hit = await luna({ effort: "medium", schema: HIT_SCHEMA, name: "hit", images: [hitImg],
    text: `어떤 사람의 끌리는 얼굴 취향: "${P.taste}"
이 세 얼굴(1~3) 중에 이 사람이 "이 사람이 내 이상형이다" 라고 할 얼굴이 있는가? 있으면 match=true 와 번호(which), 없으면 match=false, which=0. 후하게 주지 마라 — 분명히 맞을 때만 true.` });
  const ctrlImg = await grid(ctrl, 3, `${VAL}/${g}-${P.id}-ctrl.jpg`);
  const hitCtrl = await luna({ effort: "medium", schema: HIT_SCHEMA, name: "hit", images: [ctrlImg],
    text: `어떤 사람의 끌리는 얼굴 취향: "${P.taste}"
이 세 얼굴(1~3) 중에 이 사람이 "이 사람이 내 이상형이다" 라고 할 얼굴이 있는가? 있으면 match=true 와 번호(which), 없으면 match=false, which=0. 후하게 주지 마라 — 분명히 맞을 때만 true.` });
  // ② (고친 물음, ADR-122 1차) — 결과 셋과 무작위 셋을 섞은 여섯 중 '이 사람이 이상형이라 할 한 명'. 우연이면 절반
  const mix = [...res, ...ctrl].map((id, k) => ({ id, algo: k < 3, r: rand() })).sort((a, b) => a.r - b.r);
  const mixImg = await grid(mix.map((x) => x.id), 3, `${VAL}/${g}-${P.id}-pick6.jpg`);
  const one = await luna({ effort: "medium", schema: ONE_SCHEMA, name: "one", images: [mixImg],
    text: `어떤 사람의 끌리는 얼굴 취향: "${P.taste}"
여섯 얼굴(1~6) 중에서 이 사람이 "이 사람이 내 이상형이다" 라고 할 **한 명**을 고른다. 번호 하나. 누구인지는 따지지 않는다.` });
  const pickedAlgo = !!mix[one.value.pick - 1]?.algo;
  const winner = ab.value.better === "same" ? "same" : (ab.value.better === "A") === algoFirst ? "algo" : "ctrl";
  return { g, persona: P.id, kind: P.kind, rounds, result: res, ctrl, ab: winner, abWhy: ab.value.why,
    rerolledRounds: rounds.flatMap((r, i) => (r.rerolled ? [i + 1] : [])),
    picksPerRound: rounds.map((r) => r.picks.length), split: centers.length === 2, centersPerRound: rounds.map((r) => r.centers),
    hit: hit.value.match, hitWhich: hit.value.which, hitCtrl: hitCtrl.value.match, pick6Algo: pickedAlgo };
}

// ③ 첫 쪽 아홉 — 1단계 대표가 서로 닮았나 (풀마다 한 장, 3×3 — 모두에게 같은 첫 화면)
// 심판은 **같은 사진에 다른 답을 한다** — v2 연습판 두 번이 같은 여자 첫 쪽에 한 쌍 · 세 쌍을 냈다. 기준(≤ 2)이 문인데
// 한 번 부른 답이면 어느 판을 보느냐로 통과가 갈린다. 그래서 SIM_CALLS 번 따로 묻고 **과반이 짚은 쌍만** 센다 (ADR-123).
// 부른 답은 전부 report 에 남긴다 — 과반에서 떨어진 쌍도 보여야 다음 판에서 그 자리를 다시 본다
const SIM_CALLS = 3;
const SIM_SCHEMA = { type: "object", additionalProperties: false, required: ["pairs", "why"],
  properties: { pairs: { type: "array", items: { type: "array", items: { type: "integer" } } }, why: { type: "string" } } };
const firstPage = {};
for (const g of ["f", "m"]) {
  const { faces } = load(g);
  const ids = pickRound(faces, 1, null, new Set()).map((f) => f.id);
  const img = await grid(ids, 3, `${VAL}/${g}-first${ids.length}.jpg`);
  const calls = await Promise.all([...Array(SIM_CALLS)].map(() => luna({ effort: "medium", schema: SIM_SCHEMA, name: "sim", images: [img],
    text: `${ids.length}명의 얼굴(1~${ids.length})이 처음 고르는 화면에 함께 나온다. 서로 인상이 많이 닮아서 '둘 중 아무거나' 가 될 만한 쌍을 모두 적어라 (예: [[1,4]]). 분명히 닮은 것만. 없으면 빈 배열. 누구인지는 따지지 않는다.` })
    .then((r) => r.value)));
  // 쌍은 순서 없이 센다 ([7,3] = [3,7]). 번호 밖 · 자기 자신 · 한 답 안의 중복은 버린다
  const votes = new Map();
  const answers = calls.map(({ pairs, why }) => {
    const keys = [...new Set(pairs.filter((p) => p.length === 2 && p[0] !== p[1] && p.every((n) => n >= 1 && n <= ids.length))
      .map((p) => [...p].sort((a, b) => a - b).join(",")))];
    for (const k of keys) votes.set(k, (votes.get(k) ?? 0) + 1);
    return { pairs: keys.map((k) => k.split(",").map(Number)), why };
  });
  const pairs = [...votes].filter(([, n]) => n * 2 > SIM_CALLS).map(([k]) => k.split(",").map(Number))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  firstPage[g] = { ids, pairs, votes: Object.fromEntries(votes), calls: answers };
}
// --first-only: ③ 만 묻고 끝낸다 — 전체 검증 전에 첫 쪽이 문을 넘는지 먼저 본다 (세션 예순넷을 돌리기 전에)
if (FIRST_ONLY) {
  fs.writeFileSync(`${VAL}/report.json`, JSON.stringify({ firstOnly: true, version: Number(version), simCalls: SIM_CALLS, firstPage }, null, 1));
  process.exit(0);
}

const jobs = [];
for (const g of ["f", "m"]) for (const [pi, P] of (await personas(g)).entries()) jobs.push({ g, P, pi });
const out = await runPool(jobs, 6, (j) => session(j.g, j.P, j.pi));
fs.writeFileSync(`${VAL}/sessions.json`, JSON.stringify(out, null, 1));
const ok = out.filter((x) => x && !x.error);
const sum = (xs) => {
  const n = xs.length, win = xs.filter((x) => x.ab === "algo").length, lose = xs.filter((x) => x.ab === "ctrl").length;
  return { n, winVsRandom: `${win}:${lose} (same ${n - win - lose})`, winRate: +(win / Math.max(1, win + lose)).toFixed(2),
    pick6: +(xs.filter((x) => x.pick6Algo).length / n).toFixed(2),
    hit: +(xs.filter((x) => x.hit).length / n).toFixed(2), hitRandom: +(xs.filter((x) => x.hitCtrl).length / n).toFixed(2),
    // 진단 (ADR-123) — 다른 얼굴 보기를 쓴 라운드 비율 · 한 번이라도 쓴 세션 비율 · 라운드당 고른 수 · 두 갈래로 갈린 세션 비율
    rerollRounds: +(xs.flatMap((x) => x.rounds).filter((r) => r.rerolled).length / Math.max(1, n * 3)).toFixed(2),
    rerollSessions: +(xs.filter((x) => x.rerolledRounds.length).length / Math.max(1, n)).toFixed(2),
    picksPerRound: [0, 1, 2].map((i) => +(xs.reduce((s, x) => s + x.picksPerRound[i], 0) / Math.max(1, n)).toFixed(2)),
    split: +(xs.filter((x) => x.split).length / Math.max(1, n)).toFixed(2),
    forced: xs.flatMap((x) => x.rounds).filter((r) => r.forced).length, capped: xs.flatMap((x) => x.rounds).filter((r) => r.capped).length };
};
const report = { arm, all: sum(ok), f: sum(ok.filter((x) => x.g === "f")), m: sum(ok.filter((x) => x.g === "m")),
  byKind: Object.fromEntries(["one", "two", "vague"].map((k) => [k, sum(ok.filter((x) => x.kind === k))])),
  personas: personasArg ?? "personas-{g}.json", version: Number(version), simCalls: SIM_CALLS, firstPage, errors: out.filter((x) => x?.error).map((x) => x.error) };
fs.writeFileSync(`${VAL}/report.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
