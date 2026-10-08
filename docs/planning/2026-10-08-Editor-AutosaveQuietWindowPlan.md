# Autosave quiet window 계획

- 범위: use-native-autosave.ts, 새 use-native-autosave.policy.test.ts. 기존 NativeCanvasInputForm.test.ts, native-auxiliary-component-parity.test.ts, native-clipboard-interaction.test.ts는 autosave 시간 가정 및 상수 import만 수정한다.
- MAIN이 시작한 750ms quiet window / 2000ms maxWait 초안을 이어받아 정책 상수를 export한다. 로컬 입력은 즉시 유지하고 마지막 입력 시각과 첫 미전송 입력 시각으로 전송 시점을 계산한다.
- IME 중 전송 금지, ACK 대기 중 중복 전송 금지, unmount flush/drain, 실패한 동일 revision 자동 재시도 금지, 복구 mount 미전송을 보존한다.
- 1~N burst, 연속 입력 starvation, ACK 전후 입력, 실패/복구/unmount를 fake timer hook 테스트로 검증한다. 수치는 입력 이벤트 수를 분모로 한 hook save 호출 수이며 실제 네트워크 전송 측정이 아니다.
- 다른 worker의 mock 변경과 애니메이션 delay는 수정하지 않는다. ENUM/히스토리 완료 결과를 보존하고 Git add/commit은 오너가 수행한다.
- 이관 후 추가 범위: use-native-autosave.quiet-window.test.ts 검증/포맷, native-editor-autosave.test.ts, native-property-autosave.test.ts, native-continuous-editing.test.ts, NativeDomainEditor.autosave.test.ts, NativeAdvancedEditor.autosave.test.ts, NativeEditorForm.concurrent.test.ts의 autosave 타이밍 상수 참조. Canvas IME 테스트는 deadline 경과 후 composition 종료 시점의 즉시 저장 가정으로 갱신한다.
- 최종 검색에서 추가 확인한 NativeCanvasInlineCell.test.ts 역시 autosave 타이밍 및 상수 import만 수정한다.
