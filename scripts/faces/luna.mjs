// gpt-6-luna 호출 공용 — 이미지(파일 경로) + 스키마 → JSON
//
// 읽는 것: 환경 변수 OPENAI_API_KEY (환경에서만 — 파일에 적지 않는다. 저장소 뿌리에서 `set -a; . ./.env; set +a`)
// 쓰는 것: 없음
// 순서: 공용 — candidates 를 뺀 LLM 을 부르는 모든 단계가 쓴다 (QC · 속성 고르기 · 임베딩 · 웹 검색 · 종이 검증 · 직업)
// 모델은 gpt-6-luna 가 기본이다. 다른 모델을 부르는 단계는 그 이유를 자기 머리에 적는다 (roles)
import fs from "node:fs";
import path from "node:path";

const KEY = process.env.OPENAI_API_KEY;
const MIME = { webp: "image/webp", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif" };

export function dataUrl(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  return `data:${MIME[ext] || "image/jpeg"};base64,${fs.readFileSync(file).toString("base64")}`;
}

export async function luna({ text, images = [], schema, name = "out", effort = "low", tools, model = "gpt-6-luna" }) {
  const content = [{ type: "input_text", text }];
  for (const im of images) {
    if (typeof im === "string") content.push({ type: "input_image", image_url: dataUrl(im), detail: "high" });
    else content.push(im);
  }
  const body = {
    model,
    reasoning: { effort },
    input: [{ role: "user", content }],
  };
  if (schema) body.text = { format: { type: "json_schema", name, schema, strict: true } };
  if (tools) body.tools = tools;
  for (let i = 0; i < 6; i++) {
    let d;
    try {
      const res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      d = await res.json().catch(() => ({ error: { message: `status ${res.status}` } }));
    } catch (e) {
      // 망 끊김(fetch failed)도 다시 부른다 — API 오류만 다시 부르면 한 번 끊긴 호출이 빈칸으로 남는다
      d = { error: { message: String(e) } };
    }
    if (d.error) {
      if (i < 5) {
        await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
        continue;
      }
      throw new Error(JSON.stringify(d.error));
    }
    const msg = d.output.find((o) => o.type === "message");
    const t = msg?.content?.find((c) => c.type === "output_text")?.text ?? "";
    return { value: schema ? JSON.parse(t) : t, usage: d.usage, raw: d };
  }
}

export async function embed(texts, dimensions = 256) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-large", input: texts, dimensions }),
  });
  const d = await res.json();
  if (d.error) throw new Error(JSON.stringify(d.error));
  return d.data.map((x) => x.embedding);
}

/** 동시에 n 개씩 */
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const i = next++;
        try {
          out[i] = await fn(items[i], i);
        } catch (e) {
          out[i] = { error: String(e) };
        }
      }
    }),
  );
  return out;
}

const bool = { type: "boolean" };
const str = { type: "string" };

export const QC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["people", "face_clear", "angle", "heavy_styling", "styling_note", "occluded", "photo_quality"],
  properties: {
    people: { type: "integer", description: "사진에 얼굴이 또렷이 보이는 사람 수" },
    face_clear: bool,
    angle: { type: "string", enum: ["front", "slight", "side"] },
    heavy_styling: bool,
    styling_note: str,
    occluded: bool,
    photo_quality: { type: "string", enum: ["good", "ok", "poor"] },
  },
};

export const QC_PROMPT = `이 사진을 '얼굴 고르기' 카드에 쓸 수 있는지 판정한다. 누구인지 알아보거나 이름을 말하지 않는다 — 사진의 상태만 본다.
- people: 얼굴이 또렷이 보이는 사람 수
- face_clear: 얼굴이 흐리거나 너무 작거나 잘리지 않고 이목구비가 잘 보이는가
- angle: 정면(front) · 살짝 돌아감(slight, 두 눈이 모두 온전히 보임) · 측면(side, 한쪽 눈이 가려지거나 크게 돌아감)
- heavy_styling: 평소 얼굴과 동떨어진 진한 꾸밈인가 — 무대·화보용 진한 색조 화장(짙은 색 아이섀도·글리터·과한 컨투어), 콘셉트 분장, 특이한 소품·의상이 얼굴을 덮음, 얼굴을 바꿔놓는 강한 보정·필터. 일상적인 화장·자연스러운 프로필 사진은 false
- styling_note: 판단 근거 한 줄
- occluded: 선글라스·마스크·손·모자·머리카락이 눈이나 얼굴 일부를 가리는가
- photo_quality: 해상도·초점·조명`;

export const DESC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["impression", "vibe", "face_shape", "eyes", "brows", "nose", "lips", "jaw", "skin", "features", "age_feel", "hair", "summary"],
  properties: {
    impression: { ...str, description: "동물상 등 한국어 인상 유형 1~2개 (강아지상·고양이상·여우상·토끼상·곰상·사슴상·공룡상·두부상·늑대상 등)" },
    vibe: { ...str, description: "분위기 형용사 2~4개" },
    face_shape: str,
    eyes: { ...str, description: "크기·쌍꺼풀·눈꼬리·눈매" },
    brows: str,
    nose: str,
    lips: str,
    jaw: { ...str, description: "턱선·광대" },
    skin: { ...str, description: "피부 톤·결" },
    features: { ...str, description: "이목구비가 진한지 순한지, 조화" },
    age_feel: { ...str, description: "동안·성숙 등 나이 느낌" },
    hair: { ...str, description: "길이·앞머리·색 — 짧게" },
    summary: { ...str, description: "첫인상 한 문장" },
  },
};

export const DESC_PROMPT = `이 얼굴 사진의 외모를 한국어로 묘사한다. 목적: 사람들이 '끌리는 얼굴' 을 고르면 비슷한 인상의 얼굴을 찾아 주는 것.
- 누구인지 알아보거나 이름·직업을 말하지 않는다. 보이는 얼굴만 쓴다
- 평가하지 않는다 (예쁘다·잘생겼다·못생겼다 금지). 모양과 인상을 쓴다
- 사진마다 달라지는 것(표정·조명·배경·옷)보다 그 사람 얼굴에 늘 있는 특징을 앞세운다
- 각 칸은 짧은 구절로. 흔한 말보다 이 얼굴을 다른 얼굴과 갈라주는 말을 고른다`;

export function descText(d) {
  return [
    `인상: ${d.impression}`,
    `분위기: ${d.vibe}`,
    `얼굴형: ${d.face_shape}`,
    `눈: ${d.eyes}`,
    `눈썹: ${d.brows}`,
    `코: ${d.nose}`,
    `입술: ${d.lips}`,
    `턱선: ${d.jaw}`,
    `피부: ${d.skin}`,
    `이목구비: ${d.features}`,
    `나이 느낌: ${d.age_feel}`,
    `머리: ${d.hair}`,
    `첫인상: ${d.summary}`,
  ].join("\n");
}
