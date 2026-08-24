/**
 * 회차 목록을 들고 있는 단 하나의 DO.
 *
 * 여기서만 정해지는 것: 입장 코드의 유일성 · 멱등키 · 기본 설정.
 * 앞의 둘은 "동시에 두 번 눌렀을 때 하나만 만들어져야" 하므로 강한 일관성이 필요하다.
 * KV 는 쓰기 직후 읽기가 보장되지 않아 코드 중복·회차 중복이 실제로 날 수 있다 — 그래서 DO 다.
 *
 * 참가자 개인정보는 여기 오지 않는다. 이름·전화·콕은 전부 회차 DO 안에만 있다.
 */
import { DurableObject } from "cloudflare:workers";
import type { Defaults } from "../shared/types.ts";
import { DEFAULTS, withDefaults } from "../shared/constants.ts";
import { genCode, randomHex } from "./auth.ts";

export interface EventIndexEntry {
  id: string;
  code: string;
  createdAt: number;
}

interface Snapshot {
  defaults: Defaults;
  events: EventIndexEntry[];
  requests: Record<string, string>;   // requestId -> eventId
  /** 테스트 전용 시간 이동 오프셋. 프로덕션에서는 항상 0 이다 */
  clockOffset: number;
}

export interface ReserveInput {
  code?: string;
  requestId: string;
  now: number;
}

export type ReserveResult =
  | { ok: true; id: string; code: string; reused: boolean }
  | { ok: false; error: "code_taken" };

const EMPTY: Snapshot = {
  defaults: DEFAULTS,
  events: [],
  requests: {},
  clockOffset: 0,
};

/**
 * 상태를 메모리에 캐시하지 않고 매번 스토리지에서 읽는다.
 * DO 는 요청을 순차 처리하므로 경쟁이 없고, 캐시가 스토리지와 어긋날 여지를 아예 없앤다.
 */
export class RegistryDO extends DurableObject {
  /**
   * 저장된 자료는 코드보다 오래 산다.
   *
   * 항목을 하나씩 골라 읽는다 — 통째로 펼치면 옛 모양이 그대로 올라온다.
   * 실제로 그래서 기본 설정 화면의 숫자 칸이 NaN 이 됐고, 쓰지 않게 된 운영자 PIN 이
   * 스토리지에 남아 다음 저장 때 다시 쓰였다. **안 쓰는 비밀은 들고 있지 않는다.**
   */
  private async load(): Promise<Snapshot> {
    const saved = await this.ctx.storage.get<Snapshot>("snap");
    return {
      defaults: withDefaults(saved?.defaults),
      events: saved?.events ?? EMPTY.events,
      requests: saved?.requests ?? EMPTY.requests,
      clockOffset: saved?.clockOffset ?? EMPTY.clockOffset,
    };
  }

  private async save(snap: Snapshot) {
    await this.ctx.storage.put("snap", snap);
  }

  // ─────────────────────────── 테스트 전용 시간 이동
  //
  // 오프셋을 Worker 의 모듈 변수에 두면 요청 사이에 남아 다음 테스트까지 끌고 간다.
  // 회차 상태와 같은 곳에 두어야 "시간을 되돌리는 것"이 상태를 되돌리는 것과 같아진다.

  async clockOffset(): Promise<number> {
    return (await this.load()).clockOffset;
  }

  async setClockOffset(offset: number): Promise<number> {
    const snap = await this.load();
    snap.clockOffset = offset;
    await this.save(snap);
    return offset;
  }

  // ─────────────────────────── 기본 설정

  async getDefaults(): Promise<Defaults> {
    return (await this.load()).defaults;
  }

  async putDefaults(next: Defaults): Promise<Defaults> {
    const snap = await this.load();
    snap.defaults = {
      maxPre: next.maxPre,
      maxParty: next.maxParty,
      // 빈 장소는 그대로 둔다 — "회차마다 다른 곳에서 연다" 는 뜻이다 (ADR-36)
      place: next.place ?? "",
      prevoteBeforeH: next.prevoteBeforeH,
      voteEndBeforeH: next.voteEndBeforeH,
      // 빈 문구를 저장하면 안내문이 링크 없이 나간다. 비면 기본 문구로 되돌린다
      inviteTemplate: next.inviteTemplate?.trim() ? next.inviteTemplate : DEFAULTS.inviteTemplate,
    };
    await this.save(snap);
    return snap.defaults;
  }

  /** 기본값만 되돌린다. 이미 만든 회차는 건드리지 않는다 (S-B9) */
  async resetDefaults(): Promise<Defaults> {
    const snap = await this.load();
    snap.defaults = DEFAULTS;
    await this.save(snap);
    return snap.defaults;
  }

  // ─────────────────────────── 회차 목록

  async listEvents(): Promise<EventIndexEntry[]> {
    return (await this.load()).events;
  }

  async idByCode(code: string): Promise<string | null> {
    const upper = code.toUpperCase();
    return (await this.load()).events.find((e) => e.code === upper)?.id ?? null;
  }

  async hasEvent(eventId: string): Promise<boolean> {
    return (await this.load()).events.some((e) => e.id === eventId);
  }

  /**
   * 회차의 신원(아이디·입장 코드)만 먼저 잡는다. 실제 상태는 회차 DO 가 만든다.
   * 같은 requestId 로 두 번 오면 새로 만들지 않고 이미 잡아둔 것을 돌려준다 (S-B7).
   */
  async reserve(input: ReserveInput): Promise<ReserveResult> {
    const snap = await this.load();
    const known = snap.requests[input.requestId];
    if (known) {
      const entry = snap.events.find((e) => e.id === known);
      if (entry) return { ok: true, id: entry.id, code: entry.code, reused: true };
    }

    let code: string;
    if (input.code) {
      code = input.code.toUpperCase();
      if (snap.events.some((e) => e.code === code)) return { ok: false, error: "code_taken" };
    } else {
      code = freeCode(snap);
    }

    const id = randomHex(8);
    snap.events.push({ id, code, createdAt: input.now });
    snap.requests[input.requestId] = id;
    await this.save(snap);
    return { ok: true, id, code, reused: false };
  }

  async removeEvent(eventId: string): Promise<void> {
    const snap = await this.load();
    snap.events = snap.events.filter((e) => e.id !== eventId);
    for (const [req, id] of Object.entries(snap.requests)) {
      if (id === eventId) delete snap.requests[req];
    }
    await this.save(snap);
  }
}

function freeCode(snap: Snapshot): string {
  for (let i = 0; i < 100; i++) {
    const code = genCode();
    if (!snap.events.some((e) => e.code === code)) return code;
  }
  // 32^6 중에서 100번 연속 겹칠 수는 없다. 여기 왔다면 조용히 넘기지 않는다
  throw new Error("code generation failed");
}
