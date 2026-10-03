// 나간 판을 그대로 두고 특징 부호(`t`)만 얹어 새 판으로 낸다 (ADR-127)
// node emit-traits.mjs <from> <to>        예: node emit-traits.mjs 2 3
//
// v3 은 v2 와 **같은 사람 · 같은 사진 · 같은 벡터 · 같은 1·2단계**다. 바뀐 것은 규칙(3라운드의 결과 몫)과
// 결과 화면의 특징 한 줄뿐이라 emit.mjs 로 다시 뽑지 않는다 — 다시 뽑으면 그 사이 바뀐 작업 자료(큰 사진 ·
// 다시 뜬 크롭)가 섞여 v2 와 다른 판이 된다. 여기서는 v2 의 파일을 바이트째 옮기고 JSON 에 `t` 만 더한다.
//
// 읽는 것: public/faces/v{from}/ (풀 JSON · 사진), scripts/faces/v{from}-sources.json, scripts/faces/registry.json,
//          ${WORK}/out/apool-{g}.json 의 attrs (벡터를 만든 그 낱말 — attrs.mjs 의 consensus)
// 쓰는 것: public/faces/v{to}/ (풀 JSON · 사진), scripts/faces/v{to}-sources.json
// 순서: emit 다음 (나간 판에서 새 판을 낼 때만). 이 뒤에 check:faces
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_FACES, HERE, OUT, REGISTRY } from "./work.mjs";
import { IDEAL_TRAITS, traitToken } from "../../src/shared/ideal.ts";

const [from, to] = process.argv.slice(2).map(Number);
if (!Number.isInteger(from) || !Number.isInteger(to) || to <= from) throw new Error("usage: node emit-traits.mjs <from> <to>");
const src = path.join(DEFAULT_FACES, `v${from}`);
const dst = path.join(DEFAULT_FACES, `v${to}`);
// 나간 판은 고치지 않는다 (emit.mjs 와 같은 약속)
if (fs.existsSync(dst) && fs.readdirSync(dst).length) throw new Error(`${dst} 는 이미 나간 판이다 — 새 판 번호로 낸다`);

/** attrs.mjs 의 낱말 → 앱의 부호. 칸 순서 · 낱말 순서가 IDEAL_TRAITS 와 같다 — 어긋나면 아래에서 멈춘다 */
const WORDS = {
  animal: ["강아지상", "고양이상", "여우상", "토끼상", "사슴상", "곰상", "늑대상", "공룡상", "다람쥐상", "햄스터상", "말상", "뱀상", "두부상", "병아리상"],
  vibe: ["청순한", "귀여운", "발랄한", "시크한", "도도한", "우아한", "섹시한", "지적인", "따뜻한", "부드러운", "차가운", "강인한", "남성적인", "중성적인", "소년 같은", "이국적인", "수수한", "화려한", "성숙한", "장난스러운"],
  gaze: ["순한 눈매", "또렷한 눈매", "날카로운 눈매", "나른한 눈매", "웃는 듯한 눈매"],
  jaw: ["갸름하고 뾰족한 턱", "부드러운 곡선 턱", "각지고 뚜렷한 턱", "둥근 턱"],
  features: ["순하고 흐린 이목구비", "균형 잡힌 이목구비", "진하고 뚜렷한 이목구비"],
};
for (const [k, words] of Object.entries(WORDS))
  if (words.length !== IDEAL_TRAITS[k].length) throw new Error(`${k}: 낱말 ${words.length} · 부호 ${IDEAL_TRAITS[k].length} — 어휘가 어긋났다`);

const reg = JSON.parse(fs.readFileSync(REGISTRY, "utf8"));
const keyOf = Object.fromEntries(Object.entries(reg).map(([key, id]) => [id, key]));

fs.mkdirSync(dst, { recursive: true });
for (const g of ["f", "m"]) {
  const file = JSON.parse(fs.readFileSync(path.join(src, `${g}.json`), "utf8"));
  const attrs = Object.fromEntries(JSON.parse(fs.readFileSync(`${OUT}apool-${g}.json`, "utf8")).map((p) => [p.key, p.attrs]));
  const tokens = (id) => {
    const a = attrs[keyOf[id]];
    if (!a) throw new Error(`${g} ${id}: 작업 자료에 낱말이 없다`);
    const out = [];
    for (const [k, words] of Object.entries(WORDS))
      for (const w of Array.isArray(a[k]) ? a[k] : [a[k]]) {
        const i = words.indexOf(w);
        if (i < 0) throw new Error(`${g} ${id}: ${k} 의 모르는 낱말 ${w}`);
        out.push(traitToken(k, IDEAL_TRAITS[k][i]));
      }
    return out;
  };
  const next = { ...file, version: to, celebs: file.celebs.map((c) => ({ ...c, t: tokens(c.id) })) };
  fs.writeFileSync(path.join(dst, `${g}.json`), JSON.stringify(next));
  console.log(g, "celebs", next.celebs.length, "json KB", (fs.statSync(path.join(dst, `${g}.json`)).size / 1024).toFixed(1));
}
for (const f of fs.readdirSync(src)) if (f.endsWith(".webp")) fs.copyFileSync(path.join(src, f), path.join(dst, f));
fs.copyFileSync(path.join(HERE, `v${from}-sources.json`), path.join(HERE, `v${to}-sources.json`));
