# 세션 lastSeenAt 갱신 주기 제한 결과

계획: [성능 우선 개선 계획](../planning/2026-10-16-Performance-PriorityImprovements.md). 근거: [코드베이스 품질 감사](2026-10-16-Quality-CodebaseAudit.md)의 B4.

## 변경

- `apps/server/src/identity/session.ts`는 인증 조회에 `lastSeenAt`을 포함한다. 이 필드는 스키마에서 NOT NULL이며, 애플리케이션에서 인증 판단에 사용하지 않는 관측 시각이다.
- 마지막 관측 시각이 현재 인증 시각보다 60초를 초과해 오래된 경우에만 UPDATE를 요청한다. 정확히 60초인 경우에는 생략하며 기존 MCP 토큰 touch의 strict `<` 경계와 일치한다.
- UPDATE의 WHERE에 세션 ID와 `last_seen_at < cutoff`를 함께 넣는다. 여러 인증이 같은 오래된 값을 읽어도 먼저 갱신된 값은 후속 UPDATE의 조건에서 제외된다. 최근 값을 읽은 일반 요청은 UPDATE 쿼리 자체를 보내지 않는다.
- 매 요청의 토큰 SHA-256 조회, 현재 시각 기준의 엄격한 만료 검사, 사용자 join을 유지한다. 인증 결과를 캐시하지 않으며, 로그아웃의 세션 삭제와 폐기 알림도 유지한다.

## 검증

- `pnpm.cmd exec vitest run apps/server/test/session.test.ts apps/server/test/mcp-token.test.ts apps/server/test/write-auth.test.ts`: 3개 파일, 19개 테스트 통과.
- 새 세션 회귀 테스트 9개는 0/59,999/60,000ms의 UPDATE 생략, 60,001ms의 갱신, 병렬 조회의 원자 갱신 조건, 반복 인증의 최신 사용자·토큰·만료 SQL, 없는/만료된 세션 거부, 다른 토큰 거부, 로그아웃 후 동일 토큰 거부를 확인한다.
- 변경한 TypeScript 파일만 Prettier로 포맷했다. 전체 검증과 단위 커밋은 상위 작업에서 수행한다.

## 효과와 한계

최근 세션 인증에서는 기존 SELECT + UPDATE가 SELECT 하나로 줄어든다. 테스트는 실제 서비스가 생성하는 Drizzle 조건을 PostgreSQL SQL로 컴파일해 확인한다. 실제 PostgreSQL 부하·동시성 실행이나 응답 지연 개선율은 측정하지 않았다. 관측 시각은 성공한 모든 요청의 정확한 시각 대신 마지막 주기 갱신 시각을 나타낸다.
