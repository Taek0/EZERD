# Native 카드·관계선 표현 복원 구현

2026-10-05. [계획](../planning/2026-10-05-Performance-NativePresentation.md)에 따라 색상 헤더·도메인/스키마 배지·키/컬럼/타입/NULL/comment 제목행·PK/FK 강조와 관계선의 카디널리티/라벨 배경을 복원했다. 관계선 카디널리티는 기존 v1과 같은 logical endpoint metadata/fallback을 사용한다. Native 타입 모델은 그대로 표시한다.

## 검증

기존 scene/기하/스타일/PNG 회귀 63개와 표현 전용 신규3개 테스트 통과. 타입·format:check·perf:build·일반 웹 production 빌드 통과. 브라우저에서 header50px, thead28px, row52px, 첫 행 offset79px(78+border1)을 확인했다. 카드 가로 overflow가 없고, 컬럼 버튼 클릭 시 선택 표시가 갱신된다. 화면 증거를 임시 저장했고 최종 측정 결과와 함께 artifacts/performance에 보존한다.

## 범위

NativeCanvasScene의 memo 경계를 유지했다. 인라인 편집·관계선 drag/hit 도구·전체 UI 동등성은 이번 단계가 아니다. PNG는 기존 단순화된 exporter를 유지하며 FK 키 텍스트는 공통 row helper를 통해 반영된다. 기존 row height와 routing offset을 유지하므로 이번 단계에서 저장된 배치를 수정하지 않았다. main/DB/원격은 수정하지 않았다. 성능 반복 비교는 이 구현의 clean 빌드에서 별도 기록한다.
