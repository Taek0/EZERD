# Native 표현 복원 후 성능 검증 결과

2026-10-05. [계획](../planning/2026-10-05-Performance-NativePresentation.md) / [구현](2026-10-05-Performance-NativePresentationImplementation.md).

## 비교 조건

clean a6e8640 profiling 빌드. 50테이블·500컬럼, viewport1440×900/DPR1, surface1440×520, scale1. 각 조건 준비1+본측정3회, 두 번째 반복은 역순. 120회 rAF paced wheel 왕복. 같은 빌드에서 Native baseline과 기존 simple-cards를 비교했다. 운영 API/DB를 사용하지 않았다.

| 조건 | React 중앙값(ms) | frame 중앙값(ms) | 각 실행 frame p95(ms) | 25ms 초과 / 360 | DOM |
| --- | --- | --- | --- | --- | --- |
| 표현 복원 Native | 5.7 | 10 | 10.1, 19.9, 10.1 | 0 | 5,768 |
| 기존 simple-cards | 1.6 | 10 | 10.1, 10.1, 10.1 | 0 | 902 |

시간 중앙값은 각 실행 중앙값의 3회 중앙값이다. Native의 실행별 p95 중앙값은10.1ms지만 한 번19.9ms가 나왔으므로 simple-cards와 항상 같은 부드러움이라고 결론 내리지 않는다. 이전 Native DOM3,504개에서 표현 복원 후5,768개로 증가했다. 서로 다른 날짜의 수치를 속도 개선율로 계산하지 않는다.

## 검증

준비 포함8개 raw JSON 모두 clean metadata, documentUnchanged, frame120, 유효 React 표본, surface 크기, 중간 카메라 변화 및 최종 원복을 확인했다. Native에서는 장면/관계선/컬럼 타입 표시 함수 호출0회를 유지했다. 실제 browser wheel pan+Ctrl wheel zoom에서도 transform 변화, 문서 불변, 해당 함수0회를 확인했다. 시각 QA에서는 PK/FK 행 강조·헤더·스키마 배지·양 끝 카디널리티·라벨 배경이 표시되고 컬럼 선택이 유지됐다.

## 한계와 다음 단계

이 단계는 표현 복원이다. 인라인 편집, FK 조작 핸들, 관계선 선택/편집 및 PNG의 동일한 스타일 출력은 완료하지 않았다. 기존 선택 버튼과 Native 상세 편집 경로는 유지한다. 카디널리티는 기존 캔버스와 같은 logical metadata/fallback이며 물리 FK로부터 새로 추론하지 않는다.

측정은 profiling+합성 입력이며 일반 production의 모든 문서/기기에서 성능을 보증하지 않는다. Native의 한 실행에서 남은 p95 지연은 추가 컨트롤을 이식하기 전 재검증할 기준으로 남긴다. 화면 밖 렌더링/브라우저 paint 비용 분리 실험은 이후 범위다. Native 모델을 v1로 축약하거나 UI를 줄여 수치를 맞추지 않았다.

원시 결과·선택/최종 화면은 artifacts/performance/2026-10-05-native-presentation에 Git 제외 상태로 보존했다. 구현 회귀66테스트와 타입/포맷/일반·계측 빌드를 확인했다. 이번 결과 기록은 제품 변경 없이 별도 커밋하며 main·원격은 수정하지 않았다.
