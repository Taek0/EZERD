# C7 고급 인덱스·제한 AST 편집 UI 결과

- 계획: [NativeAdvancedEditorUI](../planning/2026-10-02-Database-NativeAdvancedEditorUI.md). 담당 UI 소비 단위 ready. model/compiler/validation/index.ts/server/App/NativeProjectView 및 부모 `native-editor-option-policy.ts`는 수정하지 않았다. git add/commit/full check/build/browser QA는 부모 담당이다.

## 실제 소비와 입력 보존

- 새 `NativeAdvancedEditor`는 현재 테이블의 신규/기존 index·CHECK·컬럼 default/generated 식을 선택한다. NativeStructureEditor에는 import 및 선택 테이블에 컴포넌트 하나만 연결했다. 기존 basic create/patch/delete 및 single comparison/type/generation UI는 보존했다. 부모 NativeProjectView는 기존 editable 분기로 구조 편집기를 연결하고 있어 별도 App/View 수정은 필요하지 않다.
- `NativeExpressionTreeEditor`는 literal/null/column/call/unary/binary/isNull/IN을 recursive fields로 생성·편집한다. AND/OR/NOT/합/비교 wrap은 기존 전체 subtree를 유지한다. 함수 인자/IN 값은 추가·제거·순서 변경 가능하고 index key parts도 개별 식/정렬/prefix와 순서를 갖는다. 임의 SQL/AST JSON textarea를 제품 흐름에 노출하지 않는다.
- draft boolean도 문자열이며 true/false 완성 뒤에만 boolean을 만든다. 숫자/binary/json/typedText 입력은 원문 token으로 보관한다. 빈 값/20e/부분 boolean/JSON 등은 draft 구조로는 유지하고 실제 token·expression policy에서 저장을 차단한다. Number0/NaN/false로 자동 대체하거나 식을 single comparison으로 flatten하지 않는다. prefix만 완성된 양의32bit 정수 문자열을 확인한 뒤 Number로 변환한다.
- native AST/native draft 변환은 schema 검증 후 parser-normalized 값을 사용하지 않고 raw identifiers/tokens를 유지한다. depth32/nodes1024 및 각 args/IN/parts32, 문서/식1.5MB 한도를 적용한다. safe addressing은 고정 child slots/list indices만 허용하며 proto path, 손상/cyclic/과도한 draft는 차단·보존한다.
- 기존 unsupported/외부 DB 함수는 현재 원문으로 표시하고 새 목록은 현재 DB builtin union만 제공한다. default의 column reference는 선택/검사에서 차단하고 컬럼 후보는 현재 테이블 physical scope만 보여준다. 결과 family/함수 arity/type/purpose/volatile/target type과 generated dependency cycle는 실제 policy/전체 후보로 검사한다.
- default/generation은 preserve/명시 replace/clear를 구분한다. before.originalJSON 및 originalTypeJSON이 현재 source와 다르면 차단하고 rebase 이후도 metadata가 일치해야 한다. legacy default 원문과 identity 전체 sequence/mode/generation은 replace 전 그대로 남는다. patch_column은 defaultValue 또는 generation 하나만 보내며 type/다른 default/generation/options를 자동 제거하지 않는다.
- 신규 index/CHECK ID는 NativeEditorForm의 durable 값에 보관하며 reopen에서 새 runtime seed ID로 갈아끼우지 않는다. matching ACK 후 version/sequence remount는 다음 신규 객체 seed를 새로 생성한다. 기존 index rename은 minimal patch{name}로 만들고 변경하지 않은 parts/options의 명시 false/empty attribute·전체 AST를 유지한다.
- NativeEditorForm을 재사용하므로 dirty/error/stale/storageFailure/pending export blocker, input revision, expected version/sequence/revision 및 matching ACK 소비가 기존과 같다. table/actor/project/context별 draft keys를 사용하며 readonly/busy/archived/logical table은 저장·입력을 차단한다. 저장 버튼은 allowed와 실제 usable/write policy가 모두 통과한 경우에만 활성화된다.

## 인덱스 정책 소비

- PG는 btree/hash/gist/spgist/gin/brin와 실제 default-opclass 타입/식 결과를 `nativePostgresIndexMethodDecision`으로 판단한다. INCLUDE/nulls-not-distinct/predicate/unique/order/parts 등의 후보는 현재 common engine validator로 검사한다. MySQL은 btree/fulltext/spatial/invisible/prefix만, SQLite는 predicate만 보여준다. 다른 DB 옵션은 원문으로 표시하고 현재 DB union으로의 명시 교체만 제공한다.
- method/options choices는 product usable로 draft 편집을 닫지 않는다. 실제 allowed로 선택·이유를 계산하고 unsupported 조합은 disable/diagnostic으로 설명한다. 현재 method/root option을 유지하는 경우엔 읽기/복구를 위한 현재 선택을 표시한다. 기존 잘못된 method를 repair하는 probe는 실제 해당 index patch로 검사하여 기존 객체 때문에 모든 대안이 막히지 않도록 했다. 새 probe ID/name은 source와 충돌하지 않게 만든다.
- 후보는 전체 NativeDesignDocument clone에 정확한 add_index/patch_index/add_check/patch_check/patch_column을 적용한 상태다. full native contract, raw1.5MB budget, native graph, engine inspector, write validator 및 expression/generation/method/feature readiness를 검사한다. candidate/source를 previous로 지정하거나 coverage/verified를 주입하지 않는다.
- 부모 staging basic124 types/table/column/schema/comments/enumColumn/setColumn/charset/collation/strictTable 활성화 후보는 그대로 소비했다. 전체 catalog=false를 tests의 전제로 삼지 않는다. 새 AST/index/generation 조합은 현재 advanced 정책의 실제 usable=false 및 advanced feature gates로 저장이 차단된다. API usable bool을 UI에서 hardcode/승격하지 않았으며 부모 최종 activation 결과를 그대로 소비한다.

## 부모 필수 확인과 제한

1. 부모의 `native-editor-option-policy.ts` effective MySQL charset literal/key facts 연결을 직접 수정하지 않고 공개 helper를 import했다. expression/default/generated 정책 usable bool과 index/advanced feature 활성화 및 최종 전체 세로 경로 QA는 부모 후속이다.
2. 현재 public index-policy의 명시 method API는 PG 전용이다. MySQL/SQLite 전체 옵션은 공통 `inspectNativeDatabaseDocument`로 소비한다. 부모가 공통 full nativeIndex decision API를 추가하면 이 helper에서 같은 정책으로 일원화할 수 있다.
3. 의미 테스트에서 MySQL functional expression part+prefix가 현재 공통 validator에서 allowed로 남는 것을 확인했다. 새 helper는 이 미검증 조합을 `index.expression-prefix-policy-required`로 차단한다. UI에서 SQL cast/길이 추정을 하거나 임의 조합을 허용하지 않는다. 부모 공통 model validator/compiler의 동일 조합 차단 및 정책 API 소비를 보완해야 한다. 제품 지원 범위를 새로 승격하는 근거는 아니다.
4. 생성 식 virtual/stored의 engine 조건은 공개 generation/expression 정책과 전체 candidate에 따라 판단한다. 자기 참조는 전체 engine dependency 검사에서 차단한다. 현재 scope UI는 해당 테이블의 물리 후보만 제공하지만 DAG 편집/general casts/subquery/opclass/custom functions/raw SQL은 지원하지 않는다.
5. 실제 enabled advanced command 저장/DB DDL 실행·브라우저 interaction은 이 단위에서 실행하지 않았다. candidate/typed command 준비와 현재 차단 경로, helper tree mutations 및 static UI semantics를 검사했다. 부모 activation 뒤 index6methods/DB options 및 default/generated/check/predicate/expression key의 실제 저장·replay·브라우저 재열기·DB execution을 검증해야 한다.

## 검증

- main은 현재 basic124 타입 활성화 후보의 실제 source/dist에서 tree/advanced/helper/static54개를 다시 통과했다. MySQL functional expression에 prefix를 붙이는 미검증 조합은 common validator에도 `index.expression-prefix-policy-required`로 연결했다. root 입력 복구 변경과 native-editor-structure 같은 파일의 최소 UI 연결을 index snapshot으로 분리하여 커밋하며 root form recovery 최종 연결은 별도 단위다.

- 실제 model/contracts source를 사용하는 targeted Vitest config를 ignored `.data/native-advanced-editor.vitest.ts`에 두었다. 정책 함수를 mock하거나 source flags를 위조하지 않았다.
- 새 tree policy/advanced policy/static UI3개 files **43개 통과**. 기존 `native-editor-ui.test.ts` **11개 통과**(수정 없이 확인), 최종 합계4files **54개 통과/skip0**. 최신 source paths/Vite ambient 및 web tsconfig로 담당10개 구현/tests와 실제 dependencies를 검사한 TypeScript program **diagnostics0**. columnId callback narrowing/generation storage literal typing 및 form before record 타입 오류를 해소했다. 최종 담당10개 파일 targeted Prettier 및 tracked diff whitespace 검사가 통과했다. 전체 check/build/browser 및 git add/commit은 수행하지 않았다.
- 복합 AND/call/arithmetic/IN, wrap/주소 변경/원문 roundtrip, bigint strings, incomplete tokens/boolean, functions/purpose/foreign/logical refs, budget/cyclic/손상 draft, 세 DB options union, opclass와 PG method repair, MySQL fulltext/spatial/prefix/functional, predicates/include, minimal rename/raw 옵션 보존, legacy/identity before/type 보존, generated cycle, durable new CHECK identity, 현재 advanced save 차단, readonly/static integration을 검사했다.

## 변경 파일

1. 새 `apps/web/src/features/projects/native-expression-tree-policy.ts`
2. 새 `apps/web/src/features/projects/native-expression-tree-policy.test.ts`
3. 새 `apps/web/src/features/projects/native-expression-tree.tsx`
4. 새 `apps/web/src/features/projects/native-advanced-policy.ts`
5. 새 `apps/web/src/features/projects/native-advanced-policy.test.ts`
6. 새 `apps/web/src/features/projects/native-index-options.tsx`
7. 새 `apps/web/src/features/projects/NativeAdvancedEditor.tsx`
8. 새 `apps/web/src/features/projects/native-advanced-editor-ui.test.ts`
9. 새 테스트 helper `apps/web/src/features/projects/native-advanced-test-fixtures.ts`
10. 기존 `apps/web/src/features/projects/native-editor-structure.tsx`의 최소 연결
11. [계획](../planning/2026-10-02-Database-NativeAdvancedEditorUI.md)
12. 이 작업 기록
