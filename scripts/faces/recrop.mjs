// 크롭만 다시 — 같은 사진이라 속성은 그대로 둔다. node recrop.mjs f|m
//
// 읽는 것: ${WORK}/out/attrs-{g}.json (사진 src · 크롭 자리), ${WORK}/out/apool-{g}.json
// 쓰는 것: 크롭 파일을 제자리에 다시 뜬다(${WORK}/out/crop-{g}/), attrs-{g}.json · apool-{g}.json 의 outside · scale
// 순서: 곁가지 — face.py 의 crop 을 고친 뒤에만. build-attrs 다음, emit 전
import fs from "node:fs";
import { py } from "./fallback.mjs";
import { OUT, inWork, workPath } from "./work.mjs";
const g = process.argv[2];
const aPath = `${OUT}attrs-${g}.json`, pPath = `${OUT}apool-${g}.json`;
const A = JSON.parse(fs.readFileSync(aPath));
const P = fs.existsSync(pPath) ? JSON.parse(fs.readFileSync(pPath)) : [];
let n = 0;
for (const [key, a] of Object.entries(A)) {
  if (!a?.crop || !a.src) continue;
  // 적힌 경로는 만든 그 자리다 — 읽기는 지금 작업 폴더에서, 쓰기도 지금 작업 폴더에 (emit 이 inWork 로 찾는다)
  const [c] = py("crop", inWork(a.src), workPath(a.crop));
  if (c.out) { a.outside = c.outside; a.scale = c.scale; n++; }
}
for (const p of P) if (A[p.key]) p.outside = A[p.key].outside;
fs.writeFileSync(aPath, JSON.stringify(A, null, 1));
if (P.length) fs.writeFileSync(pPath, JSON.stringify(P));
console.log(g, "recropped", n, "max outside", Math.max(...Object.values(A).filter(Boolean).map((a) => a.outside || 0)).toFixed(3));
