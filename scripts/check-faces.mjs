/**
 * 이상형 찾기의 얼굴 자료(`public/faces/`)가 앱과 맺은 계약을 기계가 본다 (슬라이스 19, 19-surface.md 「자산」).
 *
 * 자료는 코드가 아니라 파이프라인이 떨군 파일이라 타입도 테스트도 닿지 않는다. 그리고 틀려도
 * **조용히 틀린다** — 사진 하나가 빠지면 그 칸만 비고, 벡터 하나가 어긋나면 결과가 조금 이상할 뿐이다.
 *
 *  1. **짝이 안 맞는 것** — 항목에 사진이 없거나 사진에 항목이 없다. 없는 사진 주소는 SPA 폴백이
 *     `index.html` 을 200 으로 주고, 그 답이 `/faces/*.webp` 규칙을 타고 1년 캐시된다 (public/_headers)
 *  2. **이름이 새는 것** (S-B5) — 파일명은 불투명 id 다. 고르는 화면이 이름을 감춰도
 *     사진 주소에 이름이 있으면 그 사진을 새 탭으로 여는 순간 보인다
 *  3. **숫자가 계약과 다른 것** — 1단계(1라운드 두 쪽) · 2단계 · 결과를 채울 만큼의 연예인 · 단위 길이 벡터
 *  4. **판이 섞이는 것** — JSON 의 version 이 경로의 v{n} 과 다르면 옛 결과가 새 자료로 그려진다
 *  5. **여는 사람이 받는 JSON 이 불어나는 것** — 풀·차원이 늘면 파티장 와이파이에서 한 번에 받는 양이 는다
 *
 * **판마다 보는 것이 다르다.** 지금 판(IDEAL_ASSET_V)이 아닌 판은 저장된 결과를 다시 그리는 데만 쓰이고
 * 고칠 수도 지울 수도 없다 (영구 캐시 · 옛 판 경로는 지우지 않는다). 그래서 **그리는 데 필요한 것**
 * (모양 · 판 · id · 벡터 · 사진 짝 · 이름 · 매직 · 해시)은 모든 판에서 보고, **새로 찾는 데 필요한 것**
 * (level 개수 · 연예인 수 · 두 목록의 id 겹침 · JSON 크기)은 지금 판에서만 본다 — 모양이 바뀌어 판을
 * 올린 날 얼어붙은 v1 이 영영 빨갛게 남으면 아무도 정당하게 고칠 수 없다.
 *
 * `public/faces/` 가 없으면 조용히 통과한다 — 자산이 오기 전에도 CI 가 돌아야 한다.
 * 그 사이 캐시가 `index.html` 을 붙잡지 않게 하는 일은 여기가 아니라 `public/_headers` 가 맡는다
 * (JSON 은 영구 캐시에서 뺐다).
 * 숫자와 id 모양의 출처는 `src/shared/ideal.ts` 다. TS 를 import 하지 않고 **글로 읽는다** —
 * CI 의 Node 22 는 타입을 못 벗긴다 (check-config 가 APP_VERSION 을 읽는 것과 같은 방식).
 *
 *   node scripts/check-faces.mjs [폴더]      기본값 public/faces — 폴더를 주면 임시 풀로 돌려볼 수 있다
 */
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// `.pathname` 은 한글·빈칸이 든 경로를 %xx 로 남긴다 — 그러면 아래 existsSync 가 **조용히 통과**로 샌다
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ARG = process.argv[2];
const DIR = ARG ? resolve(ARG) : join(ROOT, "public/faces");
const rel = relative(process.cwd(), DIR);
const SHOWN = !rel ? "." : rel.startsWith("..") ? DIR : rel;

if (!existsSync(DIR)) {
  // 조용한 통과는 기본 폴더에만 준다 — 자산이 오기 전의 CI 를 위한 길이다.
  // 손으로 준 폴더가 없다면 오타다. 그걸 ✅ 로 답하면 아무것도 안 본 검사가 통과를 말한다
  if (ARG) {
    console.error(`❌ ${SHOWN} 가 없다 — 폴더를 주었으면 그 폴더가 있어야 한다`);
    process.exit(1);
  }
  console.log(`✅ 얼굴 자료 없음 — ${SHOWN}/ 가 아직 없어 건너뜀`);
  process.exit(0);
}

/* ── 계약의 숫자는 ideal.ts 에서 읽는다. 못 찾으면 검사가 헛도는 것이라 바로 멈춘다 */
const SRC = readFileSync(new URL("../src/shared/ideal.ts", import.meta.url), "utf8");
// IDEAL_SHAPE 블록 안에서만 찾는다 — 같은 파일의 FacePoolFile 에도 `faces:` 가 있다
const SHAPE = SRC.match(/export const IDEAL_SHAPE = \{([\s\S]*?)\} as const/)?.[1] ?? "";
const lost = [];
// min 은 그 값이 될 수 있는 가장 작은 수 — `rerolls` 만 0 이 된다(다른 얼굴 보기를 없앤 날)
const shapeNum = (key, min = 1) => {
  const n = Number(SHAPE.match(new RegExp(`\\b${key}:\\s*(\\d+)\\b`))?.[1]);
  if (!Number.isInteger(n) || n < min) lost.push(`IDEAL_SHAPE.${key}`);
  return n;
};
const ROUNDS = shapeNum("rounds");
const FACES = shapeNum("faces");
const RESULTS = shapeNum("results");
const REROLLS = shapeNum("rerolls", 0);
/**
 * 1단계 수 — 1라운드의 모든 쪽(한 화면 × (1 + rerolls)). 모두에게 같은 첫 화면과 `다른 얼굴 보기` 가 여는 둘째 화면이다.
 * 2단계 수 — 2라운드가 중심 근처 아홉을 고르는 후보 집합이다. 모자라면 2라운드가 서로 다른 군집을 못 보여준다.
 * 둘 다 ideal.ts 가 들고 파이프라인(cluster.mjs)이 맞춰 낸다
 */
const LEVEL1 = shapeNum("level1");
const LEVEL2 = shapeNum("level2");
const idSrc = SHAPE.match(/\bid:\s*\/((?:\\.|[^/\\\n])+)\/([a-z]*)/);
if (!idSrc) lost.push("IDEAL_SHAPE.id");
// g·y 는 뺀다 — test() 가 lastIndex 를 들고 다니면 같은 id 가 번갈아 맞고 틀린다
const ID = idSrc ? new RegExp(idSrc[1], idSrc[2].replace(/[gy]/g, "")) : null;
// 새로 찾는 사람이 받는 판. 그 폴더가 없으면 여는 사람 전부가 '못 불러왔어요' 를 본다
const ASSET_V = Number(SRC.match(/export const IDEAL_ASSET_V\s*=\s*(\d+)/)?.[1]);
if (!Number.isInteger(ASSET_V)) lost.push("IDEAL_ASSET_V");
if (lost.length) {
  console.error(`❌ src/shared/ideal.ts 에서 ${lost.join(" · ")} 를 못 찾았다 — 검사가 헛돈다`);
  process.exit(1);
}

/** 특징 부호 하나의 모양 — `animal.cat` (ideal.ts 의 traitToken) */
const TRAIT_TOKEN = /^[a-z]+\.[a-z]+$/;

/** 복원 길이 허용 폭. int8 양자화가 길이를 조금 흔든다 — 그 이상이면 정규화를 빠뜨린 것이다 */
const NORM_TOL = 0.02;
/**
 * 결과를 채울 최소 연예인 수 — 세 라운드에 본 얼굴을 결과에서 빼고도(S-C2) 셋이 남아야 한다.
 * `다른 얼굴 보기` 로 넘긴 쪽도 본 얼굴이다 — 라운드마다 한 화면 × (1 + rerolls) 까지 본다
 */
const SEEN_MAX = ROUNDS * FACES * (1 + REROLLS);
const NEED_CELEBS = SEEN_MAX + RESULTS;
/**
 * 풀 JSON 한 파일의 예산(gzip 바이트). **래칫이다** — check-bundle 의 FONT_BUDGET 과 같다.
 *
 * 사진은 스무 장 남짓만 받지만 JSON 은 **풀 전체**를 한 번에 받는다 — 여는 사람이 받는 것 중
 * 한 덩어리로는 가장 크다. 그리고 파이프라인은 한 사람을 celebs 와 faces 에 **두 번** 적는다
 * (같은 벡터). int8 을 base64 로 적은 것이라 gzip 으로도 잘 안 준다.
 *
 * 2026-09-27 값은 **실측이 아니라 어림**이다 — 자산이 아직 없다. 계획한 풀(190명 · dim 256)을
 * 같은 모양으로 만들어 재면 gzip 91 KiB 쯤이다. 풀이 두 배가 되거나 dim 을 올리면 여기서 걸린다 —
 * 그때 그 값을 다시 묻게 하려는 값이다. **자산이 오면 실측으로 다시 적는다.**
 */
// v5(ADR-135, 2026-10-10) 실측: 여 536명 gzip 165.0 KiB · 남 580명 179.4 KiB — 사람당 약 310바이트. 판에 실을 사람을 늘려 올렸다.
// 받는 쪽은 이상형 찾기를 처음 여는 한 번이다(사진 · JSON 은 판 경로라 오래 캐시된다). 풀이 600명을 넘으면 다시 묻는다
const POOL_BUDGET = 192 * 1024;
const POOLS = ["f", "m"]; // Gender 소문자 — 풀 하나에 파일 하나

const problems = [];

/** 벡터 하나가 계약을 어기면 그 까닭을, 멀쩡하면 null */
function vecProblem(v, dim, scale) {
  if (typeof v !== "string") return "벡터(v)가 문자열이 아니다";
  // Buffer 는 틀린 글자를 조용히 버리지만 기기의 atob 는 던진다 — atob 가 받는 만큼(forgiving-base64)만
  // 통과시킨다. 되돌려 같은지로 보면 끝 `=` 를 뺀 자료가 빨개지는데, atob 는 그것도 받는다
  const s = v.replace(/[\t\n\f\r ]/g, "");
  const body = s.length % 4 === 0 ? s.replace(/={1,2}$/, "") : s;
  if (!/^[A-Za-z0-9+/]*$/.test(body) || body.length % 4 === 1) return "벡터(v)가 온전한 base64 가 아니다";
  const buf = Buffer.from(body, "base64");
  if (buf.length !== dim) return `벡터가 ${buf.length}바이트 — dim ${dim} 과 다르다`;
  let sq = 0;
  for (const b of buf) sq += ((b >= 128 ? b - 256 : b) / scale) ** 2;
  const len = Math.sqrt(sq);
  // decodeVec() 은 정규화하지 않는다 — 단위 길이는 자료의 성질이고 여기서만 본다
  if (!(Math.abs(len - 1) < NORM_TOL)) return `벡터 길이가 ${len.toFixed(3)} — 1 에서 ${NORM_TOL} 넘게 벗어났다`;
  return null;
}

/** 이름 비교용 — 대소문자·띄어쓰기·기호를 걷는다 */
const bare = (s) => s.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
/**
 * 로마자 두 글자 이름(IU·RM)은 무작위 id 에도 우연히 들어 있다. id 는 한 번 나가면 못 바꾸므로
 * 헛경보가 영영 빨갛게 남는다 — 로마자는 세 글자부터 본다. 한글은 id 정규식에 들어갈 수 없어
 * 두 글자여도 헛경보가 없다 (걸린다면 id 가 아닌 파일이다).
 */
const watched = (n) => n.length >= 3 || (n.length === 2 && /[^\x00-\x7f]/.test(n));

const at = (list, i, x) => `${list}[${i}]${typeof x?.id === "string" ? ` ${x.id}` : ""}`;

/*
 * ── faces/ 에는 v{n}/ 만 둔다. **숨은 파일도 예외가 아니다** — Vite 는 public/ 을 점 파일까지
 *    dist 로 옮기고 wrangler 는 그걸 올린다(`.assetsignore`·`_headers`·`_redirects` 만 뺀다).
 *    파이프라인이 떨군 `.registry.json` 이 숨어 있으면 S-B5 가 통째로 샌다. `.DS_Store` 도
 *    공개되고 그 안에 폴더의 파일 이름이 적혀 있다 — 지우고 올린다
 */
if (!statSync(DIR).isDirectory()) {
  console.error(`❌ ${SHOWN} 가 폴더가 아니다`);
  process.exit(1);
}
const versions = [];
for (const ent of readdirSync(DIR, { withFileTypes: true })) {
  const m = ent.name.match(/^v([1-9]\d*)$/);
  if (m && ent.isDirectory()) versions.push({ name: ent.name, n: Number(m[1]), photos: 0 });
  else problems.push(`${ent.name} — faces/ 에는 v{n}/ 폴더만 둔다. 앱은 그 밖을 읽지 않고, 둔 것은 그대로 공개된다`);
}
versions.sort((a, b) => a.n - b.n);
if (!versions.some((v) => v.n === ASSET_V)) {
  problems.push(`v${ASSET_V}/ 가 없다 — 앱(IDEAL_ASSET_V = ${ASSET_V})이 새로 찾을 때 받는 판이다`);
}

for (const ver of versions) {
  const vdir = join(DIR, ver.name);
  const say = (p) => problems.push(`${ver.name}/${p}`);
  // 새로 찾는 사람이 받는 판 — 계약의 숫자는 여기에만 건다 (머리말 「판마다 보는 것이 다르다」)
  const current = ver.n === ASSET_V;

  const entries = readdirSync(vdir, { withFileTypes: true });
  const photos = entries.filter((e) => e.isFile() && e.name.endsWith(".webp")).map((e) => e.name);
  for (const e of entries) {
    const known = e.isFile() && (e.name.endsWith(".webp") || POOLS.some((g) => e.name === `${g}.json`));
    // 앱이 안 읽어도 공개는 된다 — 파이프라인이 떨군 id↔이름 표가 여기 남으면 S-B5 가 통째로 샌다
    if (!known) say(`${e.name} — 앱이 읽지 않는 것인데 그대로 공개된다. v{n}/ 에는 f.json · m.json · <id>.webp 만 둔다`);
  }
  ver.photos = photos.length;

  const needPhoto = new Set(); // 화면에 나가는 id — faces 전부와 retired 아닌 celebs
  const known = new Set(); // 사진이 있어도 되는 id — 두 목록의 모든 id
  const poolOf = new Map(); // id → 처음 나온 풀. 같은 폴더라 f 와 m 이 같은 id 를 쓰면 사진 하나를 둘이 가리킨다
  const names = new Set();
  // 못 읽은 풀이 있으면 그 풀의 사진이 전부 '항목 없음' 으로 쏟아진다 — 원인 한 줄을 묻지 않게 그 검사는 건너뛴다
  let unread = false;

  for (const g of POOLS) {
    const file = `${g}.json`;
    if (!existsSync(join(vdir, file))) {
      say(`${file} 가 없다 — 그 풀을 고르면 '못 불러왔어요' 가 뜬다`);
      unread = true;
      continue;
    }
    let raw;
    let pool;
    try {
      raw = readFileSync(join(vdir, file));
      pool = JSON.parse(raw.toString("utf8"));
    } catch (e) {
      say(`${file} 가 JSON 이 아니다 — ${e.message}`);
      unread = true;
      continue;
    }
    if (!pool || typeof pool !== "object" || !Array.isArray(pool.celebs) || !Array.isArray(pool.faces)) {
      say(`${file} 에 celebs · faces 배열이 없다`);
      unread = true;
      continue;
    }
    if (current) {
      const gz = gzipSync(raw, { level: 9 }).length;
      if (gz > POOL_BUDGET) {
        say(
          `${file} 가 gzip ${(gz / 1024).toFixed(1)} KiB — 예산 ${(POOL_BUDGET / 1024).toFixed(0)} KiB 를 넘었다. ` +
            `여는 사람이 한 번에 받는 양이다. 정당하면 POOL_BUDGET 을 올려라 (래칫)`,
        );
      }
    }

    // 판이 경로와 같아야 한다 — 저장된 결과는 자기 v 의 경로로 그린다
    if (pool.version !== ver.n) say(`${file} 의 version 이 ${JSON.stringify(pool.version)} 인데 경로는 ${ver.name}/ 이다`);

    const { dim, scale } = pool;
    const vecOk = Number.isInteger(dim) && dim > 0 && typeof scale === "number" && Number.isFinite(scale) && scale > 0;
    if (!vecOk) say(`${file} 의 dim(${JSON.stringify(dim)}) · scale(${JSON.stringify(scale)}) 이 양수가 아니다 — 벡터를 복원할 수 없다`);

    const poolIds = new Set();
    /** 한 목록의 항목들이 공통으로 지켜야 하는 것 — id 모양 · 목록 안에서 유일 · 벡터 */
    const common = (list, items) => {
      const seen = new Set();
      items.forEach((x, i) => {
        const where = `${file} ${at(list, i, x)}`;
        if (!x || typeof x !== "object") return say(`${where} 가 객체가 아니다`);
        if (typeof x.id !== "string" || !ID.test(x.id)) {
          say(`${where} 의 id ${JSON.stringify(x.id)} 가 ${ID} 에 맞지 않는다`);
        } else if (seen.has(x.id)) {
          say(`${where} — ${list} 안에 같은 id 가 또 있다`);
        } else {
          seen.add(x.id);
          poolIds.add(x.id);
          known.add(x.id);
        }
        if (vecOk) {
          const why = vecProblem(x.v, dim, scale);
          if (why) say(`${where} — ${why}`);
        }
      });
    };

    common("celebs", pool.celebs);
    common("faces", pool.faces);

    let live = 0;
    pool.celebs.forEach((c, i) => {
      if (!c || typeof c !== "object") return;
      if (typeof c.name !== "string" || !c.name.trim()) say(`${file} ${at("celebs", i, c)} 에 이름이 없다 — 결과 화면이 이름을 말한다`);
      else names.add(c.name);
      if (c.retired !== undefined && c.retired !== true) say(`${file} ${at("celebs", i, c)} 의 retired 는 true 이거나 없어야 한다`);
      // 특징 부호(ADR-127) — 있으면 `칸.부호` 꼴의 목록이어야 한다. 모르는 부호는 화면에서 조용히 빠진다
      if (c.t !== undefined && !(Array.isArray(c.t) && c.t.every((x) => typeof x === "string" && TRAIT_TOKEN.test(x))))
        say(`${file} ${at("celebs", i, c)} 의 t 가 \`칸.부호\` 목록이 아니다`);
      if (c.retired === true) return;
      live++;
      if (typeof c.id === "string") needPhoto.add(c.id);
    });
    if (current && live < NEED_CELEBS) {
      say(
        `${file} 의 연예인이 ${live}명(retired 뺀 수) — 세 라운드에 본 ${SEEN_MAX}명(다른 얼굴 보기 포함)을 빼고도 ` +
          `결과 ${RESULTS}명이 남으려면 ${NEED_CELEBS}명 이상이어야 한다`,
      );
    }

    const levels = { 1: 0, 2: 0, 3: 0 };
    pool.faces.forEach((f, i) => {
      if (!f || typeof f !== "object") return;
      if (typeof f.id === "string") needPhoto.add(f.id);
      if (f.level === 1 || f.level === 2 || f.level === 3) levels[f.level]++;
      else say(`${file} ${at("faces", i, f)} 의 level 이 ${JSON.stringify(f.level)} — 1 · 2 · 3 만 된다`);
    });
    if (current && levels[1] !== LEVEL1) {
      say(`${file} 의 level 1 이 ${levels[1]}개 — ${LEVEL1}개여야 한다 (1라운드 한 화면 ${FACES} × 쪽 ${1 + REROLLS} · 모두에게 같은 첫 화면)`);
    }
    if (current && levels[2] !== LEVEL2) say(`${file} 의 level 2 가 ${levels[2]}개 — ${LEVEL2}개여야 한다`);

    /*
     * 두 목록의 id 가 온전히 겹친다 (19-surface 「자산」). S-C2 는 본 얼굴을 **id 로** 결과에서 뺀다 —
     * 같은 사람이 faces 와 celebs 에서 다른 id 를 달면 라운드에서 고른 얼굴이 결과에 또 나온다.
     * 같은 사람이면 같은 벡터다 — 다르면 고른 얼굴과 결과가 서로 다른 자리에서 재진 것이다
     */
    if (current) {
      const celebV = new Map();
      for (const c of pool.celebs) if (c && typeof c.id === "string") celebV.set(c.id, c.v);
      pool.faces.forEach((f, i) => {
        if (!f || typeof f !== "object" || typeof f.id !== "string") return;
        if (!celebV.has(f.id)) say(`${file} ${at("faces", i, f)} 가 celebs 에 없다 — 본 얼굴을 결과에서 빼지 못한다 (S-C2)`);
        else if (celebV.get(f.id) !== f.v) say(`${file} ${at("faces", i, f)} 의 벡터가 celebs 의 같은 id 와 다르다`);
      });
    }

    for (const id of poolIds) {
      if (poolOf.has(id)) say(`${file} 의 ${id} 가 ${poolOf.get(id)}.json 에도 있다 — 같은 폴더라 사진 ${id}.webp 하나를 두 풀이 가리킨다`);
      else poolOf.set(id, g);
    }
  }

  /* ── 사진과 항목의 짝 */
  const onDisk = new Set(photos.map((p) => p.slice(0, -".webp".length)));
  for (const id of needPhoto) {
    if (!onDisk.has(id)) say(`${id}.webp 가 없다 — 화면에 나가는 얼굴인데 사진이 없다`);
  }
  for (const p of photos) {
    const id = p.slice(0, -".webp".length);
    if (!unread && !known.has(id)) say(`${p} 에 맞는 항목이 없다 — 어느 풀의 celebs 에도 faces 에도 없는 사진이다`);
  }

  /* ── 파일명에 이름이 없다 (S-B5) — webp 만이 아니라 폴더의 모든 파일을 본다 */
  const watchedNames = [...names].map((n) => ({ n, b: bare(n) })).filter(({ b }) => watched(b));
  for (const e of entries) {
    const b = bare(e.name.replace(/\.[^.]*$/, "")); // 확장자는 뺀다 — `webp` 네 글자가 이름과 겹치지 않게
    for (const { n, b: nb } of watchedNames) {
      if (b.includes(nb)) say(`${e.name} 에 연예인 이름 "${n}" 이 들어 있다 — 파일명은 불투명 id 다 (S-B5)`);
    }
  }

  /* ── 사진 한 장 한 장 — 진짜 webp 인가, 같은 사진이 둘인가 */
  const byHash = new Map();
  for (const p of photos) {
    const bytes = readFileSync(join(vdir, p));
    const magic = bytes.length >= 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP";
    if (!magic) say(`${p} 가 webp 가 아니다 — RIFF…WEBP 머리가 없다 (확장자만 바꾼 파일)`);
    const h = createHash("sha256").update(bytes).digest("hex");
    byHash.set(h, [...(byHash.get(h) ?? []), p]);
  }
  for (const same of byHash.values()) {
    // 같은 사진이 두 id 에 붙었다 — 한 사람이 두 번 들어왔거나 사진을 잘못 복사했다
    if (same.length > 1) say(` 에 같은 사진이 ${same.length}장 — ${same.join(" · ")}`);
  }
}

if (problems.length === 0) {
  console.log(`✅ 얼굴 자료 이상 없음 — ${versions.map((v) => `${v.name} 사진 ${v.photos}장`).join(" · ")}`);
  process.exit(0);
}
console.error(`❌ 얼굴 자료 문제 (${problems.length}건) — ${SHOWN}/\n`);
for (const p of problems) console.error(`  · ${p}`);
console.error("\n→ 계약은 docs/scenarios/19-surface.md 「자산」에 있다.");
process.exit(1);
