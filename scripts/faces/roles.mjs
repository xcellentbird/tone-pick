// 사람마다 대중에게 알려진 주된 직업 하나 — emit-face 가 판에 실을 사람을 고르는 재료다 (ADR-132)
// node roles.mjs [from=3]
//
// 이상형 찾기의 결과는 `배우 · 아이돌 · 가수 · 모델` 에서 나온다 (ADR-132 결정 ③). v3 의 첫 화면에는 아나운서 · 방송인 · 개그맨이
// 셋씩 섰다 — 처음 여는 사람이 모두 보는 아홉이다. 직업은 얼굴로 가릴 수 없어 이름과 출생 연도로 묻는다.
// 모델은 gpt-6.1-sol — 사람을 알아야 하는 물음이라 아는 것이 많은 쪽을 쓴다 (luna.mjs 의 기본은 gpt-6-luna)
//
// 새로 더하는 사람은 후보 목록에 적힌 직업(`job`)이 있으면 그것을 쓴다 — LLM 은 직업이 없는 사람에게만 묻는다.
//
// 읽는 것: scripts/faces/v{from}-sources.json (나간 판의 사람들), ${WORK}/out/apool-{f,m}.json (새로 더하는 사람 — 있으면),
//          scripts/faces/roles.json (이미 고른 것 — 다시 묻지 않는다), OPENAI_API_KEY
// 쓰는 것: scripts/faces/roles.json (`이름|출생 연도` → 직업). **커밋한다** — exclude.json 처럼 판에 실을 사람을 정하는 자료다.
//          틀린 줄은 손으로 고친다 — 다시 돌려도 있는 줄은 묻지 않는다
// 순서: emit-face 전. 새 사람을 더할 때는 build-attrs 다음
import fs from "node:fs";
import path from "node:path";
import { luna } from "./luna.mjs";
import { HERE, OUT } from "./work.mjs";

export const ROLES = ["actor", "idol", "singer", "trot", "model", "comedian", "broadcaster", "announcer", "athlete"];
/** 후보 목록의 직업(candidates · add-2026.json 의 `job`) → 부호. 후보를 고를 때 이미 적은 것이라 다시 묻지 않는다 */
const SEED = { 배우: "actor", 아이돌: "idol", 가수: "singer", 트로트: "trot", 모델: "model", 개그맨: "comedian", 방송인: "broadcaster", 아나운서: "announcer", 운동선수: "athlete" };
const PATH = path.join(HERE, "roles.json");

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const from = Number(process.argv[2] ?? 3);
  const roles = fs.existsSync(PATH) ? JSON.parse(fs.readFileSync(PATH, "utf8")) : {};
  const people = JSON.parse(fs.readFileSync(path.join(HERE, `v${from}-sources.json`), "utf8")).map((s) => ({ name: s.name, born: s.born }));
  for (const g of ["f", "m"]) {
    const ap = `${OUT}apool-${g}.json`;
    if (fs.existsSync(ap)) for (const p of JSON.parse(fs.readFileSync(ap, "utf8"))) people.push({ name: p.name, born: p.born, job: p.job });
  }
  for (const p of people) if (!roles[`${p.name}|${p.born}`] && SEED[p.job]) roles[`${p.name}|${p.born}`] = SEED[p.job];
  fs.writeFileSync(PATH, JSON.stringify(roles, null, 1) + "\n");
  const todo = [...new Map(people.map((p) => [`${p.name}|${p.born}`, p])).values()].filter((p) => !roles[`${p.name}|${p.born}`]);
  console.log("to label", todo.length);
  const schema = {
    type: "object", additionalProperties: false, required: ["people"],
    properties: { people: { type: "array", items: { type: "object", additionalProperties: false, required: ["key", "role"],
      properties: { key: { type: "string" }, role: { type: "string", enum: ROLES } } } } },
  };
  for (let i = 0; i < todo.length; i += 80) {
    const chunk = todo.slice(i, i + 80);
    const r = await luna({
      model: "gpt-6.1-sol",
      schema,
      name: "people",
      text: `한국 유명인 목록이다 (key = 이름|출생 연도). 사람마다 대중에게 가장 알려진 주된 직업 하나를 고른다.
actor 배우 · idol 아이돌 그룹 멤버(지금 활동하든 아니든 아이돌로 알려진 사람) · singer 아이돌이 아닌 가수 · trot 트로트 가수 · model 모델 ·
comedian 개그맨·코미디언 · broadcaster 방송인·예능인(코미디언이 아닌) · announcer 아나운서·기자 출신 방송인 · athlete 운동선수.
아이돌 출신이라도 배우로 더 알려졌으면 actor. 모든 key 에 답한다. key 는 받은 그대로 돌려준다.
${chunk.map((p) => `${p.name}|${p.born}`).join("\n")}`,
    });
    for (const p of r.value.people) if (chunk.some((c) => `${c.name}|${c.born}` === p.key)) roles[p.key] = p.role;
    fs.writeFileSync(PATH, JSON.stringify(roles, null, 1) + "\n");
    console.log(i + chunk.length, "/", todo.length);
  }
  const missing = todo.filter((p) => !roles[`${p.name}|${p.born}`]);
  if (missing.length) console.log("답이 없는 사람 — 다시 돌린다:", missing.map((p) => p.name).join(" "));
}
