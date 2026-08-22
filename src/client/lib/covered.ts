/**
 * 어깨너머 가리기의 켜짐/꺼짐 (슬라이스 16).
 *
 * **기기에만 남긴다.** 서버로 보낼 이유가 없고, 보내면 회차 DO 에 참가자별로 쓸 것이 는다.
 * 무엇보다 이건 화면의 상태라 **다시 읽기(ADR-26)와 아무 관계가 없어야 한다** —
 * 실시간 신호 한 번에 풀리면 **가린 사람이 그걸 모른 채 다닌다.** 최악의 실패다.
 *
 * 탭을 옮기면 화면이 통째로 갈리므로 컴포넌트 상태로는 부족하다. 그래서 localStorage 다.
 */
import { useCallback, useState } from "react";

const KEY = "tone-pick:covered";

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    // 사파리 사생활 보호 모드에서 던진다. 가리기를 못 기억할 뿐 화면은 돌아야 한다
    return false;
  }
  // `window.` 를 붙여 쓴다 — 맨 이름은 환경에 따라 전역에 없을 수 있고,
  // 그러면 try/catch 가 조용히 삼켜서 **기억이 안 되는 걸 아무도 모른다**
}

export function useCovered(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(read);
  const set = useCallback((next: boolean) => {
    setOn(next);
    try {
      window.localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      /* 기억만 못 한다 */
    }
  }, []);
  return [on, set];
}
