# ENUM QA-04 입력 안내 계획

- 사용자 승인 범위: native-editor-form.tsx의 submit catch에서 Error.name==='ZodError'만 기존 nativeEditorConditionText(nativeEditorErrorCode(error))로 표시한다. 그 외 message(error)는 보존한다.
- native-editor-diagnostic.ts/.test.ts에 value/values 또는 patch/values too_small을 enum.values-required로 매핑하고 한/영 안내를 추가한다.
- 구조 편집기·계약 schema·autosave hook은 변경하지 않는다. MAIN의 구조 분기 이관 제안보다 최신 사용자의 최소 수정 범위를 따른다.
- 실제 ENUM 폼 회귀에 값0개 입력의 안내/noSave/draft 보존을 추가하고, 이후 빈 문자열 값1개 생성·ACK 연속 입력 검증을 유지한다. 검증 후 freeze한다.
