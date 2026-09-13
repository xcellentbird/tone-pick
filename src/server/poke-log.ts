/**
 * 콕 로그 파일 (ADR-84). 찌름·되돌림이 일어날 때마다 R2 의 `poke-logs/<회차id>.csv` 에 한 줄씩 붙는다.
 *
 * **앱에는 꺼내는 길이 없다.** 운영자가 Cloudflare 에서 직접 받는다 — ADR-82 의 CSV 라우트를 걷어낸
 * 이유가 이것이다. 운영자 세션 하나로 누가 누구를 일방적으로 좋아했는지가 내려오는 문을 두지 않는다.
 *
 * ⚠️ **실명이 담긴, 회차 DO 밖의 유일한 자료다.** 회차를 지워도 남는다 — 운영자가 고른 대가다.
 * 칸을 더할 때 전화·인스타는 넣지 마라. 새면 돌이킬 수 없다.
 *
 * **던지지 않는다.** 로그를 쓰다 실패해서 콕이 깨지면 본말이 뒤바뀐다 (`metrics.ts` 와 같은 약속).
 */
import { POKE_LOG } from "../shared/copy.ts";
import type { Gender, PokeRound } from "../shared/types.ts";

export interface PokeLogSide {
  nickname: string;
  realName: string;
  gender: Gender;
  age: number;
}

export interface PokeLogEntry {
  kind: keyof typeof POKE_LOG.kind;
  round: PokeRound;
  at: number;
  from: PokeLogSide;
  to: PokeLogSide;
}

export const pokeLogKey = (eventId: string) => `poke-logs/${eventId}.csv`;

/** 쉼표·따옴표·줄바꿈이 든 칸만 따옴표로 싼다 */
function csvLine(cells: ReadonlyArray<string>): string {
  // copy-ok — CSV 따옴표 규칙(정규식)이지 화면 문구가 아니다
  const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return cells.map(cell).join(",") + "\r\n";
}

/** 한국 시각. 서머타임이 없어 고정 오프셋으로 충분하다 */
const kst = (at: number) => new Date(at + 9 * 3600_000).toISOString().replace("T", " ").slice(0, 19);

const side = (p: PokeLogSide) => [p.nickname, p.realName, POKE_LOG.gender[p.gender], String(p.age)];

export function pokeLogLine(e: PokeLogEntry): string {
  return csvLine([kst(e.at), POKE_LOG.kind[e.kind], POKE_LOG.round[e.round], ...side(e.from), ...side(e.to)]);
}

/**
 * 한 줄 덧붙인다. R2 에는 덧붙이기가 없어 읽고 → 붙여 → 다시 쓴다.
 *
 * ⚠️ **부르는 쪽이 한 줄로 세워야 한다** (EventDO.logPoke). R2 를 기다리는 동안 DO 는 다음 요청을
 * 받으므로, 두 콕이 같은 파일을 나란히 읽으면 뒤에 쓴 쪽이 앞의 줄을 덮는다.
 * 읽기가 실패하면 던져서 **쓰지 않는다** — 빈 파일로 덮으면 지난 줄이 전부 사라진다.
 */
export async function appendPokeLog(bucket: R2Bucket, eventId: string, line: string): Promise<void> {
  const key = pokeLogKey(eventId);
  const prev = await bucket.get(key);
  // 엑셀이 한글을 읽도록 BOM 을 앞에 둔다 — 파일이 처음 생길 때 한 번
  const head = prev ? await prev.text() : "\uFEFF" + csvLine(POKE_LOG.headers);
  await bucket.put(key, head + line, { httpMetadata: { contentType: "text/csv; charset=utf-8" } });
}
