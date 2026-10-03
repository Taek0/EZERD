# Native 키 후보 readiness UI 수정 결과

- [계획](../planning/2026-10-03-Database-NativeKeyReadinessUI.md). 공통 keyEligibility에 실제 PRIMARY/UNIQUE와 SQLite STRICT를 전달했다. 사용 가능한 후보에는 key.not-ready를 붙이지 않는다. 특정 UNIQUE의 허용 여부를 PRIMARY 판정으로 덮어쓰지 않는다.
- 세 DB의 ready builtin·MySQL virtual-generated UNIQUE와 금지 PRIMARY·SQLite STRICT 미지원 타입 및 현재 원문 보존을 검사했다. 기존 default/key UI 포함45개 통과와 웹 typecheck 통과.
- 실제 MySQL 브라우저에서 UNSIGNED INT·기본값7을 저장하고 PK 후보 선택·저장 경로를 확인했다. 이전 bundle의 오류 코드 표시는 새 production build 후 최종 QA에서 재확인한다. 원본/서버 권한/gates는 이 단위에서 바꾸지 않았다.
