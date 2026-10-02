# C6 native 기본값·키 정책 UI 소비

- 기준: 루트 AGENTS, [기능 명세](2026-10-01-Database-CapabilitySpecification.md), [타입·기능 명세](2026-10-01-Database-TypeFeatureMatrix.md), [진행 상태](../work-log/2026-10-01-Database-ImplementationProgress.md). 앞 C8 단위는 `3358b4c`, main public wiring은 `10027d5`다.
- 담당 write set: `native-editor-policy.ts`, `native-editor-format.tsx`, `native-editor-structure.tsx`, 새 UI option helper와 전용 테스트, 이 계획/작업 기록. model/index/catalog/validation/DDL/NativeProjectView/App/nativeCanvas/server를 변경하지 않는다. 기존 병렬 변경을 보존하고 Canvas human label 변경의 main 커밋 전에는 겹치는 format/UItest 파일을 수정하지 않는다.
- `literalDecision`, `inspectNativeLiteralToken`, `keyEligibility` public API를 사용한다. engineAllowed와 productUsable/coverage를 분리한다. none 제거 및 동일 현재 값 보존을 신규 활성화와 구분하고 gate를 승격하지 않는다. 새 literal 선택에는 타입·nullable/PK/STRICT/ENUM 및 입력 token 정책을 적용한다. 설치 환경이 필요한 PG 특수 literal은 원문 유지·복구 안내로 표시한다.
- 숫자/JSON/typedText/binary는 exact string draft를 보관하고 형식 오류를 0/NaN/false로 변환하지 않는다. before/type/default/generation/options 원본은 변경한 필드 이외에는 유지한다. 타입 파라미터/cache 등 실제 number 계약 필드만 완전한 bounded integer token 확인 뒤 변환한다.
- 현재 DB 타입·함수 union만 목록으로 제시한다. PK/UNIQUE 후보는 소유 table/scope/context/charset/generation과 model eligibility의 조건·이유를 표시한다. 기존 부적합 선택은 현재 원문으로 남기고 신규 후보로 사용하지 않는다.
- builtin default 함수(0개 인자 및 인자 필요 이유), MySQL ON UPDATE, PG identity mode/sequence의 bounded 구조화 입력과 patch 후보를 준비한다. 이들의 세부 engine/product policy public API가 없으면 허용을 추정하지 않고 main에 구체 export를 요청하며 연결 전 신규 쓰기는 차단한다.
- 기존 NativeEditorForm의 durable draft/before/dirty/error/pending/revision/export blocker 및 parent canEdit 경로를 유지한다. readonly와 DB 문맥 변경 입력을 우회하지 않는다.
- 대상 Prettier, 전용 UI/helper 및 기존 draft/save 관련 테스트, targeted TypeScript 검사만 실행한다. 전체 check/build 및 git add/commit은 main 담당이다.
- 결과: [작업 기록](../work-log/2026-10-02-Database-NativeOptionPolicyUI.md).
- 후속 main 연결: `nativeBuiltinDefaultDecision`, `nativeOnUpdateDecision`, `nativeGenerationDecision` public export와 shared build를 제공받았다. 임시 policy-required 차단은 제거하고 실제 model 판정에 UI 후보·이유·명령 생성 guard를 연결한다. complex AST는 해당 API의 validation-required 진단을 유지한다.
