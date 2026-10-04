# Native 렌더 분리 후 프레임 재측정 계획

2026-10-04. 455d6d6 구현을 대상으로 기존 baseline/memo-leaves/simple-cards와 Native baseline을 동일 clean profiling 빌드에서 비교한다. 50테이블·10컬럼, 1440×900 viewport, 1440×520 canvas, scale1, 120회 paced wheel, 조건별 준비1회+본측정3회로 진행한다. 두 번째 반복의 순서를 반대로 바꾼다. 원시 결과는 artifacts/performance에 보존한다. React actualDuration과 rAF 간격은 구분하고 이전 main 수치를 직접 전후 성능으로 비교하지 않는다. Native에서 geometry/타입 표시 호출 0회가 유지되는지 확인한다. 문서 불변과 왕복 카메라·surface 크기를 검사하고 결과와 한계를 work-log에 기록한다. 제품 코드·운영 DB·main·원격은 변경하지 않는다.
