/**
 * 슬라이스 19 — 이상형 찾기의 픽스처 풀 (표면 문서의 '픽스처 풀').
 *
 * 실제 자산이 오기 전에 순수 함수를 돌리는 지어낸 풀이다. 벡터는 전부 **2차원 단위원
 * 위의 각도**로 만든다 — 코사인 내림차순이 곧 각도 차이 오름차순이라 기대 순서를
 * 손으로 셈할 수 있다. 동률(같은 거리)이 안 생기게 각도를 일부러 벌려 뒀다.
 *
 * ⚠️ 기하가 곧 테스트 재료다. 각도를 바꾸면 19-ideal-type.test.ts 의 기대값이 같이 틀어진다.
 *
 *   1단계(6)   0° 부터 60° 간격 — 1라운드의 그 여섯 (v1 모양이라 첫 화면 묶음이 없다)
 *   2단계(12)  10° 부터 30° 간격 — 1단계 각도와 어긋나게 두어 어느 평균에서도 동률이 없다
 *   3단계(9)   3°·6°·8° 닮은꼴 셋 (dupCos 밀어내기 재료) + 50°·85°·150°·210°·265°·330°
 *
 * 실사 결정(S-C5)대로 celebs 와 faces 는 같은 사람들이다 — id 가 온전히 겹친다.
 * 단색 사진은 화면 테스트가 붙을 때 이 폴더에 온다. 순수 함수는 벡터만 본다.
 */
import type { FacePoolFile } from "../../../src/shared/ideal.ts";

/** int8 배열 → base64. 자산 파이프라인이 쓰는 것과 같은 부호화다 */
export function b64int8(bytes: readonly number[]): string {
  return btoa(String.fromCharCode(...bytes.map((b) => b & 0xff)));
}

const SCALE = 127;

/** 단위원 위 deg° 를 int8 로 양자화해 부호화한다 */
export function enc(deg: number): string {
  const r = (deg * Math.PI) / 180;
  return b64int8([Math.round(Math.cos(r) * SCALE), Math.round(Math.sin(r) * SCALE)]);
}

const FACE_DEGS: { id: string; deg: number; level: 1 | 2 | 3 }[] = [
  // 1단계 — 자산 순서가 곧 1라운드 순서다
  { id: "f000", deg: 0, level: 1 },
  { id: "f060", deg: 60, level: 1 },
  { id: "f120", deg: 120, level: 1 },
  { id: "f180", deg: 180, level: 1 },
  { id: "f240", deg: 240, level: 1 },
  { id: "f300", deg: 300, level: 1 },
  // 2단계
  { id: "f010", deg: 10, level: 2 },
  { id: "f040", deg: 40, level: 2 },
  { id: "f070", deg: 70, level: 2 },
  { id: "f100", deg: 100, level: 2 },
  { id: "f130", deg: 130, level: 2 },
  { id: "f160", deg: 160, level: 2 },
  { id: "f190", deg: 190, level: 2 },
  { id: "f220", deg: 220, level: 2 },
  { id: "f250", deg: 250, level: 2 },
  { id: "f280", deg: 280, level: 2 },
  { id: "f310", deg: 310, level: 2 },
  { id: "f340", deg: 340, level: 2 },
  // 3단계
  { id: "f003", deg: 3, level: 3 },
  { id: "f006", deg: 6, level: 3 },
  { id: "f008", deg: 8, level: 3 },
  { id: "f050", deg: 50, level: 3 },
  { id: "f085", deg: 85, level: 3 },
  { id: "f150", deg: 150, level: 3 },
  { id: "f210", deg: 210, level: 3 },
  { id: "f265", deg: 265, level: 3 },
  { id: "f330", deg: 330, level: 3 },
];

export const POOL: FacePoolFile = {
  version: 1,
  dim: 2,
  scale: SCALE,
  celebs: FACE_DEGS.map(({ id, deg }) => ({ id, name: `n${id}`, v: enc(deg) })),
  faces: FACE_DEGS.map(({ id, deg, level }) => ({ id, v: enc(deg), level })),
};
