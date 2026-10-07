# Autosave quiet window 결과

계획: [AutosaveQuietWindowPlan](../planning/2026-10-08-Editor-AutosaveQuietWindowPlan.md)

## 구현

- use-native-autosave.ts: NATIVE_AUTOSAVE_QUIET_WINDOW_MS=750, NATIVE_AUTOSAVE_MAX_WAIT_MS=2000을 export한다. MAIN의 firstChangedAt 초안을 이어받아 마지막 입력 시각도 기록하고 min(남은 quiet window, 남은 maxWait)로 타이머를 계산한다.
- 입력은 즉시 로컬에 반영한다. ACK가 도착하거나 blocker가 해제돼도 quiet window를 새로 시작하지 않는다. 지속 입력도 저장 가능 상태라면 최초 미전송 입력 후 2초 이내에 save를 시작한다.
- IME, busy/blocked, ACK 대기는 deadline보다 우선한다. deadline이 이미 지났다면 해제 후 저장한다. ACK 대기 중 병렬 save는 발생하지 않는다.
- explicit flush, unmount flush, ACK 이후 unmounted drain, 동일 실패 revision 자동 재시도 금지, 명시적 입력 없는 복구 mount 미전송을 보존한다.

## 파일 범위

- 구현: use-native-autosave.ts.
- 새 테스트: use-native-autosave.policy.test.ts. 이관된 use-native-autosave.quiet-window.test.ts는 내용 보존, 포맷 및 검증 완료.
- 기존 autosave 시간 숫자와 import만 수정: NativeCanvasInputForm.test.ts, native-auxiliary-component-parity.test.ts, native-clipboard-interaction.test.ts, native-editor-autosave.test.ts, native-property-autosave.test.ts, native-continuous-editing.test.ts, NativeDomainEditor.autosave.test.ts, NativeAdvancedEditor.autosave.test.ts, NativeEditorForm.concurrent.test.ts, NativeCanvasInlineCell.test.ts.
- Canvas IME 시간 테스트는 composition 종료 때 이미 deadline이 경과했으므로 새 quiet window 대신 다음 타이머 turn에서 저장하도록 갱신했다. 다른 worker의 useContext/logical mock 수정은 보존했고 애니메이션 delay는 수정하지 않았다.

## 검증 및 측정 범위

- 11개 파일 94개 테스트 통과, 추가 InlineCell 1개 파일 40개 테스트 통과: 합계 12개 파일 134개 테스트.
- 웹 tsc --noEmit 통과(추가 InlineCell 숫자→상수 치환 전 실행).
- hook 및 정책 테스트 3개 파일은 대상 Prettier 적용/검사 통과. 기존 타이밍 파일 10개 중 9개 검사 통과. native-editor-autosave.test.ts는 다른 worker의 NativeLogicalMode mock 한 줄에서 포맷 경고가 있어 범위 준수를 위해 미수정했다.
- 대상 diff whitespace 검사 통과. Git add/commit 없음. ENUM/히스토리 완료 문서는 변경하지 않았다.
- fake timer pure hook save spy 기준: 100ms 간격 burst 1/2/5/12회 입력 각각 최종값 save 1회. 입력 12회 대비 save 1회(1/12)다. 200ms 간격 지속 입력 21회는 2초 경계에서 2회, 마지막 값 1회로 총 save 3회(3/21)다.
- 위 분모는 입력 이벤트 수다. 이전 정책 대비 실측 감소율이나 HTTP/실제 네트워크 전송량은 측정하지 않았다. ACK, 실패, 복구, IME, unmount/drain 동작도 hook/컴포넌트 회귀로 검증했다.
