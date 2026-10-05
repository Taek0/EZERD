# Native 캔버스 인라인 편집 복구

## 기준과 범위

- [전체 복구 계획](../planning/2026-10-06-Canvas-CompleteParityRestoration.md) 및 [감사 E03/E04/E05](2026-10-06-Canvas-ParityAudit.md)를 기준으로 기존 `TableEditor`의 `InlineCell`과 `InlineType`을 대조했다.
- 변경 범위는 `NativeCanvasInlineEditor.tsx`, `native-inline-edit.ts`, 새 `NativeCanvasInlineCell.tsx`, 집중 회귀 테스트와 이 기록이다. Scene/Rows/CSS/root/NativeProjectView 연결은 다른 담당자의 작업이다.

## 구현

- 이름·설명·논리 의미 타입을 실제 셀 내부의 공유 `Input`으로 편집한다. Tab 포커스, 클릭/더블클릭, F2/Enter로 편집을 시작한다. Enter와 blur로 변경을 저장하며, Tab/Shift+Tab의 기본 포커스 이동을 막거나 blur 후 포커스를 되돌리지 않는다.
- Escape는 이번 편집을 취소하고 셀로 포커스를 돌린다. 기존 거절/복구 초안으로 시작한 경우 그 초안은 유지하고 이번 편집만 취소한다. 새 편집은 해당 초안 revision만 폐기한다. 포커스 복귀가 곧바로 편집을 다시 열지 않도록 보호한다.
- 읽기 전용 셀은 텍스트를 표시한다. 공유 `Tooltip`을 사용하고 기존 인라인 클래스 및 `data-inline-cell`을 유지한다.
- physical format 셀은 공유 `SearchType` ComboBox를 사용한다. 현재 source DB catalog, 제품 capability, SQLite STRICT 조건에 맞는 타입만 새 선택지로 제공하며, 현재 opaque/legacy 타입은 재해석 없이 표시한다. 선택 완료로 저장하고 Escape/선택 후 셀 포커스를 복구한다.
- 타입 변경은 native command schema로 검증한 `patch_column.physical.type`만 생성한다. 기본값·generation·ON UPDATE·DB options·nullable을 자동으로 초기화하지 않는다. 기존 파라미터/배열을 호환되는 경우 유지하고 후보 native 문서를 DB write 정책으로 검증한다. 필수 또는 호환되지 않는 파라미터, enum/set, 기본값·생성 규칙과 충돌하는 타입은 직접 저장하지 않고 초안을 유지해 고급 형식 편집기로 연결한다.
- 고급 편집은 편집 중 `…` 또는 Alt+Enter로 열 수 있다. 선택한 타입을 durable format 초안으로 전달하되 기존 format 초안을 덮어쓰지 않는다. 해당 타입의 저장이 승인된 경우에만 일치하는 인라인 source revision을 소비한다.
- 매 입력을 기존 Native durable draft 경로에 보관한다. 미완성 검색 문자열도 query로 보관하고 표시하며, 실제 catalog 선택 없이 타입 명령으로 만들지 않는다. 저장 거절·저장소 실패·버전/sequence/DB revision 변경에서는 입력을 보존한다. 서버 승인 없이 자동 rebase하지 않는다.
- actor/project/target별 컴포넌트 key, 최신 `onSave` 참조, expected tuple 및 revision 비교로 오래된 콜백과 ACK를 보호한다. unmount된 편집기는 뒤늦은 ACK로 새 편집 세션의 UI를 닫거나 포커스를 옮기지 않는다.
- 한국어 IME composition 및 keyCode 229의 Enter/Escape를 편집 완료로 처리하지 않는다. composition 중 blur 저장은 composition 종료 후 최신 입력으로 처리한다.
- 기존 aside에는 첫 입력의 초기 포커스, 명시적인 `focusTarget`/기존 active element 복귀, 최신 save 콜백과 actor/버전 가드, IME implicit submit 보호를 추가했다. aside의 Escape/닫기는 안내 문구처럼 복합 미저장 입력을 보관한다. 단순 셀의 Escape 취소와 구분된다.

## 연결 인터페이스

`NativeCanvasInlineCell`과 `NativeCanvasInlineCellProps`를 새 파일에서 export한다.

```ts
interface NativeCanvasInlineCellProps {
  document: NativeDesignDocument;
  target: NativeInlineTarget;
  context?: NativeEditorContext | undefined;
  onSelect?: ((target: NativeInlineTarget) => void) | undefined;
  onAdvancedFormat?:
    | ((target: NativeInlineTarget, focusTarget?: HTMLElement) => void)
    | undefined;
  disabled?: boolean | undefined;
  label?: string | undefined;
  display?: string | undefined;
  title?: boolean | undefined;
  className?: string | undefined;
}
```

- Scene의 `editorContext`를 셀의 `context`로 전달한다. context 생략 또는 disabled는 읽기 전용 텍스트다. context.busy는 저장 중 편집 시작/저장을 차단한다.
- `target.field`는 기존 `name/comment/semanticType/required/format`을 유지한다. 컬럼 physical format이 검색형 DB 타입 셀이고, logical 의미 타입은 `semanticType`이다.
- 고급 편집 콜백의 두 번째 인자를 보관하여 `NativeCanvasInlineEditor`의 `focusTarget?: HTMLElement | null | undefined`로 전달한다.
- 부모의 저장 콜백은 기존 `(commands, expected, draftRef) => Promise<boolean>` 계약을 그대로 따른다. source v1 변환이나 native 모델의 손실 cast를 추가하지 않았다.

## 검증

- `pnpm exec vitest run apps/web/src/features/projects/NativeCanvasInlineCell.test.ts apps/web/src/features/projects/native-inline.test.ts apps/web/src/features/projects/native-editor-draft.test.ts`: 3개 파일, 33개 테스트 통과.
- 실제 컴포넌트의 hook identity/layout cleanup과 이벤트 콜백을 구동하는 집중 테스트로 focus/Enter/blur/Tab/Escape, IME, 최신 save 참조, 실패 입력 보관, stale expected tuple, actor 교체, 지연 ACK, type selection/query, 고급 초안 handoff 및 source revision 소비를 검증했다. native 모델 검증으로 3개 DB의 타입 전환, 파라미터/배열, 기본값/identity 호환성, STRICT와 opaque 타입 보존을 확인했다.
- 기존 `native-inline.test.ts`의 최소 복구 fixture에 필수 draft.values를 추가했다. 다른 담당자가 확장한 복구 경로에서도 삭제된 대상의 null 판정을 테스트할 수 있도록 fixture를 실제 draft 구조에 맞췄다.
- `pnpm --filter @ezerd/web typecheck`: 통과. 병렬 연결 작업 중 나타났던 다른 파일의 타입 오류도 최종 실행 시 정리되었다.
- 변경 파일에만 루트 Prettier 설정으로 포맷과 포맷 검사를 적용했다. 전체 `pnpm format`은 다른 담당자의 파일을 변경할 수 있어 실행하지 않았다.
- 사용자의 제한에 따라 전체 check/build/전체 테스트 및 Browser 검증은 실행하지 않았다. 이벤트/hook 테스트는 DOM/브라우저 실측을 대체하지 않으며 실제 캔버스 조작과 서버 ACK 통합 검증은 부모 담당 범위다.
