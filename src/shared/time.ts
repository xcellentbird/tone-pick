/**
 * 시각·기간 포매팅. 문구 조립은 `copy.ts` 가 하고, 여기서는 숫자를 문자열로 만들기만 한다.
 *
 * 서버는 파티가 열리는 지역 시각(EVENT_TZ)으로 찍는다 — 운영자와 참가자가 같은 도시에 있고,
 * 안내 문구의 "9시"가 서버가 어디서 도느냐에 따라 달라지면 안 되기 때문이다.
 * 클라이언트는 브라우저 시간대를 그대로 쓴다.
 */
import { DURATION } from "./copy.ts";

export const EVENT_TZ = "Asia/Seoul";

const dateTime = new Intl.DateTimeFormat("ko-KR", {
  timeZone: EVENT_TZ,
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const timeOnly = new Intl.DateTimeFormat("ko-KR", {
  timeZone: EVENT_TZ,
  hour: "numeric",
  minute: "2-digit",
});

/** "8월 11일 오후 9:00" */
export function formatWhen(ts?: number): string {
  return ts ? dateTime.format(new Date(ts)) : "";
}

/** "오후 9:00" */
export function formatClock(ts?: number): string {
  return ts ? timeOnly.format(new Date(ts)) : "";
}

/** 남은 시간. 1시간 이상은 시·분, 그 아래는 분·초 */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? DURATION.hourMin(h, m) : DURATION.minSec(m, s);
}

/** 예약과 수동 진행의 차이. 분 단위로 보여준다 (UI.md) */
export function formatGap(ms: number): string {
  const min = Math.round(Math.abs(ms) / 60_000);
  return min >= 60 ? DURATION.hourMin(Math.floor(min / 60), min % 60) : DURATION.minOnly(min);
}

/** `<input type="datetime-local">` 이 읽는 형식. 브라우저 시간대 기준 */
export function toLocalInput(ts?: number): string {
  if (!ts) return "";
  const d = new Date(ts - new Date(ts).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

export function fromLocalInput(value: string): number | undefined {
  if (!value) return undefined;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : undefined;
}
