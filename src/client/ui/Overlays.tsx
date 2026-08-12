/**
 * 토스트와 확인 다이얼로그를 한 자리에서 준다.
 *
 * 두 가지 규칙이 여기 들어 있다.
 *  1. 확인창은 **라우트처럼** 동작한다 — 뒤로 가기로 닫히고, 실행 **전에** 히스토리를 정리한다.
 *     안 그러면 실행 후 뒤로 갔을 때 이미 처리된 다이얼로그가 다시 뜬다 (ROUTES.md)
 *  2. 확인창은 "정말 하시겠습니까?"가 아니라 무엇이 어떻게 바뀌는지 항목으로 보여준다.
 *     그래서 문구가 아니라 `ActionCopy`(항목 배열)를 받는다
 *
 * 데모 뷰의 폰 안에서는 `history={false}` 로 감싼다. 폰 3대가 히스토리를 공유하면
 * 한 대에서 연 확인창이 다른 대의 뒤로 가기로 닫힌다 (ADR-7).
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { BTN, type ActionCopy } from "../../shared/copy.ts";

interface Pending {
  copy: ActionCopy & { note?: string };
  run: () => Promise<void> | void;
}

interface Overlay {
  toast: (message: string) => void;
  confirm: (copy: ActionCopy & { note?: string }, run: () => Promise<void> | void) => void;
}

const Ctx = createContext<Overlay | null>(null);

export function useOverlay(): Overlay {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("Overlays provider missing");
  return ctx;
}

export function Overlays({ children, history = true }: { children: ReactNode; history?: boolean }) {
  const [toasts, setToasts] = useState<Array<{ id: number; text: string }>>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  /**
   * 뒤로 가기로 확인창이 닫힌다. 히스토리를 안 쓰는 폰 안에서는 이 감시가 필요 없다.
   *
   * 주의 — "히스토리에 dialog 가 없으면 닫는다"로 두면 안 된다. 여는 순간에는 아직
   * 히스토리가 갱신되기 전이라, 확인창이 뜨자마자 스스로 닫힌다. 그래서 한 번 들어간 걸
   * 본 뒤에만(armed) 사라짐을 닫힘으로 해석한다.
   */
  const dialogInHistory = history && !!(location.state as { dialog?: boolean } | null)?.dialog;
  const armed = useRef(false);
  useEffect(() => {
    if (!history) return;
    if (dialogInHistory) {
      armed.current = true;
      return;
    }
    if (armed.current) {
      armed.current = false;
      setPending(null);
    }
  }, [dialogInHistory, history]);

  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { id, text }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 2600);
  }, []);

  const confirm = useCallback<Overlay["confirm"]>(
    (copy, run) => {
      setPending({ copy, run });
      if (history) navigate(location.pathname + location.search, { state: { dialog: true } });
    },
    [history, location.pathname, location.search, navigate],
  );

  const close = () => {
    setPending(null);
    armed.current = false;
    if (history && dialogInHistory) navigate(-1);
  };

  const accept = async () => {
    const job = pending;
    setPending(null);
    armed.current = false;
    // 실행 **전에** 히스토리를 정리한다
    if (history && dialogInHistory) navigate(-1);
    await job?.run();
  };

  return (
    <Ctx.Provider value={{ toast, confirm }}>
      {children}

      {pending && (
        <div className="scrim" onClick={close} role="presentation">
          <div className="dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 style={{ margin: "0 0 4px", fontSize: 17 }}>{pending.copy.title}</h2>
            <div className="facts">
              {pending.copy.facts.map(([label, text]) => (
                <div className="fact" key={label + text}>
                  <b>{label}</b>
                  <span className="grow">{text}</span>
                </div>
              ))}
            </div>
            {pending.copy.note && <p className="small dim pre">{pending.copy.note}</p>}
            <div className="row">
              <button className="btn wide ghost" onClick={close}>
                {BTN.cancel}
              </button>
              <button
                className={`btn wide ${pending.copy.danger ? "gold" : "primary"}`}
                onClick={accept}
              >
                {pending.copy.btn}
              </button>
            </div>
          </div>
        </div>
      )}

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
