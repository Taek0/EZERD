# 사용자 및 리뷰 데이터 초기화 결과

작성일: 2026-09-15

사용자 승인에 따라 로컬 개발 DB의 사용자 및 연결된 핀·메시지·알림을 전체 초기화했다. 프로젝트 및 설계는 유지했다.

- 초기화 전: 프로젝트 2개, 사용자 15명, 핀 9개, 메시지 12개, 알림 1개.
- 초기화 후: 프로젝트 2개, 사용자·핀·메시지·알림 각 0개.
- 기존 API 프로세스를 확인하여 중지하고, 관련 테이블 및 마이그레이션 테이블을 잠근 단일 트랜잭션에서 전체 행을 비공개 `.cache/backups/2026-09-15-Identity-Reset-1789403690916.json`에 백업했다.
- 핀 삭제에 따른 메시지·알림 cascade, 사용자 삭제, 0003 유일성 제약 및 Drizzle migration journal 적용을 같은 트랜잭션에서 실행했다. 프로젝트 전체 행이 백업과 동일하고 초기화 대상이 0건임을 확인한 뒤 COMMIT했다.
- 0003 SHA-256: `0b72b4dd0cc422e0e32c90d07e406bf0d278d28f688ef63fa2779a9f5a455e28`; journal ID 4, timestamp `1789398286354`.
- `pnpm db:migrate` 성공. 이후 migration journal이 4건인 것을 확인하여 추가 적용 없는 상태를 검증했다.
- `pnpm test:integration`: 실제 PostgreSQL HTTP 통합 테스트 12개 통과. 빌드 성공, 기존 대형 번들 경고 존재.
- 테스트 종료 후에도 프로젝트 전체 행은 백업과 동일하며 프로젝트 2개, 초기화 대상 4개 테이블 각 0건, `users_username_unique` 제약조건 존재를 재확인했다.
- API를 `127.0.0.1:3001`에서 숨김 프로세스 PID 19400으로 재시작하고 `GET /api/users`의 HTTP 200 및 빈 배열 응답을 확인했다.

초기화는 재실행용 스크립트를 남기지 않고 일회성 Node stdin 코드로 실행했다. 백업과 검증 receipt는 Git에서 제외된 `.cache/`에 보관하며 커밋에 포함하지 않는다. 검증 receipt: `.cache/backups/2026-09-15-Identity-Reset-Receipt.json`. API 로그: `.cache/api-reset-stdout.log`, `.cache/api-reset-stderr.log`.
