/**
 * ADR-92 — 허용한 나라 밖에서는 API 가 열리지 않는다
 *
 * 이 테스트는 **공개 표면에만** 붙어 있다. 문이 어디에 어떻게 세워졌는지는 모르고,
 * 밖에서 두드렸을 때 무엇이 돌아오는지만 본다.
 *
 * 나라는 Cloudflare 가 요청에 붙여주는 값이라 **테스트에서만 손으로 넣는다.**
 * 로컬 워커와 테스트에는 그 값이 없고, 없을 때 막지 않는 것도 규칙이다 —
 * 그래서 나머지 테스트 전부가 이 문을 모른 채 지나간다.
 */
import { SELF, env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { FAIL } from "../src/shared/copy.ts";

const ORIGIN = "https://tone-pick.test";

/**
 * `cloudflare:test` 의 `env` 는 `Cloudflare.Env` 라 비어 있다 — 여기서 쓰는 칸 하나만 좁게 본다.
 * 넓히는 선언은 `test/release/old-schema.test.ts` 에 있고, 그 파일 것을 여기로 끌어오지 않는다.
 */
const cfg = env as unknown as { ALLOWED_COUNTRIES?: string };

/** 어디까지 열어둘지 정하고 두드린다. `country` 가 `null` 이면 나라를 모르는 요청이다 */
function knock(path: string, country: string | null, allow = "KR") {
  cfg.ALLOWED_COUNTRIES = allow;
  const init = country === null ? undefined : ({ cf: { country } } as unknown as RequestInit);
  return SELF.fetch(new Request(`${ORIGIN}${path}`, init));
}

// 다른 파일이 이 값을 물려받으면 안 된다. 문이 없는 것이 기본이다
afterEach(() => {
  cfg.ALLOWED_COUNTRIES = "";
});

describe("국가 문", () => {
  it("★ 허용한 나라에서는 열린다", async () => {
    const res = await knock("/api/health", "KR");
    expect(res.status).toBe(200);
  });

  it("★ 밖에서 오면 아무것도 주지 않는다 — 왜 막혔는지만 말한다", async () => {
    const res = await knock("/api/health", "US");
    expect(res.status).toBe(403);

    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("region_blocked");
    // 링크를 의심하지 않도록 이유를 말한다. 문구는 copy.ts 것 그대로다
    expect(body.message).toBe(FAIL.region);
    // 서버 상태는 한 줄도 새지 않는다 — 시각도, 설정이 온전한지도
    expect(JSON.stringify(body)).not.toContain("serverTime");
    expect(res.headers.get("x-server-time")).toBeNull();
  });

  it("★ 없는 회차를 물어도 '없다'가 아니라 '막혔다'가 온다", async () => {
    // 문이 맨 앞이라는 뜻이다. 뒤에 서면 못 들어올 요청이 회차가 있는지부터 알아낸다
    const res = await knock("/api/events/by-id/eb1b0b1b", "US");
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("region_blocked");
  });

  it("★ 나라를 모르면 막지 않는다 — 로컬과 테스트가 닫히면 안 된다", async () => {
    const res = await knock("/api/health", null);
    expect(res.status).toBe(200);
  });

  it("★ 값이 비면 문이 없다 — 끄는 길이 그것 하나다", async () => {
    const res = await knock("/api/health", "US", "");
    expect(res.status).toBe(200);
  });

  it("여러 나라를 적을 수 있다. 공백과 대소문자는 가리지 않는다", async () => {
    expect((await knock("/api/health", "JP", " kr , jp ")).status).toBe(200);
    expect((await knock("/api/health", "US", " kr , jp ")).status).toBe(403);
  });

  it("소켓도 같은 문을 지난다 — 화면만 막고 소켓을 두면 알림이 그대로 나간다", async () => {
    const res = await knock("/ws/ABC234", "US");
    expect(res.status).toBe(403);
  });

  it("소켓은 허용한 나라에서는 이 문에 걸리지 않는다", async () => {
    // 없는 입장 코드라 404 다. 403 이 아니라는 것이 여기서 볼 전부다
    const res = await knock("/ws/ABC234", "KR");
    expect(res.status).toBe(404);
  });
});
