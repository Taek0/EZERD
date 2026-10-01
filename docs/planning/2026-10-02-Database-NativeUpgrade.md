# C2/C3 명시적 native 문서 업그레이드

- 시작 `992f44d`, 작업 트리 깨끗함. 이미 연결한 native REST/MCP 편집 소비를 사용하도록 v1 저장 문서를 명시 업그레이드한다. GET은 계속 원본을 덮어쓰지 않는다.
- REST `/projects/:id/document/upgrade` 및 MCP `upgrade_project_document`는 operationId/clientId와 expectedVersion/sequence/databaseRevision을 요구한다. design 권한·row lock·재생을 새 검증보다 먼저 적용한다.
- trusted v1 원문을 기존 순수 migration으로 변환하고 native 전체 구조/예산 및 current migration 기반 복구 정책을 검사한다. PG의 알려진 의미만 변환하고 MySQL/SQLite 및 unknown type/default/namespace는 legacy로 보존한다. sourceDocument 원문·migration 진단을 감사 이력에 남긴다.
- project/document 버전·DB revision·sync sequence, 기존 baseline 무효화·native 새 baseline·원본 보존 이력을 원자 갱신한다. ordinary native writes의 legacy/retired ID 정책은 완화하지 않는다. native 이벤트는 format boundary를 reset으로 처리하고 context head는 commit 이후 발행한다.
- native type usable gate는 유지한다. UI 진입은 후속 native 편집 unit에서 제공하되 실제 MCP가 업그레이드와 편집을 함께 소비할 수 있어야 한다.
- 세 DB 실제 HTTP/MCP 업그레이드·원문 보존·재생·동시 충돌·권한·구 baseline/큐 차단·기존 승인 작업 재생 및 native 복구 편집을 격리 PostgreSQL에서 검증한다. 전체 check·기록·독립 커밋 뒤 같은 턴에서 다음 단위를 이어간다.
