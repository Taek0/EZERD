# 고스트 드래그·Worker 드롭 통합 결과

[계획](../planning/2026-10-27-Canvas-GhostDragImplementationPlan.md)에 따라 performance-lab에 제품 기능을 연결했다. 테이블 카드 포인터 이동 중 원본 카드/관계선과 문서는 유지하고, 단순 고스트만 RAF transform으로 이동한다. release의 최종 좌표로 Worker가 일반 경로를 계산하며 완료까지 고스트를 유지한다. 고비용 관계선 자동 정리는 호출하지 않는다.

## 적용과 안전 경계

- 공유 bounds/관계 인덱스 DTO를 Worker에 전달하고 geometry 결과를 정확한 입력 키의 최신 1건 캐시에 보관한다. 동일한 최종 배치를 React가 반영할 때 메인 스레드의 재라우팅을 생략한다.
- 최종 nodesJSON/commands를 기존 초안/저장 경로에 전달하여 오래된 drawn.nodes를 저장하지 않는다. 로컬 배치 반영 후 고스트를 제거하며 서버 ACK는 기다리지 않는다.
- 선택 그룹 상대 위치·줌·잡은 위치·100개 저장 한도·한 번의 저장 작업을 유지한다. 키보드 이동, 리사이즈, 도메인 배치는 기존 방식이다.
- Escape, drag 중 capture 취소/창 blur, 사용자/프로젝트/뷰/문서/버전/권한/카메라/저장 준비 상태 변경과 unmount를 처리한다. Worker timeout/오류/비정상·늦은 응답은 저장하지 않는다. release 이후 의도적 capture 해제는 계산을 취소하지 않는다.
- 제목은 기존 카드 팔레트를 사용하고 고스트는 viewport에서 clip한다. world 강제 GPU 승격은 추가하지 않았다.

## 정량 및 회귀 검증

[순수 장면/Worker 결과](2026-10-27-Canvas-GhostSceneWorkerResult.md)에서 저장 43테이블 및 version407 134테이블의 원본/단일/5개 이동 장면이 기존 결과와 정확히 같았다. 같은 geometry로 layout ID만 바뀐 경우 캐시 참조 재사용도 확인했다. DTO JSON은 각각23,851/59,455bytes다.

version407의 단일/5개 이동을 준비1회 후 5회 측정한 중앙값이다. 실제 Worker IPC·기동 및 React render/paint 시간은 제외한다.

| 단계 | 단일 | 5개 그룹 |
| --- | ---: | ---: |
| 메인 입력 준비 | 0.55ms | 0.54ms |
| 별도 경로 계산 wall(Worker가 수행하는 계산) | 176.12ms | 477.35ms |
| 메인 조립·캐시 설치 | 0.81ms | 1.12ms |
| 최종 cache-hit 장면 | 1.35ms | 1.83ms |
| 메인 세 단계 합계 중앙값 | 2.92ms | 3.31ms |

실 React/jsdom에서 이동 중 Worker/초안/저장 없음, 최종 release·단일 저장, Worker 이후 메인 relationGeometry 호출 없음, ACK 대기와 프리뷰 분리, 생성 참조·그룹·취소·카메라/버전/blur 및 stale RAF를 검증했다. 최종 ghost+lifecycle 집중23테스트 통과. 일반 팬의 프레임당1commit 회귀도 유지한다.

## 실제 브라우저 확인

격리된 127.0.0.1:4184 합성10테이블 페이지에서 실제 Worker를 실행했다. API는 차단하고 저장은 메모리에서만 처리한다. 결과 전달만1초 지연시켜 대기 상태를 관찰했다.

- drop 뒤 ghost=true, saveCount=0, 원본 t0=(0,0)를 확인했다.
- Worker 완료 뒤 ghost=false, t0=(80,80), saveCount=1, pending ACK=1을 확인했다. 수동 ACK 뒤 pending=0이며 저장 횟수는1이다.
- 계산 중 문서 변경 및 Escape는 ghost를 제거하고 saveCount=0/원본 위치를 유지했다. 늦은 결과도 저장하지 않았다.
- 10% 배율에서20px 이동은200 world-unit 위치로 반영됐다. 브라우저 error 로그는0이었다.
- 최종 빌드에서 카드 header 팔레트와 대기 표시를 재확인하고 화면(성능 워크트리의 Git 제외 경로: artifacts/performance/2026-10-27-ghost-implementation/ghost-worker-waiting.jpg)을 보존했다. 내장 Chromium의 합성 fixture 검증이며 대형 실문서 Chrome FPS/전체 GPU 회귀 측정은 아니다. 임시 탭과 서버는 종료했다.

## 전체 검사와 한계

- pnpm format 및 최종 pnpm check 통과: 292개 파일,3,241개 테스트 통과 / 환경 조건부500개 건너뜀. 전체 타입·서버/웹 제품 빌드 및 perf:build 성공.
- 첫 통합 검사에서 고스트가 없는 팬에도 상태 초기화가 추가 commit을 만들던 회귀를 수정했다. 후속 기존 font-cache 5초 timeout은 제한/skip 변경 없이 재실행으로 통과했고, 최종 blur 보완 후 전체 검사도 통과했다.
- 장면 함수 추출로 lab 계측 target이 이동한 부분을 갱신했다. 기존 큰 main chunk 경고는 남아 있다. 구성용 더미 DATABASE_URL을 사용했고 실제 DB 동시성 검사는 활성화하지 않았다.
- 실제 reader-generated ACK가 노드 순서나 fallback 위치를 변경하면 geometry 자체가 달라져 캐시는 안전하게 무효화되고 기존 동기 재계산이 발생할 수 있다. 정확히 같은 geometry의 ACK와 구분한다. 일반 원격 갱신 전체를 Worker로 전환한 변경은 아니다.
- 제품 커밋0345090, blur 보완d28857b. lab fixture/계측 보정은7083867로 분리했다. 상세 기록: [UI](2026-10-27-Canvas-GhostDragUIResult.md), [Worker](2026-10-27-Canvas-GhostSceneWorkerResult.md), [fixture](https://github.com/Taek0/EZERD/blob/6bd481f/docs/work-log/2026-10-27-Canvas-GhostBrowserFixture.md).

원본 프로젝트·main checkout·기존 실행 서버·원격 브랜치는 변경하지 않았다. 실제 서버 배포/재시작이나 push/PR은 수행하지 않았다. 원시 결과와 전체 검사·빌드 로그는 artifacts/performance/2026-10-27-ghost-implementation 및 2026-10-27-ghost-drag에 Git 제외 상태로 보존했다.
