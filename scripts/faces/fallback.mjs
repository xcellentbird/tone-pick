// 나무위키 사진이 측면·진한 꾸밈·여럿이면 다른 사진을 찾는다.
// 1) 위키데이터(출생 연도 일치) → 커먼즈 P18 + 분류의 사진들  2) 웹 검색(Luna web_search)
// 찾은 사진은 SFace 로 나무위키 얼굴과 같은 사람인지 확인한다 — 이름만 같은 남을 싣지 않는다.
//
// 읽는 것: 위키데이터 · 커먼즈 API, 웹 검색(Luna), ${WORK}/venv/bin/python + face.py + ${WORK}/models
// 쓰는 것: 부르는 쪽이 준 폴더(${WORK}/out/alt-{g}/)에 받은 후보 사진
// 순서: 공용 — select.mjs · recolor.mjs 가 사진을 바꿔 올 때, py() 는 얼굴을 다루는 모든 단계가 쓴다
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { luna, QC_SCHEMA, QC_PROMPT } from "./luna.mjs";
import { PY, FACE, MODELS } from "./work.mjs";

const WM_UA = "tone-pick-faces/0.1 (face-pool build script)";
const BR_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function py(cmd, ...args) {
  // 모델 폴더는 face.py 에 환경 변수로 넘긴다 — 작업 폴더(FACES_WORK)를 따라간다
  const out = execFileSync(PY, [FACE, cmd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, FACES_MODELS: MODELS },
  });
  return out.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

export function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** SFace 동일인 문턱 — OpenCV 권장 0.363 보다 조금 엄하게 */
export const SAME = 0.4;

async function wm(params) {
  const u = new URL("https://www.wikidata.org/w/api.php");
  for (const [k, v] of Object.entries({ format: "json", ...params })) u.searchParams.set(k, v);
  const r = await fetch(u, { headers: { "user-agent": WM_UA } });
  return r.json();
}
async function commons(params) {
  const u = new URL("https://commons.wikimedia.org/w/api.php");
  for (const [k, v] of Object.entries({ format: "json", ...params })) u.searchParams.set(k, v);
  const r = await fetch(u, { headers: { "user-agent": WM_UA } });
  return r.json();
}

/** 이름 + 출생 연도로 위키데이터 항목 → 커먼즈 사진 후보 (썸네일 URL · 라이선스) */
export async function commonsCandidates(name, born) {
  const s = await wm({ action: "wbsearchentities", search: name, language: "ko", uselang: "ko", type: "item", limit: "10" });
  // 설명이 한국인임을 말하는 항목만 — 이름만 같은 남을 거른다
  const ids = (s.search || []).filter((x) => /Korean|한국|대한민국/.test(x.description || "")).map((x) => x.id);
  if (!ids.length) return { files: [] };
  const e = await wm({ action: "wbgetentities", ids: ids.join("|"), props: "claims" });
  let hit;
  for (const id of ids) {
    const c = e.entities?.[id]?.claims;
    const t = c?.P569?.[0]?.mainsnak?.datavalue?.value?.time; // +1993-05-16T00:00:00Z
    const human = c?.P31?.some((x) => x.mainsnak?.datavalue?.value?.id === "Q5");
    // 출생 연도는 ±1 — 후보 목록(LLM)의 연도가 한 해 어긋나는 일이 있다 (수애 1979 ↔ 1980)
    if (human && t && Math.abs(Number(t.slice(1, 5)) - born) <= 1) {
      hit = { id, claims: c };
      break;
    }
  }
  if (!hit) return { files: [] };
  const files = new Set();
  for (const p of hit.claims.P18 || []) files.add("File:" + p.mainsnak.datavalue.value);
  const cat = hit.claims.P373?.[0]?.mainsnak?.datavalue?.value;
  if (cat) {
    const m = await commons({ action: "query", list: "categorymembers", cmtitle: "Category:" + cat, cmtype: "file", cmlimit: "40" });
    for (const x of m.query?.categorymembers || []) if (/\.(jpe?g|png|webp)$/i.test(x.title)) files.add(x.title);
  }
  const list = [...files].slice(0, 40);
  const out = [];
  for (let i = 0; i < list.length; i += 20) {
    const q = await commons({
      action: "query",
      titles: list.slice(i, i + 20).join("|"),
      prop: "imageinfo",
      iiprop: "url|extmetadata|size",
      iiurlwidth: "600",
    });
    for (const pg of Object.values(q.query?.pages || {})) {
      const ii = pg.imageinfo?.[0];
      if (!ii) continue;
      const md = ii.extmetadata || {};
      out.push({
        src: "commons",
        title: pg.title,
        url: ii.thumburl || ii.url,
        page: ii.descriptionurl,
        license: md.LicenseShortName?.value,
        artist: md.Artist?.value?.replace(/<[^>]+>/g, "").trim(),
        p18: (hit.claims.P18 || []).some((p) => "File:" + p.mainsnak.datavalue.value === pg.title),
      });
    }
  }
  return { qid: hit.id, files: out };
}

const WEB_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["images"],
  properties: {
    images: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["url", "page"],
        properties: { url: { type: "string" }, page: { type: "string" } },
      },
    },
  },
};

/** 웹 검색 — 정면 프로필·보도 사진의 이미지 파일 주소 */
export async function webCandidates(name, born, job) {
  const r = await luna({
    text: `${name} (${born}년생, ${job}) 의 최근 정면 얼굴 사진을 웹에서 찾는다. 공식 프로필 사진·보도 사진처럼 한 사람만, 정면, 자연스러운 화장인 것.
이미지 파일을 바로 받을 수 있는 주소(url, jpg/png/webp)와 그 사진이 실린 페이지(page)를 최대 6개. 주소를 지어내지 말고 검색 결과에 실제로 있는 것만.`,
    schema: WEB_SCHEMA,
    name: "images",
    effort: "low",
    tools: [{ type: "web_search" }],
  });
  return r.value.images.map((x) => ({ src: "web", ...x }));
}

export async function download(url, dest, referer) {
  try {
    const r = await fetch(url, { headers: { "user-agent": url.includes("wikimedia") ? WM_UA : BR_UA, ...(referer ? { referer } : {}) } });
    if (r.status !== 200) return false;
    const ct = r.headers.get("content-type") || "";
    if (!ct.startsWith("image/")) return false;
    fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
    return true;
  } catch {
    return false;
  }
}

/**
 * 후보 사진 목록 → 얼굴 검사(한 사람·정면에 가까움) → 동일인 → Luna QC. 처음 통과한 것.
 * ref: 나무위키 얼굴의 SFace 벡터 (없으면 커먼즈 P18 만 믿는다)
 */
export async function choose(cands, dir, tag, ref, log) {
  const tried = [];
  let k = 0;
  for (const c of cands) {
    if (k >= 10) break;
    const ext = (c.url.match(/\.(jpe?g|png|webp)(\?|$)/i)?.[1] || "jpg").toLowerCase();
    const dest = `${dir}/${tag}-${String(k++).padStart(2, "0")}.${ext}`;
    if (!(await download(c.url, dest))) {
      tried.push({ ...c, why: "download" });
      continue;
    }
    const [d] = py("detect", dest);
    if (!d?.n || d.crowd || d.main.yaw > 0.3 || d.main.eye < 22) {
      tried.push({ ...c, why: `detect n=${d?.n} crowd=${d?.crowd} yaw=${d?.main?.yaw} eye=${d?.main?.eye}` });
      continue;
    }
    if (ref) {
      const [id] = py("ident", dest);
      const sim = id?.v ? cosine(ref, id.v) : -1;
      if (sim < SAME) {
        tried.push({ ...c, why: `ident ${sim.toFixed(3)}` });
        continue;
      }
      c.sim = +sim.toFixed(3);
    } else if (!c.p18) {
      tried.push({ ...c, why: "no ref, not p18" });
      continue;
    }
    const q = (await luna({ text: QC_PROMPT, images: [dest], schema: QC_SCHEMA, effort: "low" })).value;
    if (q.people !== 1 || !q.face_clear || q.angle === "side" || q.heavy_styling || q.occluded || q.photo_quality === "poor") {
      tried.push({ ...c, why: `qc ${JSON.stringify(q)}` });
      continue;
    }
    log?.(`  ✓ ${c.src} ${c.title || c.url}`);
    return { chosen: { ...c, file: dest, qc: q, detect: d.main }, tried };
  }
  return { chosen: null, tried };
}

export { sleep };
