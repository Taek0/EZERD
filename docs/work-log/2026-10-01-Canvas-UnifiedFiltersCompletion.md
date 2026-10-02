# 공유 캔버스·개인 도메인 필터 통합 완료

## 사용자 동작

- 프로젝트는 도메인 유무와 관계없이 전체 테이블 캔버스로 시작한다. 도메인 뷰 생성 UI는 도메인 필터로 통합했다.
- 필터는 각 화면의 로컬 상태다. 전체·한 도메인·복수 도메인·미지정을 선택할 수 있고 다른 사용자의 필터는 변경하지 않는다.
- 테이블 위치·크기·이름·색상·컬럼·메모·관계선은 공유 전체 캔버스 상태를 편집한다. 단일 도메인 필터에서는 해당 소속으로 새 테이블을 만든다.
- 도메인 맵은 유지하며 도메인을 열면 같은 전체 화면에 필터를 적용한다. 기존 도메인·함께 보기 링크와 핀은 공유 좌표에 연결한다.
- 테이블 헤더에는 오른쪽 도메인 이름만 13px로 표시하고 제목은 26px 흰색으로 통일했다. 제목 편집은 투명하고 테두리·윤곽이 없는 같은 크기 입력 필드다.

## 실제 검증

- 두 Canvas 인스턴스에 같은 공유 문서를 연결했다. A에서 Sales 필터를 적용해도 B에는 전체 테이블이 표시됐고 문서 변경 콜백 수는 0이었다.
- A에서 만든 `orders_detail`은 Sales 소속으로 생성됐고 B에서도 표시됐다. A에서 `orders`를 `sales_orders`로 바꾸면 B에도 반영됐다. A의 필터는 그대로 유지됐다.
- A에서 테이블을 (0, 0)에서 (120, 90)으로 이동시켰고 B의 동일 테이블도 같은 좌표에 표시됐다.
- 실제 제목 입력 스타일의 흰색 글자·26px·transparent 배경·0px 테두리·outline none을 확인했다. 헤더 개선 단계에서 Enter 저장·Escape 취소·한국어 blur 저장도 확인했다.
- PostgreSQL과 HTTP API 격리 테스트 3개 통과. 기존 도메인 공유 메모·관계선의 전체 좌표 이관, 다른 멤버의 재조회, 같은 도메인 재지정과 개인 viewport 격리를 포함한다.

## 최종 검사

- `pnpm typecheck` 통과.
- `pnpm test`: 100개 파일·642개 테스트 통과. 선택 실행 DB 테스트 43개는 기본 실행에서 건너뛴다.
- `EZERD_DIRECT_TABLE_DB_TEST=1 pnpm exec vitest run apps/server/test/direct-table.integration.test.ts`: 임시 DB를 생성·마이그레이션·삭제하며 3개 테스트 통과.
- `pnpm build` 통과. 기존 번들 크기 알림은 남아 있다.
- 임시 QA HTML을 제거했다. `pnpm format`, `pnpm format:check`, `git diff --check`를 완료했다.

## 기록과 지원 경계

[계획](../planning/2026-10-01-Canvas-UnifiedDomainFilters.md), [헤더 개선](2026-10-01-Canvas-TableHeaderRefinement.md), [모델](2026-10-01-Canvas-UnifiedFiltersModel.md), [서버](2026-10-01-Canvas-UnifiedFiltersServer.md), [웹](2026-10-01-Canvas-UnifiedFiltersWeb.md).

과거 개인 기록과 개인 API는 호환을 위해 보존한다. 여러 사용자의 개인 메모를 일괄 공유로 공개하지 않는다. 활성 테이블 화면의 편집은 모두 공유 경로를 사용하고 카메라와 필터는 각자 조작한다. 서버와 웹은 함께 갱신해야 한다. 운영 데이터 일괄 이관·배포·push는 수행하지 않았다.
