# README 현행화 계획

- 목적: Notion 프로젝트 소개를 확장하기 전에 루트 README를 현재 구현과 대조하고 누락·오래된 안내를 보완한다.
- 범위: 제품 목적, 주요 기능, 사용자·워크스페이스 구조, MCP 연결, 실행·운영 안내 및 관련 문서 링크를 코드와 작업 기록으로 확인한다.
- 원칙: 구현된 동작과 계획을 구분하고, Notion 및 사용자가 관리하는 `docs/EZERD.txt`는 수정하지 않는다.
- 기존 변경: `apps/server/scripts/export-repository-erd.mjs`, `artifacts/repository-erd/ezerd-project.json`의 작업 중 변경은 이번 커밋에서 제외한다.
- 검증: README 명령·경로·설정 설명을 소스와 대조하고 Markdown 링크 및 Prettier 검사를 수행한다. 문서만 수정하므로 애플리케이션 전체 테스트는 실행하지 않는다.
- 완료: 결과와 검증을 `docs/work-log/2026-09-30-Documentation-ReadmeRefresh.md`에 기록하고 문서 변경만 하나의 커밋으로 저장한다.
