// 나무위키 문서의 인물 정보 '출생' 칸에서 연도를 읽어 후보의 출생 연도(±1)와 맞춘다.
// 본문 어딘가에 그 연도가 나오는 것(bornHit)으로는 동명이인을 못 거른다 — 최민호(정치인) 문서에 1991년이 있었다.
// node namu-born.mjs f|m
//
// 읽는 것: ${WORK}/out/apool-{g}.json, ${WORK}/out/select-{g}.json (나무위키 제목)
// 쓰는 것: ${WORK}/out/namuborn-{g}.json (사람마다 문서의 출생 연도), ${WORK}/out/namutext/ (읽은 본문 — 다시 볼 때)
// 순서: 7 — build-attrs 다음(apool 을 훑는다). 어긋난 사람(±1 넘게)은 emit 이 뺀다
import fs from "node:fs";
import { OUT } from "./work.mjs";
const g = process.argv[2];
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const P = JSON.parse(fs.readFileSync(`${OUT}apool-${g}.json`));
const sel = JSON.parse(fs.readFileSync(`${OUT}select-${g}.json`));
const path = `${OUT}namuborn-${g}.json`;
const done = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path)) : {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const p of P) {
  if (done[p.key] !== undefined) continue;
  const title = sel[p.name]?.namu;
  if (!title) { done[p.key] = { year: null, why: "no namu title" }; continue; }
  let h = "";
  for (let i = 0; i < 3 && !h; i++) {
    try {
      const r = await fetch(`https://namu.wiki/w/${encodeURIComponent(title)}`, { headers: { "user-agent": UA, "accept-language": "ko-KR,ko" } });
      if (r.status === 429) { await sleep(15000); continue; }
      h = r.status === 200 ? await r.text().catch(() => "") : "";
      if (r.status !== 200) break;
    } catch { await sleep(3000); }
  }
  const text = h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  fs.mkdirSync(`${OUT}namutext`, { recursive: true });
  fs.writeFileSync(`${OUT}namutext/${g}-${encodeURIComponent(p.key)}.txt`, text.slice(0, 60000));
  // 분류의 'YYYY년 출생' 이 가장 곧다. 없으면 인물 정보의 '출생 YYYY년 M월 D일'. 그냥 '출생' 뒤의 첫 연도는 데뷔 분류가 잡힌다
  const cat = text.match(/(\d{4})년 출생/);
  const box = text.match(/출생\s*(\d{4})년\s*\d{1,2}월\s*\d{1,2}일/);
  const m = cat || box;
  done[p.key] = { title, year: m ? Number(m[1]) : null, via: cat ? "cat" : box ? "box" : null };
  fs.writeFileSync(path, JSON.stringify(done, null, 1));
  await sleep(1300);
}
const bad = P.map((p, i) => ({ i, key: p.key, name: p.name, born: p.born, src: p.src, ...done[p.key] }))
  .filter((x) => x.year != null && Math.abs(x.year - x.born) > 1);
const unknown = P.filter((p) => done[p.key]?.year == null).length;
console.log(g, "checked", P.length, "mismatch", bad.length, "no-birth-field", unknown);
for (const b of bad) console.log(" ", b.i, b.name, "cand", b.born, "page", b.year, b.title, b.src);
