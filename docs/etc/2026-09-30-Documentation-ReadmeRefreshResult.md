# README 현행화 결과

## 변경

- 루트 README에 도메인부터 DB 설계를 구체화하는 제품 목적과 기본 사용 흐름을 추가했다.
- 여러 워크스페이스 참여, 상단 공간 전환, 초대, 역할별 권한, 보관 상태 및 계정 전환을 설명했다.
- 갤러리의 카드 편집·정렬·자동 이름·설계 미리보기와 DB 종류 메타데이터를 반영했다. MySQL/SQLite 선택이 물리 타입·DDL 변환을 의미하지 않음을 명시했다.
- 개인 도메인 뷰를 세션에서만 유지한다는 오래된 설명을 사용자·프로젝트별 서버 저장으로 수정했다.
- 프로젝트 JSON 전송의 공유 설계·DB 종류 포함 범위와 개인 화면·멤버십 제외 범위를 명확히 했다.
- EZERD MCP 기능, 기본 비활성화 상태, 토큰 발급·연결 절차 및 워크스페이스 권한을 추가했다.
- V/H 단축키, 서버 폴더·DB 저장 대상과 최근 기능별 작업 기록 링크를 보완했다.

## 확인 근거

- `apps/server/src/workspace/workspace-access.service.ts`, `space.service.ts`: 역할별 권한, 보관 정책, 빈 공간 삭제.
- `apps/web/src/features/workspaces/workspace-policy.ts`, `features/projects/ProjectGallery.tsx`, `project-gallery-order.ts`: UI 권한, DB 종류 편집, 기본 생성순.
- `apps/web/src/features/canvas/canvas-tool-shortcuts.ts`: V/H 및 입력 상황 제외.
- `apps/server/src/mcp/mcp-server.ts`, `mcp.controller.ts`, `.env.example`: MCP 도구와 비활성화 기본값.
- `packages/contracts/src/project-transfer.ts` 및 개인 화면·갤러리·공간 관련 작업 기록: 전송 계약과 저장 범위.
- 루트·앱 `package.json` 및 LAN 호스팅 안내: 기존 명령·의존성 안내와 연결 절차 대조.

## 검증

- `pnpm format`: 통과. Markdown과 `docs/`는 기존 `.prettierignore`에 따라 제외되며 별도로 포맷하지 않았다.
- `pnpm format:check`: 통과.
- README 상대경로 링크 38개: 모두 존재 확인.
- `git diff --check`: 통과.
- 문서 변경만 수행했으므로 애플리케이션 테스트·빌드·DB 작업은 실행하지 않았다.
- Notion 및 `docs/EZERD.txt`는 수정하지 않았다. 작업 시작 시 존재한 ERD 스크립트·산출물 변경은 이번 작업의 스테이징 대상에서 제외했다.

## 범위

이번 기록은 README의 소스 대조 결과이며 실제 브라우저 기능이나 MCP 연결을 새로 검증했다는 의미는 아니다. 최종 커밋에는 README와 이 작업의 계획·결과 문서만 포함한다.
