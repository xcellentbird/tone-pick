/**
 * 시트와 확인창의 껍데기.  Radix Dialog 로 **동작만** 빌려 쓰고 모양은 우리 CSS 변수 그대로다.
 *
 * 손으로 만들었을 때 없던 것들 (gzip 12KB 값):
 *   · 포커스 트랩 — Tab 이 시트 뒤 목록으로 빠져나가지 않는다
 *   · 포커스 복원 — 닫으면 열었던 자리로 돌아온다
 *   · **스크롤 잠금** — iOS 에서 시트 뒤 목록이 같이 밀리지 않는다
 *   · Escape 로 닫기, 배경을 스크린리더에서 감추기
 *
 * 히스토리는 여전히 우리가 쥔다. 뒤로 가기로 닫히고 실행 **전에** 히스토리를 정리하는 규칙은
 * 라이브러리가 모른다 (ROUTES.md) — 그래서 열림 상태를 밖에서 받고, 닫힘 요청만 넘겨받는다.
 *
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";

/** 이만큼 내려야 손 떨림이 아니라 "내리려는 것"으로 본다 */
const SLOP = 8;
/** 시트 높이의 이만큼을 내리고 놓으면 닫힌다 */
const CLOSE_RATIO = 0.25;
/** 짧게 내렸어도 이 속도(px/ms)로 튕기면 닫는다 */
const FLING_V = 0.5;
const FLING_MIN = 40;
/** 제자리로 돌아가는 시간 */
const SETTLE_MS = 200;
/**
 * 마저 내려가는 시간. **`sheetOut`(180ms)보다 짧아야 한다** — Radix 는 그 애니메이션이
 * 끝나면 언마운트하므로, 같거나 길면 다 내려가기 전에 시트가 사라진다.
 */
const DISMISS_MS = 150;

interface Props {
  open: boolean;
  onClose: () => void;
  /** 스크린리더가 읽을 제목. 화면에 보이는 제목이 따로 있으면 `titleHidden` 으로 감춘다 */
  title: string;
  titleHidden?: boolean;
  /** 아래에서 올라오는 시트인가(기본), 가운데 뜨는 확인창인가 */
  variant?: "sheet" | "dialog";
  /** 확인창의 폭·모양 변주. `narrow` 는 묻는 게 칸 둘뿐인 자리다 (입장 확인창, ADR-75) */
  tone?: "narrow";
  /**
   * **열릴 때 첫 입력칸에 커서를 준다** — ADR-63 의 예외 1호.
   *
   * 기본은 안 준다 (아래 `onOpenAutoFocus`). 시트는 대개 읽으러 여는 것이라 키보드가 화면 절반을
   * 먹으면 안 되기 때문이다. 이 값은 **칠 것밖에 없는 창**에만 켠다 — 지금은 입장 확인창 하나다.
   * ADR-63 이 *"구현이 둘 이상일 때 만든다"* 고 적어둔 그 설정이다.
   */
  autoFocus?: boolean;
  children: ReactNode;
}

export default function Sheet({
  open,
  onClose,
  title,
  titleHidden,
  variant = "sheet",
  tone,
  autoFocus,
  children,
}: Props) {
  /*
   * **닫히는 동안 내용을 붙들고 있는다.**
   *
   * 부르는 쪽은 전부 `{picked && (...)}` 로 자식을 감싼다 — 열림 상태와 자식이 **같은 값에서**
   * 나오기 때문이다. 그래서 닫는 순간 `open` 이 false 가 되는 것과 자식이 사라지는 것이
   * 동시에 일어난다. 움직임이 없던 동안에는 티가 안 났지만, 나가는 애니메이션이 붙으면
   * **빈 상자가 내려간다.** 사라지는 것을 보여주려던 자리에 아무것도 없다.
   *
   * 열려 있는 동안의 마지막 값을 들고 있다가 닫히는 동안 그걸 그린다.
   * 다시 열리면 그때는 `open` 이 true 라 새 값으로 덮인다.
   */
  const held = useRef<{ children: ReactNode; title: string }>({ children, title });
  if (open) held.current = { children, title };
  const shown = open ? { children, title } : held.current;

  /*
   * ⚠️ **`useRef` 가 아니라 콜백 ref 다.** Radix 의 `Presence` 는 열림이 true 가 된 커밋보다
   *    **한 박자 뒤에** 실제 노드를 단다 — `useRef` 로 받으면 아래 `useEffect` 가 도는 시점에
   *    아직 `null` 이고, 그 뒤로는 deps 가 안 변해서 **손잡이가 영영 안 붙는다.**
   *    노드가 상태로 들어와야 붙는 순간에 효과가 다시 돈다.
   */
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  /* 부르는 쪽은 매번 새 화살표 함수를 넘긴다 — deps 에 넣으면 렌더마다 손잡이를 다시 단다 */
  const close = useRef(onClose);
  close.current = onClose;
  /* 닫히는 중에 또 끌어서 뒤로 가기가 두 번 나가지 않게 */
  const live = useRef(open);
  live.current = open;

  /*
   * ─────────────────────────── 끌어서 닫기 (시트만)
   *
   * **스크롤이 맨 위일 때 아래로 끌면 시트가 손가락을 따라 내려가고, 충분히 내리면 닫힌다.**
   * 맨 위에서 더 당기는 동작은 원래 아무 일도 하지 않던 자리라 뺏는 것이 없다.
   * 시트가 아래에서 올라오는 것이 *이건 닫아야 하는 창* 이라고 말하는데(ADR-64),
   * 같은 방향으로 되돌리는 길을 손에 쥐여주는 것이다.
   *
   * **확인창에는 붙이지 않는다.** 아래에서 올라오지도 않고, 무엇보다 답을 골라야 닫히는
   * 자리라 손이 미끄러져 닫히면 안 된다. Escape·취소가 그 창의 길이다.
   *
   * ⚠️ **변형은 인라인 `!important` 로 얹는다.** `.sheet` 는 `sheetIn ... both` 가
   *    끝난 뒤에도 마지막 프레임을 붙들고 있어서(`fill-mode: both`), 보통 인라인 스타일로는
   *    못 이긴다 — 애니메이션이 인라인보다 세다. `!important` 만 그 위에 선다.
   *    나가는 `sheetOut` 도 같은 이유로 덮인다: 닫을 때 시트는 **끌던 자리에서 이어서**
   *    내려가야 하는데, `sheetOut` 은 늘 제자리에서 시작해서 그대로 두면 한 번 튕긴다.
   *
   * ⚠️ **`touchmove` 는 non-passive 여야 한다.** 아래로 끄는 동안 `preventDefault()` 로
   *    고무줄 스크롤을 막지 않으면 iOS 에서 시트와 배경이 같이 출렁인다.
   */
  useEffect(() => {
    const el = box;
    if (!el || variant !== "sheet") return;

    /* 움직임을 끈 사람에겐 따라오는 것도 마저 내려가는 것도 없다 — 문턱을 넘으면 그냥 닫힌다 */
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

    let startX = 0;
    let startY = 0;
    let lastY = 0;
    let lastT = 0;
    let dy = 0;
    let v = 0;
    let candidate = false;
    let dragging = false;
    let timer = 0;

    const put = (y: number) =>
      el.style.setProperty("transform", `translate(-50%, ${y}px)`, "important");
    const ease = (ms: number) =>
      el.style.setProperty("transition", `transform ${ms}ms cubic-bezier(0.2, 0.8, 0.2, 1)`, "important");
    const release = () => {
      el.style.removeProperty("transform");
      el.style.removeProperty("transition");
    };

    const onStart = (e: TouchEvent) => {
      if (dragging || e.touches.length !== 1 || el.scrollTop > 0) return;
      /* 치는 중인 사람의 손을 뺏지 않는다 — 글자를 고르려고 끄는 것일 수 있다 */
      if ((e.target as Element | null)?.closest("input, textarea, select, [contenteditable]")) return;
      const t = e.touches[0];
      startX = t.clientX;
      startY = lastY = t.clientY;
      lastT = e.timeStamp;
      dy = 0;
      v = 0;
      candidate = true;
    };

    const onMove = (e: TouchEvent) => {
      if (!candidate) return;
      const t = e.touches[0];
      const d = t.clientY - startY;

      if (!dragging) {
        if (d <= 0) {
          /* 위로 미는 건 목록을 보려는 것이다. 가로로 새는 것도 우리 것이 아니다 */
          if (d < -SLOP || Math.abs(t.clientX - startX) > SLOP) candidate = false;
          return;
        }
        if (el.scrollTop > 0) {
          candidate = false;
          return;
        }
        /* 맨 위에서 아래로 가는 순간부터 이 제스처는 우리 것이다 — 스크롤할 것이 없다 */
        e.preventDefault();
        if (d < SLOP) return;
        dragging = true;
        clearTimeout(timer);
        el.style.removeProperty("transition"); // 따라오는 동안은 곧장 따라온다
      } else {
        e.preventDefault();
      }

      if (e.timeStamp > lastT) v = (t.clientY - lastY) / (e.timeStamp - lastT);
      lastY = t.clientY;
      lastT = e.timeStamp;
      dy = Math.max(0, d - SLOP); // 잡은 자리에서 이어지게 — 문턱만큼 건너뛰지 않는다
      put(dy);
    };

    const onEnd = () => {
      if (!dragging) {
        candidate = false;
        return;
      }
      candidate = dragging = false;
      if (!live.current) return; // 이미 닫히는 중이다

      const enough = dy > el.offsetHeight * CLOSE_RATIO || (dy > FLING_MIN && v > FLING_V);
      if (enough) {
        if (still) {
          release();
          close.current();
          return;
        }
        /* 마저 내려보내고 **동시에** 닫는다 — 스크림도 같이 사라져야 한 동작으로 읽힌다 */
        ease(DISMISS_MS);
        void el.offsetHeight; // 새 `transition` 을 먼저 굳힌다
        put(el.offsetHeight);
        close.current();
        return;
      }

      if (still) {
        release();
        return;
      }
      ease(SETTLE_MS);
      void el.offsetHeight;
      put(0); // 제자리 = `sheetIn` 의 마지막 프레임이라, 끝나고 걷어내도 튀지 않는다
      timer = window.setTimeout(release, SETTLE_MS);
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      clearTimeout(timer);
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
      /*
       * ⚠️ **여기서 인라인 변형을 걷지 마라.** 이 정리는 노드가 떨어져 나갈 때 돈다 —
       *    끌어서 닫는 동안에는 시트가 아직 내려가는 중이라, 걷으면 제자리로 튕겨 올라간다.
       *    다음에 열릴 때는 Radix 가 새 노드를 만들므로 남는 것도 없다.
       */
    };
  }, [box, variant]);

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim" />
        <Dialog.Content
          ref={setBox}
          className={tone ? `${variant} ${tone}` : variant}
          aria-describedby={undefined}
          /*
           * **열었다고 입력칸에 커서를 주지 않는다** (ADR-63).
           *
           * Radix 는 열릴 때 안에서 첫 포커스 가능한 요소를 잡는다. 그게 텍스트 입력이면
           * 폰에서 **키보드가 곧장 올라와 화면 절반을 먹는다** — 초대 명단이 그 경우였다.
           * 시트는 대개 **읽으러** 여는 것이고, 칠 사람은 칸을 직접 누른다.
           *
           * ⚠️ `preventDefault()` 만 하면 안 된다. 포커스가 `body` 로 떨어져서
           * 포커스 트랩이 풀리고(Tab 이 시트 뒤 목록으로 샌다) 스크린리더가 제목을 안 읽는다.
           * 시트 자체를 잡아준다 — Radix 의 `FocusScope` 가 `tabIndex: -1` 로 렌더해서
           * 받을 수 있고, 입력이 아니라 컨테이너라 키보드는 안 올라온다.
           */
          onOpenAutoFocus={(e) => {
            if (autoFocus) return; // Radix 가 첫 입력칸을 잡는다 — 칠 것밖에 없는 창이다
            e.preventDefault();
            (e.currentTarget as HTMLElement | null)?.focus();
          }}
        >
          {titleHidden ? (
            <Dialog.Title className="srOnly">{shown.title}</Dialog.Title>
          ) : (
            <Dialog.Title className="sheetTitle">{shown.title}</Dialog.Title>
          )}
          {shown.children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
