/**
 * 파티 한 판을 만드는 재료. **여러 테스트 파일이 나눠 쓴다.**
 *
 * 한 파일에 다 있던 것을 뽑았다. 처음 이유는 속도였다 — 같은 테스트가 96개짜리 파일 끝에서
 * 110ms → 11초가 됐고(초선형), DO 를 지워도 안 줄어서 파일을 나눠 버텼다.
 * **정체는 `SELF.fetch` 였다** — 요청마다 진입점 래퍼의 prototype 에 Proxy 가 한 겹씩 쌓인다.
 * 요청은 이제 `fetchApp`(`helpers/app.ts`)으로만 넣는다. 파일을 나누는 것은 더 이상 성능 대책이 아니다.
 *
 * `master` 는 ESM 라이브 바인딩이다. 각 파일이 `beforeAll(signInMaster)` 로 채우고,
 * 쓰는 쪽은 `cookie: master` 를 그대로 읽으면 된다.
 */
import { fetchApp } from "./app.ts";
import { expect } from "vitest";
import { hangulSeq } from "../../src/shared/copy.ts";
import type { EventConfig, EventMeta, Invite, RegisterInput, RegisterResult } from "../../src/shared/types.ts";

const MASTER_PIN = "1234";
const HOUR = 3600_000;

export interface Res<T> {
  status: number;
  body: T;
  cookie: string | null;
  /** 이 응답이 심은 쿠키 전부 (`이름=값`). 탭이 갈리는 경우를 확인할 때 쓴다 */
  setCookies: string[];
}

/**
 * 세션 쿠키는 **두 벌** 나간다 (ADR-44) — `tp_play_<이름표>` 와 이름표 없는 `tp_play`.
 * 테스트는 이름표를 보내지 않으므로 **기본 쿠키**를 집는다. 탭이 갈리는 경우는
 * `x-tp-ref` 를 직접 실어 따로 확인한다 (`test/44-tab-sessions.test.ts`).
 */
export function baseCookie(res: Response): string | null {
  const all = res.headers.getSetCookie?.() ?? [];
  const one = all.map((c) => c.split(";")[0]).find((c) => /^tp_(host|play|inv)=./.test(c));
  return one ?? res.headers.get("set-cookie")?.split(";")[0] ?? null;
}

export async function api<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; cookie?: string | null; ref?: string } = {},
): Promise<Res<T>> {
  const res = await fetchApp(`https://tone-pick.test${path}`, {
    method: init.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(init.cookie ? { cookie: init.cookie } : {}),
      // 이 탭이 어느 세션을 읽을지 고르는 이름표 (ADR-44). 없으면 기본 세션이다
      ...(init.ref ? { "x-tp-ref": init.ref } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  let body: unknown = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return {
    status: res.status,
    body: body as T,
    cookie: baseCookie(res),
    setCookies: (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]),
  };
}

export let master: string | null = null;
let seq = 0;

/** 각 파일이 `beforeAll(signInMaster)` 로 부른다. 파일마다 아이솔레이트가 새것이라 매번 필요하다 */
export async function signInMaster() {
  master = (await api("/api/host/pin", { method: "POST", body: { pin: MASTER_PIN } })).cookie;
}

/** 등록이 열린 회차를 하나 만든다. 테스트끼리 상태를 나눠 쓰지 않기 위해 매번 새로 만든다 */
export async function freshEvent(config: Partial<EventConfig> = {}): Promise<EventMeta> {
  seq++;
  const res = await api<EventMeta>("/api/host/events", {
    method: "POST",
    cookie: master,
    body: {
      name: `${seq}회차`,
      partyAt: Date.now() + 3 * 24 * HOUR,
      prevoteAt: Date.now() + 24 * HOUR,
      // 발표는 파티 **뒤**다 (ADR-43). 여기 테스트들은 발표를 직접 눌러 넘기므로 넉넉히 둔다
      revealAt: Date.now() + 3 * 24 * HOUR + 3 * HOUR,
      /*
       * **알림을 켠 회차다.** 기본은 꺼짐이라(ADR-34) 받은 콕 수가 발표 전까지 0 으로 나온다 —
       * 이 헬퍼를 쓰는 테스트들은 그 숫자로 익명성을 재므로 여기서는 켜 둔다.
       * 꺼진 쪽의 규칙은 `test/22-poke-rules.test.ts` 가 본다.
       */
      // 알림은 라운드마다 따로다 (ADR-43). 이 헬퍼의 뜻은 "둘 다 켠 회차" 다
      config: { maxPre: 2, maxParty: 3, preNotify: true, pokeNotify: true, ...config },
      requestId: `p-${seq}-${Date.now()}`,
    },
  });
  expect(res.status).toBe(200);
  return res.body;
}

let phoneSeq = 0;
export const nextPhone = () => `0101234${String(1000 + ++phoneSeq)}`;

export function person(over: Partial<RegisterInput> = {}): RegisterInput {
  return {
    nickname: `사람${hangulSeq(phoneSeq)}`,
    realName: "김실명",
    age: 28,
    gender: "M",
    instagram: `insta_${phoneSeq}`,
    mbti: "ENFP",
    charms: ["요리를 잘해요", "잘 웃어요", "노래를 좋아해요"],
    // 등록을 마쳐야 저장된다 (ADR-75). 재입력 대조는 화면 몫이라 여기엔 하나뿐이다
    pin: PIN,
    ...over,
  };
}

/** 테스트 참가자들이 정하는 PIN 번호. 넷 다 같아도 된다 — 회차마다 따로이고 사람마다 따로다 */
export const PIN = "2468";

/**
 * 초대 명단은 **더하고 빼기만** 있다. 통째로 갈아치우는 길은 두지 않았다.
 * 넣은 번호를 그대로 돌려준다 — 문을 여는 열쇠가 이제 번호다 (ADR-75). 토큰은 응답에 없다.
 */
export async function invite(eventId: string, phone: string): Promise<string> {
  const res = await api<Invite[]>(`/api/host/events/${eventId}/invites`, {
    method: "POST",
    cookie: master,
    body: { phones: [phone] },
  });
  expect(res.status).toBe(200);
  expect(res.body.find((i) => i.phone === phone), "명단에 줄이 생겨야 한다").toBeTruthy();
  return phone;
}

/**
 * 문을 두드린다 (ADR-75). 번호만 주면 **묻기**(미등록이면 초대 쿠키, 등록자면 다음에 펼 칸),
 * PIN 번호까지 주면 **들어가기**다.
 */
export async function enter(eventId: string, phone: string, pin?: string) {
  return api<{ registered: boolean; code?: string; pin?: "required" | "set"; ref?: string }>(
    `/api/events/${eventId}/enter`,
    { method: "POST", body: pin === undefined ? { phone } : { phone, pin } },
  );
}

/** 명단에 넣고 → 입장하고 → 등록한다. 실제 참가자가 지나는 길 그대로다 */
export async function join(ev: EventMeta, over: Partial<RegisterInput> = {}) {
  const phone = nextPhone();
  const input = person(over);
  await invite(ev.id, phone);

  const gate = await enter(ev.id, phone);
  expect(gate.status, JSON.stringify(gate.body)).toBe(200);
  expect(gate.body.registered).toBe(false);

  const res = await api<RegisterResult>("/api/register", {
    method: "POST",
    cookie: gate.cookie,
    body: input,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { cookie: res.cookie, id: res.body.state.me.id, input, phone, pin: input.pin };
}

export async function setPhase(id: string, to: string) {
  const res = await api(`/api/host/events/${id}/phase`, { method: "POST", cookie: master, body: { to } });
  expect(res.status).toBe(200);
}

/**
 * 소켓 하나를 열고 받은 신호를 모은다 (ADR-26 — 신호는 "다시 읽어라" 뿐이다).
 *
 * `cookie` 가 참가자 쿠키면 그 참가자의 소켓이다. **운영자 콘솔은 `host` 로 스스로 밝히고
 * 운영자 쿠키로 증명한다** (ADR-107) — 둘 중 하나라도 없으면 운영자 신호(`toHosts`)를 받지 않는다.
 * `headers` 는 속인 요청을 흉내 낼 때만 쓴다.
 */
export async function listen(
  ev: EventMeta,
  opts: { cookie?: string | null; host?: boolean; headers?: Record<string, string> } = {},
): Promise<string[]> {
  const res = await fetchApp(`https://tone-pick.test/ws/${ev.code}${opts.host ? "?host=1" : ""}`, {
    headers: { Upgrade: "websocket", ...(opts.cookie ? { cookie: opts.cookie } : {}), ...opts.headers },
  });
  const ws = res.webSocket;
  expect(ws, `소켓이 안 열렸다 (${res.status})`).toBeTruthy();
  const got: string[] = [];
  ws!.accept();
  ws!.addEventListener("message", (e) => got.push(String(e.data)));
  return got;
}

/** 소켓 신호는 응답보다 늦게 닿는다. 한 박자 기다린다 */
export const settle = () => new Promise((r) => setTimeout(r, 50));
