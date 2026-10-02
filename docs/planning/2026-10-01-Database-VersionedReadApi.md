# C3 버전별 프로젝트 snapshot 조회와 v1 보호

- 시작 `2886789`, 작업 트리 깨끗함. 원본/native preview reader를 실제 권한 있는 조회 경로에 연결한다. 이번 단위는 읽기 API이며 native 저장을 활성화하지 않는다.
- `GET /api/projects/:id/document-state`의 protocolVersion 2 응답에 같은 프로젝트 row에서 읽은 metadata/version/sequence와 원본 sourceDocument, native preview 또는 unavailable 원인을 담는다. 원본 source를 계약 파싱으로 정규화하지 않는다. DB/profile/revision과 preview 일치를 계약에서 확인한다.
- gallery/project metadata preview와 capabilities 조회는 두 저장 버전을 읽는다. native 카드의 타입 표시는 기본 native 타입 이름/ENUM/배열/legacy 원문을 사용하며 v1 PG 타입 함수로 native 구조를 해석하지 않는다. 전체 native 편집 타입 표시는 별도 C4 단위다.
- 기존 v1 조회/normalizer/baseline/events/새 sync 쓰기는 native 저장을 명시적으로 차단한다. accepted v1 replay는 이 차단보다 먼저 그대로 반환한다. DB metadata 변경도 아직 native 변환이 준비되지 않았으므로 다른 kind/profile 변경을 차단한다. 이름/보관 상태 변경 등 native 원본을 건드리지 않는 metadata 수정은 유지한다.
- source/stored/preview가 달라도 GET은 document/version/sequence/baseline/history/audit를 쓰지 않는다. 읽기 권한·보관 프로젝트·DB mismatch·용량 unavailable·기존 alias 및 v1 응답/재생을 의미 있는 테스트로 검사한다.
- 격리 DB에 native fixture를 직접 넣어 실제 HTTP 인증/읽기/클라이언트 보호와 원본/순서 불변을 확인한다. 이는 native 저장 활성화·native sync ACK·편집 UI·DDL 실행 검증을 대신하지 않는다.
