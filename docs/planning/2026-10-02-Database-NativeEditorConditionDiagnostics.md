# Native 고급 편집 조건 안내

- 기준: root AGENTS, 기능 명세/TypeFeatureMatrix 및 현재 진행 상태. 새 table의 physical column이 없을 때 method probe의 빈 parts가 ZodError.message JSON으로 노출되는 실제 브라우저 보고를 수정한다.
- 범위: 고급 index/tree helper·UI·전용 tests 및 새 진단 helper. 부모/Singer 변경과 기존 미커밋 공통 prefix 판정 소비를 보존한다. 후속 부모 명시 배정으로 native-editor-format.tsx의 generation/default choices 및 입력 진단도 같은 helper를 소비한다. before/legacy 원문 표시는 그대로 보존한다.
- ZodError는 issue의 code/path만 분류하여 안정적인 입력/컬럼/키 진단 코드로 변환한다. Error.message는 bounded diagnostic code만 유지하며 JSON/SyntaxError/기타 내부 문자열을 표시하지 않는다. 실제 draft/token/source는 변환하거나 버리지 않는다.
- 빈 index key 후보는 컬럼/키 조건을 먼저 검사한다. method labels/status 및 tree 함수·오류에 한국어/영문 조건 안내를 표시한다. unknown code도 원문 대신 일반 입력 안내로 처리한다. 정책 allowed/usable 및 coverage를 변경하지 않는다.
- 실제 schema 오류, 빈/논리 컬럼만 있는 table, 손상 draft, 외부 DB 함수, 입력 token 보존 및 두 언어 static UI를 targeted tests로 검증한다. targeted Prettier/source typecheck만 실행하고 git add/commit은 부모가 수행한다.
- 결과: [작업 기록](../work-log/2026-10-02-Database-NativeEditorConditionDiagnostics.md).
