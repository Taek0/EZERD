# 캔버스 반복 작업 축소 통합 결과

[계획](../planning/2026-10-22-Canvas-InteractivePerformancePlan.md)의 1~4번을 performance-lab에서 구현·검증했다. 일반 관계 경로의 부분 갱신과 화면 밖 카드 가상화는 적용하지 않았다.

## 확인한 작업 감소

| 항목 | 검증 결과 |
| --- | --- |
| 팬 | 실제 React Profiler와 제어 RAF에서 100개 독립 pointermove는 프레임 전 commit 0회, 프레임 후 1회. 최종 release 좌표는 추가 1회 commit으로 반영 |
| 관계 hover | 5회 진입/이탈 및 focus/blur에서 하이라이트는 갱신되고 SVG/tooltip 추가 계산은 0회. 같은 컬럼을 참조하는 100개 관계의 이름 읽기는 1회 |
| 인라인 셀 | 편집 가능한 셀 렌더의 테이블·컬럼 조회를 각각 3회에서 1회로 축소. 저장 시 최신 원본 재조회는 유지 |
| 탐색/속성 패널 | 같은 문서에서 무관한 렌더·검색 변경은 outline/속성 행 최초 계산 1회를 재사용. 모드·문서·키·검색·번역 라벨 변경은 해당 결과 갱신 |

캔버스가 선택 때마다 새 visibleObjectIds 배열을 전달하던 부분도 scene.nodes 기반 memo로 바꿨다. 실제 DOM에서 선택 a→b의 selectedObjectId는 갱신되면서 배열 참조가 유지됨을 검사했다. producer와 consumer를 함께 검증하여 패널 memo가 실제 전달 흐름에서도 유효하도록 했다.

## 안전성 및 검증

- 팬 마지막 위치·cancel/lost capture·새 제스처·휠·pending 팬 뒤 줌 앵커·scope 변경·StrictMode/unmount를 검사했다. layer promotion, 관성, spring 및 스타일 변경은 추가하지 않았다.
- 인라인 초안·IME·자동 저장·복구·고급 편집·최신 권한/저장 기준을 기존 회귀 검사로 유지했다. 관계선 선택·tooltip·접근성 및 언어 변경도 검사했다.
- 6.1 Sol의 읽기 전용 독립 리뷰에서 구체적인 정확성 문제는 발견하지 못했다. 리뷰와 검증은 실제 브라우저 FPS 측정과 구분한다.
- pnpm format 및 pnpm check 통과: 284개 파일, 3,144개 테스트 통과 / 환경 조건부 500개 건너뜀. 포맷·전체 타입·서버/웹 빌드 성공. 병렬 작업 중 발견한 타입 오류는 최종 검증 전에 해결했다.
- 구성 검사용 더미 로컬 DATABASE_URL을 사용했다. 실제 DB 동시성 검사는 활성화하지 않았다. 기존 큰 main chunk 경고는 남아 있다.
- raw 로그: artifacts/performance/2026-10-22-interactive/format.log, check.log (Git 제외).

## 기록과 반영

- [팬](2026-10-22-Canvas-PanFrameResult.md): d431b64
- [관계 hover](2026-10-22-Canvas-RelationHoverResult.md): 8f06df9
- [인라인 셀](2026-10-22-Canvas-InlineLookupResult.md): 034eaa7
- [패널 파생 데이터](2026-10-22-Canvas-PanelDerivedResult.md): 50986c6

검증 수치는 jsdom의 실제 React 실행과 순수 helper 작업 횟수이며, 사용자의 Chrome에서 FPS 또는 입력 지연 개선율을 측정한 결과는 아니다. 원본 문서·main checkout·실행 서버·원격 브랜치는 변경하지 않았다. 최종 브라우저 체감 확인은 별도 후속 검증이다.
