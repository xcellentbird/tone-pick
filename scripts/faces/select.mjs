// 사람마다 사진 한 장을 고른다: 나무위키 → (측면·진한 꾸밈·여럿이면) 커먼즈 → 웹.
// node select.mjs f|m [동시성=4]
//
// 읽는 것: ${WORK}/out/namu-{g}.json, ${WORK}/out/raw-{g}/, OPENAI_API_KEY
// 쓰는 것: ${WORK}/out/select-{g}.json (사람마다 chosen: src namu|commons|web · url · page · file · license · artist),
//          ${WORK}/out/alt-{g}/ (바꿔 온 후보 사진)
// 순서: 4 — fix-namu 다음. 이어서 돈다(사진이 정해진 사람은 건너뛴다)
import fs from "node:fs";
import { luna, QC_SCHEMA, QC_PROMPT, pool } from "./luna.mjs";
import { py, commonsCandidates, webCandidates, choose } from "./fallback.mjs";
import { OUT } from "./work.mjs";

const g = process.argv[2];
const N = Number(process.argv[3] || 4);
const RAW = `${OUT}raw-${g}`;
const ALT = `${OUT}alt-${g}`;
fs.mkdirSync(ALT, { recursive: true });
const namu = JSON.parse(fs.readFileSync(`${OUT}namu-${g}.json`));
const selPath = `${OUT}select-${g}.json`;
const sel = fs.existsSync(selPath) ? JSON.parse(fs.readFileSync(selPath)) : {};
const save = () => fs.writeFileSync(selPath, JSON.stringify(sel, null, 1));

// 이미 사진이 정해진 사람만 건너뛴다 — 못 찾은 사람은 기준을 고친 뒤 다시 본다
const people = Object.values(namu).filter((r) => r.file && r.bornHit && !r.disamb && !sel[r.name]?.chosen);
console.log(g, "to select:", people.length);

await pool(people, N, async (r, i) => {
  const log = (m) => console.log(`[${r.name}] ${m}`);
  const file = `${RAW}/${r.file}`;
  const [d] = py("detect", file);
  let ref = null;
  if (d?.n) {
    const [id] = py("ident", file);
    ref = id?.v || null;
  }
  const rec = { name: r.name, namu: r.namu, born: r.born, job: r.job, namuImg: r.img, namuDetect: d };
  // 나무위키 사진부터
  // 측면 판정은 Luna QC 의 angle 이 한다 — 기하 문턱(0.3)은 뚜렷한 측면만 미리 거른다. 3/4 각도는 흔한 프로필 사진이다
  if (d?.n && !d.crowd && d.main.yaw <= 0.3 && d.main.eye >= 16) {
    const q = (await luna({ text: QC_PROMPT, images: [file], schema: QC_SCHEMA, effort: "low" })).value;
    rec.namuQc = q;
    if (q.people === 1 && q.face_clear && q.angle !== "side" && !q.heavy_styling && !q.occluded && q.photo_quality !== "poor") {
      rec.chosen = { src: "namu", url: r.img, page: `https://namu.wiki/w/${encodeURIComponent(r.namu)}`, file, detect: d.main, qc: q };
      sel[r.name] = rec;
      save();
      log("namu ok");
      return;
    }
  }
  log(`namu rejected: ${d?.n ? `yaw=${d.main.yaw} crowd=${d.crowd} ${JSON.stringify(rec.namuQc || {})}` : "no face"}`);
  const tag = String(r.file).split(".")[0];
  const cm = await commonsCandidates(r.name, r.born).catch(() => ({ files: [] }));
  rec.qid = cm.qid;
  // P18 먼저, 그다음 분류 사진
  const cands = [...cm.files.filter((f) => f.p18), ...cm.files.filter((f) => !f.p18)];
  let got = await choose(cands, ALT, `${tag}c`, ref, log);
  rec.triedCommons = got.tried.length;
  if (!got.chosen && ref) {
    const web = await webCandidates(r.name, r.born, r.job).catch(() => []);
    got = await choose(web, ALT, `${tag}w`, ref, log);
    rec.triedWeb = got.tried.length;
    rec.webWhy = got.tried.map((t) => t.why);
  }
  rec.chosen = got.chosen;
  sel[r.name] = rec;
  save();
  log(got.chosen ? `fallback ${got.chosen.src}` : "NO PHOTO");
});

const vals = Object.values(sel);
const by = (s) => vals.filter((v) => v.chosen?.src === s).length;
console.log(g, "done", vals.length, "namu", by("namu"), "commons", by("commons"), "web", by("web"), "none", vals.filter((v) => !v.chosen).length);
