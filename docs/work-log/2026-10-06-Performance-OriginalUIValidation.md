# 원본 컴포넌트·애니메이션 복원 검증

## 반영 범위

- 원본 PanelSection/PanelRow/PanelListDetail, 속성·목록 탭, 선택 배지, 도메인 필터 Popover, Select/Checkbox, 도메인 색상 선택기를 Native 데이터에 연결했다.
- 원본 CommentsPanel/CommentPins/PinPanelResizer, 핀 생성 위치와 이동, 히스토리 팝오버를 연결했다.
- 컬럼 추가/순서 변경, 테이블 삭제 검토 진입, 카드 크기 손잡이, 실행 취소/다시 실행을 기존 Native 저장/버전/권한/입력 복구 경로로 연결했다.
- Native DB별 타입/생성/제약 조건의 추가 검증 UI는 보존한다. v1 형식으로 데이터를 변환하지 않는다.

## 실제 모션

브라우저의 실행 중 Animation 목록을 로컬 QA 페이지에서 수집했다. CSS를 끄거나 duration을 0으로 바꾸지 않았다.

| 대상 | 확인한 모션 |
|---|---|
| 속성 패널 | grid-template-columns 220ms, opacity 180ms, visibility 220ms; 너비 320→1px |
| 컬럼 상세 | PanelListDetail WAAPI 180ms |
| 도메인 화면 진입 | domain-enter 240ms |
| 댓글 패널 | width 220ms, opacity 180ms |
| 도메인 필터 | ui-overlay-in 150ms |

실제 Select 팝오버에서 computed:stored / computed:virtual의 조건 불충족 옵션이 disabled로 표시됨을 확인했다. Native 선택 입력에는 명시적 aria-label도 연결했다. reduced-motion 경로는 기존 공통 컴포넌트/CSS를 유지한다.

## 화면 이동

- 측정 커밋: `4d64bb6346c8d1d53970d14d7cdb1dfc09310e9b`, dirty=false, production React profiling build.
- Chrome 154, DPR 1, 브라우저 1280×720 / 캔버스 1280×520. 이전 1440px 측정과 절대값을 직접 비교하지 않는다.
- Native editable-presentation과 **기존 v1 simple-cards**를 같은 크기에서 비교했다. 각각 워밍업 1회 + 본 측정 3회, 회당 rAF-paced wheel 120회. 100개 조건은 두 번째 본 측정에서 순서를 반대로 실행했다.
- 초기 Native/simple-cards 선택은 실제 simple renderer가 적용되지 않는 조건이라 비교에서 제외했다. 유효 표본 16개(워밍업 포함)만 최종 요약에 사용했다.

| 테이블 × 컬럼 | Native React median | v1 simple-cards React median | Native frame p95 | simple-cards frame p95 |
|---|---:|---:|---:|---:|
| 50 × 10 | 0.5ms | 1.5ms | 11.1ms | 11.1ms |
| 100 × 10 | 0.5ms | 1.7ms | 11.1ms | 11.1ms |

수치는 본 측정 3회의 해당 지표 중앙값이다. 모든 유효 표본에서 문서 원문은 불변이고 카메라는 중간에 이동한 뒤 원점으로 돌아왔다. 25ms 초과 프레임은 0개, Native 장면/관계선/타입 표시 재계산은 0회였다. React actualDuration은 paint 시간과 다르며, 이 측정은 네트워크·실제 협업을 포함한 전체 사용자 지연을 보장하지 않는다. 모션 전환은 위 별도 검증에서 확인했다.

## 검사와 결과 위치

- Lab 전체 `pnpm check`: 206개 파일, 2,599개 테스트 통과 / 497개 환경 조건부 테스트 skip; format/typecheck/build 통과.
- 제품 worktree 전체 `pnpm check`: 202개 파일, 2,590개 테스트 통과 / 497개 skip; format/typecheck/build 통과.
- 후속 툴바 memo 변경은 독립 제품 typecheck로 다시 확인했다.
- 원시 JSON/스크린샷: Lab `artifacts/performance/2026-10-06-original-ui-motion/` (Git 제외).
- 로컬 예제: http://127.0.0.1:4177/performance/workspace.html . 예제 데이터·모의 GET 응답만 사용하며 API 쓰기는 차단한다. 제품 브랜치에는 예제·계측 스크립트·원시 결과를 포함하지 않는다.
