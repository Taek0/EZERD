# C6 native option 정책 UI 작업 기록

- 계획: [NativeOptionPolicyUI](../planning/2026-10-02-Database-NativeOptionPolicyUI.md).
- 상태: 담당 UI 정책 소비 단위 **ready**. Canvas의 human label baseline을 포함한 `3d87167` 커밋 이후 현재 파일을 확장했으며 기존 변경을 덮어쓰지 않았다. 제품 전체 옵션/coverage 활성화나 C7 복합 AST 편집 완료를 의미하지 않는다.
- 담당 외 파일, readiness/coverage 및 기존 draft/export blocker를 변경하지 않는다. git add/commit/전체 check/build는 실행하지 않는다.
- 필요한 default builtin/ON UPDATE/generation model API를 구체 요청했고 main에서 `nativeBuiltinDefaultDecision`, `nativeOnUpdateDecision`, `nativeGenerationDecision`을 공개 제공했다. 초기 임시 `nativeStructuredPolicyRequired`는 제거했으며 engine 허용을 UI에서 추정하지 않는다.

## 담당 변경 파일

| 파일 | 변경 |
| --- | --- |
| `apps/web/src/features/projects/native-editor-option-policy.ts` | exact literal/integer/boolean token, type-specific literal 후보, PK/UNIQUE 후보, 함수·identity/ON UPDATE 구조화 입력, 6개 model public API 판정 adapter |
| `apps/web/src/features/projects/native-editor-option-policy.test.ts` | 39개 전용 helper/UI 테스트. 현재 실제 정책과 false readiness를 검증하며 모델·coverage mocks 없음 |
| `apps/web/src/features/projects/native-editor-policy.ts` | 현재 DB 타입 필터, literal/키 정책 소비 및 기존 feature facts 유지 |
| `apps/web/src/features/projects/native-editor-format.tsx` | 허용 literal 종류/이유와 환경 복구 안내, 정확한 token draft, 함수/identity/ON UPDATE UI 및 실제 후보/patch guard, 기본값·생성 조합 검사 |
| `apps/web/src/features/projects/native-editor-structure.tsx` | key 후보의 허용·조건·bytes·미검증 사유, PK/UNIQUE 및 unique index 생성 후보 검증, 기존 부적합 키 보존·이름 수정 유지 |
| `apps/web/src/features/projects/native-editor-ui.test.ts` | 기존 11개 UI 회귀 유지. 타 DB 타입 노출을 요구하던 테스트를 현재 DB 필터 명세로 갱신하고 새 메모리 draft 캐시와 충돌하지 않도록 fixture actor/project를 격리. Canvas human label 테스트는 보존 |
| `docs/planning/2026-10-02-Database-NativeOptionPolicyUI.md` | 착수 계획 및 model API 제공 반영 |
| `docs/work-log/2026-10-02-Database-NativeOptionPolicyUI.md` | 이 결과 |

## 구현과 보호 정책

- `literalDecision`, `inspectNativeLiteralToken`, `keyEligibility` 및 새 option-policy의 3개 판정을 사용한다. engineAllowed와 productUsable를 분리하여 표시하고, 모든 신규 미검증 후보는 선택/명령/submit에서 차단한다. none 제거 및 현재 동일 값 보존은 복구 경로이며 coverage를 true로 바꾸는 예외가 아니다.
- literal 후보에 nullable/PK/SQLite STRICT/프로젝트 ENUM 값을 전달한다. 대표 token은 모델로 검증한 입력 힌트이며 기본값 자동 입력이나 전체 엔진 parser 지원 주장이 아니다. 실제 입력은 별도로 다시 검사한다. 돈/등록 객체 등 환경 의존 값은 환경 진단과 현재 원문 유지·명시 제거 복구 안내를 제공한다.
- 숫자/typedText/JSON/binary/string은 정확한 문자열로 보관한다. 미완성 `20e-`, 날짜 입력, 홀수 hex, malformed JSON, Unicode/NUL, boolean 미완성 입력을 0/NaN/false나 정규화된 JSON으로 저장하지 않는다. 캐시·타입 파라미터처럼 number 계약 필드만 완전한 bounded integer token 검증 후 숫자로 구성한다.
- 기본값 함수는 현재 DB의 native union만 제시한다. 0개 인자 clock/UUID의 목적 타입과 생성 조합을 `nativeBuiltinDefaultDecision`으로 검사한다. 인자가 필요한 함수는 입력 필요 이유로 차단하고, 기존 복합 식/인자는 raw default JSON을 그대로 보존한다. 복합 AST는 `default.expression-validation-required`/관련 model 진단으로 남긴다.
- MySQL ON UPDATE는 현재 값 유지, 명시 제거, 함수 후보로 구성한다. 실제 `nativeOnUpdateDecision`의 datetime/timestamp·current_timestamp·generation 조건을 적용한다. supported candidate라도 usable false면 options patch를 보내지 않는다. 기존 charset/collation/ON UPDATE 원문은 다른 옵션 변경 시 삭제하지 않는다.
- PG identity는 mode와 start/increment/min/max의 100자 이내 정확한 정수 문자열, cache 1…2147483647 및 optional cycle을 구조화한다. 원래 token의 부호/leading zeros를 정규화하지 않는다. 모델의 type별 BigInt 범위, descending 기본값, zero increment, cache, nullable/default 및 key/index 조건을 그대로 소비한다. 미변경 sequence 항목은 유지하며 cache 공백은 명시 옵션 제거이고 0 변환이 아니다.
- generation 변경은 `nativeGenerationDecision`에 effective nullable/default, PK 위치, WITHOUT ROWID, index 첫 컬럼/다른 autoIncrement 컬럼 facts를 전달한다. computed 식은 validation-required로 차단한다. 기존 generation을 건드리지 않는 복구 편집을 보존하고 nullable/default 수정으로 새로 발생하는 generation 불일치는 명령 생성 전에 차단한다.
- key 후보는 같은 table의 native physical 컬럼과 현재 DB type만 제공한다. MySQL 상속/컬럼 charset, generation, 단일 및 알려진 복합 문자열/바이너리 bytes를 검사한다. model 조건과 기존 selection의 부적합 이유를 표시하고 기존 invalid/missing selection은 조용히 대체하지 않는다. 복합 키 전체 DB 조건/미확인 opclass/복합 AST를 임의 승인하지 않는다.
- `NativeEditorForm`, draft 저장/ACK 소비, pending queue, export blocker, NativeView/App/nativeCanvas/server는 수정하지 않았다. dirty exact draft/before와 이전 DB revision 입력을 그대로 보관하고 stale/pending/invalid 상태에서 submit을 차단한다. parent canEdit/readonly 경로도 그대로 유지한다.

## 검증

- 담당 TS/TSX 6개 파일 targeted Prettier 적용/검사: 통과. docs는 루트 prettierignore 대상이다.
- option 정책/UI 50개 및 draft/save/export 회귀 24개를 포함한 5개 파일 targeted run은 **74개 통과**했다. 이후 병렬 durable queue/draft 변경이 같은 작업 트리에 반영되어 최종 재실행에서는 기존 save/export 회귀가 IndexedDB 없는 Node fixture 및 async 저장 API 전환으로 실패했다. 이 74개 전부의 최신 통합 성공을 주장하지 않는다.
- 최종 `pnpm exec vitest run apps/web/src/features/projects/native-editor-option-policy.test.ts apps/web/src/features/projects/native-editor-ui.test.ts apps/web/src/features/projects/native-editor-draft.test.ts`: **54개 통과**. 담당 helper 39개/UI 11개와 draft 회귀 4개다. 원래 고정 fixture ID는 병렬 RAM draft 캐시와 충돌하므로 프로젝트·사용자별로 격리했고 정책/storage mocks로 실패를 가리지 않았다.
- `pnpm exec vitest run apps/web/src/features/projects/NativeProjectView.test.ts -t "without write actions"`: **1개 통과**, 나머지 관련 없는 1개 미선택. readonly에서 write action이 없음을 확인했으며 해당 파일은 수정하지 않았다.
- TypeScript compiler API를 사용해 담당 구현/테스트 6개 파일만 rootNames로 지정하고 web tsconfig의 noEmit/JSX/module 옵션으로 검사했다. 초기 exactOptionalPropertyTypes 오류는 model NativeGeneration 후보를 먼저 만들고 계약 검증 후 원본 후보를 반환하여 수정했다. 새로운 model option API adapter에도 type 오류가 없다.
- 중간 타입 검사에서 병렬 `native-durable-queue.ts` 61/62/65/161행의 optional Promise에 undefined를 대입하는 오류 4개를 확인하여 main에 전달했다. 해당 담당이 수정한 최신 소스에서 담당 6개 구현/테스트 rootNames를 사용한 **최종 targeted 타입 검사는 통과**했다. 담당 외 파일을 수정하지 않았다.
- `git diff --check`: 통과. 전체 pnpm check/build 및 git add/commit은 실행하지 않았다.

## 메인 통합과 남은 범위

- main의 model public option-policy export/shared 산출물과 이 UI 소비 변경을 함께 통합한다. 임시 policy-required fallback은 없으며 실제 API의 engine 조건·명시 진단·usable false를 유지한다.
- readiness/coverage 활성화는 실제 전체 경로 evidence 검증 후 main만 수행한다. UI unit fixtures나 문자열 후보 준비를 coverage 증거로 승격하지 않는다.
- 신규 지원되지 않은 인자/복합 AST의 결과 타입 추론·다차원 생성식 편집·설치 환경 승인은 C7/후속 정책 범위다. 현재 UI가 문자열 SQL이나 임의 cast로 이를 보완하지 않는다.
- 대상 DB 실제 실행 evidence/서버 validation/DDL/MCP 및 durable queue 변경은 각 담당 범위이며 이 작업에서 변경하지 않았다. 새 IndexedDB 기반 저장에 맞춘 기존 native-save/project-ddl-export 회귀 fixture 갱신 및 전체 check/독립 commit은 main/저장 담당이 수행한다.
