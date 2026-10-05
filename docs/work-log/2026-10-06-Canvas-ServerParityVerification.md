# 복구된 캔버스 명령의 실제 서버 검증

- 계획: [CompleteParityRestoration](../planning/2026-10-06-Canvas-CompleteParityRestoration.md).
- 실제 PostgreSQL 저장소·Nest HTTP 서버에서 PostgreSQL/MySQL/SQLite Native 프로젝트 각각에 UI의 그룹 이동/자동 배치/삭제 helper가 만든 명령을 제출했다.
- 3개 테스트 모두 통과: 묶음 배치 저장, 같은 operation ACK replay 시 문서/sequence 불변, 잘못된 한 항목 포함 시 전체 취소, 필터 밖 테이블 배치 보존, 개인 보기의 여러 노드 CAS 저장과 shared 원문 불변, 선택한 테이블/컬럼 cascade 및 v1 소비자 보호.
- `scripts/test-isolated.ts`가 생성한 독립 ezerd_qa DB에서 마이그레이션/검증/정리를 완료했다. 기존 데이터베이스는 변경하지 않았다.
- 첫 실행에서는 검증 3개가 통과했지만 테스트 teardown의 workspace 기본키가 잘못되어 종료 검사에 실패했다. workspace_id로 수정 후 전체 실행·정리까지 통과했다.
- 사용자가 브라우저 검증을 제외했다. 실제 서버 결과를 실제 UI 조작/모션 검증으로 계산하지 않는다.
