# 캔버스 비교 계측 구현

2026-10-02. 최신 main 396ba24를 병합한 lab에서 동일한 50테이블·10컬럼 fixture로 기존/Native 캔버스를 비교하는 읽기 전용 진단 화면을 추가했다. 운영 API는 호출하지 않는다.

- production React profiling을 별도 EZERD_PERF_COMPARISON=1 빌드에만 적용한다.
- React Profiler, 함수 집계, rAF 간격, 지원되는 longtask/Long Animation Frame을 수집한다.
- baseline, memo-leaves, simple-cards, no-relations, flat-style 조건을 제공한다. memo-leaves는 읽기 전용 실험에서 콜백 identity를 무시하므로 제품 코드로 사용하지 않는다.
- 카메라는 양쪽 translate(24px,24px)/scale(1), 표면 1440×520 기준이다. 주변 상세 패널은 비교 영역에서 제외한다. 카드 실제 크기/표시 차이는 그대로 유지한다.
- 휠은 프레임당 한 개의 합성 이벤트로 재생하며 실제 물리 입력 벤치마크와 구분한다. 함수 span 원시 목록은 큰 전송 비용을 피하기 위해 결과에서 제외하되 집계, 프레임, React commit 표본은 보존한다.
- 이전 빌드와 결과는 유지하며 dist-performance-comparison은 Git/포맷 제외 대상이다.
- 최신 lockfile의 추가 의존성으로 초기 타입 검증에서 fake-indexeddb가 누락되어 frozen-lockfile 설치 후 타입 검증 및 비교 빌드를 통과했다. lockfile은 변경하지 않았다.
- 예비 브라우저 실행에서 실제 transform 변화, 문서 불변 및 production Profiler 표본 수집을 확인했다. 최종 반복 결과는 별도 측정 결과 문서에 기록한다.

후속 검증: 실제 브라우저 휠 검증 버튼을 af0c7cd에 추가했다. 반복 결과를 점검하면서 surface 크기를 mount 애니메이션 도중 읽은 표본이 발견되어 유한 진입 애니메이션 종료 후 측정을 시작하도록 수정했다. 이전 결과는 예비 표본으로 보존하고 최종 비교는 수정된 clean 빌드에서 다시 수행한다.
