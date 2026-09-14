# Untitled UI 화면 연결 및 기존 스타일 정리

작성일: 2026-09-14

계획: docs/planning/2026-09-14-UntitledUI-Rebuild.md

## 수행 내용

- Canvas 도메인 관계와 TableEditor 컬럼·타입·키·FK 대응의 Select 이벤트를 실제 선택값을 받는 onValueChange로 전환했다. 각 선택 트리거에 한국어 접근성 이름을 명시했다.
- 사용자 이름 버튼을 공통 Dropdown의 트리거로 연결하고 이름 변경을 메뉴 항목으로 제공했다. 메뉴 선택 후 기존 이름 변경 폼을 연다.
- 전역 네이티브 버튼·입력창·선택박스의 배경, 테두리, 그림자, 포커스와 전환 규칙을 제거해 공통 컴포넌트 스타일이 적용되도록 했다.
- 갤러리 검색·프로젝트 생성 입력 너비, 테이블 컬럼 추가 폼과 도구 영역의 배치를 새 입력 그룹·선택 루트에 맞췄다. 체크박스의 숨겨진 네이티브 입력에 남던 화면별 크기 지정을 제거했다.
- 인라인 컬럼 편집과 색상 입력 등 화면의 특수 용도 크기는 유지했다.

## 검증 및 통합 상태

- 모든 Select 소비부에서 기존 네이티브 onChange와 event.target.value 의존이 제거됐으며 명시적 aria-label을 확인했다.
- 변경 파일 diff와 기존 primary/danger 버튼의 variant 명시를 확인했다.
- 공통 컨트롤 구현과 결합한 타입 검사 및 브라우저 회귀 결과는 통합 검증 기록에 별도로 남긴다.
- 기존 문서 이동 및 다른 작업의 변경은 이 단위에 포함하지 않는다. 커밋은 통합 작업 담당자가 조정한다.

## 실제 화면 시각 검증 및 최종 보정

- 실제 App/Canvas/TableEditor 화면에 API 응답만 격리한 주문·고객 테이블 데이터를 넣어 데스크톱 1440×1000 및 모바일 390×844에서 확인했다. 전체 저장 회귀는 별도 검증 담당자가 수행한다.
- 원본 버튼의 span[data-text] 도입으로 프로젝트 제목·화살표가 잘못 꾸며지던 선택자를 수정했고, 사용자 버튼·패널 행·알림 항목의 내부 배치를 연결했다.
- 실제 긴 타입 Select 팝오버가 React Aria 인라인 max-height 때문에 818px로 표시되는 문제를 발견했다. 원본의 256px 제한을 !important로 우선 적용한 뒤 실제 높이 256px, 불투명도 1을 확인했다.
- 원본 버튼 그림자의 RGB 값을 검정으로 맞추고 체크박스 배경·링과 체크 표시의 100ms 전환을 적용했다. 모션 감소 환경은 전환을 제거한다.
- 입력 그룹 높이 40px, Select 트리거 높이 40px, 체크박스 16×16px를 확인했다. 입력 그룹의 흰색 배경과 #d5d7da 링 및 작은 그림자를 확인했다.
- 갤러리와 편집기의 모바일 body.scrollWidth가 viewport와 동일한 390px였으며 페이지 오류는 0건이었다. 열고 닫는 애니메이션 완료를 기다린 후 캡처했다.
- 결과 이미지: .cache/verification/untitled-gallery-desktop.png, untitled-gallery-mobile.png, untitled-profile-menu.png, untitled-controls-desktop.png, untitled-controls-mobile.png. 실행용 격리 검증 코드는 .cache/untitled-integration-visual.mjs에 있다.
- Browser 플러그인과 이미지 뷰어는 Windows sandbox helper 초기화 오류가 있어, 기존 설치된 Playwright로 캡처하고 생성된 이미지 바이트로 실제 화면을 확인했다.
- 최종 검토에서 로고의 기존 `.brand span`이 새 버튼 래퍼까지 파랗게 만드는 회귀를 수정했다. 점을 담은 내부 span만 파란색으로 한정하고 브랜드 글자는 기존 ink 색상으로 지정했다. 갤러리와 편집기 모두 글자 rgb(32, 35, 39), 점 rgb(48, 91, 231)을 확인하고 스크린샷을 갱신했다.
- 도구 모음 및 패널의 실제 동작 버튼에 남은 box-shadow:none 네 곳을 제거해 원본의 테두리 링을 복원했다. 실제 ＋ 테이블 버튼에서 #d5d7da 1px inset 링과 원본 입체 그림자를 확인했다. 크기와 브랜드·탭·패널 행 등 의도된 전용 스타일은 유지했다. 스크린샷 갱신 후 페이지 오류 0건 및 모바일 390px 너비를 재확인했다.
