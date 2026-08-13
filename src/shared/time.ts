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

/**
 * 남은 시간을 `01:10:45` 로. 초가 움직여야 마감이 다가오는 게 눈에 보인다.
 *
 * "13시간 42분"은 1분에 한 번 바뀌어서 멈춘 화면처럼 보인다. 파티 중에 참가자가
 * 가장 자주 보는 숫자라 움직이는 편이 낫다.
 *
 * 시간은 24를 넘어도 그대로 쓴다 (37:12:04). 날짜로 접으면 "며칠 남았지" 를
 * 다시 계산하게 만든다.
 */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

/** 예약과 수동 진행의 차이. 분 단위로 보여준다 (UI.md) */
export function formatGap(ms: number): string {
  const min = Math.round(Math.abs(ms) / 60_000);
  return min >= 60 ? DURATION.hourMin(Math.floor(min / 60), min % 60) : DURATION.minOnly(min);
}

/**
 * 일정은 30분 단위로만 고른다.
 *
 * 파티 일정은 "21:00 / 21:30" 으로 잡히지 21:07 로 잡히지 않는다. 분 단위로 열어두면
 * 고를 것만 많아지고, 안내 문구에도 어중간한 시각이 그대로 나간다.
 *
 * 실제 전환 시각(`fired`)은 그대로 초 단위다 — 그건 사람이 고른 값이 아니라 일어난 일이라서.
 *
 * epoch 를 그대로 반올림해도 우리 시간대(+09:00)에서는 :00/:30 에 맞는다.
 * 30분이 아닌 오프셋을 쓰는 지역(예: +05:45)까지 노린다면 이 계산을 시간대 기준으로 바꿔야 한다.
 */
export const SCHEDULE_STEP_MIN = 30;
const STEP = SCHEDULE_STEP_MIN * 60_000;

export function snapSchedule(ts: number, dir: "near" | "up" = "near"): number {
  return (dir === "up" ? Math.ceil(ts / STEP) : Math.round(ts / STEP)) * STEP;
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
