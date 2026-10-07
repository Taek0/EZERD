# 카드 타입 검색 및 마우스 선택 수정 계획

- 지정 Chrome QA 탭에서 최신 HMR/새로고침 이후 검색어 var의 첫 글자 누락과 VARCHAR 마우스 선택 실패를 재현한다.
- SearchType 및 NativeCanvasInlineCell의 포커스·controlled query·포인터 이벤트 순서를 조사한다. 필요할 때만 UntitledPopover/SelectItem을 분석하고 변경 필요성을 먼저 보고한다.
- 수정 범위는 SearchType.tsx/test 및 NativeCanvasInlineCell.tsx/test, 본 계획·결과 문서로 제한한다.
- 회귀테스트와 실제 Chrome에서 연속 var 입력, 마우스 옵션 선택, 새로고침 후 타입 보존을 검증한다.
- Git add/commit은 실행하지 않으며 오너가 커밋한다.
- 오너 추가 허용: NativeERDCanvas/NativeCanvasScene의 최소 portal guard 및 캔버스 pointer 테스트 fixture·회귀. 실제 재현 결과 NativeERDCanvas guard만으로 해결되므로 NativeCanvasScene은 수정하지 않는다.
- 추가 QA: 소속 도메인 QA Domain Saved Final 저장·reload, 고급 편집기 항목/식 선택 계층 표시를 확인한다.
- 마지막 범위 허용에 따라 native-editor-form.tsx와 native-editor-format.tsx의 누락 번역을 각 한 항목만 추가한다. 기능 코드는 변경하지 않는다.
