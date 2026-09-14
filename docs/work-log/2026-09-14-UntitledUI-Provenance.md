# Untitled UI 원본 및 적용 범위 검증

작성일: 2026-09-14

공개 MIT 저장소의 고정 커밋 c981a73bcd6b6c68d2a54070f20f020191212828에서 17개 원본 파일을 다시 확보하고 URL·SHA-256을 공통 UI 폴더 UPSTREAM.json에 기록했다. 기존 배포 라이선스 전문을 유지한다.

실제 실행 모듈 untitled.tsx, untitled.css를 index.tsx/ui.css가 가져오는 것을 확인했다. Button/InputBase/TextAreaBase/CheckboxBase/Select/Popover/SelectItem/MenuItem/Tooltip 원본 구조·상태 스타일을 로컬 수정본에 옮겼으며, 원본 전체 패키지를 그대로 설치한 것으로 표현하지 않는다.

NOTICE.md에 원본→실행 모듈 대응, 파란색·한국어 폰트·기존 폼 API·모달 포털 등 수정 범위, 원본 그대로 사용하지 않은 별도 구성 요소를 기록했다.
