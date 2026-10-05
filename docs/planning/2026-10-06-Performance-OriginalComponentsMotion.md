# 원본 편집기 컴포넌트·모션 동등성 복원 계획

2026-10-06. 사용자가 첨부한 두 화면과 기존 Canvas 구현을 기준으로 이전의 부분적 UI 재구성을 교정한다. 원본 컴포넌트/스타일/애니메이션을 우선 재사용하며 성능을 위해 효과를 임의 제거하지 않는다.

| 영역 | 기준 구현 | 반영 방향 |
| --- | --- | --- |
| 속성/목록2탭·VIEW/DOMAIN·선택배지 | Canvas inspector-topbar, TabButton, inspector.css | Native Inspector가 같은 구조와 컴포넌트를 사용 |
| 기본정보·컬럼·키·관계·생성행 | PanelSection/PanelList/PanelRow/PanelListDetail | Native 검증 폼을 원본 패널 컴포넌트 안에 연결 |
| 접힘·전개·선택 상세 | AnimatedDetails 및 PanelListDetail WAAPI180ms | 실제 open/close 모션과 reduced-motion 보존 |
| 드롭다운·체크박스·팝오버 | 공통 Select/Checkbox, DialogTrigger/UntitledPopover | raw select/details 대신 원본 control 사용 |
| 패널 펼침/접힘·도메인 진입 | workspace grid220ms, opacity180ms, domain-enter240ms | 상태를 unmount하지 않고 모션 후 숨김, resize 중 transition 중지 |
| 핀·댓글·작성기·크기 조절 | CommentPins/CommentsPanel/PinPanelResizer | 공통 layout 타입으로 좁혀 Native에도 직접 연결 |
| 프로젝트 이력 도구 | Native history의 검증된 API/queue | 기존 상단 icon UI에 실제 undo/redo(보상 이력의 역연산) 연결 |
| 컬럼 순서 grip | PanelRow drag UI | Native table 범위 순서 변경 명령을 검증해 연결 |

Native 문서를 v1로 변환하지 않는다. 저장·권한·version/ACK/초안 guard를 유지한다. preview에는 원본 shell을 포함한 명시적인 테스트 데이터를 사용하며 실제 사용자 프로젝트나 댓글에는 쓰지 않는다. 기능 동작, 전환 중/후 screenshot, computed animation 및 reduced-motion, 동일 pan fixture를 검증한다. 모션 없는 정지 스크린샷만으로 동등하다고 판단하지 않는다. 제품 변경을 작은 단위로 커밋하고 기존 제품 PR을 갱신한다.
