# C4 MCP versioned 공유 snapshot 조회

- 시작 `ec00c39`, 작업 트리 깨끗함. REST와 동일한 권한/문맥/원본·native preview 계약을 MCP에서 읽도록 연결한다. 기존 v1 도구의 편집/개인 상태와 혼합하지 않는다.
- `get_project_document_state(projectId)`를 readOnly/non-destructive/closed-world 도구로 등록한다. 인증된 사용자로 WorkspaceService의 versioned snapshot을 호출하고 전체 계약을 검증한다. DB capabilities의 usable과 preview available 의미를 설명한다.
- SDK의 현 JSON Schema 변환기는 custom raw-source/AST 검증을 표현하지 못하므로 공개 output schema는 protocol/project/sequence/source schemaVersion/native status/진단과 opaque document body를 기술한다. 실행 handler는 실제 전체 contracts 스키마로 원본/AST/DB 문맥을 검증한다. runtime validation을 생략하거나 arbitrary 입력의 write를 허용하지 않는다.
- 기존 `get_project`/summary/table 도구는 현재 v1 경로임을 안내하고 native 쓰기는 아직 비활성임을 명시한다. 새 도구는 personal state를 조회·합치거나 baseline을 발급하지 않는다.
- SDK tools/list·callTool/annotations/structured result, 잘못된 결과/입력, 만료 토큰/권한 거부를 확인한다. 격리 DB의 HTTP MCP transport로 REST와 snapshot이 일치하고 읽기가 문서를 바꾸지 않는지 확인한다. 기록·필수 check·독립 커밋한다.
