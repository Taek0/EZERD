# 변경 버전 기록 일괄 저장

- 한 저장에서 변경 경로마다 실행하던 sync_field_versions INSERT/UPSERT를 단일 다중 행 UPSERT로 묶었다. 트랜잭션·sequence·operationId·충돌 정책은 유지한다.
- 격리 DB를 생성/마이그레이션한 replay 권한, 취소, native 기능 통합 테스트 160개 통과. 테스트 DB 정리 완료.
- 별도 테스트 프로젝트로 10/50/100 테이블의 이름 변경·컬럼 추가·삭제·10개 속성 변경을 전체/경량 ACK 각각 48회 실행했다. 모두 승인되었고 경량 ACK의 replay 및 전체 서버 원본 문서와 일치했다. 생성 데이터는 finally에서 정리했다.
- 실측 SQL 수: 이름/추가/10개 속성 변경 20회, 단일 컬럼 삭제 21회. 기존 단일 삭제는 22회였다. 10개 속성은 경로 수만큼 SQL 수가 증가하지 않는다.
- 원시 결과는 performance-lab artifacts/performance/2026-10-14-async-final-{full,delta}/samples.json에 보관한다. 전체/경량 실행은 순차 수행이므로 HTTP 시간 차이를 모두 응답 형식의 인과 효과로 해석하지 않는다.
