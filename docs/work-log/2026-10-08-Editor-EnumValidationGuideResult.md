# ENUM QA-04 입력 안내 결과

- 계획: [EnumValidationGuidePlan](../planning/2026-10-08-Editor-EnumValidationGuidePlan.md).
- native-editor-form.tsx: submit catch의 Error.name === 'ZodError'만 기존 진단 코드/안내 경로로 변환한다. 다른 오류는 기존 message(error)를 유지한다.
- native-editor-diagnostic.ts: too_small의 정확한 value/values 또는 patch/values 경로를 enum.values-required로 매핑한다. 한국어는 “값을 하나 이상 추가해 주세요. 입력한 내용은 유지됩니다.”, 영어는 “Add at least one value. Your input is preserved.”다.
- native-editor-diagnostic.test.ts: 실제 add_enum/patch_enum schema 오류의 한·영 안내 및 빈 문자열 값 [''] 허용을 검증했다.
- NativeEnumDialog.continuity.test.ts: 실제 NativeEditorForm 포함 ENUM 전체 폼 경로에서 이름만 입력하고 750ms 후 사용자 안내, raw validator JSON 미노출, onSave 미호출, 이름/values[] durable draft 보존을 확인한다. 이후 빈 값 추가→생성 ACK→동일 ID 후속 편집 기존 회귀도 통과한다.
- 검증: 관련 5파일 22테스트, 웹 tsc --noEmit, 대상 Prettier 및 diff whitespace 검사 통과.
- QA-01/02는 오너/Faraday 브라우저 재검증 PASS 기록을 확인했다. QA-04는 코드/회귀 검증 완료이며 수정 후 브라우저 재검증은 이 작업에서 수행하지 않았다.
- 수정 파일은 위 4개 코드/테스트와 이 단위 계획·결과 문서다. 구조/계약 schema, autosave hook은 수정하지 않았다. Git add/commit 없음. 이 단위 완료 후 freeze한다.
