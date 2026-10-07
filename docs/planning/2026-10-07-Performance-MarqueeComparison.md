# 영역 선택 전후 계측 및 제품 PR 계획

- lab 기준 a27b0de(개선 전)와 9e942c4(개선 후)의 NativeERDCanvas만 바꾸어 동일한 production profiling fixture를 빌드한다.
- 50/100개 테이블 × 10컬럼, 동일 선택 유지/선택 대상 변경 시나리오 각각 warmup 1회 및 본 측정 3회를 실행한다.
- 고정 프레임당 synthetic pointermove burst로 반복 가능한 부하를 만들며, 실제 OS 입력 지연 측정과 구분한다. 문서 fingerprint, 최종 선택, 사각형 해제 및 카메라 불변을 검증한다.
- 원시 frame intervals·React commit duration·측정 메타데이터는 Git 제외 artifacts에 저장한다.
- 최신 원격 main에서 제품 변경 및 회귀 테스트·관련 문서만 선별해 독립 검사를 통과하면 별도 브랜치 push와 PR 생성을 진행한다.
