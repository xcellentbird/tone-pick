/**
 * 이상형 찾기를 열어도 되는 빌드인가 (슬라이스 19, S-C5).
 *
 * **사진 출처를 확보하기 전에는 화면을 열지 않는다** (S-C5). 자산(`public/faces/v{n}/`)은 코드와 따로 오고,
 * 코드가 먼저 qa 로 가면(자동 머지·자동 배포) 카드를 누른 사람 모두가 `불러오지 못했어요` 만 본다 —
 * 그리고 그 기기에는 폴백 HTML 이 JSON 주소에 박힐 수 있다 (`public/_headers` 의 경고).
 *
 * 그래서 **문을 빌드가 연다.** `vite.config.ts` 가 빌드하는 순간 지금 판(`IDEAL_ASSET_V`)의 두 풀 JSON 이
 * 있는지 보고 이 값을 박는다 — 자산이 들어온 커밋이 곧 여는 커밋이다. 따로 켤 스위치를 두지 않는다:
 * 스위치는 자산 없이 켤 수 있고, 그게 바로 막으려던 일이다.
 *
 * 값을 모르는 번들(define 이 없는 도구)에서는 닫힌다 — 여는 쪽이 증거를 대야 한다.
 */
declare const __IDEAL_FACES__: boolean;

export const FACES_READY: boolean = typeof __IDEAL_FACES__ !== "undefined" && __IDEAL_FACES__ === true;
