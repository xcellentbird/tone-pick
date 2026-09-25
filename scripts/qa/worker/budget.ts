/**
 * 무대 워커의 하루 상한 (슬라이스 35 S-B2 → 슬라이스 37, ADR-97 후기 4 · ADR-99).
 *
 * 무대 워커에는 로그인이 없다 — 한국에서 주소를 아는 사람은 누구나 연다. 그래도 **프로덕션의 하루 한도는 지킨다.**
 * 무료 플랜의 한도는 계정 전체라 `tone-pick` 과 같이 쓴다. 바인딩으로 부른 QA 는 워커 요청으로 따로 세지 않지만,
 * QA 를 한 번 부를 때마다 **QA 의 DO 가 깨어 줄을 쓴다** — DO 요청도, 쓴 줄도 하루 10만이다.
 *
 * **QA 를 부른 횟수로 센다.** 처음엔 무대 세우기와 명령을 따로 셌는데(후기 4), 무대가 100명까지 커지고
 * 콕 뿌리기처럼 한 줄이 40번을 부르는 명령이 생기면서 "명령 한 번" 이 더는 끝을 말하지 못했다.
 * 요청마다 **몫을 먼저 받고**(`grant`), 쓰고 남은 것은 돌려준다. 이 워커 자신의 DO 왕복도 요청 하나에
 * `OVERHEAD` 만큼 함께 센다.
 *
 * 다 쓰면 어디까지 가나 — 두 한도를 따로 셈한다. 둘 다 **하루 한도의 10% 안**이 목표다.
 *  - DO 요청 — 로컬 추적으로 쟀다 (ADR-97 후기 4). QA 를 한 번 부르면 QA 의 DO 가 1.6번쯤 깬다
 *    (12명 무대 = QA 33번 · DO 53번). `DAILY` 를 다 써도 4,800번 남짓, 5% 다
 *  - 쓴 줄 — 추적에 줄 수가 안 나와 **코드에서 셌다.** 등록 한 명이 6~7줄(참가자 · 토큰 · PIN 과 색인), 명단 한 줄.
 *    무대 세우기에 몫을 다 쓰는 날이 가장 나쁘다 — 몫 하나에 3.5줄쯤, `DAILY` 면 1만 줄 남짓, 10% 다
 * 100명 무대 하나가 230쯤 드니 하루에 열두 번 남짓이다 (ADR-99). `DAILY` 를 올리려면 이 셈부터 다시 한다.
 *
 * 하루는 **UTC** 로 끊는다. Cloudflare 의 하루 한도가 00:00 UTC(한국 오전 9시)에 다시 찬다.
 */
export const DAILY = 3_000;

/** 요청 하나마다 이 워커가 스스로 쓰는 몫 — 로비에 몫을 받고 돌려주는 왕복과 무대 DO 하나 */
export const OVERHEAD = 3;

/** 하루의 이름. 한도가 다시 차는 시각에 바뀐다 */
export const quotaDay = (now: number): string => new Date(now).toISOString().slice(0, 10);

/**
 * 오늘 `used` 만큼 썼을 때 `want` 를 달라고 하면 얼마를 주나. `OVERHEAD` 도 못 채우면 **0** — 아무것도 안 준다.
 * 모자라면 있는 만큼만 준다 — 그 요청은 가다가 막히고, 막힌 줄은 로그에 남는다.
 */
export function grant(used: number, want: number): number {
  const left = Math.max(0, DAILY - used);
  const n = Math.min(want, left);
  return n > OVERHEAD ? n : 0;
}

/** 무대 하나를 세우는 데 드는 어림 — 로그인·회차·명단, 한 명에 두 번, 파티까지 가는 걸음, 요청마다의 몫 */
export const buildCost = (people: number, batches: number): number => 12 + 2 * people + OVERHEAD * (batches + 2);

export const refusal = (): string =>
  `오늘 쓸 수 있는 QA 호출 ${DAILY.toLocaleString("ko-KR")}번을 다 썼어요. 오전 9시가 지나면 다시 채워져요.`;

export const tooBig = (need: number, left: number): string =>
  `이 무대는 QA 호출이 ${need.toLocaleString("ko-KR")}번쯤 드는데 오늘은 ${left.toLocaleString("ko-KR")}번 남았어요. 인원을 줄이거나 오전 9시가 지나면 다시 세워주세요.`;
