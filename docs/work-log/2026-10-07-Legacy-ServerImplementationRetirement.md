# v1 서버 구현 폐기와 Native 공통 기능 보존

- [계획](../planning/2026-10-07-Legacy-ServerRetirementPlan.md) 및 [첫 경계 변경](2026-10-07-Legacy-ServerEntryRetirement.md)에 이어 두 번째 단위를 완료했다.
- SyncService, McpDocumentService, mcp-patch, mcp-read, mcp-response, mcp-layout-diagnostics의 v1 전용 구현 6개를 제거하고 AppModule/McpServerFactory 의존성도 제거했다.
- v1 전용 단위 테스트 5개와 autosync/direct-table 통합 테스트를 제거했다. 삭제된 테스트 파일의 실행기 참조도 갱신했다.
- WorkspaceService의 v1 getProjectState를 제거했다. 파일 export에 필요한 기존 정규화 읽기는 비공개 readLegacyExportDocument로 제한해 보존했다.

## 보존한 현재 기능

- SyncGateway는 Native 실시간 전달과 권한 변경 알림에 사용하므로 유지했다.
- 기존 SyncService에 있던 만료 정리를 SyncRetentionService로 분리했다. 시작 시/매시간 실행, 7일 operations·baseline 보존 기간, tombstone expiresAt 기준, 종료 시 타이머 해제를 그대로 유지했다. 실제 SQL 조건과 스케줄·오류 후 재시도를 테스트한다.
- Native 서비스·MCP 도구·공유 DB 테이블·모델·계약과 파일 import/export/upgrade를 보존했다. 프로젝트 메타데이터·보관·삭제·리뷰 관리도 유지한다.
- 현재 및 역사적 원본을 읽는 document-state/capabilities와 파일 호환 경로는 유지한다. 개인 상태의 신규 v1 편집은 차단하지만 동일 operation 재생의 기존 저장 결과 반환 순서는 유지한다.
- HTTP의 기존 v1 경로는 제거 대신 인증 후 410 응답만 남겨 오래된 클라이언트가 종료 사실을 알 수 있게 했다. v1 MCP 도구는 등록·호출 목록에서 제거됐다.

## 혼합 테스트 갱신

- 파일 import의 타입 정규화·크기 검증과 export의 단일 snapshot·공유/개인 annotation 보존 검증을 유지했다. 제거된 서비스 메서드를 모킹하지 않고 저장소 읽기를 검사한다.
- 개인 상태 권한 테스트를 Native 문서·databaseRevision/projectVersion/syncSequence 문맥으로 전환했다. 공유 배치 변경 거부, viewer 개인 viewport 저장, 원본 불변 검증은 유지한다.
- 일반 HTTP 통합 테스트는 계정·프로젝트 관리·리뷰·파일 전송을 유지했다. 리뷰용 v1 설계는 격리 DB fixture로만 준비하며 폐기된 편집 API가 성공했다고 가장하지 않는다. 일반 snapshot 읽기는 document-state 응답을 테스트 내부 fixture 형태로 변환한다.
- MCP 통합 테스트는 workspace 수명주기·권한·토큰·페이지 조회를 유지하고 Native upgrade 이후의 개인 상태 쓰기를 검증한다. v1 전용 전체 편집 흐름은 제거하고 Native 실제 편집/개인 상태 흐름은 versioned-document 통합 테스트로 계속 검증한다.
- 버전 전환 통합 테스트는 v1 과거 문서·baseline을 fixture로 준비해 원문/history 보존과 Native 편집을 검증한다. 폐기된 경로에 대한 이전 200/409 기대값은 410으로 변경했다.
- Native 취소 통합 테스트는 새 공통 retention service를 호출한다. 취소 기록과 만료 처리 보호 검증을 그대로 수행했다.

## 최종 검증

- pnpm format, pnpm format:check, pnpm typecheck, pnpm test, pnpm build, git diff --check 통과.
- 기본 전체 테스트: 201개 파일/2,585개 테스트 통과, 25개 파일/488개 테스트 건너뜀.
- 별도 격리 DB에서 api.integration, mcp.integration, versioned-document.integration, native-cancellation.integration의 **111개 테스트 모두 통과**했다. 실행: `pnpm --filter @ezerd/server exec tsx scripts/test-isolated.ts` 뒤에 네 테스트 경로를 지정했다.
- 최초 workspace 격리 실행기는 Native 취소 테스트의 ezerd_qa_ 이름 조건과 맞지 않아 거부됐다. 조건에 맞는 test-isolated 실행기로 전환했으며, 발견된 폐기 응답 기대값·업그레이드 후 버전 사용을 수정한 뒤 네 스위트가 모두 통과했다.
- 임시 DB 생성·마이그레이션·정리는 실행기가 수행했다. 기존 개발 DB의 사용자 문서는 변경하지 않았다. 서버 재시작·배포는 수행하지 않았다.
- 웹 산출물은 기존 `index-B8eXxYp3.css`, `index-BNjMsGjH.js`와 동일하며 Native 웹 구현은 변경하지 않았다. Vite의 500kB 청크 경고는 기존과 같다.
- docs/EZERD.txt는 수정하지 않았다. 모델의 v1 타입·파일 호환과 역사적 이력 해석은 이번 API 폐기와 별개로 남아 있다.
