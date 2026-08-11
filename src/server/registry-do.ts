/**
 * 회차 목록을 들고 있는 단 하나의 DO.
 *
 * 여기서만 정해지는 것: 입장 코드의 유일성 · 회차 PIN · 멱등키 · 공통 PIN · 기본 설정.
 * 세 가지 모두 "동시에 두 번 눌렀을 때 하나만 만들어져야" 하므로 강한 일관성이 필요하다.
 * KV 는 쓰기 직후 읽기가 보장되지 않아 코드 중복·회차 중복이 실제로 날 수 있다 — 그래서 DO 다.
 *
 * 참가자 개인정보는 여기 오지 않는다. 이름·전화·콕은 전부 회차 DO 안에만 있다.
 */
import { DurableObject } from "cloudflare:workers";
import type { Defaults } from "../shared/types.ts";
import { DEFAULTS } from "../shared/constants.ts";
import { genCode, genPin, makePinRecord, pinCollides, randomHex, verifyPin, type PinRecord } from "./auth.ts";

export interface EventIndexEntry {
  id: string;
  code: string;
  createdAt: number;
}

interface Snapshot {
  defaults: Defaults;
  masterPin: string | null;   // null 이면 env.MASTER_PIN 을 쓴다
  events: EventIndexEntry[];
  pins: Record<string, PinRecord>;
  requests: Record<string, string>;   // requestId -> eventId
  /** 테스트 전용 시간 이동 오프셋. 프로덕션에서는 항상 0 이다 */
  clockOffset: number;
}

export interface ReserveInput {
  code?: string;
  pin?: string;
  requestId: string;
  masterPin: string;
  now: number;
}

export type ReserveResult =
  | { ok: true; id: string; code: string; reused: boolean }
  | { ok: false; error: "pin_collision" | "code_taken" };

const EMPTY: Snapshot = {
  defaults: DEFAULTS,
  masterPin: null,
  events: [],
  pins: {},
  requests: {},
  clockOffset: 0,
};

/**
 * 상태를 메모리에 캐시하지 않고 매번 스토리지에서 읽는다.
 * DO 는 요청을 순차 처리하므로 경쟁이 없고, 캐시가 스토리지와 어긋날 여지를 아예 없앤다.
 */
export class RegistryDO extends DurableObject {
  private async load(): Promise<Snapshot> {
    return { ...EMPTY, ...((await this.ctx.storage.get<Snapshot>("snap")) ?? {}) };
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

  async getMasterPin(envPin: string): Promise<string> {
    return (await this.load()).masterPin ?? envPin;
  }

  /**
   * 공통 PIN 을 기존 회차 PIN 과 같게 만들 수 없다.
   * 검사 시점(resolvePin)만으로는 부족하다 — 입력 시점에서도 막아야 두 겹이 된다 (ADR-3)
   */
  async putDefaults(next: Defaults, masterPin: string | undefined): Promise<Defaults | "pin_collision"> {
    const snap = await this.load();
    if (masterPin) {
      for (const rec of Object.values(snap.pins)) {
        if (await verifyPin(masterPin, rec)) return "pin_collision";
      }
      snap.masterPin = masterPin;
    }
    snap.defaults = {
      maxPre: next.maxPre,
      maxParty: next.maxParty,
      regOpenAfterH: next.regOpenAfterH,
      voteWindowH: next.voteWindowH,
    };
    await this.save(snap);
    return snap.defaults;
  }

  /** 콕 횟수와 일정 오프셋만 되돌린다. 공통 PIN 과 기존 회차는 건드리지 않는다 (S-B9) */
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

  async pinOf(eventId: string): Promise<PinRecord | null> {
    return (await this.load()).pins[eventId] ?? null;
  }

  async hasEvent(eventId: string): Promise<boolean> {
    return (await this.load()).events.some((e) => e.id === eventId);
  }

  /**
   * 회차의 신원(아이디·코드·PIN)만 먼저 잡는다. 실제 상태는 회차 DO 가 만든다.
   * 같은 requestId 로 두 번 오면 새로 만들지 않고 이미 잡아둔 것을 돌려준다 (S-B7).
   */
  async reserve(input: ReserveInput): Promise<ReserveResult> {
    const snap = await this.load();
    const known = snap.requests[input.requestId];
    if (known) {
      const entry = snap.events.find((e) => e.id === known);
      if (entry) return { ok: true, id: entry.id, code: entry.code, reused: true };
    }

    if (input.pin && pinCollides(input.pin, input.masterPin)) return { ok: false, error: "pin_collision" };

    let code: string;
    if (input.code) {
      code = input.code.toUpperCase();
      if (snap.events.some((e) => e.code === code)) return { ok: false, error: "code_taken" };
    } else {
      code = freeCode(snap);
    }

    const id = randomHex(8);
    const pin = input.pin ?? genPin(input.masterPin);
    snap.pins[id] = await makePinRecord(pin);
    snap.events.push({ id, code, createdAt: input.now });
    snap.requests[input.requestId] = id;
    await this.save(snap);
    return { ok: true, id, code, reused: false };
  }

  /** 회차 설정에서 코드·PIN 을 바꾼다. 유일성과 PIN 충돌은 여기서만 판정한다 */
  async updateIdentity(
    eventId: string,
    patch: { code?: string; pin?: string },
    masterPin: string,
  ): Promise<{ ok: true; code: string } | { ok: false; error: "pin_collision" | "code_taken" | "not_found" }> {
    const snap = await this.load();
    const entry = snap.events.find((e) => e.id === eventId);
    if (!entry) return { ok: false, error: "not_found" };

    if (patch.pin && pinCollides(patch.pin, masterPin)) return { ok: false, error: "pin_collision" };
    if (patch.code) {
      const code = patch.code.toUpperCase();
      if (snap.events.some((e) => e.code === code && e.id !== eventId)) {
        return { ok: false, error: "code_taken" };
      }
      entry.code = code;
    }
    if (patch.pin) snap.pins[eventId] = await makePinRecord(patch.pin);
    await this.save(snap);
    return { ok: true, code: entry.code };
  }

  async removeEvent(eventId: string): Promise<void> {
    const snap = await this.load();
    snap.events = snap.events.filter((e) => e.id !== eventId);
    delete snap.pins[eventId];
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
