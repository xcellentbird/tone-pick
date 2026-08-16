/**
 * 마감·발표 카운트다운은 서버 시각 기준이어야 한다.
 * 클라이언트 시계를 그대로 쓰면 폰 시간을 바꿔서 결과를 먼저 볼 수 있다.
 */
let offset = 0;

export function syncFromResponse(res: Response) {
  const t = Number(res.headers.get("x-server-time"));
  if (Number.isFinite(t) && t > 0) offset = t - Date.now();
}

export function now(): number {
  return Date.now() + offset;
}

