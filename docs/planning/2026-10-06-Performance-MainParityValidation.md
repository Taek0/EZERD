# 최신 main 성능 검증 계획

- 대상 main 1ac4d6d. 성능 lab에 merge하여 제품 코드는 최신 원격 기준으로 맞추고 측정 도구는 유지한다.
- production profiling 빌드, 1280×720 브라우저/1280×520 캔버스, 50/100 테이블 × 10컬럼에서 Native와 기존 simple-cards를 비교한다. 각 조건 워밍업 1회+본 측정 3회, 순서 교차, rAF wheel 120회.
- frame p95/25ms 초과/React actualDuration/장면·관계·타입 재계산, 문서 불변과 카메라 왕복을 확인한다. 변경된 Native 렌더 경로에 맞게 계측 어댑터를 검토한다.
- 결과를 work-log에 기록하고 원시는 artifacts/performance에 저장한다. main/실제 데이터/원격 브랜치는 변경하지 않는다.
