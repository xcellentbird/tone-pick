// 크롭 전부를 번호 붙여 몇 장의 시트로 — 눈으로 검수한다. node sheet.mjs f|m
//
// 읽는 것: ${WORK}/out/apool-{g}.json 과 그 crop
// 쓰는 것: ${WORK}/out/sheet/{g}-{s}.jpg (80장씩), ${WORK}/out/sheet/{g}-index.json (번호 → 이름)
// 순서: 8 — build-attrs 다음, emit 전. 시트를 눈으로 보고 뺄 사람(진한 꾸밈 · 가림 · 그림 · 흑백 콘셉트)을
//       scripts/faces/exclude.json 에 `이름|출생 연도` 로 적는다 — 수동 제외 목록은 여기서만 나온다
import fs from "node:fs";
import sharp from "sharp";
import { OUT, inWork } from "./work.mjs";
const g = process.argv[2];
const pool = JSON.parse(fs.readFileSync(`${OUT}apool-${g}.json`));
const COLS = 10, PER = 80, W = 96, H = 120;
fs.mkdirSync(`${OUT}sheet`, { recursive: true });
fs.writeFileSync(`${OUT}sheet/${g}-index.json`, JSON.stringify(pool.map((p, i) => ({ i, name: p.name, src: p.src })), null, 1));
for (let s = 0; s * PER < pool.length; s++) {
  const part = pool.slice(s * PER, (s + 1) * PER);
  const comps = [];
  for (const [k, p] of part.entries()) {
    const x = (k % COLS) * (W + 4), y = Math.floor(k / COLS) * (H + 4);
    comps.push({ input: await sharp(inWork(p.crop)).resize(W, H).toBuffer(), left: x, top: y });
    const n = s * PER + k;
    comps.push({ input: Buffer.from(`<svg width="30" height="18"><rect width="30" height="18" fill="black" fill-opacity="0.7"/><text x="15" y="14" font-size="13" font-family="Arial" fill="white" text-anchor="middle">${n}</text></svg>`), left: x, top: y });
  }
  const rows = Math.ceil(part.length / COLS);
  await sharp({ create: { width: COLS * (W + 4), height: rows * (H + 4), channels: 3, background: "#fff" } }).composite(comps).jpeg({ quality: 78 }).toFile(`${OUT}sheet/${g}-${s}.jpg`);
}
console.log(g, pool.length, "sheets", Math.ceil(pool.length / PER));
