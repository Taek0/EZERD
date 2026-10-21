# 테이블 자동 배치 모델 구현 결과

작성일: 2026-10-21. [구현 계획](../planning/2026-10-21-Canvas-TableAutoLayoutPlan.md)의 순수 모델 계산 범위를 구현했다. 기존 `layout.ts`와 도메인 배치는 수정하지 않았다.

## 구현

- `arrangeNativeTableNodes(nodes: NodeLayout[], relations: { sourceTableId: string; targetTableId: string }[]): NodeLayout[]`를 모델 public export에 추가했다. 호출자는 현재 보이는 TABLE 카드와 실제 측정 크기를 전달한다.
- 입력 순서, 노드 ID·기타 속성·크기를 보존하고 좌표만 새 객체에 반영한다. 결과의 최소 x/y는 입력 최소 x/y다. 입력 배열·객체·관계는 변경하지 않는다.
- FK source → PK target 관계를 부모 → 자식 계산 그래프로 반전한다. 반복형 Kosaraju SCC와 DAG 최장 경로 rank를 사용한다. SCC 외부의 부모는 자식보다 항상 위에 있으며, 긴 단일 연결은 접지 않는다.
- weak component를 나누고 실제 카드 크기를 사용해 같은 rank를 목표 폭에 맞춰 여러 행으로 감싼다. 다음 rank는 이전 rank의 모든 행 아래에 배치한다. 독립 component는 shelf 방식으로 포장한다. 카드와 component 경계 사이 간격은 200이다.
- canonical ID 순서에서 네 번의 barycenter sweep을 수행한다. 최종 점수가 같은 노드에만 기존 y→x→ID 순서를 적용한다. x만 tie-break로 사용하면 래핑된 행이 다음 실행에서 재정렬되므로, 기존 행을 위에서 아래로 읽는 방식으로 반복 실행의 고정점을 유지한다. 그래프 구조가 정한 순서를 수동 좌표보다 우선하며, 무관한 component 순서는 canonical ID 순서다.
- 전체 padded area에서 유도한 폭의 0.8/1.2/1.8배 세 후보만 평가한다. 종횡비, 면적, 평균 중심 간 관계 길이, 최대 64개 관계의 교차 표본을 점수에 반영한다. 교차 검사는 후보당 최대 2,016쌍이며 실제 관계 라우팅의 장애물 검사는 수행하지 않는다. 반복 수렴·재귀 그래프 순회·전체 관계쌍 스캔은 사용하지 않는다.

## 검증

- `pnpm.cmd --filter @ezerd/model typecheck`: 통과.
- `pnpm.cmd --filter @ezerd/model build`: 통과.
- `pnpm.cmd exec vitest run packages/model/src/native-table-auto-layout.test.ts packages/model/src/layout.test.ts`: 2파일, 18테스트 통과.
- 신규 10테스트는 별·고립·순환·여러 연결 그룹·불균일 크기·모든 카드 간 200 간격·SCC 외부 부모 순서·입력 불변성·origin 보존·입력/관계 permutation·중복/누락 관계·반복 실행·기존 형제 좌우 순서·2,500노드 긴 연결을 검증한다. 24개 고정 seed의 불균일 순환 그래프에도 permutation/고정점/간격을 검증한다.
- 변경한 모델 파일·테스트·index export에는 Prettier를 적용했다. 저장소 전체 검증은 통합 작업에서 수행한다.

## 합성 측정

Node v24.18.1, Windows x64, AMD Ryzen 9 7900X 환경에서 각 조합을 30회 예열하고 200회 측정했다. 실제 크기는 폭 280–492, 높이 220–622로 다르다. 아래 시간은 순수 모델 호출만 포함하며 Worker 전달·카드 측정·저장·렌더링·관계선 라우팅은 포함하지 않는다. 성능 상한을 보장하는 수치가 아니라 이 로컬 실행 결과다.

| 테이블 수 | tree median / p95 (ms) | star median / p95 (ms) | isolates median / p95 (ms) | cycles median / p95 (ms) | chain median / p95 (ms) |
| --- | --- | --- | --- | --- | --- |
| 20 | 0.041 / 0.164 | 0.034 / 0.110 | 0.029 / 0.096 | 0.038 / 0.144 | 0.029 / 0.082 |
| 50 | 0.104 / 0.187 | 0.077 / 0.180 | 0.047 / 0.100 | 0.105 / 0.183 | 0.107 / 0.208 |
| 100 | 0.163 / 0.257 | 0.131 / 0.208 | 0.103 / 0.262 | 0.171 / 0.320 | 0.164 / 0.319 |

100개 star 결과 경계는 5,660×7,386, isolates는 8,484×5,554였다. 100개 chain은 492×61,565로 부모 순서를 유지하며 길게 이어진다. 모든 측정 조합에서 결과를 재입력했을 때 좌표가 정확히 일치했다.

원시 표본과 실행 스크립트는 Git 제외 대상인 `artifacts/performance/table-auto-layout-model-2026-10-21.json`, `artifacts/performance/table-auto-layout-model-2026-10-21.mjs`에 저장했다. 재실행 명령은 `pnpm.cmd --filter @ezerd/model build` 후 `node artifacts/performance/table-auto-layout-model-2026-10-21.mjs`다.

## 실제 문서 비교의 제약

통합 작업에서 실제 측정 크기를 사용해 확인한 43카드·61관계 문서는 기존 경계 7,620×18,921에서 신규 8,445×11,142로 바뀌었다. HWP 49카드·75관계 문서는 기존 8,200×3,756에서 신규 9,260×7,720으로 늘었다. 두 문서 모두 카드 겹침이 없고 반복 실행 결과가 같았다. 순수 계산 시간은 각각 약 0.40ms, 0.18ms였다. 원시 결과는 `artifacts/performance/2026-10-21-table-layout/actual-results.json`이다.

이번 모델은 기존 100/64 간격 대신 200 간격과 SCC 외부 부모의 위쪽 계층을 강제한다. 세 폭 후보의 점수는 이 제약 안에서 형태를 선택하는 휴리스틱이며, 기존 배치보다 모든 문서의 면적이 작아지는 것을 보장하지 않는다. 특히 이미 낮고 가로로 넓은 문서는 계층 보존으로 높이가 늘 수 있다. 실제 카드 간 관계선 라우팅 품질은 별도의 캔버스 검증 범위다.
