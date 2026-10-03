// 사람을 더하는 판의 후보를 작업 자료로 옮긴다 (ADR-132 남은 일) — 손으로 고른 목록에서. LLM 을 부르지 않는다
// node candidates-add.mjs [목록=scripts/faces/add-2026.json]
//
// candidates.mjs 는 LLM 에게 처음부터 명단을 뽑게 한다 — 다시 돌리면 명단이 바뀐다. 더하는 판은 운영자가 먼저 보는 목록에서 시작한다:
// 목록은 저장소에 있고(커밋), 빼고 더하는 것은 그 파일을 고치는 일이다. 여기서는 이미 나간 사람(registry.json 의 `이름|출생 연도`)을
// 빼고 fetch-namu 가 읽는 모양(candidates-{g}.json)으로 옮길 뿐이다.
//
// 읽는 것: 주어진 목록({ f: [{name, namu, born, job}], m: [...] }), scripts/faces/registry.json, ${WORK}/out/candidates-{g}.json(있으면 이어 붙인다)
// 쓰는 것: ${WORK}/out/candidates-{g}.json
// 순서: 1 — candidates.mjs 대신. 이어서 fetch-namu → fix-namu → select → recolor → build-attrs → namu-born → sheet(exclude.json)
//       → roles.mjs → emit-face (ADR-132 「파이프라인」)
import fs from "node:fs";
import path from "node:path";
import { HERE, OUT, REGISTRY } from "./work.mjs";

const list = JSON.parse(fs.readFileSync(path.resolve(process.argv[2] ?? path.join(HERE, "add-2026.json")), "utf8"));
const reg = JSON.parse(fs.readFileSync(REGISTRY, "utf8"));
fs.mkdirSync(OUT, { recursive: true });
for (const g of ["f", "m"]) {
  const p = `${OUT}candidates-${g}.json`;
  const have = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : [];
  const seen = new Set(have.map((c) => `${c.name}|${c.born}`));
  const skipped = [];
  for (const c of list[g] ?? []) {
    const key = `${c.name}|${c.born}`;
    if (reg[key]) { skipped.push(c.name); continue; }
    if (seen.has(key)) continue;
    seen.add(key);
    have.push({ name: c.name, namu: c.namu, born: c.born, job: c.job, bucket: path.basename(process.argv[2] ?? "add-2026.json") });
  }
  fs.writeFileSync(p, JSON.stringify(have, null, 1));
  console.log(g, "candidates", have.length, skipped.length ? `(이미 나간 사람 ${skipped.length} — ${skipped.join(" ")})` : "");
}
