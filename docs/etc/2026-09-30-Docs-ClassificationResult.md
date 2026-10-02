# 문서 분류 정리 결과

## 변경

- 기타 보조 작업 문서 45개를 docs/etc로 이동했다. 22쌍의 계획·결과는 Plan/Result로 구분했고 기존 Drizzle 학습 문서의 이름은 보존했다.
- Git 동기화, 로컬 Docker·pnpm 장애, README·문서 관리, Notion 커버, 예시 프로젝트·ERD 생성·배치, 일회성 서버 종료, Drizzle 학습 안내를 분리했다.
- 제품 코드·기능 개선·QA·아이디어·워크스페이스 설계, 코드 품질 도구 도입, 개발 재현용 버전·환경 검증, 제품 호스팅 안내는 planning/work-log에 유지했다.
- AGENTS.md와 docs/README.md에 세 폴더의 분류 기준, 혼합 문서 판단법, 기타 계획·결과의 이름 규칙과 이동 시 링크 점검을 추가했다.
- 루트 README, TECH_STACK 및 이동 문서의 경로 참조를 갱신했다. 버전 문서 생성 경로는 그대로 유지했다.

## 검증

- 이동 45개 모두 원본 경로 제거·대상 존재와 경로 참조 치환 외 본문 보존을 확인했다.
- 전체 Markdown 상대 링크 163개가 유효하며 이동 전 경로의 잔존 참조는 없다. 아래 이전 위치는 이동 이력을 위한 의도적인 기록이다.
- `pnpm format:check`, `git diff --check` 통과.
- Markdown과 docs는 .prettierignore의 제외 대상이다. 제품 코드의 포맷은 이 문서 정리에서 변경하지 않는다.
- 문서만 변경하므로 앱 테스트·빌드·DB 작업은 수행하지 않는다. docs/EZERD.txt와 진행 중인 캔버스 작업은 이번 커밋에서 제외한다.

## 이동 목록

| 이전 위치 | 현재 문서 |
| --- | --- |
| `docs/planning/2026-09-14-Docker-RootCause.md` | [2026-09-14-Docker-RootCausePlan.md](./2026-09-14-Docker-RootCausePlan.md) |
| `docs/planning/2026-09-14-Docker-SocketRecovery.md` | [2026-09-14-Docker-SocketRecoveryPlan.md](./2026-09-14-Docker-SocketRecoveryPlan.md) |
| `docs/planning/2026-09-15-Brand-NotionCover.md` | [2026-09-15-Brand-NotionCoverPlan.md](./2026-09-15-Brand-NotionCoverPlan.md) |
| `docs/planning/2026-09-15-Docs-OriginSync.md` | [2026-09-15-Docs-OriginSyncPlan.md](./2026-09-15-Docs-OriginSyncPlan.md) |
| `docs/planning/2026-09-15-Docs-ReadmeRefresh.md` | [2026-09-15-Docs-ReadmeRefreshPlan.md](./2026-09-15-Docs-ReadmeRefreshPlan.md) |
| `docs/planning/2026-09-15-Docs-RemoveEzerdHistory.md` | [2026-09-15-Docs-RemoveEzerdHistoryPlan.md](./2026-09-15-Docs-RemoveEzerdHistoryPlan.md) |
| `docs/planning/2026-09-15-Toolchain-PnpmDiagnosis.md` | [2026-09-15-Toolchain-PnpmDiagnosisPlan.md](./2026-09-15-Toolchain-PnpmDiagnosisPlan.md) |
| `docs/planning/2026-09-17-Git-Pull.md` | [2026-09-17-Git-PullPlan.md](./2026-09-17-Git-PullPlan.md) |
| `docs/planning/2026-09-17-MCP-TestProject.md` | [2026-09-17-MCP-TestProjectPlan.md](./2026-09-17-MCP-TestProjectPlan.md) |
| `docs/planning/2026-09-21-Docs-ReadmeRefresh.md` | [2026-09-21-Docs-ReadmeRefreshPlan.md](./2026-09-21-Docs-ReadmeRefreshPlan.md) |
| `docs/planning/2026-09-21-Git-RebasePush.md` | [2026-09-21-Git-RebasePushPlan.md](./2026-09-21-Git-RebasePushPlan.md) |
| `docs/planning/2026-09-29-Database-CombinedLayout.md` | [2026-09-29-Database-CombinedLayoutPlan.md](./2026-09-29-Database-CombinedLayoutPlan.md) |
| `docs/planning/2026-09-29-Database-McpModel.md` | [2026-09-29-Database-McpModelPlan.md](./2026-09-29-Database-McpModelPlan.md) |
| `docs/planning/2026-09-29-Database-ReferenceDetails.md` | [2026-09-29-Database-ReferenceDetailsPlan.md](./2026-09-29-Database-ReferenceDetailsPlan.md) |
| `docs/planning/2026-09-30-Database-CodeSync.md` | [2026-09-30-Database-CodeSyncPlan.md](./2026-09-30-Database-CodeSyncPlan.md) |
| `docs/planning/2026-09-30-Documentation-ReadmeRefresh.md` | [2026-09-30-Documentation-ReadmeRefreshPlan.md](./2026-09-30-Documentation-ReadmeRefreshPlan.md) |
| `docs/planning/2026-09-30-ERD-DomainLayout.md` | [2026-09-30-ERD-DomainLayoutPlan.md](./2026-09-30-ERD-DomainLayoutPlan.md) |
| `docs/planning/2026-09-30-ERD-DomainPresentation.md` | [2026-09-30-ERD-DomainPresentationPlan.md](./2026-09-30-ERD-DomainPresentationPlan.md) |
| `docs/planning/2026-09-30-ERD-HierarchyLayout.md` | [2026-09-30-ERD-HierarchyLayoutPlan.md](./2026-09-30-ERD-HierarchyLayoutPlan.md) |
| `docs/planning/2026-09-30-ERD-RelationRouting.md` | [2026-09-30-ERD-RelationRoutingPlan.md](./2026-09-30-ERD-RelationRoutingPlan.md) |
| `docs/planning/2026-09-30-ERD-RepositoryReverseEngineering.md` | [2026-09-30-ERD-RepositoryReverseEngineeringPlan.md](./2026-09-30-ERD-RepositoryReverseEngineeringPlan.md) |
| `docs/planning/2026-09-30-Hosting-StopHost.md` | [2026-09-30-Hosting-StopHostPlan.md](./2026-09-30-Hosting-StopHostPlan.md) |
| `docs/work-log/2026-09-14-Docker-RootCause.md` | [2026-09-14-Docker-RootCauseResult.md](./2026-09-14-Docker-RootCauseResult.md) |
| `docs/work-log/2026-09-14-Docker-SocketRecovery.md` | [2026-09-14-Docker-SocketRecoveryResult.md](./2026-09-14-Docker-SocketRecoveryResult.md) |
| `docs/work-log/2026-09-15-Brand-NotionCover.md` | [2026-09-15-Brand-NotionCoverResult.md](./2026-09-15-Brand-NotionCoverResult.md) |
| `docs/work-log/2026-09-15-Docs-OriginSync.md` | [2026-09-15-Docs-OriginSyncResult.md](./2026-09-15-Docs-OriginSyncResult.md) |
| `docs/work-log/2026-09-15-Docs-ReadmeRefresh.md` | [2026-09-15-Docs-ReadmeRefreshResult.md](./2026-09-15-Docs-ReadmeRefreshResult.md) |
| `docs/work-log/2026-09-15-Docs-RemoveEzerdHistory.md` | [2026-09-15-Docs-RemoveEzerdHistoryResult.md](./2026-09-15-Docs-RemoveEzerdHistoryResult.md) |
| `docs/work-log/2026-09-15-Toolchain-PnpmDiagnosis.md` | [2026-09-15-Toolchain-PnpmDiagnosisResult.md](./2026-09-15-Toolchain-PnpmDiagnosisResult.md) |
| `docs/work-log/2026-09-17-Git-Pull.md` | [2026-09-17-Git-PullResult.md](./2026-09-17-Git-PullResult.md) |
| `docs/work-log/2026-09-17-MCP-TestProject.md` | [2026-09-17-MCP-TestProjectResult.md](./2026-09-17-MCP-TestProjectResult.md) |
| `docs/work-log/2026-09-21-Docs-ReadmeRefresh.md` | [2026-09-21-Docs-ReadmeRefreshResult.md](./2026-09-21-Docs-ReadmeRefreshResult.md) |
| `docs/work-log/2026-09-21-Git-RebasePush.md` | [2026-09-21-Git-RebasePushResult.md](./2026-09-21-Git-RebasePushResult.md) |
| `docs/work-log/2026-09-29-Database-CombinedLayout.md` | [2026-09-29-Database-CombinedLayoutResult.md](./2026-09-29-Database-CombinedLayoutResult.md) |
| `docs/work-log/2026-09-29-Database-McpModel.md` | [2026-09-29-Database-McpModelResult.md](./2026-09-29-Database-McpModelResult.md) |
| `docs/work-log/2026-09-29-Database-ReferenceDetails.md` | [2026-09-29-Database-ReferenceDetailsResult.md](./2026-09-29-Database-ReferenceDetailsResult.md) |
| `docs/work-log/2026-09-30-Database-CodeSync.md` | [2026-09-30-Database-CodeSyncResult.md](./2026-09-30-Database-CodeSyncResult.md) |
| `docs/work-log/2026-09-30-Documentation-ReadmeRefresh.md` | [2026-09-30-Documentation-ReadmeRefreshResult.md](./2026-09-30-Documentation-ReadmeRefreshResult.md) |
| `docs/work-log/2026-09-30-ERD-DomainLayout.md` | [2026-09-30-ERD-DomainLayoutResult.md](./2026-09-30-ERD-DomainLayoutResult.md) |
| `docs/work-log/2026-09-30-ERD-DomainPresentation.md` | [2026-09-30-ERD-DomainPresentationResult.md](./2026-09-30-ERD-DomainPresentationResult.md) |
| `docs/work-log/2026-09-30-ERD-HierarchyLayout.md` | [2026-09-30-ERD-HierarchyLayoutResult.md](./2026-09-30-ERD-HierarchyLayoutResult.md) |
| `docs/work-log/2026-09-30-ERD-RelationRouting.md` | [2026-09-30-ERD-RelationRoutingResult.md](./2026-09-30-ERD-RelationRoutingResult.md) |
| `docs/work-log/2026-09-30-ERD-RepositoryReverseEngineering.md` | [2026-09-30-ERD-RepositoryReverseEngineeringResult.md](./2026-09-30-ERD-RepositoryReverseEngineeringResult.md) |
| `docs/work-log/2026-09-30-Hosting-StopHost.md` | [2026-09-30-Hosting-StopHostResult.md](./2026-09-30-Hosting-StopHostResult.md) |
| `docs/work-log/DRIZZLE_START.md` | [DRIZZLE_START.md](./DRIZZLE_START.md) |
