/**
 * 토스트와 확인 다이얼로그를 한 자리에서 준다.
 *
 * 두 가지 규칙이 여기 들어 있다.
 *  1. 확인창은 **라우트처럼** 동작한다 — 뒤로 가기로 닫히고, 실행 **전에** 히스토리를 정리한다.
 *     안 그러면 실행 후 뒤로 갔을 때 이미 처리된 다이얼로그가 다시 뜬다 (ROUTES.md)
 *  2. 확인창은 "정말 하시겠습니까?"가 아니라 무엇이 어떻게 바뀌는지 항목으로 보여준다.
 *     그래서 문구가 아니라 `ActionCopy`(항목 배열)를 받는다
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { BTN, type ActionCopy } from "../../shared/copy.ts";
import Sheet from "./Sheet.tsx";

interface Pending {
  copy: ActionCopy & { note?: string; second?: { label: string; run: () => Promise<void> | void } };
  run: () => Promise<void> | void;
}

interface Overlay {
  toast: (message: string) => void;
  /**
   * `second` 는 **되돌리는 행동**을 위한 자리다 (ADR-34).
   * 목록 행에 버튼을 하나 더 두면 카드가 화면 밖으로 밀리고,
   * 가린 동안 그 버튼이 보이면 "이 사람을 골랐다" 가 그대로 샌다.
   * 그래서 이미 숫자를 보여주고 있는 이 창 안에 둔다.
   */
  confirm: (
    copy: ActionCopy & { note?: string; second?: { label: string; run: () => Promise<void> | void } },
    run: () => Promise<void> | void,
  ) => void;
}

const Ctx = createContext<Overlay | null>(null);

export function useOverlay(): Overlay {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("Overlays provider missing");
  return ctx;
}

export function Overlays({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Array<{ id: number; text: string }>>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  /**
   * 뒤로 가기로 확인창이 닫힌다.
   *
   * 주의 — "히스토리에 dialog 가 없으면 닫는다"로 두면 안 된다. 여는 순간에는 아직
   * 히스토리가 갱신되기 전이라, 확인창이 뜨자마자 스스로 닫힌다. 그래서 한 번 들어간 걸
   * 본 뒤에만(armed) 사라짐을 닫힘으로 해석한다.
   */
  const dialogInHistory = !!(location.state as { dialog?: boolean } | null)?.dialog;
  const armed = useRef(false);
  useEffect(() => {
    if (dialogInHistory) {
      armed.current = true;
      return;
    }
    if (armed.current) {
      armed.current = false;
      setPending(null);
    }
  }, [dialogInHistory]);

  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { id, text }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 2600);
  }, []);

  const confirm = useCallback<Overlay["confirm"]>(
    (copy, run) => {
      setPending({ copy, run });
      navigate(location.pathname + location.search, { state: { dialog: true } });
    },
    [location.pathname, location.search, navigate],
  );

  const close = () => {
    setPending(null);
    armed.current = false;
    if (dialogInHistory) navigate(-1);
  };

  const accept = async () => {
    const job = pending;
    setPending(null);
    armed.current = false;
    // 실행 **전에** 히스토리를 정리한다
    if (dialogInHistory) navigate(-1);
    await job?.run();
  };

  return (
    <Ctx.Provider value={{ toast, confirm }}>
      {children}

      <Sheet
        open={!!pending}
        onClose={close}
        title={pending?.copy.title ?? ""}
        variant="dialog"
      >
        {pending && (
          <>
            <div className="facts">
              {pending.copy.facts.map(([label, text]) => (
                <div className="fact" key={label + text}>
                  <b>{label}</b>
                  <span className="grow">{text}</span>
                </div>
              ))}
            </div>
            {pending.copy.note && <p className="small dim pre">{pending.copy.note}</p>}
            {/*
              **윗줄은 하는 일, 아랫줄은 취소다.**
              되돌리기와 실행은 같은 축의 반대 방향이라(한 번 더 / 한 번 물리기)
              붙어 있어야 무엇을 고르는 자리인지 읽힌다. 취소는 아무것도 하지 않고
              닫는 것이라 성격이 다르다 — **되돌리기가 있든 없든 늘 아래 한 줄**이다.
              한때 되돌리기가 없을 때만 취소가 윗줄로 올라왔는데, 같은 창인데도
              **누를 자리가 옮겨 다녔다.**
            */}
            <div className="row">
              {pending.copy.second && (
                <button
                  className="btn wide undo"
                  onClick={() => {
                    const run = pending.copy.second!.run;
                    close();
                    void run();
                  }}
                >
                  {pending.copy.second.label}
                </button>
              )}
              {/* 되돌리기가 실행 자리에 오는 창도 있다 (다 쓴 뒤) — 그때도 색은 되돌리기다 */}
              <button
                className={`btn wide ${pending.copy.undo ? "undo" : pending.copy.danger ? "gold" : "primary"}`}
                onClick={accept}
              >
                {pending.copy.btn}
              </button>
            </div>
            <button className="btn ghost block" onClick={close}>
              {BTN.cancel}
            </button>
          </>
        )}
      </Sheet>

      <div className="toasts">
        {toasts.map((t) => (
          <div className="toast" key={t.id}>
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
