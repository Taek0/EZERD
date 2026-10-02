# Native 편집 영역 스크롤 결과

- [계획](../planning/2026-10-02-Database-NativeEditorScroll.md). native main의 selector를 v1 editor보다 구체적으로 지정하여 overflow:auto를 제공하고, 구조/표 grid를 최소420px로 보존했다. 다른 편집기에는 적용하지 않는다.
- 실제1280×720에서 새 native 생성→구조 편집 열기→논리 이름 입력→저장/ACK 후 입력 초기화를 확인했다. 변경 이전의 화면 밖 summary 클릭 실패를 재현했다. 최종 빌드의 main computed overflow:auto, clientHeight668/scrollHeight1401과 summary 접근을 확인했다. 좁은 native 화면 QA는 전체 BrowserPathQA 후속이다.
- web build 한 번 통과 후 마지막 selector는 vite 실제 bundle로 검증했다. 병렬 고급 UI 파일 작성 도중 typecheck 오류는 해당 단위에서 해결하며 이 CSS 변경을 전체 check 성공으로 계산하지 않는다.
