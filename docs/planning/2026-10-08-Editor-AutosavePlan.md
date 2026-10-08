# 자동저장 계획

- 범위: native-editor-form.tsx, NativeCanvasInputForm.tsx, 공용 hook 및 관련 테스트.
- 사용자 변경만 300ms debounce로 저장하며 IME 조합, busy, 검증 실패, 저장 중에는 대기한다.
- mount 및 복구 초안은 자동 실행하지 않는다. 실패한 입력은 새 사용자 변경 전까지 재시도하지 않는다.
- ACK는 전송한 revision만 소비하고 이후 입력은 보존한다.
- NativePropertyEditor.tsx는 다른 워커가 공용 API 적용. 금지 파일과 전체 포맷은 건드리지 않는다.
- 대상 Prettier, 관련 Vitest, 웹 typecheck 후 담당 파일만 커밋한다.
