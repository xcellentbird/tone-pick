/**
 * wrangler.jsonc 가 지켜야 하는 것들을 기계가 본다.
 *
 * 셋 다 사람 눈으로는 잘 안 잡히는 종류다.
 *  1. **프로덕션 비밀값이 저장소에 들어오는 것** — vars 에 MASTER_PIN 을 적으면 그대로 공개된다
 *  2. **QA 공통 PIN 이 흔들리는 것** — 연습용은 언제나 0000 이어야 한다는 약속
 *  3. **환경에 상속되지 않는 키를 빠뜨리는 것** — durable_objects·assets 는 상속되지 않는다.
 *     빠뜨리면 배포는 되고 첫 요청에서야 터진다
 *
 *   node scripts/check-config.mjs
 */
import { readFileSync } from "node:fs";

const RAW = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");

/** 주석을 걷어낸다. 문자열 안의 // 는 주석이 아니다 */
function stripComments(text) {
  let out = "";
  let state = "code";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (state === "code") {
      if (c === '"') state = "str";
      else if (c === "/" && n === "/") { state = "line"; i++; continue; }
      else if (c === "/" && n === "*") { state = "block"; i++; continue; }
      out += c;
    } else if (state === "str") {
      out += c;
      if (c === "\\") { out += text[++i]; continue; }
      if (c === '"') state = "code";
    } else if (state === "line") {
      if (c === "\n") { state = "code"; out += c; }
    } else if (state === "block") {
      if (c === "*" && n === "/") { state = "code"; i++; }
    }
  }
  return out;
}

const config = JSON.parse(stripComments(RAW));
const problems = [];

// ① 프로덕션 비밀값은 저장소에 두지 않는다
for (const key of ["MASTER_PIN", "SESSION_SECRET"]) {
  if (config.vars && key in config.vars) {
    problems.push(`프로덕션 vars 에 ${key} 가 있습니다. 시크릿으로만 넣으세요 (wrangler secret put ${key})`);
  }
}

// ② 연습용 공통 PIN 은 언제나 0000
const qa = config.env?.qa;
if (!qa) {
  problems.push("env.qa 가 없습니다");
} else {
  if (qa.vars?.MASTER_PIN !== "0000") {
    problems.push(`QA 공통 PIN 이 "${qa.vars?.MASTER_PIN}" 입니다. 연습용은 언제나 0000 입니다`);
  }
  if (!qa.vars?.ENV_LABEL) {
    problems.push("env.qa 에 ENV_LABEL 이 없습니다. 화면 위 띠와 리허설 스크립트의 안전장치가 이 값으로 돕니다");
  }

  // ③ 환경에 상속되지 않는 키들
  for (const key of ["durable_objects", "assets"]) {
    if (!qa[key]) problems.push(`env.qa 에 ${key} 가 없습니다. 환경에 상속되지 않으니 그대로 다시 적어야 합니다`);
  }
  const names = (qa.durable_objects?.bindings ?? []).map((b) => b.name).sort();
  const expected = (config.durable_objects?.bindings ?? []).map((b) => b.name).sort();
  if (String(names) !== String(expected)) {
    problems.push(`env.qa 의 DO 바인딩(${names})이 프로덕션(${expected})과 다릅니다`);
  }
}

if (problems.length === 0) {
  console.log("✅ wrangler 설정 이상 없음");
  process.exit(0);
}
console.error(`❌ wrangler 설정 문제 (${problems.length}건)\n`);
for (const p of problems) console.error(`  · ${p}`);
process.exit(1);
