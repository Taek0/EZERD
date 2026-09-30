# 승인된 운영 워크스페이스 이관 결과

## 실행 결과

- 2026-09-30 15:05:46 KST에 이관 트랜잭션을 커밋했다. 준비 0011, 데이터 이관/NOT NULL 확정, 최종 0012_colorful_reavers 마이그레이션을 모두 적용했다.
- 현재 설정된 MCP 토큰은 원문을 출력하지 않고 활성 레코드의 소유자를 확인했다. 이관 후 새 서버의 whoami도 cebce815-6ff4-42fe-a55f-997d1b6aabc0와 일치했다.
- Edusync(611dca01-381d-4d45-9b6e-a2a47b2177d9): klassboard-backend(56a7ccd0-ffb8-462c-a253-6ae6f266c4a8, v156/sync163).
- TY(3c57cfc8-e6e6-4ec5-8cbd-8c5538a67182): ezerd(903ec4ff-2ca4-4724-8d8a-3ec98765a68b, v63/sync63), monya(bbae7fcb-72ba-4395-add3-a9e4ff13a546, v7/sync7).
- 두 공간 모두 검증한 계정의 owner 멤버십이 있다. 기존 다른 사용자를 삭제하거나 자동 멤버로 추가하지 않았다. 기존 작성자/개인 상태의 사용자는 필요할 때 owner가 앱 내부 초대하여 수락할 수 있다.
- 새 서버는 기존 설정의 LAN 범위로 숨김 백그라운드 실행했다. 로컬/LAN /api/health/ready 모두 ready이며 새 MCP 44개 도구에서 실제 공간·역할·프로젝트 소속을 확인했다.
- 운영 프로젝트의 설계 내용, 버전, sync_sequence, 생성/수정 시각은 바뀌지 않았다. DB 초기화나 전체 사용자 삭제, git push는 수행하지 않았다.

## 보존 검증

이관 직전과 직후 아래 모든 테이블의 정렬된 전체 행 JSON SHA-256이 일치했다. projects는 새 workspace_id만 해시에서 제외했다. 서버 시작 후에도 다시 조회한 건수와 모든 해시가 동일했다.

| 데이터 | 보존 건수 |
| --- | ---: |
| projects | 3 |
| project_personal_states | 2 |
| project_personal_operations | 6 |
| review_threads | 1 |
| review_messages | 4 |
| review_notifications | 3 |
| sync_operations | 148 |
| sync_field_versions | 1780 |
| sync_client_baselines | 230 |
| sync_tombstones | 132 |

검증 결과는 로컬 비공개 실행 산출물 .data/workspace-transfer-2026-09-30.json에 저장했다. 각 공간의 projects.transferred 감사 이벤트에도 migrationKey/프로젝트 ID/보존 검증을 기록했다. 재실행은 같은 공간/owner/배정을 유지하고 감사 이벤트를 중복 생성하지 않도록 격리 DB에서 확인했다.

## 설치와 검증 도구

- 신규 빈 DB: pnpm db:migrate.
- 기존 데이터의 준비만 필요하면 node apps/server/scripts/prepare-workspace-migration.mjs(0011까지만 적용). 별도 승인한 소속/owner 매핑 후 일반 db:migrate로 0012를 적용한다. 이번 승인 전용 script를 다른 계정이나 프로젝트에 사용하지 않는다.
- 이번 배정 재검증: node apps/server/scripts/workspace-transfer.mjs(dry run), node apps/server/scripts/verify-workspace-mcp.mjs(read-only 실제 MCP). 원문 토큰을 출력하지 않는다.
- 전체 격리 통합 검증: node apps/server/scripts/test-workspaces.mjs. 새 DB에서 준비→최종 마이그레이션과 39개 API/sync/MCP/권한/WebSocket/초대/owner 동시성/이관 보존/로그아웃 테스트 통과.
- 최종 pnpm check(format:check, typecheck, test, build)가 통과했다. 일반 테스트 530개 통과, opt-in 통합 테스트는 격리 실행에서 별도로 확인했다. 기존 웹 단일 번들의 크기 안내만 남으며 빌드는 성공했다.
- 사용자 승인 후 실제 브라우저에서 owner 공간/프로젝트 생성, viewer 초대·수락, viewer의 설계 비활성화와 실제 핀·댓글 작성, 역할 변경, 공간 보관/복원, 한국어/영어, 정상 로그아웃/계정 전환을 확인했다. 화면 검증 산출물은 .data/workspace-viewer-qa-2026-09-30.png다.
- 마지막 운영 서버를 4a7dc5e 코드의 최신 빌드로 갱신했다. 로컬/LAN readiness와 실제 현재 토큰의 whoami/list_workspaces/list_projects를 다시 확인했고 모두 통과했다.
- 승인된 UI QA 계정에서 로그아웃하고 임시 브라우저 탭/preview 프로세스 및 이번 작업이 만든 임시 DB를 정리했다. 운영 데이터와 운영 서버는 유지했다. 모든 구현과 기록은 논리 단위별 커밋으로 남겼고 작업 트리를 정리했다.
