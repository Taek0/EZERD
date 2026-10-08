# 자동저장 결과

## 구현

- `useNativeAutosave`는 실제 사용자 변경만 300ms debounce로 저장한다. IME 조합 중 저장하지 않으며 동일 입력 실패를 자동 재시도하지 않는다.
- busy 해제 후 저장, 선택 전환 시 pending 입력 flush, 저장 중 unmount 후 새 revision drain을 지원한다. 복구 초안 mount는 저장을 무장하지 않는다.
- 공용 폼과 캔버스 폼의 저장 요청·입력 초기화 버튼/핸들러를 제거했다. 외부 busy fieldset 차단은 유지한다.
- delete/clear/remove/reset 명령은 자동 실행하지 않고 별도 삭제 실행 확인을 요구한다.
- ACK 성공시에만 baseline을 전진하고 후속 입력은 유지한다. 캔버스 ACK 후 승인된 입력을 표시한다.
- 생성 폼은 첫 생성 이후 patch로 이어진다. ACK 스냅샷 전 unmount 시에도 승인된 생성 문서를 이용해 중복 add를 방지한다.
- 생성 이후 build에 before를 전달하여 사용자 변경 필드만 patch한다. 원격 변경된 다른 이름·scope·도메인을 덮어쓰지 않는 회귀 테스트를 추가했다.
- 사용되지 않는 resetNativeEditorDraft/resetNativeDraft helper를 제거했다. ACK discard와 archive 복구·dismiss는 유지했다.

## 다른 워커 적용 API

`useNativeAutosave({ blocked, getBlocked?, save, delay? })` 반환은 `markChanged`, `compositionProps`, `flush`다.

- 사용자 change에서만 persist 후 markChanged 호출. mount/rebase/ACK에서는 호출하지 않는다.
- form에 compositionProps 전달. save는 currentDraft.current를 읽는다.
- getBlocked(draining)는 최신 draft 유효성·CAS·storage guard를 검사한다. draining은 자체 저장 완료 후 unmount된 후속 입력 처리이므로 오래된 busy/outstanding 렌더 값만 제외한다.
- save(draining)도 동일 guard 계약을 지킨다. 실패는 초안 보관과 오류 표시로 처리한다.
- NativePropertyEditor 담당 워커에게 API와 ACK 동시성 주의점을 전달했다. 해당 파일은 직접 수정하지 않았다.

## 검증

- fake timer 기반 debounce/IME/busy/실패 재시도 억제, 복구 mount, unmount flush/drain, 생성 후 patch, ACK 연속 입력 테스트를 추가·갱신했다.
- 계획: [자동저장 계획](../../docs/planning/2026-10-08-Editor-AutosavePlan.md).
- 테스트 드라이버는 React hook/effect를 모델링하며 실제 브라우저 IME E2E 검증은 포함하지 않는다.
- 담당 7 suites / 62 tests 통과. 대상 13개 소스·테스트 Prettier check 및 diff check 통과.
- 웹 typecheck는 담당 파일 오류 없이, 동시 작업 중인 native-auxiliary-component-parity.test.ts:38 / native-clipboard-interaction.test.ts:35 / native-condition-hints-ui.test.ts:39의 optional deps 타입과 NativeERDCanvas.interaction.test.ts:281의 id 타입 오류로 실패했다.
- 오너 지시에 따라 git add/commit을 실행하지 않았다. 이 작업에서 생성한 커밋은 없다.

## 오너 커밋 대상

모든 소스 경로는 `apps/web/src/features/projects/` 기준이다.

- use-native-autosave.ts
- native-editor-form.tsx
- NativeCanvasInputForm.tsx
- native-editor-structure.tsx
- native-editor-draft.ts
- native-save.ts
- NativeCanvasInputForm.test.ts
- native-editor-autosave.test.ts
- NativeEditorForm.concurrent.test.ts
- native-continuous-editing.test.ts
- native-editor-draft.test.ts
- native-draft-archive.test.ts
- native-export-state.test.ts
- docs/planning/2026-10-08-Editor-AutosavePlan.md
- docs/work-log/2026-10-08-Editor-AutosaveResult.md
