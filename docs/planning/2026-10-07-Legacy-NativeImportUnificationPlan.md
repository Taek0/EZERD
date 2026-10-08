# v1 파일 가져오기의 Native 통합

- 웹·기존 REST import·MCP import_project가 v1 파일도 NativeTransferService를 통해 v2 문서로 저장하도록 통합한다.
- 기존 Native 변환·검증·원문 증거·새 ID 발급 로직을 재사용한다. schemaVersion 1을 신규 프로젝트에 저장하던 WorkspaceService 경로와 사용되지 않는 import 요청 계약은 제거한다.
- 기존 /projects/import와 MCP import_project의 Project 응답 형태는 유지하고, Native endpoint는 진단이 포함된 기존 응답을 유지한다. 원문이 검증 전에 정규화되지 않도록 MCP 입력은 구조 메타데이터와 서버의 전체 검증을 분리한다.
- 웹에 v1 파일이 Native 프로젝트로 변환됨을 안내한다. Native 파일 입력도 같은 흐름으로 검증하며 계정·프로젝트 문맥 검사를 유지한다.
- 신규 가져오기 결과는 v2이므로 MCP export_project도 versioned export를 사용한다. 기존 v1 저장 프로젝트의 HTTP 파일 export/upgrade 및 v1 파일 reader·migration 자체는 보존한다.
- raw 값 보존·3개 DB 종류·새 프로젝트 격리·권한·실패 시 무삽입·REST/MCP 입력 경계를 검증한다. 포맷·타입·전체 테스트·빌드 및 격리 DB 통합 테스트 후 커밋한다.
- 실제 사용자 DB나 기존 프로젝트는 일괄 변환하지 않는다. docs/EZERD.txt는 변경하지 않는다.
