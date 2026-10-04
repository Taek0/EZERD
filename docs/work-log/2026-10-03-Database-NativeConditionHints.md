# Native 조건 안내 가독성 결과

2026-10-03. 계획: [Native key 및 typed literal 조건 안내](../planning/2026-10-03-Database-NativeConditionHints.md). PG 대표 브라우저 QA에서 확인한 키 후보 내부 condition 코드 노출을 수정했다.

## 변경

- `NativeOrderedColumns`가 `eligibility.conditions`의 원시 문자열을 이어 붙이던 부분을 기존 `nativeEditorConditionText` mapping으로 변환했다. 선택값, 후보 순서, disabled 조건, engineAllowed/productUsable 및 ready/eligibility 판정은 변경하지 않았다.
- 실제 key policy의 여섯 조건인 `enum.definition-required`, `table.mode-validation-required`, `key.innodb-byte-limit`, `key.composite-byte-limit`, `key.btree-entry-size-limit`, `key.sqlite-null-rowid-semantics`를 한국어/영어 안내로 등록했다. PG의 실제 값 크기 제한을 고정 숫자 한도로 단정하지 않는다.
- 현재 PG bounded typed family의 search/multirange/array/snapshot 코드 8개와 XML/jsonpath도 공유하는 형식·지원 문법·길이 코드 3개를 같은 패턴으로 안내했다. 빈 배열만 지원하는 범위, 선언 차원의 실제 차원 비강제, 단일 search lexeme, snapshot 순서/개수 경계를 설명한다. parser 지원이나 readiness를 확대하지 않았다.

## 검증

- `pnpm exec vitest run`으로 아래 전용 4개 파일: **64 PASS / 0 FAIL**.
  - 새 `native-condition-hints-ui.test.ts`: **13개**. 한국어/영어의 모든 17개 mapping 확인. 실제 PG/MySQL/SQLite key 정책을 소비한 React markup에서 원시 condition 코드 부재, enabled selected 옵션 유지, 정책/문서 불변 확인. 실제 ENUM/SQLite declared 조건도 기존 선택 유지 확인.
  - XML/jsonpath/search/multirange/array/snapshot의 실제 미지원 입력을 durable draft로 저장해 `NativeFormatEditor` 렌더링. 실제 policy 거부, plain 안내, submit 차단, exact draft/before/counter 및 문서 보존, save 미호출 확인. coverage를 위조하거나 candidate를 previous로 넣지 않았다.
  - 기존 `native-editor-diagnostic.test.ts`, `native-key-readiness-ui.test.ts`, `native-editor-option-policy.test.ts`도 통과.
- `pnpm --filter @ezerd/web typecheck`: PASS.
- 수정 TS/TSX/test 3개 파일 targeted Prettier check: PASS. 문서는 루트 `.prettierignore`에 따라 별도 유지한다.
- 전체 check/build 및 브라우저 재검증은 이 단위에서 수행하지 않았다. 실제 interactive 이벤트 전체 테스트를 주장하지 않으며 부모 최종 browser/check와 Singer QA 범위를 보존했다.

## 파일 범위

1. `apps/web/src/features/projects/native-editor-diagnostic.ts`
2. `apps/web/src/features/projects/native-editor-structure.tsx` (조건 표시 한 줄)
3. `apps/web/src/features/projects/native-condition-hints-ui.test.ts` (새 파일)
4. `docs/planning/2026-10-03-Database-NativeConditionHints.md`
5. 이 결과 문서

engine/model/policy/readiness/server 및 `docs/EZERD.txt`는 수정하지 않았다. 부모의 진행 기록·validation test·브라우저 QA 변경은 커밋에 포함하지 않는다.

## 도움말 안내 후속 결과

부모의 추가 요청에 따라 `HelpDialog.tsx`의 과거 “DB 종류는 분류 정보 / PostgreSQL 기준” 설명을 한국어/영어 모두 현재 native 동작으로 바꿨다. PostgreSQL·MySQL·SQLite별 타입과 검증된 기능, 선택 DB의 전체 물리 설계 DDL, preview 이후 apply 시 최신 상태 재검증과 확인된 변환 범위, 미지원/의미 손실 차단을 안내한다. 구버전은 native 기능을 쓰려면 명시 업그레이드가 필요하며 변환 불가 원문이 진단과 함께 보존됨을 설명한다. 기존 v1 import/export 사용 자체가 업그레이드를 강제한다고 표현하지 않는다.

- 새 `HelpDialog.test.ts` 2개: 실제 컴포넌트의 한국어/영어 SSR markup에 최신 안내가 표시되고 과거 설명은 없음을 확인. 기존 제목 연결·도움말 섹션·닫기 버튼 유지 확인. portal은 테스트에서만 표시 내용으로 전달하며 실제 modal focus lifecycle 검증을 주장하지 않는다.
- 도움말 2개 + `native-condition-hints-ui.test.ts` 13개 = **15 PASS / 0 FAIL**.
- web Typecheck 및 도움말 TSX/test targeted Prettier check PASS.
- 후속 파일: `HelpDialog.tsx`, 새 `HelpDialog.test.ts`, 기존 계획/결과 문서. 원래 조건 hint 커밋 `ff93235`는 보존하며 후속 독립 커밋으로 분리한다. engine/policy/readiness는 변경하지 않았다.
