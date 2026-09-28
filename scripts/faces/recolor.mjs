// 흑백 사진을 컬러로 바꿔 끼운다 — 여섯 칸 중 하나만 흑백이면 그 한 장이 튀어 고르는 손이 기운다.
// 못 찾으면 흑백 그대로 둔다 (사람을 잃지 않는다). node recolor.mjs f|m
//
// 읽는 것: ${WORK}/out/select-{g}.json 과 그 chosen.file, OPENAI_API_KEY
// 쓰는 것: ${WORK}/out/select-{g}.json (chosen.chroma · recolorTried · 바꿨으면 grayChosen), ${WORK}/out/alt-{g}/
// 순서: 5 — select 다음. 그래도 흑백(chroma < 6)인 사람은 emit 이 뺀다
import fs from "node:fs";
import sharp from "sharp";
import { pool } from "./luna.mjs";
import { py, commonsCandidates, webCandidates, choose } from "./fallback.mjs";
import { OUT, inWork } from "./work.mjs";

const g = process.argv[2];
const ALT = `${OUT}alt-${g}`;
fs.mkdirSync(ALT, { recursive: true });
const selPath = `${OUT}select-${g}.json`;
const sel = JSON.parse(fs.readFileSync(selPath));
const save = () => fs.writeFileSync(selPath, JSON.stringify(sel, null, 1));

/** 채널 차이의 평균 — 흑백이면 0 근처 */
export async function chroma(file) {
  const { data, info } = await sharp(file).resize(96, 96, { fit: "inside" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let s = 0;
  for (let i = 0; i < data.length; i += info.channels) s += Math.abs(data[i] - data[i + 1]) + Math.abs(data[i + 1] - data[i + 2]);
  return s / (data.length / info.channels);
}

const people = Object.values(sel).filter((v) => v.chosen);
for (const v of people) v.chosen.chroma ??= await chroma(inWork(v.chosen.file));
save();
const gray = people.filter((v) => v.chosen.chroma < 6 && !v.recolorTried);
console.log(g, "gray", gray.length, "of", people.length);

await pool(gray, 4, async (v) => {
  const [id] = py("ident", inWork(v.chosen.file));
  const ref = id?.v || null;
  const tag = `rc${Object.keys(sel).indexOf(v.name)}`;
  const color = async (list) => {
    const out = [];
    for (const c of list) out.push(c);
    return out;
  };
  const cm = await commonsCandidates(v.name, v.born).catch(() => ({ files: [] }));
  let got = await choose(await color([...cm.files.filter((f) => f.p18), ...cm.files.filter((f) => !f.p18)]), ALT, `${tag}c`, ref);
  if (got.chosen && (await chroma(got.chosen.file)) < 6) got = { chosen: null };
  if (!got.chosen && ref) {
    const web = await webCandidates(v.name, v.born, v.job).catch(() => []);
    got = await choose(web, ALT, `${tag}w`, ref);
    if (got.chosen && (await chroma(got.chosen.file)) < 6) got = { chosen: null };
  }
  v.recolorTried = true;
  if (got.chosen) {
    v.grayChosen = v.chosen;
    v.chosen = { ...got.chosen, chroma: await chroma(got.chosen.file) };
    console.log(`[${v.name}] color ← ${v.chosen.src}`);
  } else console.log(`[${v.name}] keep gray`);
  save();
});
