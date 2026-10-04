# Native 편집 영역 스크롤 개선 계획

- 실제1280×720 브라우저에서 canvas 뒤의 구조 편집 summary가 화면 밖에 있고 main overflow:hidden으로 클릭하지 못했다. native main에 세로 스크롤을 제공하고 overview/detail grid가 축소되어 높이0이 되지 않도록 한다.
- canvas pan과 내부 표 이동을 보존하고 구조/도메인/clipboard form, 상단 제목·공유 메뉴에 실제 접근 가능한지 브라우저로 검증한다. 기존 v1 editor CSS와 독립 적용한다.
