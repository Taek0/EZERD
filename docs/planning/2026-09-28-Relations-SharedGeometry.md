# 관계선 본문·조작 overlay 계산 공유

작성일: 2026-09-28
기준: `213a86f`, `feat/performance-measurement`.

- 변경 전 고정 빌드에서 10개·50개 fixture의 EDIT/MOVE를 반복 실행해 기준을 저장한다. 같은 입력·데이터·브라우저 조건으로 변경 후 결과를 비교한다.
- 현재 두 TableRelationsSvg가 각각 수행하는 순수 geometry 준비를 추출한다. Canvas가 문서·뷰·scope·visibleNodeIds 기준으로 한 번 계산하여 본문과 overlay에 동일 결과를 제공한다.
- 독립적으로 TableRelationsSvg를 사용하는 기존 호출자는 fallback 계산을 유지한다. 글로벌 캐시나 세밀한 무효화는 도입하지 않는다.
- 경로 알고리즘·순서·라벨·장애물·수동 경로는 그대로 유지한다. handler와 드래그 상태는 각각의 컴포넌트가 최신 문서로 처리한다.
- 준비 함수와 view 필터, 수동 경로 보존, 장애물 포함에 대한 테스트를 추가한다. 브라우저에서는 최종 문서 fingerprint와 SVG path를 기준 빌드와 비교한다.
- 전체 검사 및 팬 재계산 0회 회귀 검증을 수행하고 로컬 커밋으로 남긴다. push·main 병합은 이번 단계에 포함하지 않는다.
