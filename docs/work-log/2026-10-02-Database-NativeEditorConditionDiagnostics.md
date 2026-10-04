# Native 고급 편집 조건 안내 결과

- 계획: [NativeEditorConditionDiagnostics](../planning/2026-10-02-Database-NativeEditorConditionDiagnostics.md). 실제 브라우저에서 보고된 빈 table 고급 index method 라벨의 전체 ZodError JSON 노출을 helper/static UI 경로로 재현·수정했다. git add/commit은 하지 않았다.

## 변경 동작

- `nativeEditorErrorCode`는 실제 ZodError issue의 code/path를 분류한다. 빈 columnId는 `expression.column-required`, 빈 parts는 `index.key-parts-required`, 그 밖의 schema 오류는 `native.input-shape-invalid`로 만든다. 임의 Error/SyntaxError 메시지는 bounded diagnostic code 외에 그대로 사용하지 않는다. zod 직접 의존성을 추가하지 않고 현재 계약 schema가 반환하는 실제 Error/issue 구조를 소비한다.
- `nativeIndexCandidate`는 empty parts를 먼저 확인한다. 선택 table에 물리 컬럼이 없으면 `index.key-columns-required`, 컬럼은 있지만 key part가 없으면 `index.key-parts-required`를 반환한다. 다른 테이블 컬럼이나 logical 컬럼은 물리 후보로 계산하지 않는다. 원래 source/draft/ID/token과 allowed/usable·coverage는 변경하지 않는다.
- 새 `nativeEditorConditionText`는 코드와 사용자 안내를 분리한다. 한·영으로 컬럼/키 추가, 입력 완성, 함수 인자, 타입/인덱스 방식, prefix, 참·거짓 조건, 복구/문맥 변경 등을 안내한다. unknown code도 원문/JSON 대신 입력 확인 안내로 처리한다.
- 고급 index method labels/status/진단 및 tree 함수 labels/local status/root status/catch가 같은 안내를 소비한다. schema JSON, 내부 Error.message, raw path/code를 제품 라벨에 출력하지 않는다. 내부 candidate의 affected object ID/path/code 진단은 보존한다.
- 후속 부모 명시 배정으로 format generation/default/builtin/ON UPDATE choices 및 입력 진단도 같은 helper를 소비한다. generation probe catch와 `nativeFormatDraftIssue`의 Zod 오류를 코드로 분류하고, 해당 선택지·현재 default 상태·입력 오류에는 양 언어 조건 안내를 표시한다. productUsable이 true인 생성 선택지에는 검증 미완료 안내를 덧붙이지 않는다. before/legacy/current display 및 입력·type reset·저장 조건은 보존한다.
- 기존 공통 validator의 functional expression+prefix 판정 소비 후속 diff 및 부모/Singer recovery/기본 타입 활성화 diff는 보존했다. 이 단위에서 model/서버/readiness/NativeProjectView/native-editor-structure/native-editor-option-policy를 수정하지 않았다.

## 검증

- 실제 model/contracts source alias의 ignored `.data/native-editor-condition-diagnostics.vitest.ts`로 targeted7files **121개/skip0 통과**. 정책/schema를 mock하거나 coverage를 주입하지 않았다.
- 고급/tree/기존 editor56개에 진단 regression14개를 더하고 format11개와 기존 option-policy40개를 함께 검사했다. actual schema error의 column/parts/generic 분류, parser/runtime 메시지 비노출, 양 언어 safe fallback, 세 DB 빈/논리 컬럼 table, method 옵션과 저장 disabled, malformed command ID, 원문 draft/source·onChange/onSave 무변경을 확인했다.
- 마지막 tree UI negative assertion은 영문 original 단어와 JSON origin field를 구분하도록 escaped schema key를 검사한다. 완성되지 않은 숫자/boolean/foreign 함수 및 기존 recovery 검사도 통과했다.
- format11개는 세 DB blank computed probes, persisted generation draft의 빈 columnId 및 `20e` 원문, 실제 localStorage archive 재읽기, JSON처럼 보이는 legacy 원문과 exact identity sequence/before, DB별 default function 및 MySQL ON UPDATE 조건 안내를 검사한다. 기존 option-policy UI 기대값2개는 raw code 대신 조건 안내를 검사하도록 바꿨으며 내부 정책 code 검사와 나머지40개 검증은 유지했다.
- 최종 담당15개 root files와 실제 source dependencies TypeScript diagnostics0, 변경12개 코드 targeted Prettier 및 tracked diff whitespace 검사 통과.
- 부모 보고의 전체 check2111/skip312 및 전체 build 통과 이후의 WIP 단위다. 이 변경을 그 전체 snapshot의 완료 증거에 포함하지 않는다. 이 단위에서는 전체 pnpm check/build를 실행하지 않았다.
- 실제 브라우저 재검증·enabled advanced DB 저장은 실행하지 않았다. 부모 브라우저 QA에서 새 column 없는 table의 method dropdown과 생성 option probe를 다시 확인해야 한다.

## 부모 통합 사항

- main targeted121개를 다시 통과했다. 최신 web build/typecheck 후 실제 브라우저에서 INTEGER 키 후보에 btree/hash/brin을 표시하고 gist/spgist/gin은 해당 타입 조건 안내와 함께 비활성화하는 것을 확인했다. 옵션 라벨은 schema JSON 대신 사용자 조건으로 표시된다. 저장 미검증 상태도 유지하며 본 단위가 advanced usable를 올리지 않는다.

- format scope 추가 배정분도 실제 연결을 완료했으므로 별도 adapter 수정은 필요 없다. 부모는 새 helper/test 및 format 회귀 tests를 같은 독립 진단 단위에 포함하면 된다. JSON처럼 보이는 legacy/user 원문은 의도적으로 원문 display에 남기므로 schema JSON 비노출 검사는 diagnostic/choice 경로를 대상으로 한다.
- 부모 브라우저 QA에서 rebuilt 새 table method labels와 일반 column의 generation/default choices를 재확인해야 한다. 실제 브라우저 재실행 및 전체 core check는 이 단위의 증거로 주장하지 않는다.

## 이번 단위 파일

- 새 helper/test: `apps/web/src/features/projects/native-editor-diagnostic.ts`, `native-editor-diagnostic.test.ts`.
- 고급 정책/test: `native-advanced-policy.ts`, `native-advanced-policy.test.ts`.
- tree policy/UI: `native-expression-tree-policy.ts`, `native-expression-tree.tsx`.
- index UI/고급 form/UI test: `native-index-options.tsx`, `NativeAdvancedEditor.tsx`, `native-advanced-editor-ui.test.ts`.
- format/UI 회귀: `native-editor-format.tsx`, 새 `native-editor-format-diagnostic.test.ts`, 기존 `native-editor-option-policy.test.ts` UI 기대값2개.
- 새 계획과 이 작업 기록. 이전 AdvancedEditorUI 계획/결과의 unstaged 후속 기록은 그대로 두었다.
