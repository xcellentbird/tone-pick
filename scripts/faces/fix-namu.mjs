// 나무위키 1차에서 빠진 사람을 제목 변형으로 다시 찾는다: 이름(배우) · 이름(가수) · 이름(출생 연도) · 이름(직업)
// node fix-namu.mjs f|m
//
// 읽는 것: ${WORK}/out/candidates-{g}.json, ${WORK}/out/namu-{g}.json
// 쓰는 것: ${WORK}/out/namu-{g}.json (찾은 사람의 줄을 고친다 · fixedBy), ${WORK}/out/raw-{g}/
// 순서: 3 — fetch-namu 다음
import fs from "node:fs";
import { OUT } from "./work.mjs";
const g = process.argv[2];
const IMG = `${OUT}raw-${g}/`;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const resPath = `${OUT}namu-${g}.json`;
const done = JSON.parse(fs.readFileSync(resPath));
const cands = JSON.parse(fs.readFileSync(`${OUT}candidates-${g}.json`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const JOBS = { 배우: ["배우"], 가수: ["가수"], 아이돌: ["가수"], 방송인: ["방송인", "개그맨", "코미디언"], 모델: ["모델"], 운동선수: ["야구 선수", "축구 선수", "운동선수"] };

async function page(title) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`https://namu.wiki/w/${encodeURIComponent(title)}`, { headers: { "user-agent": UA, "accept-language": "ko-KR,ko" } });
      if (r.status === 429) {
        await sleep(15000);
        continue;
      }
      if (r.status !== 200) return null;
      return await r.text();
    } catch {
      await sleep(3000);
    }
  }
  return null;
}

let fixed = 0;
for (const [i, c] of cands.entries()) {
  const rec = done[c.name];
  if (!rec) continue;
  const good = rec.file && rec.bornHit && !rec.disamb;
  if (good) continue;
  const variants = [...new Set([rec.namu, `${c.name}(${c.born})`, ...(JOBS[c.job] || []).map((j) => `${c.name}(${j})`), c.name])];
  for (const t of variants) {
    await sleep(1500);
    const h = await page(t);
    if (!h) continue;
    const body = h.replace(/<[^>]+>/g, " ");
    const bornHit = body.includes(`${c.born}년`);
    const disamb = /동음이의어|동명이인 문서/.test(body.slice(0, 20000));
    const og = (h.match(/<meta property="og:image" content="([^"]+)"/) || [])[1];
    if (!bornHit || disamb || !og) continue;
    const url = og.startsWith("//") ? "https:" + og : og;
    try {
      const ir = await fetch(url, { headers: { "user-agent": UA, referer: "https://namu.wiki/" } });
      if (ir.status !== 200) continue;
      const buf = Buffer.from(await ir.arrayBuffer());
      const ext = (ir.headers.get("content-type") || "").split("/")[1]?.split(";")[0] || "bin";
      const file = `${String(i + 1).padStart(3, "0")}.${ext}`;
      fs.writeFileSync(IMG + file, buf);
      done[c.name] = { ...rec, namu: t, title: (h.match(/<title>(.*?) - 나무위키<\/title>/) || [])[1], bornHit, disamb, img: url, file, bytes: buf.length, err: undefined, fixedBy: t };
      fs.writeFileSync(resPath, JSON.stringify(done, null, 1));
      fixed++;
      console.log("fixed", c.name, "→", t);
      break;
    } catch {}
  }
  if (!done[c.name].fixedBy) console.log("still missing", c.name, rec.err || (rec.disamb ? "disamb" : "noBorn"));
}
console.log(g, "fixed", fixed);
