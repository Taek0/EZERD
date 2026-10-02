# C3 native sync 최종 후보 검증 준비 결과

- [계획](../planning/2026-10-01-Database-NativeServerCandidate.md), [전체 진행](2026-10-01-Database-ImplementationProgress.md).
- 서버의 `prepareNativeSyncCandidate`는 권한/replay/row lock 이후 전달받은 current·발급 baseline·필드 버전으로 후보를 준비한다. 아직 기존 SyncService와 live v1 endpoint에 연결하지 않았으며 저장/ACK/idempotency 응답을 생성하지 않는다.
- v2 raw claims를 검증하고 ID trim 같은 계약 변환이 원문/claims를 바꾸면 거부한다. 프로젝트 DB/profile/revision, baseline 사용자/client/project/ID/sequence/발급 시각/24시간 수명과 실제 원문 문서를 확인한다. valid v1은 upgrade-required, 손상된 native 저장은 별도 오류다.
- client read-set이 없어도 서버가 AST/FK/index/check 의존 경로를 계산한다. 요청의 추가 의존 경로와 함께 online 구조 충돌/reconnect 필드 충돌을 보호하고 indexes/checks를 포함한 과거 identity 재사용을 막는다.
- current에 변경만 적용해 다른 사용자의 수정·legacy 정상화 결과를 보존한다. 전체 merged 후보의 1.5 MB/구조와 공통 native write 정책을 검사하며, legacy previous는 baseline이 아닌 current다. 새로운 미검증 기능은 차단된다.
- 공통 모델에 모든 scope의 domain/view/note/layout·소유 테이블·key/FK/ENUM·AST/index/check 참조/scope 검사를 추가했다. PK는 논리/물리 facet별 하나만 허용한다. 기존 dangling 문제의 안전한 설명 수정은 허용하지만 복제나 실패 의존 대상 교체는 새 원인으로 거부한다. 원인 fingerprint는 공개 진단에 노출하지 않는다.
- 서버 테스트 20개와 graph 테스트 8개를 추가했다. raw 위조/trim, 발급 기준 위조, DB/revision/사용자/client/만료, 현재 정상화 보존, 빈 client read-set에도 concurrent include-column 삭제 감지, retired ID, merged 이름 충돌/용량, logical dangling과 scope, AST/ENUM/배치, 원인별 복구가 통과했다.
- 전체 `pnpm check`: 785개 통과, 44개 건너뜀. 포맷·타입·빌드 통과; 기존 큰 Vite 번들 경고 유지. 순수 서버 준비 함수와 공통 모델 변경이므로 실제 DB 트랜잭션/native endpoint/브라우저 검증으로 계산하지 않는다.

다음: 공통 native 화면 배치 정규화·읽기 preview, native upgrade/import/history 소비 및 SyncService/MCP/web 연결. restore는 trusted history/deletion provenance를 증명하는 별도 경로가 필요하며 ordinary 후보에서 identity/legacy 규칙을 느슨하게 만들지 않는다. 서비스 연결 전까지 live v2 저장을 활성화하지 않는다. UI·DDL·DB 실행 및 전체 QA는 미완료다.
