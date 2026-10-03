// 얼굴 모델의 벡터로 새 판을 낸다 (v4 부터, ADR-132) — SFace(얼굴 인식) + 얼굴 메시(MediaPipe) → space.py → FacePoolFile
// node emit-face.mjs <from> <to> [outDir|-]        예: node emit-face.mjs 3 4        outDir 가 - 이거나 없으면 public/faces
//
// 사람은 두 곳에서 온다.
//   1. 나간 판 v{from} — 사진(크롭) · 이름 · 특징 부호(`t`)를 그대로 쓴다. 크롭은 그 판의 사진 파일이다 (작업 자료가 없어도 된다)
//   2. 새로 더하는 사람 — ${WORK}/out/apool-{g}.json 에 있고 v{from} 에 없는 사람 (build-attrs 까지 돈 사람).
//      emit.mjs 와 같은 거르기(수동 제외 · 출생 연도 · 흑백)를 거치고, 특징 부호는 attrs 의 낱말에서 짓는다 (traits.mjs)
// 그리고 **직업으로 한 번 더 거른다** — 판에 싣는 것은 `KEEP_ROLES` 뿐이다 (ADR-132 결정 ③, roles.json).
// 사람의 사정으로 빼는 사람(고인 등)은 drop.json 에 적는다 — 두 곳 모두에 건다
//
// 벡터는 같은 사진에서 잰다 — 고르는 화면도 결과도 이 사진이다. 사진은 판마다 폴더라 바이트째 옮긴다 (19-surface 「자산」)
//
// 읽는 것: public/faces/v{from}/ · scripts/faces/v{from}-sources.json · scripts/faces/registry.json · scripts/faces/roles.json ·
//          scripts/faces/drop.json · scripts/faces/exclude.json, (있으면) ${WORK}/out/apool-{g}.json · select-{g}.json · namuborn-{g}.json,
//          ${WORK}/venv 의 파이썬 + face.py(embed · mesh · detect) + space.py, ${WORK}/models
// 쓰는 것: <outDir>/v{to}/{f,m}.json · {id}.webp, scripts/faces/registry.json(새 사람의 id), scripts/faces/v{to}-sources.json
//          (outDir 가 public/faces 일 때만 — 다른 폴더로 낸 시험은 그 폴더 뿌리에), ${WORK}/out/space-{g}-{in,out}.json
// 순서: roles 다음. 이 뒤에 check:faces · judge.mjs
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { levels } from "./cluster.mjs";
import { traitTokens } from "./traits.mjs";
import { DEFAULT_FACES, EXCLUDE, FACE, HERE, MODELS, OUT, PY, REGISTRY, inWork } from "./work.mjs";

/**
 * 판에 싣는 직업 (ADR-132 결정 ③). 이상형 찾기는 `연예인 이상형` 을 찾는 기능이다 — v3 의 첫 화면 아홉에 아나운서 · 방송인 ·
 * 개그맨이 풀마다 셋씩 섰고, 참가자는 `좋아하는 연예인이 많이 없다` 고 했다. 개그맨 · 방송인 · 아나운서 · 운동선수는 싣지 않는다.
 * **옛 판(v1~v3)에서는 그대로다** — 저장된 결과가 그 사람을 들고 있다. 바꾸려면 새 판 번호로 낸다
 */
export const KEEP_ROLES = new Set(["actor", "idol", "singer", "trot", "model"]);
/** 정면으로 치는 고개 돌림 — face.py detect 의 yaw(코가 두 눈 가운데에서 비킨 정도, 눈 사이 거리 대비). 1단계 대표를 고를 때 쓴다 */
const FRONT_YAW = 0.15;

const [fromArg, toArg, outArg] = process.argv.slice(2);
const FROM = Number(fromArg);
const TO = Number(toArg);
if (!Number.isInteger(FROM) || !Number.isInteger(TO) || TO <= FROM) throw new Error("usage: node emit-face.mjs <from> <to> [outDir|-]");
const outDir = !outArg || outArg === "-" ? DEFAULT_FACES : path.resolve(outArg);
const dir = path.join(outDir, `v${TO}`);
// 나간 판은 고치지 않는다 — 저장된 결과가 자기 판으로 그려지고 사진은 1년 immutable 이다 (ADR-122 결정 ⑤)
if (outDir === DEFAULT_FACES && fs.existsSync(dir) && fs.readdirSync(dir).length) throw new Error(`${dir} 는 이미 나간 판이다 — 새 판 번호로 낸다`);
fs.mkdirSync(dir, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const reg = JSON.parse(fs.readFileSync(REGISTRY, "utf8"));
const keyOf = Object.fromEntries(Object.entries(reg).map(([key, id]) => [id, key]));
const roles = JSON.parse(fs.readFileSync(path.join(HERE, "roles.json"), "utf8"));
const EXCL = fs.existsSync(EXCLUDE) ? JSON.parse(fs.readFileSync(EXCLUDE, "utf8")) : {};
const DROP = JSON.parse(fs.readFileSync(path.join(HERE, "drop.json"), "utf8")).keys;
const fromSources = new Map(JSON.parse(fs.readFileSync(path.join(HERE, `v${FROM}-sources.json`), "utf8")).map((s) => [s.id, s]));
const readJson = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null);

/** 불투명하고 영원한 id — emit.mjs 와 같다. 이름에서 만들지 않는다(사전 대입으로 되돌릴 수 있다) */
function idFor(key) {
  if (!reg[key]) {
    let id;
    do id = crypto.randomBytes(5).toString("hex").slice(0, 8).replace(/^[0-9]/, "k");
    while (Object.values(reg).includes(id));
    reg[key] = id;
  }
  return reg[key];
}

/** int8 양자화 — emit.mjs 와 같다. 풀에서 가장 큰 성분이 127 이 되게 */
function quantize(vecs) {
  let max = 0;
  for (const v of vecs) for (const x of v) max = Math.max(max, Math.abs(x));
  const scale = Math.floor(127 / max);
  const enc = (v) => Buffer.from(Int8Array.from(v.map((x) => Math.max(-127, Math.min(127, Math.round(x * scale)))))).toString("base64");
  return { scale, enc };
}

/** face.py — 줄마다 JSON. 메시는 한 사람에 1,400 숫자라 표준 출력이 크다 */
function py(cmd, ...args) {
  const out = execFileSync(PY, [FACE, cmd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, FACES_MODELS: MODELS },
    maxBuffer: 1 << 30,
  });
  return out.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

const sources = [];
for (const g of ["f", "m"]) {
  const file = JSON.parse(fs.readFileSync(path.join(DEFAULT_FACES, `v${FROM}`, `${g}.json`), "utf8"));
  const people = [];
  const dropped = { drop: [], role: [], manual: [], born: [], gray: [] };
  const keep = (key, name) => {
    if (DROP[key]) return dropped.drop.push(name), false;
    const r = roles[key];
    if (!r) throw new Error(`${key}: roles.json 에 직업이 없다 — roles.mjs 를 먼저 돌린다`);
    if (!KEEP_ROLES.has(r)) return dropped.role.push(`${name}(${r})`), false;
    return true;
  };
  // 1. 나간 판의 사람 — 그 판의 사진 · 특징 부호
  for (const c of file.celebs) {
    if (c.retired) continue;
    const key = keyOf[c.id];
    if (!key) throw new Error(`${g} ${c.id}: registry 에 없다`);
    if (!keep(key, c.name)) continue;
    const s = fromSources.get(c.id);
    people.push({ key, id: c.id, name: c.name, born: s?.born, photo: path.join(DEFAULT_FACES, `v${FROM}`, `${c.id}.webp`), t: c.t,
      source: s ? { src: s.src, page: s.page, photo: s.photo, license: s.license, artist: s.artist } : null });
  }
  // 2. 새로 더하는 사람 — build-attrs 까지 돈 작업 자료가 있을 때만
  const apool = readJson(`${OUT}apool-${g}.json`) ?? [];
  const sel = readJson(`${OUT}select-${g}.json`) ?? {};
  const born = readJson(`${OUT}namuborn-${g}.json`) ?? {};
  const manual = new Set(EXCL[g] || []);
  const have = new Set(people.map((p) => p.key));
  const published = new Set(file.celebs.map((c) => keyOf[c.id]));
  for (const p of apool) {
    if (have.has(p.key) || published.has(p.key)) continue;
    if (manual.has(p.key)) { dropped.manual.push(p.name); continue; }
    const b = born[p.key];
    if (b?.year != null && Math.abs(b.year - p.born) > 1) { dropped.born.push(`${p.name}(${b.year})`); continue; }
    if ((sel[p.name]?.chosen?.chroma ?? 99) < 6) { dropped.gray.push(p.name); continue; }
    if (!keep(p.key, p.name)) continue;
    const c = sel[p.name]?.chosen;
    people.push({ key: p.key, id: idFor(p.key), name: p.name, born: p.born, photo: inWork(p.crop), t: traitTokens(p.attrs, p.key),
      source: { src: p.src, page: p.page ?? null, photo: c?.url ?? null, license: p.license ?? null, artist: p.artist ?? null } });
  }
  console.log(g, "people", people.length, "(새", people.filter((p) => !published.has(p.key)).length + ")", "dropped", JSON.stringify(dropped));

  // 3. 사진마다 SFace · 메시 · 고개 돌림
  const photos = people.map((p) => p.photo);
  const emb = py("embed", ...photos);
  const mesh = py("mesh", ...photos);
  const det = py("detect", ...photos);
  const bad = [...emb, ...mesh].filter((r) => r.err).map((r) => `${r.path} ${r.err}`);
  if (bad.length) throw new Error(`얼굴을 못 잰 사진 — 크롭을 다시 본다:\n${bad.join("\n")}`);
  const inPath = `${OUT}space-${g}-in.json`;
  const outPath = `${OUT}space-${g}-out.json`;
  fs.writeFileSync(inPath, JSON.stringify({ ids: people.map((p) => p.id), sface: emb.map((r) => r.v), pts: mesh.map((r) => r.pts) }));
  const info = execFileSync(PY, [path.join(HERE, "space.py"), inPath, outPath], { encoding: "utf8" }).trim();
  const space = JSON.parse(fs.readFileSync(outPath, "utf8"));
  if (space.ids.join() !== people.map((p) => p.id).join()) throw new Error("space.py 가 순서를 바꿨다");

  // 4. 1 · 2단계 — 군집은 새 벡터로, 첫 쪽의 '눈에 읽히는 기준'(동물상이 갈리게)은 특징 부호의 첫 동물상으로 (cluster.mjs)
  const vecs = space.vecs;
  const lp = people.map((p, i) => ({
    ...p,
    vec: vecs[i],
    front: (det[i]?.main?.yaw ?? 1) <= FRONT_YAW,
    attrs: { animal: [(p.t ?? []).find((x) => x.startsWith("animal.")) ?? `#${i}`] },
  }));
  const { lv, l1, l2, sizes1 } = levels(lp, {});
  const { scale, enc } = quantize(vecs);
  const order = [...l1, ...l2, ...lp.map((_, i) => i).filter((i) => lv[i] === 3)];
  const pool = {
    version: TO,
    dim: vecs[0].length,
    scale,
    celebs: lp.map((p, i) => ({ id: p.id, name: p.name, v: enc(vecs[i]), ...(p.t ? { t: p.t } : {}) })),
    faces: order.map((i) => ({ id: lp[i].id, v: enc(vecs[i]), level: lv[i] })),
  };
  const raw = JSON.stringify(pool);
  fs.writeFileSync(path.join(dir, `${g}.json`), raw);
  for (const p of people) fs.copyFileSync(p.photo, path.join(dir, `${p.id}.webp`));
  for (const p of people) sources.push({ id: p.id, pool: g, name: p.name, born: p.born, ...(p.source ?? {}) });
  console.log(g, info, "front", lp.filter((p) => p.front).length, "l1 sizes", sizes1.join(","), "scale", scale,
    "json KB", (raw.length / 1024).toFixed(1), "gzip KB", (gzipSync(raw, { level: 9 }).length / 1024).toFixed(1));
  console.log(g, "첫 쪽", l1.slice(0, 9).map((i) => lp[i].name).join(" "), "| 둘째 쪽", l1.slice(9).map((i) => lp[i].name).join(" "));
}
fs.writeFileSync(REGISTRY, JSON.stringify(reg, null, 1));
// 출처는 나간 판의 기록이라 public/faces 로 낼 때만 scripts/faces/ 에 쓴다 (emit.mjs 와 같다)
const srcPath = outDir === DEFAULT_FACES ? path.join(HERE, `v${TO}-sources.json`) : path.join(outDir, `v${TO}-sources.json`);
fs.writeFileSync(srcPath, JSON.stringify(sources, null, 1) + "\n");
