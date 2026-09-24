/**
 * Cloudflare Access 의 JWT 를 **워커가 스스로** 확인한다 (슬라이스 35 S-B2, ADR-97).
 *
 * 문은 Access 다 — 대시보드에서 워커 주소에 정책을 건다. 그런데 정책은 git 밖이라 실수로 풀릴 수 있고,
 * `workers.dev` 주소로 바로 치면 Access 를 안 지난다. 그래서 워커가 한 겹 더 선다:
 * **Access 가 서명한 토큰이 있고, 그 토큰이 이 앱(`aud`)의 것이고, 아직 살아 있어야** 들어온다.
 *
 * ⚠️ **헤더가 있다는 것만 보지 마라.** `Cf-Access-Jwt-Assertion` 은 요청이 들고 오는 값이다 —
 * `workers.dev` 로 바로 치면서 아무 글자나 넣을 수 있다. 서명까지 확인해야 문이다.
 * ⚠️ **설정이 비어 있으면 닫는다.** `ACCESS_AUD`·`ACCESS_TEAM` 이 없을 때 열어 두면,
 * 값을 넣기 전의 첫 배포가 곧 누구나 QA 회차를 만들고 지우는 공개 도구가 된다.
 */

export interface AccessConfig {
  /** Access 앱의 Audience(AUD) 태그 */
  aud: string;
  /** Zero Trust 팀 이름 — `<team>.cloudflareaccess.com` */
  team: string;
}

interface Jwk extends JsonWebKey {
  kid?: string;
}

type KeySource = (team: string) => Promise<Jwk[]>;

const b64urlBytes = (s: string): Uint8Array => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const b64urlJson = (s: string): Record<string, unknown> => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

/** Access 의 공개 키. 한 시간 들고 있는다 — 요청마다 부르면 문 하나에 왕복이 하나씩 붙는다 */
let cached: { team: string; at: number; keys: Jwk[] } | null = null;
export const accessKeys: KeySource = async (team) => {
  if (cached && cached.team === team && Date.now() - cached.at < 3600_000) return cached.keys;
  const res = await fetch(`https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access 공개 키를 못 받았습니다 (${res.status})`);
  const keys = ((await res.json()) as { keys?: Jwk[] }).keys ?? [];
  cached = { team, at: Date.now(), keys };
  return keys;
};

/** 문을 지난 사람. 무대 목록에 누가 세웠는지 적는 데만 쓴다 */
export interface AccessUser {
  email?: string;
}

/**
 * 토큰이 이 앱의 것인가. **실패는 이유를 가리지 않고 `null`** 이다 — 무엇이 틀렸는지 알려 주면
 * 문을 두드리는 쪽이 하나씩 맞춰 본다.
 */
export async function verifyAccess(
  token: string | null,
  config: Partial<AccessConfig>,
  { now = Date.now(), keys = accessKeys }: { now?: number; keys?: KeySource } = {},
): Promise<AccessUser | null> {
  if (!token || !config.aud || !config.team) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = b64urlJson(parts[0]);
    const claims = b64urlJson(parts[1]);
    if (header.alg !== "RS256") return null;

    const audOk = Array.isArray(claims.aud) ? claims.aud.includes(config.aud) : claims.aud === config.aud;
    if (!audOk) return null;
    if (claims.iss !== `https://${config.team}.cloudflareaccess.com`) return null;
    const sec = now / 1000;
    if (typeof claims.exp !== "number" || claims.exp <= sec) return null;
    if (typeof claims.nbf === "number" && claims.nbf > sec + 60) return null;

    const jwk = (await keys(config.team)).find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const signed = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64urlBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    return signed ? { email: typeof claims.email === "string" ? claims.email : undefined } : null;
  } catch {
    return null;
  }
}
