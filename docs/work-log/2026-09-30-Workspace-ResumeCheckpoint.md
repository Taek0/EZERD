# 워크스페이스 구현 재개 체크포인트

## 완료한 준비

- AGENTS.md와 기존 설계/코드를 읽고 계획을 docs/planning/2026-09-30-Workspace-Implementation.md에 작성했다.
- 계획 문서만 커밋했다: 30c9668. 시작 HEAD는 1239035이고 최초 작업 트리는 깨끗했다.
- Git 메타데이터 쓰기는 sandbox 밖이므로 git add/commit에 require_escalated가 필요하다. 자동 심사는 계획 커밋을 승인했다.
- 현재 연결된 EZERD MCP list_projects 호출(2026-09-30T05:14:49.853Z)의 서버 감사 로그와 응답을 대조했다. 서버 로그의 userId는 cebce815-6ff4-42fe-a55f-997d1b6aabc0, tokenId는 6fe865da-fe73-4729-a31e-c36bd5038ac1이다. 토큰 원문은 읽거나 출력하지 않았다.
- 프로젝트 ID와 이름을 재확인했다: klassboard-backend 56a7ccd0-ffb8-462c-a253-6ae6f266c4a8 v156, ezerd 903ec4ff-2ca4-4724-8d8a-3ec98765a68b v63, monya bbae7fcb-72ba-4395-add3-a9e4ff13a546 v7. 이관은 아직 수행하지 않았다.

## 중단된 구현 상태

- MCP 서브에이전트가 429 retry limit으로 중단됐다. 사용자 재개 지시 후 기존 서브에이전트는 남아 있지 않다.
- 미커밋 변경은 이번 작업의 부분 구현이다. schema.ts, contracts spaces/workspace/project-transfer/index, workspace-access/events 서비스, review controller/service, personal-state.service, mcp-server, web features/workspaces를 다시 검토해 이어서 구현한다.
- SpaceService/SpaceController와 마이그레이션은 아직 없다. 기존 WorkspaceService/Controller는 프로젝트를 담당하므로 이름을 구분한다.
- 공통 API는 WorkspaceAccessService.requireProject(userId,projectId,permission,executor), requireWorkspace(userId,workspaceId,permission,executor), runProject/runWorkspace다. permissions: read/design/review/personal/createProject/manageProject/deleteProject/manageWorkspace. schema 멤버 export 이름은 userWorkspaces다.
- 현재 공통 서비스는 모든 tx에 FOR SHARE를 적용하므로 read-only repeatable-read tx에서는 수정 필요하다. 공간·멤버 변이 FOR UPDATE와 쓰기 권한 FOR SHARE를 같은 공간 행에 걸어 동시성 보장을 구현한다.
- WorkspaceEventsService는 공간/멤버 변경 후 기존 WebSocket 권한을 즉시 반영할 용도로 추가됐다. SyncGateway 연결은 아직 안 됐다.
- 프로젝트 서비스 actor-first 시그니처 변경 예정: createProject(actorId,input), listProjects(actorId,input), listProjectsPage(actorId,input), getProject(actorId,id), getProjectState(actorId,id), exportProject(actorId,id), importProject(actorId,body), updateProject(actorId,id,input), deleteProject(actorId,id,input).
- ReviewService 중간 변경은 list(projectId,userId), listPage(projectId,userId,limit,cursor?), getThread(id,userId) 시그니처다. 호출자/MCP와 테스트를 모두 맞춘다.
- SyncService.apply/findReplay/establishBaseline/restore/undo/lookup의 기존 user 인자를 이용해 권한을 확인하고, events/history/historyPage 읽기에 actorId를 추가한다. apply는 replay 검사 전 tx 안에서 design 권한을 확인해야 한다.

## 남은 필수 작업

1. 공간/초대 도메인 API 및 감사 로그, 마지막 owner 동시성, 초대 수락/거절/취소/만료.
2. 프로젝트/모든 sync/리뷰/개인 상태/멘션/알림/전체 MCP/WebSocket 권한과 기존 연결 취소.
3. UI 완료: 사용자 지정 gpt-6-astra medium, 한국어/영어, 기존 버튼 디자인. Viewer shared 설계 편집 차단과 active 개인 상태·리뷰 허용을 분리한다. Archived는 모든 쓰기 차단.
4. 기존/새 테스트의 계약/생성자 mock 조정 및 격리 PostgreSQL 권한·초대·동시성·이관 보존 테스트. format/typecheck/test/build와 UI 검증.
5. DB 현상태 read-only 재확인 후 nullable workspace_id 준비 migration, 이관 script로 승인된 owner와 프로젝트만 원자적으로 backfill, 최종 NOT NULL. 추가 미소속 프로젝트 발견 시 추측 배정하지 않는다. 재실행 안전, 프로젝트/설계/리뷰/히스토리/개인 상태 보존 검증.
6. 서버의 실행 상태를 확인하고 새 빌드/스키마와 함께 적용한 뒤 MCP/UI 실제 검증. git push는 요청되지 않았다. docs/EZERD.txt 수정 금지.

## 도구 정보

- node v24.18.1, pnpm 11.24.0. 실행 진입점 node node_modules/prettier/bin/prettier.cjs 및 node node_modules/vitest/vitest.mjs를 사용할 수 있다.
- 운영 서버 MCP URL은 http://192.168.0.178:3001/mcp, 감사 로그는 .data/logs/mcp/2026-09-30.jsonl이다. .env나 MCP config의 credential 원문은 출력하지 않는다.
- 앱 fork_thread로 사용자가 승인한 현재 작업 폴더 포크를 수행하고 이어서 GPT-6.1 Sol high로 작업한다.
