# Native 상호작용 테스트 어댑터

2026-10-05. performance/interactions.html에 실제 Native scene/직접 편집/관계선 폼/PNG를 연결한 메모리 전용 어댑터를 추가했다. 운영 API/DB 호출 없이 승인/실패/version 변경/편집 권한/de모 undo-redo를 시험한다. actor/project는90000000으로 시작하는 고정 테스트 identity이며 로컬 초안만 보존한다. 일반 앱 빌드에는 포함하지 않는다.

비교 빌드에만 editable-presentation variant를 추가했다. Native userId 없이 편집 트리거 버튼의 DOM만 표시하므로 편집 저장은 하지 않는다. 정상 Native props는 그대로이고 비교 plugin이 해당 onEdit 표현만 교체한다. 필수 marker가 없으면 빌드를 실패시킨다. 편집 가능 카드의 표시 비용과 실제 공유/개인 저장 비용을 혼동하지 않는다. 제품 전용 PR에는 도구 파일을 포함하지 않는다.
