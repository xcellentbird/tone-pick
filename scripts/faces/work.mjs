// 파이프라인의 자리 — 모든 스크립트가 여기서 경로를 받는다. 절대 경로를 스크립트에 박지 않는다.
//
// 읽는 것: 환경 변수 FACES_WORK (없으면 <저장소>/.faces-work)
// 쓰는 것: 없음
// 순서: 공용 (단계가 아니다)
//
// 작업 자료는 저장소에 들어가지 않는다 (.gitignore 의 .faces-work/) — 받은 사진·크롭·LLM 답이 전부 여기 있다.
//   ${WORK}/out/      단계마다 떨구는 JSON · 사진 · 크롭
//   ${WORK}/venv/     face.py 의 파이썬 (requirements.txt)
//   ${WORK}/models/   yunet.onnx · sface.onnx (face.py 머리의 주소)
// **남겨야 하는 것**(id 레지스트리 · 수동 제외 목록 · 판마다의 출처)은 이 폴더(scripts/faces/)에 둔다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `.pathname` 은 한글·빈칸이 든 경로를 %xx 로 남긴다 — fileURLToPath 로 푼다 (check-faces.mjs 와 같은 이유)
export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "../..");
export const WORK = path.resolve(process.env.FACES_WORK || path.join(REPO, ".faces-work"));
/** 끝에 / 가 붙어 있다 — `${OUT}raw-${g}` 처럼 이어 붙여 쓴다 */
export const OUT = path.join(WORK, "out") + path.sep;
export const PY = path.join(WORK, "venv", "bin", "python");
export const MODELS = path.join(WORK, "models");
export const FACE = path.join(HERE, "face.py");
/** 커밋되는 상태 */
export const REGISTRY = path.join(HERE, "registry.json");
export const EXCLUDE = path.join(HERE, "exclude.json");
export const DEFAULT_FACES = path.join(REPO, "public", "faces");

/**
 * 레코드(select · attrs · apool)에 적힌 절대 경로를 **지금 작업 폴더의 같은 파일**로 옮긴다.
 * 레코드는 만든 그 자리의 절대 경로를 담는다 — 작업 폴더를 옮기거나 복사(FACES_WORK)하면 옛 자리를 가리킨다.
 * `…/out/` 뒤를 지금 OUT 에 붙인다. 쓰는 쪽(크롭 다시 뜨기)에 쓴다 — 있는지 보지 않는다.
 */
export function workPath(p) {
  if (!p) return p;
  const i = p.lastIndexOf("/out/");
  return i < 0 ? p : OUT + p.slice(i + 5);
}

/**
 * 읽는 쪽 — 지금 작업 폴더에 그 파일이 있으면 그것, 없으면 적힌 그대로.
 * 옛 자리가 남아 있어도 **지금 작업 폴더를 먼저 본다** — 복사본으로 돌렸는데 원본을 읽으면 무엇을 검증했는지 알 수 없다.
 */
export function inWork(p) {
  const q = workPath(p);
  return q && q !== p && fs.existsSync(q) ? q : p;
}
