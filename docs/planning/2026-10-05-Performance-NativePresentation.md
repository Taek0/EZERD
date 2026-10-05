# Native 카드·관계선 표현 복원 계획

2026-10-05. 455d6d6의 렌더 경계를 유지한 채 기존 v1 UI의 시각 요소를 Native에 단계적으로 복원한다. 이번 단계는 색상 헤더/도메인 배지, 컬럼 제목, PK/FK/UQ 표시와 행 강조, hover/focus, 관계선 카디널리티와 라벨 배경이다. Native 원본 타입·NULL·comment 표시 및 선택 콜백을 유지하고 v1 데이터 투영은 하지 않는다.

카드 header50+컬럼제목28=78px을 기존 scene의 row offset과 맞춘다. 기존 row height를 유지해 배치/관계 앵커 계산과 맞춘다. 인라인 편집·관계선 드래그 도구는 이후 별도 단계이며 이번 화면에 작동하지 않는 버튼을 넣지 않는다. PNG는 기존의 단순화된 Native export 표현을 유지한다.

회귀 테스트/타입/포맷/빌드와 브라우저 visual QA 후 같은 clean profiling 빌드에서 Native·기존 simple-cards를 각 준비1+본측정3회 비교한다. pan에서 geometry/타입 표시0회, 문서 불변, p95를 확인하고 결과와 제한을 기록한다. main/운영 문서/원격은 변경하지 않는다.
