# 시각 디자인 최종 메뉴 정리 및 QA

- 날짜: 2026-10-12. 브랜치: codex/apple-ui-review.
- [전체 계획](../planning/2026-10-12-UI-VisualDesignImplementationPlan.md)
- [시각 체계·캔버스 적용](2026-10-12-UI-VisualDesignImplementation.md): 4564c98.
- [모션·재입력 보완](2026-10-12-UI-PanelMotionImplementation.md): 65b8e39.

## 마지막 세부 수정

- 실제 타입 메뉴가 입력창보다 좁고 화면 위쪽까지 길게 펼쳐지는 것을 확인해 SearchType 팝오버에 전용 클래스와 maxHeight=360을 적용했다.
- 입력의 trigger-width를 사용하고 최소 폭·뷰포트 한계·내부 스크롤을 정리했다. 실제 측정은 입력과 같은 272px 폭, 360px 높이, 내용 2176px이며 overflow:auto다.
- 일반 Select의 기존 maxHeight=256은 유지했다.
- 메뉴 진입/종료 이동 방향은 top/bottom placement의 --ui-overlay-y를 따른다.
- 워크스페이스 메뉴는 공통 ui-popover와 다른 전용 구조이므로 workspace-popover에 표면·경계·그림자·모션을 적용했다. 내부 workspace-menu에 중복 프레임을 만들지 않는다.
- 워크스페이스 메뉴 실제 측정: 흰색 배경, 반경 9px, 약247px 높이. 기존 워크스페이스 목록·관리·초대·생성 항목이 유지됐다.

## 실제 화면 대응 확인

| 영역 | 반영 및 확인 |
| --- | --- |
| 헤더/도구 | 문서명/메타데이터/저장 상태를 분리하고 생성과 보기·내보내기를 정렬. 전용 워크스페이스 버튼 포함 그라데이션 없음 |
| 탐색 | 기존 도메인·테이블·컬럼·관계·검색·필터 유지, 밝은 표면과 작은 목록 행·선택 표현 |
| 속성/필드 | 기존 편집 폼 유지, 섹션 테두리·패딩·입력·disabled·focus·오류 표현 정리. 빈 설정 host 공간 제거 |
| 캔버스 | 기본 헤더 중립색, 제목20px/본문14px/line22px. 실제 행 높이31px와 공유 geometry 계산31px 일치 |
| 색상/출력 | 사용자 지정 색상 보존 및 전경 대비 선택. PNG 글자·팔레트·헤더·행·footer를 화면과 동기화 |
| 우클릭 | 컬럼의 속성·PK·삭제·추가·연결, 테이블의 오려두기·복사·핀·삭제 항목 유지. 컬럼 메뉴 흰색/13px/224px 폭/140ms 진입 및 화면 내부 배치 확인 |
| 타입 메뉴 | 입력 폭과 정렬, 최대360px·내부 스크롤, 키보드 열기/닫기 확인 |
| 갤러리 | 실제 ProjectGallery에서 여백·카드·미리보기 높이·보조 텍스트·검색·메뉴 표현 확인 |
| 모션 | 메뉴/팝오버의 짧은 방향성 전환, 드래그 좌표 전환 없음, 알림 닫기50ms 후 재열기 성공, reduced-motion 훅 회귀 및 CSS 분기 |

## 검증 결과

- 전체 pnpm check: 235개 파일/2,866개 테스트 통과, 26개 파일/499개 테스트 건너뜀. 타입 검사와 전체 빌드 성공.
- 마지막 워크스페이스 CSS 세부 조정 후 pnpm format:check 및 웹 프로덕션 빌드를 추가 실행해 통과했다.
- 실제 length=-1 입력에서 원문 초안 보존 오류를 확인했다. 최종 오류 색상 rgb(156,55,55), 배경 rgb(255,245,244), 경계 rgb(238,212,210). 80으로 복원 후 role=alert 0개 확인.
- 실제 Notifications의 열기→닫기→50ms 뒤 재열기 결과가 열림이고 data-closing=false인 것을 확인했다.
- 헤더·툴바의 gradient 배경 버튼 0개 확인.
- 일부 자동화 클릭은 iframe hit-test 문제로 키보드 동작을 사용했다. 제품의 텍스트 입력 중 기본 컨텍스트 행동은 변경하지 않았다. 빈 캔버스 메뉴의 모든 배치 조합을 실측했다고 주장하지 않는다.

## 화면 기록

- 실제 편집기: `C:\Users\TY\.codex\visualizations\2026\10\10\01a12667-c321-7f80-be51-c759af309fa6\ezerd-visual-implementation.png`
- 컬럼 우클릭: `C:\Users\TY\.codex\visualizations\2026\10\10\01a12667-c321-7f80-be51-c759af309fa6\ezerd-context-menu-implementation.png`
- 타입 팝오버: `C:\Users\TY\.codex\visualizations\2026\10\10\01a12667-c321-7f80-be51-c759af309fa6\ezerd-type-menu-implementation.png`

이 화면은 실제 제품 컴포넌트에 검증용 데이터를 공급한 결과다. 실제 프로젝트/DB를 수정하지 않았고, 쓰기 API는 검증 화면에서 차단했다. 서버 DB 통합 테스트와 OS 모션 설정 직접 변경은 수행하지 않았다. Vite 번들 크기 경고는 남아 있다. 원본 main 작업 디렉터리는 변경하지 않았으며 merge/push하지 않았다.
