# 자동 저장 실제 5브라우저 검증

작성일: 2026-09-15
상태: 통과

## 검증 환경

- 현재 소스 기준 커밋: `7de03b2`
- API: `http://127.0.0.1:3001`, 최종 실행 PID 28120
- Vite: `http://127.0.0.1:5174`, 최종 listener PID 34524
- 브라우저: Playwright 1.57.0의 headless Chrome, 서로 다른 browser context 5개
- 저장·전파 경로: 실제 PostgreSQL, HTTP 작업 API, Vite WebSocket 프록시, 브라우저 IndexedDB
- 실행 전 API와 Vite의 `/api/health/ready`가 모두 HTTP 200임을 확인했다.

## 실행 명령

전용 API와 Vite가 종료된 뒤 아래 명령에 해당하는 숨김 프로세스로 다시 시작했다. 기존 공유 Vite 5173은 변경하지 않았다.

```powershell
node apps/server/dist/main.js
pnpm --filter @ezerd/web exec vite --host 127.0.0.1 --port 5174 --strictPort
```

브라우저 인수 검증은 아래 환경과 명령으로 실행했다.

```powershell
$env:EZERD_PLAYWRIGHT_MODULE='file:///C:/Users/nty43/AppData/Local/OpenAI/Codex/runtimes/cua_node/a708e72b10c27b59/bin/node_modules/playwright/index.mjs'
$env:EZERD_WEB_URL='http://127.0.0.1:5174'
$env:EZERD_API_URL='http://127.0.0.1:3001'
$env:EZERD_VERBOSE_FAILURE='0'
node scripts/browser-autosync-smoke.mjs
```

최종 출력:

```text
PASS: five-browser autosync acceptance {"initialFiveWayMs":52,"distinctClientIds":5,"websocketSubscribedContexts":5,"websocketOperationContexts":5,"fixtureArrangementRequests":1,"imeDebounceRequests":1,"dragRequests":1,"lastEventCatchupMs":1739,"lastEventCatchupRequests":1,"offlineReplayAckMs":840,"undoAcceptedOperations":1,"redoAcceptedOperations":1}
```

## 통과한 계약

- 독립 사용자·세션을 가진 컨텍스트 5개의 localStorage clientId가 모두 존재하고 서로 달랐다. 각 컨텍스트가 자기 clientId로 subscribe를 전송하고 subscribed와 operation 프레임을 각각 한 번 이상 수신했으며 초기 변경을 52ms에 수렴했다. 목표 1초 이내다.
- 한글 IME 조합 중 작업 요청은 없었고 조합 종료 뒤 작업 요청은 정확히 1회였다.
- 카드의 여러 pointer move 뒤 700ms 동안 작업 요청이 0회임을 먼저 확인했고 pointerup 뒤에는 정확히 1회 발생했다. 겹친 fixture도 강제 DOM 조작 없이 일반 드래그로 배치했다.
- owner의 HTTP ACK를 지연한 동안 다른 참여자는 서버 승인 WebSocket 이벤트를 먼저 적용했다.
- 한 컨텍스트에서 다음 application operation 프레임 하나만 전달하지 않은 뒤 네트워크를 오프라인으로 전환하고 sync WebSocket을 닫았다. 재연결 전까지 이전값을 유지했으며 온라인 복귀 뒤 `events` 조회 1회로 누락 이벤트를 가져와 다섯 화면이 1,739ms에 수렴했다.
- 작업 제출과 작업 결과 조회를 의도적으로 끊은 상태에서 편집이 IndexedDB에 남았고 새로고침 뒤 낙관값이 복원됐다. 연결 회복 뒤 서버 승인, 다른 참여자 전파, IndexedDB 삭제까지 840ms였다.
- 서로 다른 속성의 동시 변경은 모두 보존됐다. 같은 속성은 owner 제출을 단일 라우트 게이트로 지연해 서버 승인 순서를 결정했으며 마지막 승인값으로 다섯 화면이 수렴했다.
- 자신의 승인 작업 undo와 redo가 각각 기존 이력에 없던 서로 다른 operation ID로 accepted 기록됐다. undo 뒤 다섯 화면이 이전값으로, redo 뒤 다섯 화면이 편집값으로 수렴했다. 다른 참여자의 같은 속성 후속 변경 뒤 stale undo는 서버에서 rejected로 기록됐고, 후속값을 덮어쓰지 않았으며 owner 화면에 원인을 표시했다.
- 개인 도메인 조합뷰를 연 동안 다른 네 참여자는 도메인 맵에 남았다. 조합뷰에서 바꾼 테이블 이름은 공유 원본과 다른 참여자에게 전파됐고, 조합뷰 카드 드래그는 위치와 서버 이력을 바꾸지 않았다.
- 삭제 이력의 복원 버튼으로 도메인을 복원했으며 내용은 유지되고 객체 ID는 새로 발급됐다.
- 브라우저 page error와 예상하지 않은 동기화 요청 실패는 없었고 모든 컨텍스트의 IndexedDB 대기열이 비었다.

## 하네스 보정과 정리

검증 계약은 약화하지 않고 실제 UI 상태를 기다리도록 하네스를 보정했다. 새로고침 뒤 프로젝트 목록 로딩과 승인 후 IndexedDB 삭제를 기다리고, 의도적으로 차단한 작업 요청만 오류 집계에서 제외했다. 같은 속성 순서 검사는 단일 라우트 핸들러가 요청 진입·해제·응답을 소유한다. 이벤트 누락 검사는 세 번째 컨텍스트에만 test WebSocket wrapper를 시작 전에 설치해 application operation 프레임 하나를 선택적으로 전달하지 않고, 이후 실제 offline/reconnect와 HTTP 누락 조회를 관찰한다. 조합뷰 테이블명은 선택된 inspector 입력으로 한정하고, 이름 변경 뒤 새 접근성 이름으로 카드를 다시 찾는다. 삭제 복원은 삭제 섹션의 실제 버튼 이름인 `새 객체로 복원`을 사용한다.

각 실행은 고유 접두사와 UUID로 사용자 5명과 프로젝트 하나를 만들었다. 성공과 실패 모두 `finally`에서 해당 프로젝트 ID와 생성한 사용자 ID 배열만 조건으로 삭제했으며 기존 데이터와 DB 전체는 삭제하지 않았다.

## 남은 한계

측정값은 로컬 한 대에서 수행한 headless Chrome 단일 최종 실행 결과다. 네트워크 지연이나 여러 장치·브라우저 엔진의 차이는 포함하지 않는다. Playwright는 워크스페이스 의존성이 아니어서 이 머신의 Codex 번들 모듈 경로를 명시했다.
