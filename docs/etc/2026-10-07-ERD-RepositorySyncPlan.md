# 레포 기준 EZERD 프로젝트 동기화 계획

- 대상: TY 공간의 `ezerd` (`903ec4ff-2ca4-4724-8d8a-3ec98765a68b`).
- 기준: 현재 `apps/server/src/db/schema.ts`와 Drizzle 메타데이터. 운영 DB 변경 없이 ERD 표현만 갱신한다.
- 테이블, 컬럼 타입·NULL·기본값, PK·UNIQUE·인덱스·CHECK·ENUM·FK를 비교하고 기존 객체 ID와 사용자 설명을 가능한 한 보존한다.
- native v2 문서를 유지하고 MCP 최신 버전으로 변경한다. 공유 테이블 화면과 도메인 개요를 계층별로 정렬하고 카드 간 최소 40px 간격을 검증한다.
- 변경 전 스냅샷 및 비교·검증 결과를 artifacts에 저장하고 완료 기록을 docs/etc에 작성한다. docs/EZERD.txt는 수정하지 않는다.
