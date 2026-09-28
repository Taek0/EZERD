# 최소 성능 측정 도구 구현과 사용법

작성일: 2026-09-28
브랜치: `feat/performance-measurement`, 제품 기준 커밋 `293ff60`.

## 구현

- `apps/web/performance`에 실제 Canvas를 사용하는 독립 테스트 진입점과 Vite 계측 변환기를 추가했다. 일반 제품 계산·렌더 알고리즘은 수정하지 않았다.
- 성능 빌드에서만 모델의 `tableCardMetrics`·`tableCardSize`, 웹의 `relationGeometry`·`layoutDomainRelations`, Canvas 렌더 함수·이동 처리 함수를 try/finally 계측한다. 필수 함수가 변환되지 않으면 빌드를 실패시킨다.
- collector는 inclusive 시간·호출 수·최댓값·원시 표본과 중앙값/p95를 제공한다. 원시 표본 상한 초과 시 손실을 표시하고 해당 함수의 분위수는 null로 둔다. off 모드, reset·run 간 격리·잘못된 전이 처리를 제공한다.
- 10·50·100·300개 테이블, 5·10·30개 컬럼의 고정 fixture를 제공한다. 테이블당 FK 한 개이며 데이터 내용 fingerprint는 비교용 FNV-1a로 보안 해시가 아니다. 모델 진단에서 정상임을 확인했다.
- 페이지에서 PAN/MOVE/EDIT 선택, reset, arm, finish, JSON 표시·다운로드를 제공한다. 입력 이벤트 수·전후 문서 fingerprint·첫 카드/컬럼·카메라·DOM 수·rAF 간격을 함께 저장한다.
- 30초 실행 제한, 오류·visibility 중단 표시, 예약 callback 정리를 포함했다. 페이지가 완전히 멎거나 crash하면 자체 타이머도 동작하지 못하므로 자동화 측의 timeout 판단이 여전히 필요하다.
- 단일 프로세스 계산 runner는 전체 카드 치수 계산만 5회 준비·30회 반복한다. UI·관계 입력 준비·관계 경로 비용은 이 터미널 수치에 포함하지 않는다.

## 실행

```powershell
pnpm perf:calculate
pnpm perf:calculate 100 300
pnpm perf:build
pnpm perf:serve
```

브라우저 주소는 `http://127.0.0.1:4175/performance/index.html`이다. `perf:build`는 별도 `apps/web/dist-performance`로 빌드하며 `perf:serve`는 loopback에서만 제공한다. 기존 4175 포트를 사용하는 프로세스가 있으면 자동 대체하지 않고 실패한다.

1. Tables/Columns 선택 후 Reset fixture를 눌러 ready를 확인한다.
2. PAN은 손 도구 또는 wheel 팬, MOVE는 카드 이동, EDIT는 컬럼 이름 편집으로 사용한다. 준비 조작은 arm 전에 완료한다.
3. Arm measurement를 누른 후 편집 영역에서 조작한다. 첫 유효 입력에서 수집이 시작된다. hover만으로는 시작하지 않는다.
4. Finish measurement를 누르면 마지막 UI 갱신 기회를 기다린 뒤 결과를 확정한다. JSON 텍스트 또는 Download JSON으로 수집한다.
5. 각 반복 전 reset한다. Collect spans를 끈 대조 실행도 가능하다. 기존 카메라·편집 상태와 cache 조건을 동일하게 맞춘다.

원시 계산 결과는 `artifacts/performance`에 저장하고 Git 추적에서 제외했다. 측정용 빌드도 ignore 대상이다. 요약 결과와 한계는 문서로 남긴다.

## 해석 제한

- `elapsedMs`는 첫 이벤트부터 finish까지이며 자동화 호출 사이 대기시간도 포함한다. 앱 응답 지연으로 사용하지 않는다.
- span은 inclusive다. 카드 크기와 그 내부 치수 계산 시간을 합산하면 중복된다. Canvas 함수 시간은 React commit·브라우저 paint 시간이 아니다.
- browser 시계 정밀도 때문에 짧은 span이 0ms일 수 있다. 호출 수와 누적 시간, 터미널 반복 측정을 함께 본다.
- pointer/mouse 호환 이벤트는 각각 기록한다. 서로 합쳐 물리 입력 수라고 표현하지 않는다. rAF는 화면 표시 지연이나 GPU 시간이 아니다.
- 현재 관계 입력 준비를 별도 span으로 추출하지 않았고, React profiler·GPU trace·원격 동기화·undo·자동 A/B 분석은 아직 없다.
- 메모리 fixture는 API/DB를 사용하지 않는다. 앱 전체 저장·협업 비용을 포함하는 end-to-end 측정은 아니다. 같은 loopback origin을 사용하는 테스트 화면끼리는 앱의 패널·언어 로컬 설정이 공유될 수 있으므로 locale·패널 상태를 기록한다.

## 검증

- collector의 중첩·표본 제한·중복 종료·run 격리, fixture 유효성·재현성, 변환기의 early return/exception 보존을 테스트했다.
- 초기 `pnpm check`에서 373개 통과, DB 관련 25개 skip, 타입·포맷·일반 빌드 통과. 이후 collector off/표본 손실 개선 후 관련 테스트 5개와 측정용 타입·빌드 검증을 통과했다.
- `pnpm perf:build` 성공. 일반 dist에서 측정 화면 문자열·계측 symbol·span 이름이 없는 것을 확인했다. 빌드의 큰 청크 경고는 남아 있다.
- 브라우저에서 작은 fixture 로딩·선택·wheel 팬과 결과 JSON 출력을 확인했다. 첫 시도에서 arm이 시작되지 않는 조작은 유효 표본으로 사용하지 않았다. 최종 커밋 기준 반복 결과는 별도 기록으로 남긴다.
