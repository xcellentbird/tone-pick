// Luna 로 연예인 후보를 뽑는다 — 나무위키 문서 제목까지. 이후 fetch 단계가 검증한다.
// node candidates.mjs
//
// 읽는 것: OPENAI_API_KEY (환경)
// 쓰는 것: ${WORK}/out/candidates-{f,m}.json — 이름 · 나무위키 제목 · 출생 연도 · 직업 · 범주
// 순서: 1 — 맨 처음. 다시 돌리면 명단이 바뀐다(LLM). 한 번 뽑은 명단을 두고 뒤 단계만 다시 도는 것이 보통이다
import fs from "node:fs";
import { OUT } from "./work.mjs";
const KEY = process.env.OPENAI_API_KEY;
fs.mkdirSync(OUT, { recursive: true });

const BUCKETS = {
  f: [
    "여자 배우, 1975~1987년생",
    "여자 배우, 1988~2005년생",
    "여자 아이돌 멤버·솔로 여가수, 1985~1995년생",
    "여자 아이돌 멤버·솔로 여가수, 1996~2006년생",
    "여자 방송인·모델·예능인·가수(아이돌 제외), 1975~2000년생",
  ],
  m: [
    "남자 배우, 1972~1986년생",
    "남자 배우, 1987~2003년생",
    "남자 아이돌 멤버·솔로 남가수, 1985~1995년생",
    "남자 아이돌 멤버·솔로 남가수, 1996~2006년생",
    "남자 방송인·모델·예능인·가수(아이돌 제외)·운동선수, 1972~2000년생",
  ],
};

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["people"],
  properties: {
    people: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "namu", "born", "job"],
        properties: {
          name: { type: "string" },
          namu: { type: "string" },
          born: { type: "integer" },
          job: { type: "string" },
        },
      },
    },
  },
};

async function ask(bucket, exclude) {
  const prompt = `대한민국의 20~30대가 얼굴을 보면 대부분 알아보는 유명인을 뽑는다. 범주: ${bucket}.
- 70명. 최근(2020~2026) 활동으로 얼굴이 널리 알려진 사람을 우선한다.
- 인상이 한쪽으로 몰리지 않게 — 다양한 얼굴형과 분위기가 섞이게.
- 한국인(한국에서 활동하는 한국 국적)만. 그룹 이름이 아니라 사람 한 명씩.
- namu: 나무위키 문서의 정확한 제목. 동명이인이 있으면 나무위키가 쓰는 괄호 구분자를 붙인다 (예: '수지(1994)', '김태리'). 모르면 이름 그대로.
- born: 출생 연도. job: 배우/가수/아이돌/방송인/모델/운동선수 중 대표 하나.
- 이미 뽑힌 사람은 제외: ${exclude.join(", ") || "(없음)"}`;
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "gpt-6-luna",
      reasoning: { effort: "medium" },
      input: prompt,
      text: { format: { type: "json_schema", name: "people", schema, strict: true } },
    }),
  });
  const d = await res.json();
  if (d.error) throw new Error(JSON.stringify(d.error));
  const msg = d.output.find((o) => o.type === "message");
  return JSON.parse(msg.content[0].text).people;
}

for (const g of ["f", "m"]) {
  const all = [];
  for (const b of BUCKETS[g]) {
    const got = await ask(b, all.map((p) => p.name));
    for (const p of got) if (!all.some((q) => q.name === p.name)) all.push({ ...p, bucket: b });
    console.log(g, b, got.length, "→", all.length);
  }
  fs.writeFileSync(`${OUT}candidates-${g}.json`, JSON.stringify(all, null, 1));
}
