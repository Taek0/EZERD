# 전체 테이블 캔버스와 테이블 색상 완료 기록

## 사용 흐름

- 빈 프로젝트는 전체 테이블 캔버스에서 바로 테이블을 만들 수 있다. 도메인이 있는 기존 프로젝트는 도메인 맵으로 시작한다.
- 툴바의 `전체 테이블`과 `도메인 맵`으로 이동한다. 도메인 생성 → 내부 화면 → 테이블 생성 흐름을 계속 사용할 수 있다.
- 테이블 속성에서 도메인을 지정하거나 미지정으로 해제한다. 테이블 ID와 컬럼·키·관계, 전체 캔버스의 위치는 유지한다.
- 테이블 색상을 지정하면 모든 화면과 협업자에게 같은 색상을 표시한다. 자동 색상으로 되돌리면 소속 도메인 색상, 미소속이면 중립 색상을 사용한다.
- 공유 저장·MCP·파일 이동·복사/붙여넣기·DDL·PNG·리뷰 핀을 새 전체 뷰에 연결했다.

## 구현 단위

- [계획과 지원 경계](../planning/2026-10-01-Canvas-DirectTableImplementation.md)
- [모델·계약](2026-10-01-Canvas-DirectTableModel.md)
- [서버·MCP](2026-10-01-Canvas-DirectTableServer.md)
- [웹 구현과 브라우저 QA](2026-10-01-Canvas-DirectTableWeb.md)
- [격리 PostgreSQL·HTTP 검증](2026-10-01-Canvas-DirectTableIntegration.md)

## 최종 검증

- `pnpm test`: 99개 파일·623개 테스트 통과. 선택 실행 DB 테스트 42개는 기본 실행에서 건너뛴다.
- `EZERD_DIRECT_TABLE_DB_TEST=1 pnpm exec vitest run apps/server/test/direct-table.integration.test.ts`: 실제 DB·HTTP 테스트 2개 통과. 임시 DB를 생성·마이그레이션하고 제거했다.
- `pnpm typecheck`, `pnpm build`: 전체 타입 검사와 빌드 통과. 웹 빌드의 기존 큰 번들 알림은 남아 있다.
- 최종 CSS 배지 보완 후 `pnpm --filter @ezerd/web build`도 통과했다. `pnpm format`, `pnpm format:check` 및 `git diff --check`를 완료했다.
- 실제 화면에서 두 생성 흐름, 소속 지정/해제, 색상 우선순위·초기화, 위치 유지, 컬럼 추가·자동 배치·확대/축소와 실제 PNG 픽셀을 확인했다.

버전 1 문서를 확장했으므로 서버와 웹을 함께 배포해야 한다. 기존 저장소의 문서 용량·노드 한도를 확대하지 않았으며, 기존 문서의 전체 배치 보완으로 한도를 넘는 경계는 서버 기록에 명시했다. 운영 데이터 이관·배포·push는 수행하지 않았다.
