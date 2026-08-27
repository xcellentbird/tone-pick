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
import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";

interface Props {
  open: boolean;
  onClose: () => void;
  /** 스크린리더가 읽을 제목. 화면에 보이는 제목이 따로 있으면 `titleHidden` 으로 감춘다 */
  title: string;
  titleHidden?: boolean;
  /** 아래에서 올라오는 시트인가(기본), 가운데 뜨는 확인창인가 */
  variant?: "sheet" | "dialog";
  children: ReactNode;
}

export default function Sheet({
  open,
  onClose,
  title,
  titleHidden,
  variant = "sheet",
  children,
}: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim" />
        <Dialog.Content
          className={variant}
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
            e.preventDefault();
            (e.currentTarget as HTMLElement | null)?.focus();
          }}
        >
          {titleHidden ? (
            <Dialog.Title className="srOnly">{title}</Dialog.Title>
          ) : (
            <Dialog.Title className="sheetTitle">{title}</Dialog.Title>
          )}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
