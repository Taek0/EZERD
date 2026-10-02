# Native 이력 조회·undo·삭제 restore 계획

- [기본 명세 6.2 및 sync 원칙](2026-10-01-Database-CapabilitySpecification.md), [진행 상태](../work-log/2026-10-01-Database-ImplementationProgress.md), [역연산 순서](2026-10-01-Database-NativeDeletionUndoOrder.md), [legacy 출처 정책](../work-log/2026-10-01-Database-NativeWriteProvenance.md)을 확인했다.
- 담당 새 파일: native-history 서비스/컨트롤러/계약/계약 테스트/격리 integration 및 계획·결과 문서. 필요하면 NativeSyncService만 수정할 수 있으나 일반 candidate/shared helper/model 정책은 수정하지 않는다. AppModule/index/MCP/web는 메인 통합 담당이며 git add/commit은 하지 않는다.
- read-only snapshot에서 실제 ledger의 v1/native/upgrade 경계와 raw result/changes/deletion audit를 페이지 조회한다. 기존 이력을 자동 migration하거나 저장 원본을 수정하지 않는다.
- 보상 요청은 writable transaction에서 read 권한 확인 → 같은 actor/동일 fingerprint ACK 조회 → 프로젝트 row UPDATE lock/ACK 재확인 → 새 변경의 design 권한 확인 순서로 처리한다. read 권한이 남은 같은 actor는 workspace 보관·viewer 역할 변경 후에도 동일 ACK를 재생할 수 있다. 다른 actor 또는 read 권한이 없는 재생과 새 쓰기의 design 권한 부족은 403으로 차단한다. 새 쓰기에만 활성 상태, 현재 DB/profile/revision/version/sequence, 서버 발급 native baseline을 요구하며 client before/legacy/retired ID/복원 문서 주장은 받지 않는다.
- source accepted native 결과의 문서+changes로 원본 before를 재구성하고 독립적으로 저장된 서버 ACK baseline 및 forward/inverse/derived fingerprint를 검사한다. v1·upgrade 경계의 원문 audit는 조회만 제공하고 새 native inverse 대상으로 사용하지 않는다.
- source 이후 field versions 및 원본 before/after/current의 서버 파생 참조 read-set이 겹치면 충돌한다. 현재 형식 내 역연산은 inverseChanges의 ID move 순서를 유지하며 다른 협업자의 후속 변경을 보존한다.
- 삭제 snapshot은 ledger changes와 정확히 일치해야 하고 살아 있는 tombstone의 operation/sequence/원문도 일치해야 한다. 원본 삭제 ID는 재사용하지 않고 native remapper로 새 ID·AST/ENUM/FK/배치 참조를 재발급한다.
- restore는 삭제 객체와 위치만, undo는 전체 accepted bundle을 보상한다. 정책 previous는 locked current를 기본으로 한다. 복원되는 새 엔티티만 검증된 서버 삭제 원본에서 보완한다. 참조 컬럼 삭제 때문에 both FK가 logical/physical null로 정리된 경우 undo는 입증한 저장 physical/scope cleanup만 보완한다. candidate 전체를 previous로 인정하거나 unrelated 기존 type/legacy 정상화를 역연산으로 재발급하지 않는다. 현재 원인과 historical 원인을 함께 확인하고 unsafe legacy ENUM remap은 명시 진단으로 차단한다.
- relation placement는 자체 ID가 없는 virtual pair이므로 원문과 최신 tombstone으로 입증한 동일한 비어 있는 pair만 전용 복원 경로에서 허용한다. ordinary candidate의 retired pair 금지는 유지하고 entity/node ID는 새 UUID로 remap한다.
- 구조·raw 문서 1.5 MB·changes 1,000·DB/graph/legacy 정책을 검증하고 프로젝트/sequence/version/ledger/field versions/tombstone/native baseline을 같은 트랜잭션으로 저장한다. commit 후 WS event를 발행한다.
- targeted format/typecheck/계약 테스트 및 임시 로컬 DB의 실제 REST/ledger/충돌/재생/rollback 검증을 수행한다. 독립 Nest 모듈 검증은 전체 AppModule 통합 완료로 계산하지 않는다.
- 결과: [작업 로그](../work-log/2026-10-02-Database-NativeHistory.md).
