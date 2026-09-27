// 나무위키 문서를 열어 og:image(프로필 사진)를 받는다. 문서가 맞는 사람인지 출생 연도로 확인한다.
// node fetch-namu.mjs f|m
//
// 읽는 것: ${WORK}/out/candidates-{g}.json
// 쓰는 것: ${WORK}/out/namu-{g}.json (사람마다 제목 · og:image · bornHit · 파일), ${WORK}/out/raw-{g}/NNN.{ext}
// 순서: 2 — candidates 다음. 이어서 돈다(이미 받은 사람은 건너뛴다)
import fs from "node:fs";
import { OUT } from "./work.mjs";
const g = process.argv[2];
const IMG = `${OUT}raw-${g}/`;
fs.mkdirSync(IMG, { recursive: true });
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const cands = JSON.parse(fs.readFileSync(`${OUT}candidates-${g}.json`));
const resPath = `${OUT}namu-${g}.json`;
const done = fs.existsSync(resPath) ? JSON.parse(fs.readFileSync(resPath)) : {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, headers = {}) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": UA, "accept-language": "ko-KR,ko", ...headers } });
      if (r.status === 429) {
        await sleep(10_000);
        continue;
      }
      return r;
    } catch (e) {
      await sleep(3000);
    }
  }
  return null;
}

let i = 0;
for (const c of cands) {
  i++;
  if (done[c.name]) continue;
  const r = await get(`https://namu.wiki/w/${encodeURIComponent(c.namu)}`);
  const rec = { name: c.name, namu: c.namu, born: c.born, job: c.job };
  if (!r || r.status !== 200) {
    rec.err = `page ${r?.status}`;
  } else {
    const h = await r.text().catch(() => "");
    rec.title = (h.match(/<title>(.*?) - 나무위키<\/title>/) || [])[1];
    const og = (h.match(/<meta property="og:image" content="([^"]+)"/) || [])[1];
    // 본문 앞부분에 출생 연도가 있는가 — 동명이인·동음이의어 문서를 거른다
    const body = h.replace(/<[^>]+>/g, " ");
    rec.bornHit = body.includes(`${c.born}년`);
    rec.disamb = /동음이의어|동명이인 문서/.test(body.slice(0, 20000));
    if (og) {
      const url = og.startsWith("//") ? "https:" + og : og;
      rec.img = url;
      const ir = await get(url, { referer: "https://namu.wiki/" });
      if (ir && ir.status === 200) {
        const buf = Buffer.from(await ir.arrayBuffer().catch(() => new ArrayBuffer(0)));
        const ext = (ir.headers.get("content-type") || "").split("/")[1]?.split(";")[0] || "bin";
        const file = `${String(i).padStart(3, "0")}.${ext}`;
        fs.writeFileSync(IMG + file, buf);
        rec.file = file;
        rec.bytes = buf.length;
      } else rec.err = `img ${ir?.status}`;
    } else rec.err = "no og:image";
  }
  done[c.name] = rec;
  fs.writeFileSync(resPath, JSON.stringify(done, null, 1));
  console.log(i, c.name, rec.title, rec.bornHit, rec.err || rec.file);
  await sleep(1500);
}
