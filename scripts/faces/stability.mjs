// 안정성 시험 — 같은 얼굴을 따로 두 번 기술했을 때 자기 자신을 1순위로 찾는가 (24명)
// node stability.mjs
//
// 읽는 것: ${WORK}/out/stab/*.webp (크롭 스물넷 — 손으로 넣어 둔다), ${WORK}/out/value-table.json, OPENAI_API_KEY
// 쓰는 것: ${WORK}/out/stab/attr-runs.json (한 얼굴에 여섯 번 고른 속성), ${WORK}/out/value-table.json
// 순서: 곁가지 — 자산을 만들지 않는다. 속성 어휘·무게(attrs.mjs)를 바꿀 때 돌려 ADR-122 결정 ⑥ 의 숫자와 견준다
import fs from "node:fs";
import { luna, embed, pool } from "./luna.mjs";
import { ATTR_SCHEMA, ATTR_PROMPT, consensus, valueTable, bases, attrVec, attrText } from "./attrs.mjs";
import { OUT } from "./work.mjs";
const crops = fs.readdirSync(`${OUT}stab`).filter((f) => f.endsWith(".webp")).slice(0, 24).map((f) => `${OUT}stab/` + f);
const runsPath = `${OUT}stab/attr-runs.json`;
let runs;
if (fs.existsSync(runsPath)) runs = JSON.parse(fs.readFileSync(runsPath));
else {
  const jobs = [];
  for (const c of crops) for (let k = 0; k < 6; k++) jobs.push(c);
  runs = await pool(jobs, 10, async (c) => (await luna({ text: ATTR_PROMPT, images: [c], schema: ATTR_SCHEMA, name: "attrs", effort: "low" })).value);
  fs.writeFileSync(runsPath, JSON.stringify(runs));
}
const tp = `${OUT}value-table.json`;
const table = fs.existsSync(tp) ? JSON.parse(fs.readFileSync(tp)) : await valueTable(embed);
fs.writeFileSync(tp, JSON.stringify(table));
const B = bases(table);
const n = crops.length, dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const R = (i, k) => runs[i * 6 + k];
function evalPairs(a, b, label) {
  let top1 = 0; const same = [], diff = [];
  for (let i = 0; i < n; i++) { let best = -9, bj = -1; for (let j = 0; j < n; j++) { const s = dot(a[i], b[j]); if (i === j) same.push(s); else diff.push(s); if (s > best) { best = s; bj = j; } } if (bj === i) top1++; }
  const avg = (x) => (x.reduce((p, q) => p + q, 0) / x.length).toFixed(3);
  console.log(label.padEnd(28), "top1", top1 + "/" + n, " same", avg(same), " diff", avg(diff));
}
const idx = [...Array(n).keys()];
evalPairs(idx.map((i) => attrVec(R(i, 0), table, B)), idx.map((i) => attrVec(R(i, 3), table, B)), "attr single run");
const maj1 = idx.map((i) => attrVec(consensus([R(i, 0), R(i, 1), R(i, 2)]), table, B));
const maj2 = idx.map((i) => attrVec(consensus([R(i, 3), R(i, 4), R(i, 5)]), table, B));
evalPairs(maj1, maj2, "attr majority of 3");
const t1 = await embed(idx.map((i) => attrText(consensus([R(i, 0), R(i, 1), R(i, 2)]))), 3072);
const t2 = await embed(idx.map((i) => attrText(consensus([R(i, 3), R(i, 4), R(i, 5)]))), 3072);
evalPairs(t1, t2, "sentence emb of majority");
console.log("dim", maj1[0].length);
