# 관계선 본문·overlay 계산 공유

작성일: 2026-09-28
기준 브랜치: `feat/performance-measurement`, 변경 전 `213a86f`.

## 변경

- 기존 TableRelationsSvg의 순수 준비 코드를 `prepare-table-relations.ts`로 옮겼다. 경로 계산 입력·순서·필터·알고리즘을 변경하지 않았다.
- Canvas가 문서·뷰·scope·visibleNodeIds에 따라 geometry를 한 번 준비하고 본문/조작 overlay에 같은 배열을 제공한다. 컴포넌트 단독 사용 시 기존처럼 자체 계산하는 fallback을 유지한다.
- 전역 캐시·세부 필드 무효화는 추가하지 않았다. 편집·이동 시 새 문서에 대해 전체 geometry를 갱신하며, 카메라 이동에서는 재사용한다. overlay 이벤트·pointer capture·rollback은 각 컴포넌트가 계속 처리한다.
- 브라우저 편집/드래그 반복 helper `scripts/performance/browser-edit-move.mjs`를 추가했다. 현재 한국어 fixture 기준이며 입력 결과와 문서 변경을 확인하고 SVG paths도 수집한다.

## 변경 전 측정

고정 빌드 `213a86f`, dirty=false에서 10개/컬럼5개와 50개/컬럼10개를 사용했다. 1440×900 in-app browser, locale ko, 관계 수는 테이블 수와 동일하다. EDIT는 id→측정용_고객_식별자, MOVE는 카드 헤더를 4개 pointermove로 100px 이동한다.

- 10개: 각 시나리오 준비1회 + 반복3회. EDIT 경로20회, MOVE 경로80회가 반복마다 동일했다.
- 50개: 각 시나리오 준비1회 + 반복5회. EDIT 경로100회·치수5,100회, MOVE 경로400회·치수20,400회가 반복마다 동일했다.
- 원시 결과와 SVG 경로는 `artifacts/performance/213a86f-edit-move/`에 저장했다. Git 추적 제외 대상이다.

## 구현 검증

- view/scope/combined view/visible endpoints 필터, 수동 경로와 문서 불변, 카드 치수·장애물 이동 갱신 테스트를 추가했다.
- 두 레이어에 같은 geometry를 공급할 때 실제 경로 함수는 관계당 한 번만 호출되고, standalone fallback의 본문·overlay SVG 문자열과 각각 동일함을 렌더 테스트로 확인했다.
- 최종 `pnpm check`에서 378개 통과·DB 관련25개 skip·타입·포맷·일반 빌드 통과. 공유 렌더 검증을 포함한 관련 테스트4개와 성능 빌드도 통과했다. 기존 큰 청크 경고는 유지된다.
- 커밋 전 작은 EDIT 실험은 경로20→10회, baseline과 최종 문서 fingerprint·SVG path 동일을 확인했다. 최종 커밋 반복 결과는 후속 기록한다.
