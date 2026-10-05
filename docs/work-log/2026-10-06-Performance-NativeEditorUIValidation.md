# Native 원래 UI 이식 최종 검증

2026-10-06. [UI 계획](../planning/2026-10-06-Performance-NativeEditorUI.md)과 [구현 기록](2026-10-06-Performance-NativeEditorUI.md)의 제품 변경을 PR #2 브랜치에 반영했다.

## 독립 제품 검사

제품 checkout에서 pnpm check PASS: 201파일2582테스트 통과,26파일497조건부 skip,포맷·전체 타입·서버/웹 build 통과. 제품 경로는 성능 lab과 diff 없이 같다. UI preview·계측 파일은 제품 변경에 포함하지 않는다. 기존 번들 경고는 남아 있다.

## 브라우저 UI

1440×900에서 넓은 canvas/오른쪽 panel/하단 controls가 화면 안에 배치된다. panel 접기/펼치기,너비 keyboard 조절,tab 방향키,검색값 보존,도구 portal의 PNG 버튼,domain filter0→10카드 복원,domain card 진입을 확인했다. 손 도구 drag는 camera(24,24→144,84)만 바꾸고 V로 커서 전환된다. control button에 focus가 있어도 V 단축키가 동작한다. 390×844에서 가로 page overflow가 없고 toolbar가 겹치지 않으며 panel을 아래로 쌓는다.

## 성능

clean lab c2761a2 profiling 빌드에서 50/100테이블·각10컬럼·1440×900/surface1440×520·120회paced wheel을 조건별 준비1+본측정3회 측정했다. Native는 편집 버튼 표시 variant이며 비교는 동일 빌드의 기존 simple-cards다.

| 테이블 | Native React 중앙값 | Native frame p95 | simple-cards p95 |
| --- | --- | --- | --- |
| 50 | 0.5ms | 11.1ms | 11.1ms |
| 100 | 0.5ms | 11.2ms | 11.1ms |

Native 장면/기하/타입표시0회,문서 불변,camera 왕복,25ms초과0회 유지. 이번 유휴 rAF는 약10.8~11.1ms로 관측되어 이전10ms 환경과 절대시간 개선율을 계산하지 않았다. 숫자는 동일 fixture의 standalone canvas 비교이며 전체 application의 저장/협업/권한 비용까지 측정한 것은 아니다. 전체 workspace UI는 별도 읽기 전용 synthetic preview에서 확인했다.

기존 v1 다중선택·일괄이동은 Native에 새로 구현한 것으로 주장하지 않는다. 생성은 원래 버튼 위치에서 기존 Native 검증 폼을 여는 방식이다. domain filter는 원본 변경 없이 화면에만 적용하며 PNG는 저장된 view를 내보낸다. 운영 DB·main·배포는 변경하지 않았다.
