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

## 고정 커밋 비교 결과

실험 빌드는 `5f6479a`, dirty=false이며 baseline과 같은 fixture·브라우저·입력으로 실행했다. 10개는 준비1+반복3회씩, 50개는 준비1+반복5회씩 수행했다. 16개 유효 반복 쌍 모두 최종 문서 fingerprint·전체 본문 SVG path가 정확히 일치했다. 입력 이벤트 수와 환경 metadata도 자동 비교했다.

| 시나리오 | 관계 경로 호출 전→후 | 카드 치수 호출 전→후 |
| --- | --- | --- |
| EDIT, 테이블10·컬럼5 | 20→10 | 220→120 |
| MOVE, 테이블10·컬럼5 | 80→40 | 880→480 |
| EDIT, 테이블50·컬럼10 | 100→50 | 5,100→2,600 |
| MOVE, 테이블50·컬럼10 | 400→200 | 20,400→10,400 |

50개 반복5회의 함수별 inclusive 누적 시간 중앙값:

| 시나리오 | 카드 치수 전→후 | 경로 계산 전→후 |
| --- | --- | --- |
| EDIT | 88.5→49.6ms | 42.9→22.0ms |
| MOVE | 360.7→190.7ms | 168.8→86.7ms |

위 시간은 입력 하나부터 종료까지의 전체 지연이 아니라 run 안에서 해당 함수가 실행된 시간을 합한 것이다. 측정 오버헤드를 포함하고 기준/실험 교차 순서(ABBA) 검증이 아니므로, 전체 체감 속도가 절반이 됐다는 의미는 아니다. 계산 준비를 Canvas로 옮겨 Canvas 함수 span의 포함 범위도 바뀌었으므로 Canvas span 자체는 전후 속도 비교에 사용하지 않는다.

카메라 PAN 회귀 검사에서도 치수·경로·도메인 geometry 호출0회가 유지됐고 문서 데이터는 불변이었다. `assertCameraReuse`로 확인했다.

## 결과 파일·재현

- 변경 전: `artifacts/performance/213a86f-edit-move/`
- 변경 후: `artifacts/performance/5f6479a/`
- 비교 결과: 변경 후 폴더의 `comparison.json`
- PAN 및 화면 증거: `pan-regression.json`, `shared-geometry.png`

```powershell
node scripts/performance/compare-edit-move.mjs artifacts/performance/213a86f-edit-move artifacts/performance/5f6479a
```

비교 스크립트는 dirty/실패/계측 off 표본, 입력 이벤트·fixture·환경 차이, 문서/경로 차이를 거부한다. 준비 실행(-1)은 통계에서 제외한다. 원시 결과는 Git 제외 대상이며 이 문서에 요약을 보존한다.

## 남은 범위

- 문서 변경마다 모든 관계를 한 번씩 재계산한다. 개별 테이블 치수 인덱스와 관계별 무효화는 다음 단계다.
- 관계마다 전체 장애물 카드 크기를 다시 만드는 비용은 남아 있다. 중복 레이어를 제거했지만 계산 복잡도 자체를 바꾼 것은 아니다.
- 직접 관계선 조작·취소는 기존 단위 테스트 및 SVG 동등성으로 확인했고, 이번 브라우저 시나리오는 카드 이동·컬럼 편집·팬에 한정했다. 전체 undo·실시간 동기화·PNG의 수동 회귀 검증은 별도다.
- 전체 메모리와 GPU·실제 input-to-present 지연은 측정하지 않았다. 별도 브랜치의 로컬 커밋이며 원격 push는 수행하지 않았다.
