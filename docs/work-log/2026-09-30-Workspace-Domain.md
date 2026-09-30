# 워크스페이스 도메인 구현 및 검증

## 구현

- 공간 생성과 최초 owner 멤버십 및 감사 이벤트를 동일 트랜잭션으로 저장한다. 공간 목록은 현재 사용자 멤버십으로 제한한다.
- 공간 조회/이름 변경/보관/복원/빈 공간 삭제, 멤버 목록/역할 변경/제거/자진 탈퇴를 제공한다. 프로젝트가 남은 공간의 삭제를 거부한다.
- 내부 사용자명 초대를 생성하고 받은 초대/공간 초대 목록, 수락/거절/취소 및 7일 만료 처리를 제공한다. 수락 이전에는 멤버십이 없으며 수락의 동시 재시도는 하나의 멤버십과 감사 이벤트만 생성한다.
- 공간 행 FOR UPDATE로 멤버/초대/보관 변경을 직렬화하고 마지막 owner 제거·강등·탈퇴를 거부한다. 기존 멤버십이 있는 초대 수락은 역할을 덮어쓰지 않는다.
- 쓰기 권한 검사는 공간 FOR SHARE를 획득하므로 보관/멤버 변경이 이미 진행 중인 쓰기와 일관되게 직렬화된다. 읽기 권한 검사는 행 잠금을 생략하여 read-only repeatable-read 트랜잭션을 지원한다.
- 공통 runProject/runWorkspace의 read 권한 경로는 read-only REPEATABLE READ 트랜잭션을 명시하여 멤버십 확인과 실제 조회가 같은 스냅샷을 사용한다. design/review/personal 쓰기는 기존 트랜잭션과 FOR SHARE 잠금을 유지한다.
- 공간/멤버 변경 커밋 후 접근 변경 이벤트를 전송한다. 공간 삭제 이후에도 감사 기록을 보존한다.
- 계약의 프로젝트 생성/가져오기는 대상 workspaceId를 명시하고 내보내기 파일은 공간 ID 대신 프로젝트 이름만 포함한다.
- 0011 준비 마이그레이션은 공간 테이블·enum·FK·색인을 생성하고 기존 projects.workspace_id는 nullable로 추가한다. 해당 스냅샷도 nullable이다. schema.ts의 최종 모델은 NOT NULL이며 운영 데이터 이관과 최종 제약 적용은 별도 승인된 작업에서 수행한다.
- readiness 검사는 공간 스키마 및 프로젝트 workspace_id 존재도 확인한다.

## 검증

- 격리 PostgreSQL 테스트는 매 실행 고유한 새 데이터베이스를 생성하여 마이그레이션을 적용하고 종료 시 해당 데이터베이스만 제거한다. 운영 데이터를 변경하지 않는다.
- `EZERD_WORKSPACE_DB_TEST=1 node node_modules/vitest/vitest.mjs run apps/server/test/workspace-domain.integration.test.ts`: 6개 테스트 통과.
- 원자 생성 실패 rollback, 타 사용자 목록/조회 차단, read-only 조회, viewer/archived 권한 정책, 초대 수락 전 멤버십 부재, 동시 중복 수락, 두 owner의 동시 강등, 마지막 owner 탈퇴 차단, 만료 상태 영속화, 거절/취소, 실제 PostgreSQL 잠금 대기를 통한 진행 중 쓰기와 보관 직렬화, 공간 삭제 조건 및 감사 보존을 검증했다.
- 서버 소스 타입 검사가 통과했다. 도구 타입 검사의 기존 db-check.ts 프로젝트 삽입은 workspaceId 대응이 필요하여 통합 담당자에게 전달했다.
- 대상 소스·계약·검증 파일에 루트 Prettier 설정을 적용했다.
- 공통 접근 트랜잭션 보완 후 `workspace-access.test.ts`의 8개 테스트로 두 경로의 read 스냅샷 옵션, 쓰기 옵션 유지 및 권한 검사 이후 콜백 실행을 확인했다. 기존 격리 PostgreSQL 도메인 테스트 6개도 통과했다.

## 변경 경계

- docs/EZERD.txt를 수정하지 않았다. 사용자/프로젝트 소유자를 추측하거나 운영 이관을 실행하지 않았다. git push를 실행하지 않았다.
