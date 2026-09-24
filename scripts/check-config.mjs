/**
 * 배포 설정이 지켜야 하는 것들을 기계가 본다 — wrangler.jsonc 가 대부분이지만 전부는 아니다.
 *
 * 다섯 다 사람 눈으로는 잘 안 잡히는 종류다.
 *  1. **프로덕션 비밀값이 저장소에 들어오는 것** — vars 에 MASTER_PIN 을 적으면 그대로 공개된다
 *  2. **QA 공통 PIN 이 흔들리는 것** — 연습용은 언제나 0000 이어야 한다는 약속
 *  3. **환경에 상속되지 않는 것을 빠뜨리는 것** — durable_objects, assets, vars, r2_buckets 가 다 그렇다.
 *     빠뜨리면 배포는 되고 첫 요청에서야 터지거나, 아예 조용히 어긋난다
 *  4. **preload 한 파일에 캐시 규칙이 없는 것** — preload 는 그 파일을 첫 그림의 조건으로 만든다.
 *     기본값은 `max-age=0, must-revalidate` 라 두 번째 방문부터 **그림이 왕복 뒤에** 뜬다
 *  5. **화면에 뜨는 버전이 package.json 과 어긋나는 것** — 운영자가 그 숫자를 보고
 *     배포가 나갔는지 판단한다. 틀린 버전은 없느니만 못하다
 *  6. **무대 워커가 QA 아닌 곳을 겨누는 것** (슬라이스 35 S-A3) — 공개된 워커라 프로덕션을
 *     겨누면 PIN 하나로 진짜 회차를 만지게 된다
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
for (const key of ["MASTER_PIN", "SESSION_SECRET", "OPENAI_API_KEY"]) {
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

  /*
   * ③ 환경에 상속되지 않는 것들. 빠뜨리면 배포는 되고 첫 요청에서야 터지거나 조용히 어긋난다 —
   * 이름과 읽는 법만 표에 적는다. 새 바인딩이 생기면 줄 하나다.
   */
  const logs = (env) => (env.r2_buckets ?? []).find((b) => b.binding === "LOGS")?.bucket_name;
  // 국가 문은 **키가 있는지**를 본다 (ADR-92 후기). 빈 값은 사고가 아니라 끄는 길이다 — 아래 프로덕션 쪽 주석
  const gate = (env) => !!env.vars && "ALLOWED_COUNTRIES" in env.vars;
  const NOT_INHERITED = [
    { what: "durable_objects", read: (e) => e.durable_objects },
    { what: "assets", read: (e) => e.assets },
    { what: "ENV_LABEL", read: (e) => e.vars?.ENV_LABEL, why: "화면 위 띠와 리허설 스크립트의 안전장치가 이 값으로 돕니다" },
    { what: "LOGS 버킷(r2_buckets)", read: logs, why: "콕 로그가 쌓이지 않습니다 (ADR-84)" },
    { what: "ALLOWED_COUNTRIES 키(vars)", read: gate, why: "국가 문이 조용히 열립니다 (ADR-92)" },
  ];
  for (const { what, read, why } of NOT_INHERITED) {
    if (read(qa)) continue;
    problems.push(`env.qa 에 ${what} 가 없습니다. 환경에 상속되지 않으니 그대로 다시 적어야 합니다${why ? ` — ${why}` : ""}`);
  }

  // 프로덕션 쪽 규칙 — 상속의 문제가 아니라 그 자체로 있어야 하는 것
  if (!logs(config)) problems.push("프로덕션에 LOGS 버킷(r2_buckets)이 없습니다. 콕 로그가 쌓이지 않습니다 (ADR-84)");
  if (logs(config) && logs(config) === logs(qa)) {
    problems.push(`QA 와 프로덕션이 같은 로그 버킷(${logs(qa)})을 씁니다. 연습 콕이 진짜 파티 로그에 섞입니다`);
  }
  /*
   * 국가 문 (ADR-92). **키가 빠지면 조용히 열린다** — 배포는 되고 앱도 멀쩡히 돌고, 문만 없어진다.
   * **빈 값은 사고가 아니라 끄는 길이다** (ADR-92 후기). 파티 당일 로밍 참가자가 막히면 이 값을 비우고
   * 배포하는 것이 유일한 되돌리기인데, 그때 이 검사가 빨개지면 CI 가 바로 그 배포를 막는다.
   * 그래서 값이 아니라 키가 있는지를 본다 — 없는 것은 손이 미끄러진 것이고, 비운 것은 고른 것이다.
   * 문을 걷어내기로 했다면 이 검사도 함께 걷어내라 — 안 그러면 검사가 없는 문을 지킨다.
   */
  if (!gate(config)) {
    problems.push("프로덕션 vars 에 ALLOWED_COUNTRIES 키가 없습니다. 국가 문이 조용히 열립니다 (ADR-92). 끄려면 지우지 말고 비우세요");
  }

  const names = (qa.durable_objects?.bindings ?? []).map((b) => b.name).sort();
  const expected = (config.durable_objects?.bindings ?? []).map((b) => b.name).sort();
  if (String(names) !== String(expected)) {
    problems.push(`env.qa 의 DO 바인딩(${names})이 프로덕션(${expected})과 다릅니다`);
  }
}

// ④ index.html 이 preload 하는 파일에는 캐시 규칙이 있어야 한다
//
//    preload 는 "이 파일이 와야 화면이 선다" 는 선언이다. 그런데 정적 자산의 기본 헤더는
//    `max-age=0, must-revalidate` 라, 이름에 해시가 없는 파일은 **두 번째 방문부터도**
//    304 왕복을 기다린 뒤에야 그려진다. 첫 그림을 정하는 파일에 그 왕복이 붙으면
//    preload 로 얻은 것이 그대로 없어진다 (ADR-70).
//
//    해시가 붙는 /assets/* 는 번들러가 알아서 하지만, public/ 에 손으로 둔 파일은 아무도 안 챙긴다.
const HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const HEADERS = readFileSync(new URL("../public/_headers", import.meta.url), "utf8");

/** `_headers` 에서 경로 규칙과 그 아래 Cache-Control 을 모은다 */
const rules = [];
for (const line of HEADERS.split("\n")) {
  if (line.startsWith("#") || line.trim() === "") continue;
  if (!line.startsWith(" ") && !line.startsWith("\t")) rules.push({ path: line.trim(), cache: "" });
  else if (rules.length > 0 && /^\s*cache-control:/i.test(line)) {
    rules[rules.length - 1].cache = line.split(":").slice(1).join(":").trim();
  }
}

/** `_headers` 의 경로 규칙이 이 주소를 덮는가. 규칙은 끝의 `*` 만 와일드카드다 */
const covers = (rule, href) =>
  rule.endsWith("*") ? href.startsWith(rule.slice(0, -1)) : rule === href;

for (const m of HTML.matchAll(/<link\b[^>]*\brel="preload"[^>]*>/g)) {
  const href = m[0].match(/\bhref="([^"]+)"/)?.[1];
  if (!href || !href.startsWith("/")) continue;
  const rule = rules.find((r) => covers(r.path, href));
  const maxAge = Number(rule?.cache.match(/max-age=(\d+)/)?.[1] ?? 0);
  if (maxAge > 0) continue;
  problems.push(
    rule
      ? `index.html 이 preload 하는 ${href} 의 캐시 규칙(${rule.path})이 max-age=0 입니다. ` +
        `첫 그림이 매번 304 왕복을 기다립니다`
      : `index.html 이 preload 하는 ${href} 에 public/_headers 규칙이 없습니다. ` +
        `기본값이 max-age=0 이라 첫 그림이 매번 304 왕복을 기다립니다`,
  );
}

// ⑤ 화면에 뜨는 버전이 package.json 과 같은가
//
//    회차 목록 머리에 뜨는 값이다 (ADR-74). 빌드에 박힌 상수라 배포와 함께 굳는데,
//    릴리스에서 package.json 만 올리면 화면은 지난 버전을 계속 말한다.
//    운영자는 그 숫자를 보고 "새 게 안 나갔다" 고 판단하므로, 틀린 버전은 없느니만 못하다.
const PKG = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const CONSTANTS = readFileSync(new URL("../src/shared/constants.ts", import.meta.url), "utf8");
const shown = CONSTANTS.match(/APP_VERSION\s*=\s*"([^"]+)"/)?.[1];
if (shown !== PKG.version) {
  problems.push(
    shown
      ? `화면에 뜨는 APP_VERSION("${shown}")이 package.json("${PKG.version}")과 다릅니다. 릴리스에서 같이 올리세요`
      : "src/shared/constants.ts 에서 APP_VERSION 을 못 찾았습니다. 회차 목록 머리가 버전을 못 말합니다",
  );
}

// ⑥ 무대 워커의 표적은 QA 하나다 (슬라이스 35 S-A2·S-A3, ADR-97)
//
//    표적을 고르는 입력이 없는 대신 **설정 파일의 바인딩 하나가 곧 표적**이다.
//    그 한 줄이 프로덕션(`tone-pick`)을 가리키면 공개된 도구가 진짜 회차를 만진다 —
//    사람 눈으로는 이름 끝의 `-qa` 세 글자 차이라 잘 안 잡힌다.
const STAGE = JSON.parse(
  stripComments(readFileSync(new URL("./qa/worker/wrangler.jsonc", import.meta.url), "utf8")),
);
const QA_NAME = qa?.name;
const stageTargets = (STAGE.services ?? []).map((s) => `${s.binding} → ${s.service}`);
const app = (STAGE.services ?? []).find((s) => s.binding === "APP");
if (!app) {
  problems.push("무대 워커(scripts/qa/worker)에 APP 바인딩이 없습니다");
} else if (!QA_NAME || app.service !== QA_NAME) {
  problems.push(`무대 워커의 APP 바인딩이 "${app.service}" 를 가리킵니다. QA("${QA_NAME}")만 됩니다 (ADR-97)`);
}
if ((STAGE.services ?? []).length !== 1) {
  problems.push(`무대 워커의 서비스 바인딩은 APP 하나여야 합니다 — 지금: ${stageTargets.join(", ") || "없음"}`);
}
if (STAGE.env) {
  problems.push("무대 워커에 env 가 있습니다. 환경마다 표적이 갈릴 자리를 두지 않습니다 (S-A2)");
}
// 무대 워커가 로그인하는 PIN 은 QA 의 공개 PIN 그대로여야 한다 — 어긋나면 무대가 하나도 안 선다
if (STAGE.vars?.QA_PIN !== qa?.vars?.MASTER_PIN) {
  problems.push(`무대 워커의 QA_PIN("${STAGE.vars?.QA_PIN}")이 QA 공통 PIN("${qa?.vars?.MASTER_PIN}")과 다릅니다`);
}
// 사람에게 보여 줄 주소도 QA 여야 한다. **점까지 본다** — `tone-pick-qa-tool.` 도 앞 글자가 같다
if (!String(STAGE.vars?.QA_PUBLIC_URL ?? "").startsWith(`https://${QA_NAME}.`)) {
  problems.push(`무대 워커의 QA_PUBLIC_URL("${STAGE.vars?.QA_PUBLIC_URL}")이 QA(${QA_NAME}) 주소가 아닙니다 — 참가 링크가 엉뚱한 곳을 엽니다`);
}
// 무대 워커에는 로그인이 없다 (ADR-97 후기 4). 국가 문은 QA 와 **같은 값**이어야 한다 (S-B3) —
// 도구가 여는 참가 링크가 QA 로 가서 어차피 거기서 막힌다. 키가 빠지면 도구만 해외에 조용히 열리고,
// 아무 데나 훑는 봇이 하루 상한을 먼저 써 버린다. 끄는 길은 QA 와 함께 비우는 것이다 (ADR-92 후기)
if (!STAGE.vars || !("ALLOWED_COUNTRIES" in STAGE.vars)) {
  problems.push("무대 워커 vars 에 ALLOWED_COUNTRIES 키가 없습니다. 도구만 해외에 조용히 열립니다 (S-B3). 끄려면 지우지 말고 비우세요");
} else if (STAGE.vars.ALLOWED_COUNTRIES !== qa?.vars?.ALLOWED_COUNTRIES) {
  problems.push(`무대 워커의 ALLOWED_COUNTRIES("${STAGE.vars.ALLOWED_COUNTRIES}")가 QA("${qa?.vars?.ALLOWED_COUNTRIES}")와 다릅니다 — 둘은 같이 움직입니다 (S-B3)`);
}

if (problems.length === 0) {
  console.log("✅ 배포 설정 이상 없음");
  process.exit(0);
}
console.error(`❌ 배포 설정 문제 (${problems.length}건)\n`);
for (const p of problems) console.error(`  · ${p}`);
process.exit(1);
