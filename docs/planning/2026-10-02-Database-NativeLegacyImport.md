# Native legacy import provenance와 ENUM 호환 계획

- 기준 HEAD `aa22d10`. root 지침, [DB 명세](2026-10-01-Database-CapabilitySpecification.md) 6.1/6.2, TypeFeatureMatrix, ImplementationProgress 및 기존 NativeTransfer 계획/결과를 읽었다. source JSON/token/labels와 개인 상태 격리 원칙을 유지한다.
- 담당 범위는 NativeTransferService, 새 shared/native-import-provenance helper/테스트, 새 native-transfer-legacy integration 및 이 계획/동명 work-log다. 이력의 unsafe ENUM restore는 원인과 계약 필요성을 보고한 뒤 명시 차단에 필요한 작은 hunk만 연결한다. 기존 validation/index/model/gate/ordinary clipboard/retired ID 정책은 수정하지 않는다. git add/commit은 main 담당이다.

## 새 프로젝트 ID 범위

- legacy type.original.enumId가 있는 source는 새 project UUID 범위에서 전체 entity/node ID를 보존한다. 원본 legacy JSON 내부의 ID를 바꾸지 않고 matching ENUM 정의와 전체 참조를 함께 유지한다. 일반 source는 기존 fresh ID remap을 유지한다.
- 구조/중복/예약 ID 및 graph는 source와 저장 candidate 모두 검사한다. source project metadata/status/counters/ledger/baseline/tombstones/개인 state는 가져오지 않는다. 새 project 생성 전용 경로의 정책이며 기존 project나 clipboard/restore의 retired ID 발급에는 적용하지 않는다.

## v2 legacy 검증

- v1은 기존처럼 서버 migration 결과에서 previous를 생성하는 복구 예외를 유지한다.
- v2 전체 candidate를 previous로 쓰지 않는다. 최소한의 v1 표현으로 서버 migration을 재실행해 실제로 재현되는 legacy type/default/namespace와 legacy ENUM 참조 정의만 검증 마스크에 넣는다. native 필드는 마스크에 신뢰 복사하지 않는다.
- 원본 후보 전체를 fresh write로 검사한 결과와 마스크 검사 결과를 대조한다. suppression은 재현된 legacy 필드의 unresolved/origin 및 그 v1 기본 table/column/참조 ENUM 구조의 정확한 원인에 한정한다. native 타입 readiness, 추가 generation/options, 키/FK/index/check, context, graph, 식/이름/값 오류는 계속 전체 검사한다. 마스크가 우연히 동일 오류를 갖더라도 허용 목록 밖 native 오류는 되살려 차단한다.
- source2 raw shape/canonical 검사, 원본/최종 문서 1.5MB 및 transfer 2MB 예산을 유지한다. client source coordinate/진단/태그가 전체 후보의 쓰기 신뢰 근거가 되지 않는다. versioned native preview는 기존대로 서버 재계산 값과 일치해야 한다.
- 검증된 원본 설계 및 canonical JSON UTF-8 SHA-256, source/target context, 마스크와 identity mapping 정책/hash를 project.imported audit에 기록한다. JSONB의 키 순서 변경과 원문 문자열/token 변경을 구분한다. 권한/활성 workspace 확인과 새 project/audit는 같은 transaction이다.
- MySQL 중앙 물리 정책의 byte-budget unknown은 서버 마스크와 type/generation/column 및 table 옵션이 정확히 같은 proven legacy type 경로에 한해서 복구한다. table 전체 row/column budget이나 새 native 옵션의 오류는 fresh 검증 결과에 유지한다.

## 이력 ENUM 복원 경계

- 같은 project에서 삭제된 ENUM 정의를 fresh ID로 복원하면 원문 legacy enumId가 예전 ID를 계속 가리킨다. 새 project import의 ID 보존을 이력에 적용하면 retired ID 정책을 우회한다.
- live matching ENUM이 남은 legacy column 복원은 기존 정책을 유지한다. ENUM 정의까지 삭제된 경우는 원문 origin→새 live enum을 구분하는 추가 모델/계약이 필요하다. 이번 단위에서 그 계약을 새로 만들거나 ordinary remapper를 완화하지 않고 명시 진단으로 차단한다.

## 검증

- 실제 AppModule + isolated DB API에서 세 DB v1 legacy ENUM 및 안전한 native2 legacy export/import, 독립 project namespace, 원문/labels/공유 canvas/private 제외, 예산, 권한/보관 workspace, rollback을 검증한다.
- unverified native 타입/옵션/keys/FK/index/check, changed/dangling legacy references, namespace/type의 위조 origin, context/source metadata 및 preview 변조는 차단한다. 이력에서 live ENUM column restore와 unsafe deleted ENUM restore의 경계를 확인한다.
- targeted format, helper 및 관련 integration, strict TypeScript만 실행하며 전체 pnpm check/build는 main 담당이다. 변경된 정책 때문에 과거 transfer 테스트의 구체 기대값을 교정해야 하면 기존 파일을 직접 수정하지 않고 main에 hunk/새 동작을 보고한다.

## Basic activation 이후 승인된 transfer QA 갱신

- 부모가 basic type/table/comment/namespace/STRICT 등의 coverage를 활성화한 뒤, 두 담당 transfer integration 파일의 과거 type.not-implemented 기대값을 현재 정책 경계로 교정하도록 승인했다. 기존 model/validation/default/onUpdate/gate 정책은 수정하지 않는다.
- 기존 음성 샘플은 유지하고 실제 차단 원인(참조를 잃은 ENUM 정의의 enumType 또는 legacy context, invalid STRICT 타입, 미검증 PK/FK)을 명시 검사한다. 별도 양성 샘플로 legacy origin을 유지한 기본 native 컬럼과 새 순수 native 프로젝트의 기본 타입/유효한 SQLite STRICT를 201·원문·graph/remap·audit/hash와 검증한다.
- literal default 1과 WITHOUT ROWID는 별도 false coverage 경계로 추가 검사한다. client source coordinates/empty diagnostics/previous는 authority가 아니며, 기본 타입만 유효한 경우 import를 허용하되 source counters는 새 프로젝트에 복사하지 않는다. 같은 claims로 미검증 default/advanced ENUM를 주입하면 계속 차단한다.
- actual AppModule + 기존 isolated runner로 신규/기존 transfer 전체를 재실행하고, 두 test의 targeted strict TypeScript/Prettier만 검사한다. full check/build 및 git 작업은 하지 않는다.
