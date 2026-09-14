# 이름 수정 및 캔버스 우클릭 핀 작성

- 날짜: 2026-09-15
- 계획: `docs/planning/2026-09-15-Identity-RenameReset.md`

## 구현

- 프로젝트 이름 수정의 `window.prompt`를 공통 Input/Button과 기존 확인창 스타일을 사용하는 `RenameDialog`로 교체했다.
- 이름을 trim한 뒤 1~120자로 검증하고 Enter 저장, 한글 IME 조합 중 Enter 방지, Escape/취소, 트리거 포커스 복원을 지원한다. 요청 실패 시 모달과 입력값을 유지하고 오류를 표시한다.
- 핀 패널의 상시 새 핀 영역과 객체/빈 공간 선택 옵션을 제거했다. 캔버스 우클릭으로 전달된 draftTarget이 현재 뷰에 있을 때만 작성자를 보여 준다.
- 우클릭 좌표에 빈 공간 핀을 생성하며 작성 취소, 패널 닫기, 헤더 핀 버튼, 등록 성공 후 스레드 이동 시 draft를 해제한다. 기존 핀 답글 작성은 유지한다.
- `CommentsPanel`의 사용하지 않는 dirty prop을 제거하고 `onCancelPinDraft`를 추가했다.

## 검증

- `pnpm --filter @ezerd/web typecheck`: 성공.
- `scripts/browser-rename-context-pin-smoke.mjs`: 로컬 Vite/API + 실제 headless Chrome에서 성공.
  - 이름 취소, Escape, 트리거 포커스 복원, 빈 이름 저장 비활성화, trim + Enter 저장.
  - PATCH 409를 주입해 오류 표시와 수정 입력값 유지 확인.
  - 핀 탭을 열어도 새 핀 입력란/제목이 없음을 확인.
  - 캔버스 우클릭에서 작성자 포커스, 작성 취소, Enter 등록 후 작성자 제거, objectId null 확인.
  - 기존 핀 답글 Enter 등록 확인.
  - 브라우저 native dialog 0, page error 0.
- 검증 fixture는 생성한 프로젝트와 사용자 ID만 대상으로 제거했다. 기존 사용자 DB 데이터는 이 UI 작업에서 변경하지 않았다.
- Browser 플러그인 연결은 Windows sandbox helper 오류로 실패하여 로컬 Playwright 검증을 사용했다.
