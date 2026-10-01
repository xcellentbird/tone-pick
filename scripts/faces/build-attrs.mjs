// 고른 사진 → 크롭 → 속성 고르기(Luna, 고정 어휘, K번) → 합의 → 속성 벡터(값 임베딩, 68차원)
// node build-attrs.mjs f|m [K=3]      결과: out/apool-{g}.json   (v1 은 K=5 로 돌았다 — ADR-122 결정 ⑥ 의 다섯 번)
//
// 읽는 것: ${WORK}/out/select-{g}.json 과 그 chosen.file, OPENAI_API_KEY
// 쓰는 것: ${WORK}/out/crop-{g}/*.webp (240x300 크롭), ${WORK}/out/attrs-{g}.json (사람마다 크롭 · 고른 속성 K번),
//          ${WORK}/out/value-table.json (값 구절 임베딩 — 없을 때만 부른다), ${WORK}/out/apool-{g}.json (합의 속성 · 68차원 벡터 · 출처)
// 순서: 6 — recolor 다음. 이어서 돈다(runs 가 K 개 찬 사람은 다시 묻지 않는다)
import fs from "node:fs";
import crypto from "node:crypto";
import { luna, embed, pool } from "./luna.mjs";
import { py } from "./fallback.mjs";
import { ATTR_SCHEMA, ATTR_PROMPT, consensus, valueTable, bases, attrVec, attrText } from "./attrs.mjs";
import { OUT, inWork } from "./work.mjs";

const g = process.argv[2];
const K = Number(process.argv[3] || 3);
const CROP = `${OUT}crop-${g}`;
fs.mkdirSync(CROP, { recursive: true });
const sel = JSON.parse(fs.readFileSync(`${OUT}select-${g}.json`));
const aPath = `${OUT}attrs-${g}.json`;
const A = fs.existsSync(aPath) ? JSON.parse(fs.readFileSync(aPath)) : {};
const save = () => fs.writeFileSync(aPath, JSON.stringify(A, null, 1));

const people = Object.values(sel).filter((s) => s.chosen);
for (const [i, s] of people.entries()) {
  s.key = `${s.name}|${s.born}`;
  // 크롭 파일 이름은 사람에게 고정 — 목록 순서로 지으면 사람이 늘 때 남의 크롭을 덮는다
  // 이름과 아래 src 비교는 레코드에 **적힌 그대로의** chosen.file 로 한다 — 작업 폴더를 옮겼다고 이름이 바뀌거나
  // 속성(runs)이 지워지면 안 된다. 사진을 실제로 읽을 때만 inWork 로 지금 작업 폴더의 파일을 찾는다
  const dst = `${CROP}/${crypto.createHash("sha1").update(s.key + "|" + s.chosen.file).digest("hex").slice(0, 12)}.webp`;
  // 고른 사진이 바뀌었으면(흑백 → 컬러 등) 크롭도 속성도 처음부터 — 옛 사진의 속성을 새 사진에 붙이지 않는다
  if (A[s.key] && A[s.key].src !== s.chosen.file) A[s.key] = undefined;
  if (!A[s.key]?.crop || A[s.key].crop !== dst || !fs.existsSync(A[s.key].crop)) {
    const [c] = py("crop", inWork(s.chosen.file), dst);
    A[s.key] = { ...(A[s.key] || {}), src: s.chosen.file, crop: c.out, outside: c.outside, scale: c.scale, runs: A[s.key]?.runs || [] };
  }
}
save();
const jobs = [];
for (const s of people) for (let k = A[s.key].runs.length; k < K; k++) jobs.push(s);
await pool(jobs, 10, async (s) => {
  const r = await luna({ text: ATTR_PROMPT, images: [A[s.key].crop], schema: ATTR_SCHEMA, name: "attrs", effort: "low" });
  A[s.key].runs.push(r.value);
  save();
});
const tp = `${OUT}value-table.json`;
const table = fs.existsSync(tp) ? JSON.parse(fs.readFileSync(tp)) : await valueTable(embed);
fs.writeFileSync(tp, JSON.stringify(table));
const B = bases(table);
const out = people.map((s) => {
  const c = consensus(A[s.key].runs.slice(0, K));
  return {
    key: s.key, name: s.name, born: s.born, job: s.job,
    src: s.chosen.src, page: s.chosen.page || s.chosen.url, license: s.chosen.license, artist: s.chosen.artist,
    crop: A[s.key].crop, outside: A[s.key].outside, attrs: c, text: attrText(c), vec: attrVec(c, table, B),
  };
});
fs.writeFileSync(`${OUT}apool-${g}.json`, JSON.stringify(out));
console.log(g, "apool", out.length, "dim", out[0].vec.length);
