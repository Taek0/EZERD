# 참여자별 동기화 기준 갱신 수정

작성일: 2026-09-15

다른 참여자가 만든 객체를 편집할 때 그 참여자에게 귀속된 `nextBaseline`을 재사용하지 않고, 편집자의 `clientId`로 최신 기준을 다시 발급받아 변경 의도를 적용하도록 수정했다. 기준 갱신 중 더 최신 이벤트가 도착하면 오래된 응답을 채택하지 않고 다시 갱신한다.

갱신 실패로 기존 기준에 표현할 수 없는 변경은 잘못된 변경 목록과 전체 문서를 서버로 보내지 않고 unresolved 상태로 영속 보관한다. 연결 복구 후 재적용은 먼저 수신자 기준을 갱신하고 새 작업을 내구 저장한 다음 기존 unresolved 항목을 제거한다.

기준 갱신 전에 만들어진 로컬 선행 작업이 있으면 후속 작업에 그 baseline 계보를 로컬 메타데이터로 보존한다. 선행 ACK 뒤 후속 작업을 승인 문서에 rebase할 때 사용하며, 후속 작업이 이미 더 최신 수신자 기준을 가진 경우에는 더 오래된 ACK 후보를 제외한다. 메타데이터는 서버의 엄격한 작업 계약에 포함되지 않도록 송신 전에 제거한다. rebase는 저장 항목의 기존 `createdAt`, `baselineAt`, `baselineIssuedAt` 기반 자동 재연결 나이를 바꾸지 않는다.

검증 결과:

- `node node_modules/vitest/vitest.mjs run apps/web/src/sync-client.test.ts apps/web/src/sync-queue.test.ts`: 2개 파일, 31개 테스트 통과.
- `pnpm --filter @ezerd/web typecheck`: 통과.
- `git diff --check -- apps/web/src/sync-client.ts apps/web/src/sync-client.test.ts apps/web/src/sync-queue.ts`: 통과.

커밋 `7de03b2` 기준으로 `pnpm check`를 다시 실행해 전체 타입 검사와 4개 워크스페이스 빌드가 통과했다. Vitest는 46개 파일 중 44개 통과·2개 건너뜀, 236개 테스트 중 217개 통과·19개 건너뜀이다. 웹 프로덕션 빌드는 1,478개 모듈을 변환해 성공했으며, 기존 500 kB 초과 청크 경고가 남아 있다. 실제 PostgreSQL 통합 검사는 이 기본 검사에 포함되지 않는다.

별도 실제 브라우저 검증에서는 오프라인 편집, 새로고침 복원, 누락 이벤트 따라잡기, 서로 다른 속성의 동시 변경까지 부분 통과했다. 이후 브라우저 하네스의 요청 라우팅 단계를 수정했으며 전체 인수 시나리오 완료 여부는 별도 브라우저 작업 기록에서 확정한다.
