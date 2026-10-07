# 실제 Chrome hover 재현 및 복제 환경

- Chrome 확장 재설치 후 localhost:3001의 klassboard-backend 사용자 탭을 claim해 실제 DOM과 전체 캡처를 읽었다. 새로고침/문서 저장 없이 손 도구만 선택했다.
- 사용자에게 buttons=0 커서 이동으로 재현을 요청했고 재현 직후 비교했다. camera는 translate(643.652px,177.116px) scale(0.1), viewport는 양쪽 모두 2560×1249/DPR1이며 scrollLeft/Top=0이었다.
- 50개 카드의 objectId/style/rect/row count 배열, 관계선 SVG path 118개, panel rect/style/opacity, surface rect가 JSON 비교에서 모두 동일했다. 실제 Chrome 전체 캡처에는 가로 띠 손상이 보였다. 이전 IAB clip 오류와 구분되는 새로운 관측이다. JS error log는 비어 있었다.
- MCP의 list_projects/get_project_document_state 읽기만 사용해 동일 프로젝트의 version214/sequence222 스냅샷을 확보했다. 원본 쓰기는 하지 않았다. raw는 Git 제외 artifacts/performance/2026-10-07-actual-chrome/snapshot.json에 보관하며 기본 앱 bundle/public 자산에 넣지 않는다.
- actualFixturePlugin은 환경변수로 opt-in할 때만 localhost 진단 GET 경로를 제공한다. 복제 fixture는 기존 API 쓰기 차단을 유지한다. 진단 탭은 /performance/panels.html?actual=1이다.
- Chrome 내부 chrome://gpu 조회는 브라우저 URL 보안 정책으로 차단됐다. 다른 경로로 우회하지 않았다. 이후 복제 탭 조작 중 도구 시간 초과/Debugger unattached로 제어 연결이 끊겼다.
- 사용자 수동 비교: 실제 문서 복제에서 content-visibility를 visible로 강제해도 발생. 새로고침 후 Disable world promotion만 체크하면 10% 손 도구 hover에서 발생하지 않는다고 확인했다. 이는 world will-change:transform 경로와 연관된 증거이며 Chromium 내부나 GPU 드라이버 원인까지 확정하지 않는다.

[계획](../planning/2026-10-07-Performance-ChromeHoverAudit.md)
