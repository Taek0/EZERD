# C2d/C3 native 동기화 순수 모델 결과

- 기준: [계획](../planning/2026-10-01-Database-NativeSyncModel.md), 시작 `06490b2`.
- sharedDocument/diff/apply/merge/overlay와 DocumentOperation을 v1/v2 공통 코어로 확장했다. v1의 기본 컬렉션/개인 화면 제외/fingerprint 및 ID 기반 변경 규칙을 유지한다.
- native indexes/checks는 shared 문서에서 빈 컬렉션을 정규화하고 ID 단위로 추가·삭제·snapshot에 포함한다. optional 컬렉션이 없는 원본에도 엔티티 추가를 materialize한다.
- generation/defaultValue/column options/table namespace·options/index parts·options/check AST/deferrable을 원자 필드로 다룬다. discriminator나 AST 노드 일부만 병합하지 않는다.
- native 구조 참조 read-set은 table 옵션·namespace·scope, column 타입·생성·옵션·nullable·소유 테이블, ENUM, FK 대상 key 외에 default/generated/onUpdate AST, index 표현식·predicate·include, CHECK 컬럼까지 파생한다. 삭제 snapshot에서도 원래 참조를 사용한다. JSON pointer ID escaping을 유지한다.
- diff/merge는 같은 문서 버전과 DB/profile을 요구한다. apply는 database/schemaVersion 경로를 거부하고, pending overlay에 document가 있으면 문맥을 검사한다. v2 업그레이드·DB 변환은 별도 서버 작업으로 남긴다.

## 검증과 범위

- native 신규 6개 + 기존 sync 23개, **29개 통과**. native 값/정확한 숫자 보존, index/check 추가·삭제·snapshot, 원자 AST, 참조 및 오프라인 충돌, 원인별 inverse, 개인 화면 제외, 다른 DB overlay/버전 변경 거부를 검증했다.
- 최종 `pnpm check` 전체 포맷/타입/테스트/빌드 통과: **716개 통과, 44개 건너뜀**.
- 변경 후 격리 PostgreSQL 전체 마이그레이션/기존 autosync HTTP 통합 **8개 통과**. 임시 DB는 종료 후 삭제했다.
- 이 단위는 순수 모델이며 native API 저장을 열지 않는다. API의 최종 구조·정책 검증과 v2 소비/편집·upgrade/import/clipboard/remap/서버 history 연결은 아직 남았다. native 기능의 coverage도 활성화하지 않았다.
- 기존 API/MCP 통합 실패 5건은 [설정 저장 결과](2026-10-01-Database-ContextPersistence.md)에 기록되어 있으며 이번 단위에서 무관한 fixture/개인 화면 동작을 바꾸지 않았다.
