/**
 * 운영자 뽑기 — 콕 이력 CSV (ADR-82).
 *
 * **화면이 아니라 파일이다.** 운영 중 콘솔에 누가 누구를 찔렀는지 띄우지 않는 것은 ADR-22 의
 * 결정이고(알면 그 사람을 다르게 대하게 된다), 이건 끝나고 돌아보는 도구다.
 * 그래서 콘솔에 버튼이 없다 — 운영자 세션으로 주소를 열거나 `scripts/export-pokes.mjs` 로 받는다.
 */
import { HOST_CSV } from "../shared/copy.ts";
import type { HostPokeRow, HostPokeSide } from "../shared/types.ts";

/** 쉼표·따옴표·줄바꿈이 든 칸만 따옴표로 싼다. 엑셀이 한글을 읽도록 BOM 을 앞에 둔다 */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<string>>): string {
  // copy-ok — CSV 따옴표 규칙(정규식)이지 화면 문구가 아니다
  const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return "\uFEFF" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** 한국 시각. 서머타임이 없어 고정 오프셋으로 충분하다 */
const kst = (at: number) => new Date(at + 9 * 3600_000).toISOString().replace("T", " ").slice(0, 19);

function side(p: HostPokeSide | null): string[] {
  if (!p) return [HOST_CSV.gone, "", "", ""];
  return [p.nickname, p.realName, HOST_CSV.gender[p.gender], String(p.age)];
}

export function pokeCsv(rows: HostPokeRow[]): string {
  return toCsv([
    HOST_CSV.headers,
    ...rows.map((r) => [
      HOST_CSV.round[r.round],
      kst(r.at),
      ...side(r.from),
      ...side(r.to),
      r.mutual ? HOST_CSV.yes : HOST_CSV.no,
    ]),
  ]);
}
