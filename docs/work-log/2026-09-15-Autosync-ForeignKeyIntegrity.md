# 자동 동기화 외래 키 무결성 회귀 수정 기록

작성일: 2026-09-15

## 원인

`deriveOperationChanges`가 구조적으로 같은 primitive 배열을 올바르게 제외하도록 바뀐 뒤, FK 생성 bundle에는 더 이상 변경되지 않은 참조 키의 `columnIds` 쓰기가 포함되지 않았다. 서버는 online 작업의 직접 쓰기만 현재 문서에 적용했고 계산된 구조 의존성은 reconnect 충돌에만 사용했으므로, 기준 발급 뒤 참조 키가 삭제되어도 FK와 같은 bundle의 다른 변경을 수락했다.

뒤이은 restore 실패는 별도 restore 결함이 아니었다. 앞 테스트에서 잘못 수락한 논리 이름 `부모` 관계가 공유 통합 테스트 프로젝트에 남았고, restore 결과에서 같은 이름을 검색하는 assertion에 잡힌 연쇄 실패였다. FK bundle을 올바르게 거부하자 기존 restore의 `missing-reference-key` 진단이 복원 관계와 route를 제외했고 원래 assertion이 통과했다.

## 변경

- online 작업의 직접 쓰기 경로는 기존 최신 값 우선 정책을 유지한다.
- 후보 문서에서 서버가 계산한 테이블, 컬럼, 키 등의 구조 의존성 경로는 online과 reconnect 모두 기준 시퀀스 이후 변경을 검사한다.
- online 구조 의존성 충돌은 기존 원자적 missing-target 거부 사유로 반환한다.
- 모델 단위 테스트에 online 직접 쓰기 충돌은 허용하면서 구조 의존성 충돌은 감지하는 계약을 추가했다.

## 검증

- `node node_modules/vitest/vitest.mjs run packages/model/src/sync.test.ts`: 1개 파일, 23개 테스트 통과.
- `pnpm --filter @ezerd/model typecheck`: 통과.
- `pnpm build`: model, contracts, server, web 전체 빌드 통과. web 번들 크기 경고만 발생했다.
- `node apps/server/node_modules/tsx/dist/cli.mjs apps/server/scripts/test-isolated.ts`: 임시 로컬 PostgreSQL 데이터베이스의 마이그레이션과 API/autosync 통합 테스트 2개 파일, 20개 테스트 통과. 스크립트가 임시 데이터베이스를 정리했으며 실제 개발 데이터베이스는 사용하거나 삭제하지 않았다.

요청된 `pnpm --filter @ezerd/server exec tsx scripts/test-isolated.ts`는 현재 Windows 환경에서 pnpm이 로컬 `tsx` 실행 파일을 찾지 못해 테스트 시작 전에 실패했다. 동일하게 설치된 `tsx` CLI 엔트리포인트를 Node로 직접 실행해 같은 스크립트를 검증했다.
