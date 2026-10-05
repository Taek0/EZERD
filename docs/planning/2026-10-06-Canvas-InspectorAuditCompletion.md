# 인스펙터 감사 후속 복원 계획

- 기준: [전체 복원 계획](2026-10-06-Canvas-CompleteParityRestoration.md), [항목별 감사](../work-log/2026-10-06-Canvas-ParityAudit.md), 첫 인스펙터 커밋 6453eda.
- E07, V03/V04, R01/R03/R04/R05/R06, N04/N05/N06/N07/N08, S01/S02/S03/S04/S10의 실제 source/call-site를 원본과 대조한다. 첫 단위에서 이미 구현한 동작은 중복 구현하지 않고 실제 호출·검증을 보강한다.
- Native 관계 의미·끝점·매핑 편집은 기존 constraint 초안/ACK 경로를 유지한다. 계약에서 허용되지 않는 물리 FK 제거·테이블 변경은 부모의 Native 계약/서버 확장과 연결하며 v1 투영을 하지 않는다.
- 실제 캔버스 scope, requestedView, selectionHost, toolbarHost/pathHost를 NativeProjectView에서 준비한다. NativeERDCanvas 및 인라인 담당 파일은 수정하지 않는다.
- 원본 bounds/resize helper와 측정 기반 stacking, 개인 preference, ENUM modal, 선택 관계/연결 목록, Native 상태·권한 notice를 복원한다.
- focused web typecheck/관련 tests/변경 파일 Prettier만 실행한다. 사용자 결정에 따라 브라우저·전체 check는 제외한다. 결과·남은 정확한 API/ID를 work-log에 기록하고 독립 커밋한다.
