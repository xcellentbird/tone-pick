/**
 * happy-dom 에 없는 브라우저 API 를 채운다.
 *
 * `localStorage` 가 없으면 어깨너머 가리기(슬라이스 16)의 **기억이 통째로 테스트에서 빠진다** —
 * 앱 코드는 try/catch 로 감싸 조용히 false 를 돌려주므로, 없는 채로 두면
 * "다시 읽어도 안 풀린다" 를 재는 테스트가 **아무것도 안 재면서 통과한다.**
 */
const store = new Map<string, string>();

Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  },
});
