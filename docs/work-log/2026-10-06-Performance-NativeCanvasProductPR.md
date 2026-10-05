# Native 캔버스 제품 반영 검증 결과

2026-10-06. [계획](../planning/2026-10-06-Performance-NativeCanvasProductPR.md)에 따라 origin/main 8390e9e에서 제품 코드·회귀만 선별했다.

## 반영 내용

- 기본 문서/장면 계산 재사용, draft가 없는 이중 계산 제거, camera와 scene/보조 패널 렌더 경계 분리.
- 색상 헤더·도메인/스키마 배지·PK/FK 강조·컬럼 제목·관계선 endpoint/label 표현 복원.
- 이름/설명 직접 편집, 타입/NULL의 기존 NativeFormatEditor 연결. 보존되는 입력·명시 저장·권한/버전 검사와 복구 routing.
- 관계선 선택/hover/키보드, 연결점·구간 drag 및 자동 경로 복원. shared/personal 저장과 private version/expected guard 유지.
- PNG의 헤더·열·키 강조·카디널리티·label 표현 일치. XML escaping, clip, 픽셀 한도 및 저장본/문맥 guard 유지.
- 성공한 편집창만 닫고 실패 초안은 유지하며, 편집창 스크롤을 camera wheel과 분리. 순수 command helper/공통 canvas form을 분리했다.

## 독립 검증

새 checkout에서 frozen-lockfile 설치 후 공개 .env.example만 setup했다. lockfile 변경 없이 pnpm check 통과: 포맷·전체 타입·서버/웹 build, 200파일2578테스트 PASS, 26파일497조건부 SKIP. 예시 .env, dependency/build 결과는 Git 제외 상태다. Vite의 기존500kB초과 번들 경고는 남아 있다.

제품 경로가 검증한 lab과 byte diff 없이 일치함을 확인했다. performance 디렉터리·측정 plugin·raw·테스트 어댑터·lab Git 기록은 이 PR에 포함하지 않는다. 문서2개 외 제품 변경은 apps/web/src/features/projects에 한정한다.

## 성능 근거

별도 lab의 clean 67d85a8에서 50/100테이블×10컬럼을 측정했다. 1440×900/DPR1, surface1440×520, 준비1+본측정3회,120회paced wheel. Native 조회/편집 버튼 표시 두 조건 모두 React 중앙값약0.4ms와 frame p95약10.1ms. 같은 빌드의 simple-cards도 p95약10.1ms였다. 카드/관계선/타입표시 재계산0회 유지. 보조 UI 분리 전50테이블 p95약20ms,100테이블40~50ms였다. 100테이블 조회 본측정360frame 중25ms초과1개도 기록했다.

이는 synthetic 입력+production profiling 빌드이며 일반 production FPS/실제 저장·협업 비용을 보증하지 않는다. 편집 버튼 표시는 저장 없는 DOM 비용 probe다. 300개 이상 문서나 다른 기기까지 일반화하지 않는다.

## 브라우저 확인과 한계

메모리 어댑터에서 실제 컴포넌트의 이름/NULL/bigint 변경, 실패 입력 보존, viewer 차단, version 재검토, 경로 drag/키보드/자동 복원,1.1275배 확대 drag, 편집창 scroll과 camera 불변을 확인했다. PNG 파일6496×1910/400221bytes를 실제 내려받고 이미지 내용을 확인했다. 메모리 undo/redo와 ACK 시뮬레이션은 실제 HTTP/DB/NativeHistory browser E2E로 계산하지 않는다. 기존 서버 저장·복구 회귀는 전체 테스트로 검증했지만497개조건부 DB 검사는 별도 환경에서 실행해야 한다.

최종 변경은 draft PR로 제출하며 main merge, 운영 DB 변경, 배포는 하지 않는다.
