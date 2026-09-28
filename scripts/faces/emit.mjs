// pool-{g}.json(float 3072) → FacePoolFile(int8 base64) + {id}.webp
// node emit.mjs <outDir|-> <version> <dim> [arm=attr|text|sface]      outDir 가 - 면 public/faces
// attr: 속성 벡터(apool) · text: 자유 서술 임베딩(pool-3072) · sface: 같은 사진의 인식 모델 벡터(비교용)
// v1 은 `node emit.mjs <outDir> 1 68 attr` 로 나왔다 (attr 에서는 dim 을 쓰지 않는다 — 벡터 길이 그대로 68)
//
// 읽는 것: ${WORK}/out/apool-{g}.json (text 팔이면 pool-{g}-3072.json), select-{g}.json (흑백 · 사진 주소), namuborn-{g}.json,
//          ${WORK}/out/crop-{g}/ (apool 의 crop — inWork 로 지금 작업 폴더에서 찾는다),
//          scripts/faces/exclude.json (눈으로 거른 사람 — sheet.mjs 를 보고 적는다), scripts/faces/registry.json
// 쓰는 것: <outDir>/v{n}/{f,m}.json · {id}.webp, scripts/faces/registry.json (새 사람에게 id 를 준다),
//          scripts/faces/v{n}-sources.json (사람마다 사진의 출처 — 내려 달라는 요청에 답할 자료. outDir 가 - 일 때만 —
//          다른 폴더로 낸 시험은 <outDir>/v{n}-sources.json 에 둔다)
// 순서: 9 — namu-born · sheet 검수(exclude.json) 다음. 이 뒤에 validate
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { levels, shorten, norm } from "./cluster.mjs";
import { py } from "./fallback.mjs";
import { OUT, HERE, REGISTRY, EXCLUDE, DEFAULT_FACES, inWork } from "./work.mjs";

const [outArg, version = "1", dimArg = "256", arm = "attr"] = process.argv.slice(2);
const V = Number(version);
const DIM = Number(dimArg);
const outDir = !outArg || outArg === "-" ? DEFAULT_FACES : path.resolve(outArg);
// id 는 영원하다 — 레지스트리는 저장소에 커밋된다 (이름|출생 연도 → id)
const regPath = REGISTRY;
const reg = fs.existsSync(regPath) ? JSON.parse(fs.readFileSync(regPath)) : {};
// 눈으로 거른 사람 — { f: [키…], m: [키…], why: { f, m } }
const EXCL = fs.existsSync(EXCLUDE) ? JSON.parse(fs.readFileSync(EXCLUDE)) : {};
const dir = `${outDir}/v${V}`;
// 나간 판의 1단계 모양 — 앱의 IDEAL_SHAPE 가 바뀐 뒤에도 옛 판을 다시 내면 같은 파일이 나와야 한다 (판을 확인하는 길이 그것뿐이다).
// v1 여섯 한 쪽 · v2 아홉 × 두 쪽. 둘째 쪽의 판박이 문턱은 cluster.mjs 의 PAGE_TWIN_COS 에 박혀 있다
const PUBLISHED = { 1: { k1: 6, k2: 36, pages: 1 }, 2: { k1: 9, k2: 36, pages: 2 } };
// 나간 판은 고치지 않는다 — 저장된 결과가 자기 판으로 그려지고 사진은 1년 immutable 이다 (ADR-122 결정 ⑤).
// 자료를 고치면 새 판 번호로 내고 IDEAL_ASSET_V 를 올린다
if (outDir === DEFAULT_FACES && fs.existsSync(dir) && fs.readdirSync(dir).length)
  throw new Error(`${dir} 는 이미 나간 판이다 — 새 판 번호로 낸다`);
fs.mkdirSync(dir, { recursive: true });
const sources = [];

/** 불투명하고 영원한 id — 이름에서 만들지 않는다(사전 대입으로 되돌릴 수 있다). 레지스트리에 남긴다 */
function idFor(key) {
  if (!reg[key]) {
    let id;
    do id = crypto.randomBytes(5).toString("hex").slice(0, 8).replace(/^[0-9]/, "k");
    while (Object.values(reg).includes(id));
    reg[key] = id;
  }
  return reg[key];
}

function quantize(vecs) {
  let max = 0;
  for (const v of vecs) for (const x of v) max = Math.max(max, Math.abs(x));
  const scale = Math.floor(127 / max);
  const enc = (v) => Buffer.from(Int8Array.from(v.map((x) => Math.max(-127, Math.min(127, Math.round(x * scale)))))).toString("base64");
  return { scale, enc };
}

for (const g of ["f", "m"]) {
  const all = JSON.parse(fs.readFileSync(arm === "text" ? `${OUT}pool-${g}-3072.json` : `${OUT}apool-${g}.json`));
  // 싣지 않는 사람 — 눈으로 거른 것(exclude.json 의 {g}) · 나무위키 출생 연도가 어긋난 것(동명이인) · 끝내 컬러를 못 구한 흑백
  const manual = new Set(EXCL[g] || []);
  const born = fs.existsSync(`${OUT}namuborn-${g}.json`) ? JSON.parse(fs.readFileSync(`${OUT}namuborn-${g}.json`)) : {};
  const sel = JSON.parse(fs.readFileSync(`${OUT}select-${g}.json`));
  const dropped = { manual: [], born: [], gray: [] };
  const pool = all.filter((p) => {
    if (manual.has(p.key)) return dropped.manual.push(p.name), false;
    const b = born[p.key];
    if (b?.year != null && Math.abs(b.year - p.born) > 1) return dropped.born.push(`${p.name}(${b.year})`), false;
    if ((sel[p.name]?.chosen?.chroma ?? 99) < 6) return dropped.gray.push(p.name), false;
    return true;
  });
  console.log(g, "dropped", JSON.stringify(dropped));
  let vecs;
  if (arm === "sface") {
    const rows = py("ident", ...pool.map((p) => inWork(p.crop)));
    vecs = rows.map((r) => norm(r.v));
    if (rows.some((r) => !r.v)) throw new Error("sface: 얼굴을 못 찾은 크롭이 있다");
  } else if (arm === "text") vecs = pool.map((p) => shorten(p.vec, DIM));
  else {
    // 풀의 평균을 뺀다 (종이 검증 2차) — 모두가 나눠 가진 속성(흔한 얼굴형·눈매)이 유사도를 차지하면
    // 풀 한가운데의 몇 사람이 누구의 평균에도 가장 가까운 '허브' 가 된다. 실제로 결과 열여섯 판 중 한 사람이 다섯 번 나왔다.
    // 빼고 나면 그 풀에서 **갈라지는** 속성이 남는다. 실린 사람만으로 잰다(뺀 사람은 평균에 넣지 않는다)
    const raw = pool.map((p) => norm(p.vec));
    const mean = raw[0].map((_, j) => raw.reduce((s, v) => s + v[j], 0) / raw.length);
    vecs = raw.map((v) => norm(v.map((x, j) => x - mean[j])));
  }
  // 정면 사진인가 — 1단계 대표를 고를 때 쓴다 (cluster.mjs)
  const people = pool.map((p, i) => ({ ...p, vec: vecs[i], id: idFor(p.key), front: sel[p.name]?.chosen?.qc?.angle === "front" }));
  // 판마다 1단계 모양이 다르다 — 나간 판은 제 모양을 박아 둔다(PUBLISHED). 새 판은 지금 앱의 모양(cluster.mjs 의 기본값)
  const { lv, l1, l2, sizes1 } = levels(people, PUBLISHED[V] ?? {});
  const { scale, enc } = quantize(vecs);
  // 1단계는 levels() 가 정한 순서(큰 군집부터)로 앞에 둔다 — 자산 순서가 곧 1라운드 순서다
  const order = [...l1, ...l2, ...people.map((_, i) => i).filter((i) => lv[i] === 3)];
  const file = {
    version: V,
    dim: vecs[0].length,
    scale,
    celebs: people.map((p) => ({ id: p.id, name: p.name, v: enc(p.vec) })),
    faces: order.map((i) => ({ id: people[i].id, v: enc(people[i].vec), level: lv[i] })),
  };
  fs.writeFileSync(`${dir}/${g}.json`, JSON.stringify(file));
  for (const p of people) fs.copyFileSync(inWork(p.crop), `${dir}/${p.id}.webp`);
  // 출처 — 사진을 내려 달라는 요청이 오면 id 로 찾아 어디서 왔는지 답한다. photo 는 받은 사진 파일의 주소다
  for (const p of people) {
    const c = sel[p.name]?.chosen;
    sources.push({ id: p.id, pool: g, name: p.name, born: p.born, src: p.src, page: p.page ?? null, photo: c?.url ?? null,
      license: p.license ?? null, artist: p.artist ?? null });
  }
  console.log(g, arm, "people", people.length, "dim", file.dim, "scale", scale, "l1 sizes", sizes1.join(","), "l2", l2.length,
    "json KB", (fs.statSync(`${dir}/${g}.json`).size / 1024).toFixed(1));
}
fs.writeFileSync(regPath, JSON.stringify(reg, null, 1));
// 출처는 나간 판의 기록이라 public/faces 로 낼 때만 scripts/faces/ 에 쓴다. 다른 폴더로 내는 시험(sface 비교 ·
// 복사본 검증)은 그 폴더 뿌리(v{n}/ 밖 — 판 폴더를 옮겨 실어도 따라가지 않는다)에 둔다 — 나간 판의 출처를 덮지 않게
const srcPath = outDir === DEFAULT_FACES ? path.join(HERE, `v${V}-sources.json`) : path.join(outDir, `v${V}-sources.json`);
fs.writeFileSync(srcPath, JSON.stringify(sources, null, 1) + "\n");
