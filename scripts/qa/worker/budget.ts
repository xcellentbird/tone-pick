/**
 * 무대 워커의 하루 상한 (슬라이스 35 S-B2, ADR-97 후기 4).
 *
 * 무대 워커에는 로그인이 없다 — 한국에서 주소를 아는 사람은 누구나 연다. 그래도 **프로덕션의 하루 한도는 지킨다.**
 * 무료 플랜의 한도는 계정 전체라 `tone-pick` 과 같이 쓴다. 바인딩으로 부른 QA 는 워커 요청으로 따로 세지 않지만,
 * QA 를 한 번 부를 때마다 **QA 의 DO 가 깨어 줄을 쓴다** — DO 요청도, 쓴 줄도 하루 10만이다.
 * 무대 하나를 세우는 요청 하나가 QA 를 서른 번 넘게 부르므로, 누르는 횟수를 세야 그 끝이 보인다.
 *
 * 다 쓰면 어디까지 가나 — 두 워커를 붙여 로컬에서 쟀다 (ADR-97 후기 4). 12명짜리 무대를 파티까지 세우면
 * QA 를 33번 부르고 DO 가 53번 깬다. 가장 비싼 명령(`lock`)은 QA 5번에 DO 10번, 여기에 이 워커의 DO 가
 * 다섯 번(명령 셋 + 로그 다시 읽기 둘) 더한다. 20 × 60 + 500 × 15 ≈ **8,700 — 하루 DO 요청 한도의 9% 가 끝이다.**
 * QA 를 여러 번 부르는 명령을 더하거나 인원 상한(`PEOPLE_MAX`)을 올릴 때는 이 셈부터 다시 한다.
 *
 * 하루는 **UTC** 로 끊는다. Cloudflare 의 하루 한도가 00:00 UTC(한국 오전 9시)에 다시 찬다.
 */
export const DAILY = { stage: 20, command: 500 } as const;
export type Spend = keyof typeof DAILY;

/** 하루의 이름. 한도가 다시 차는 시각에 바뀐다 */
export const quotaDay = (now: number): string => new Date(now).toISOString().slice(0, 10);

/** 오늘 `used` 번 썼을 때 한 번 더 써도 되면 `null`, 안 되면 사람에게 할 말 */
export function refusal(kind: Spend, used: number): string | null {
  if (used < DAILY[kind]) return null;
  return kind === "stage"
    ? `무대는 하루에 ${DAILY.stage}번까지 세울 수 있어요. 오전 9시가 지나면 다시 세워주세요.`
    : `명령은 하루에 ${DAILY.command}번까지 칠 수 있어요. 오전 9시가 지나면 다시 쳐주세요.`;
}
