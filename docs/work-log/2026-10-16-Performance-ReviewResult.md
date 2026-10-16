# 댓글 목록 쿼리와 프로젝트 잠금 projection 개선

[계획](../planning/2026-10-16-Performance-PriorityImprovements.md)의 댓글 개선 범위와 [감사 B2/B6](2026-10-16-Quality-CodebaseAudit.md)를 적용했다.

## 변경

- REST 댓글 목록은 프로젝트의 전체 thread를 정렬해 한 번 읽고, 해당 프로젝트 thread에 속하는 messages를 join으로 한 번 읽어 thread별로 묶는다. 조회는 기존 `runProject`의 repeatable-read/read-only transaction과 현재 멤버십 검사 안에서 수행한다.
- thread의 `updatedAt DESC, id ASC`, 답글의 `createdAt ASC, id ASC`, ISO 시간, 답글 없는 thread, 과거 개인 화면 메타데이터를 유지한다. 단일 thread 응답과 목록의 직렬화 함수를 공유한다.
- messages 조회는 프로젝트 ID 한 개로 범위를 제한하므로 thread 수에 비례하는 IN 바인드 변수가 생기지 않는다.
- reply/update/remove/notification update의 프로젝트 잠금은 `status`만 조회한다. 기존 workspace SHARE → project UPDATE → thread UPDATE 순서와 archived/missing 검사, 삭제 시 expectedUpdatedAt 검사는 유지한다. create는 문서와 DB context를 읽는 기존 전체 project UPDATE 잠금을 유지하며 화면/대상 배치/멘션 검증을 계속 수행한다.

## 검증

- `pnpm.cmd exec vitest run apps/server/test/review-personal-access.test.ts apps/server/test/write-auth.test.ts apps/server/test/workspace-access.test.ts`: 3개 파일, 41개 테스트 통과.
- `pnpm.cmd --filter @ezerd/server typecheck`: 통과.
- 해당 서비스/테스트/문서의 Prettier 검사 통과.
- mock executor로 0/1/50/1,000 thread에서 쿼리 수와 SQL 조건·정렬·join을 검사했다. 비어 있지 않은 목록의 댓글 데이터 SELECT는 기존 2N+1에서 2개이며, 권한 검사의 3개 SELECT를 포함하면 2N+4에서 5개다. 빈 목록은 댓글 SELECT 1개/권한 포함 4개다. BEGIN/COMMIT은 이 수에 포함하지 않는다.
- 답글 그룹화·빈 답글·ISO 변환·개인 화면 메타데이터·repeatable-read 설정, 권한 회수/워크스페이스 및 프로젝트 보관, 상태 전용 잠금과 생성 시 문서 잠금, 오래된 삭제 거부와 commit 뒤 게시를 확인했다.

## 한계

실제 PostgreSQL 지연·쿼리 실행 계획·row/byte 전송량·잠금 대기 시간은 측정하지 않았다. 쿼리 수는 mock executor 회귀 검사 결과다. 동시 DB 쓰기를 사용하는 통합 테스트는 이 단위에서 실행하지 않았다.

REST 전체 목록과 알림 전체 목록의 응답 크기, 쓰기 뒤 전체 thread 재전송은 유지한다. 알림 UI 갱신 정책이나 새 pagination/count API는 이번 범위에 포함하지 않았다. 작업은 격리된 performance worktree에서 수행했으며 D:/ChatGPT/ERD와 docs/EZERD.txt는 수정하지 않았다.
