# 편집 워크플로 브라우저 QA 결과

완료. Chrome QA 전용 탭 322938574, http://127.0.0.1:5174, 임시 DB 및 native-sync POST 800ms 지연 환경.

## 발견 사항

QA-01~04를 발견해 오너에게 즉시 보고했으며 모두 수정 후 재검증 PASS. 아래 발견 시점 기록은 이력으로 보존한다.

## 검증 기록

- QA 세션 및 신규 사용자 생성 시작.

### QA-01 / P1 / ENUM 생성 중 자동 저장으로 입력 대상 소멸

- 재현: ENUM → ENUM 추가 → 물리 이름 `qa_status` → 값 추가 → 잠시 후 값 1 입력 시도.
- 실제: 값 1을 입력하기 전에 `public.qa_status`가 값 1개(빈 문자열)로 자동 생성되고 생성 폼 이름/값이 초기화됨. 접근성 입력 대상도 disconnected로 변경됨.
- 기대: 사용자가 값 입력을 마칠 수 있도록 생성 흐름이 안정적으로 유지되어야 함. 생성 후에도 편집 중 값 입력이 자연스럽게 이어져야 함.
- 환경: native-sync POST 800ms 지연, 자동 저장 기본 750ms.
- 증거: [ENUM 자동생성 화면](screenshots/2026-10-08-Editor-WorkflowBrowserQA/enum-empty-autocreate.jpg).

### QA-02 / P2 / ENUM 값 목록 영역 높이 부족

- 위 생성 화면에서 순서가 있는 값 목록 fieldset이 약 40px 높이로 눌려 내부 스크롤만 보임. 값 추가/값 입력이 화면상 드러나지 않음(AX에는 존재).
- 같은 화면 증거 참조. 2560×1272 기본 Chrome viewport, 별도 배율 조정 없음.

### QA-03 / P1 후보 / 컬럼 추가 응답 후 테이블 소멸 관찰 (작업 중 재확인 필요)

- 사이드바 새 테이블 만들기에서 `qa_orders` 입력 → 저장 완료 후 카드/목록 1개 확인 → 카드 컬럼 추가 클릭.
- 낙관적 빈 컬럼의 이름 입력이 나타났지만 다음 조작 시 입력 대상 disconnected. 이후 전체 테이블 수 0, 빈 캔버스가 표시됨. ENUM 1개는 유지됨.
- 코드 작업/HMR 또는 QA 서버 상태 변경의 영향일 수 있어 제품 결함 확정 전 MAIN/Godel 완료 후 재검증 필요. 이 시점 QA 사용자는 테이블 삭제/실행 취소를 하지 않음.

### 확인 완료

- 히스토리: 시퀀스 3→2→1 최신순, 생성/값 변경 요약 정상. 콘텐츠 높이 442px, top 143px / viewport 1215px. [화면](screenshots/2026-10-08-Editor-WorkflowBrowserQA/history.jpg).
- 추가 단축키 검증 예정: 카드 이름/타입 편집 중 H/V 텍스트 유지, Escape 후 H/V 도구 전환, sidebar 입력 중 가로채지 않음, 빈 캔버스/toolbar 포커스 후 전환.

### QA-03 후속 / 최신 reload 후 기존 테이블 UI 소실 재관찰

- reload/갤러리에서 qa_orders 테이블1·빈컬럼1이 서버에 보존됨을 확인. 이전 소실은 영구 데이터 삭제로 단정할 수 없음.
- 최신 UI에서 ＋테이블 click와 사이드바 테이블명 fill(`qa_race_table`)을 같은 CUA 호출에서 실행. click 반환 977ms, 그 후 fill43ms(총1020ms). 800ms 이전 입력은 입증 못함. 입력 중 UI에 저장 확인 중 표시, 목록2 확인.
- 저장 기준 확인됨 이후 qa_race_table만 남고 기존 qa_orders 카드가 없어지며 목록1로 감소. 오류/거절 문구는 없음.
- [응답 이후 화면](screenshots/2026-10-08-Editor-WorkflowBrowserQA/table-count-after-ack.jpg). 브라우저 로그에는 NativeProjectView를 NativePropertyEditor/NativeEditorForm/NativeAdvancedIndexForm render 중 갱신한다는 React 경고가 있음. 앞선 02:16경 maximum update depth 로그도 있었으나 현재 소실과 인과는 미확정.
- HTTP 요청 횟수/실제 ACK 시점은 실측하지 않음. 이 호출의 800ms 이전 race는 미검증으로 유지.

### QA-03 확정 후속 / 논리 OFF·필터 전체·reload 이후도 저장 시 기존 카드 소실

- `더 보기` 메뉴가 **논리 설계 켜기**(현재 OFF)임을 직접 확인. 도메인 필터 전체 테이블 표시/미지정 모두 체크 확인 후 필터 해제·reload 수행.
- 갤러리/편집기에서 qa_orders 및 qa_race_table 2개 확인. qa_race_table 이름과 order_id 저장값 보존 PASS.
- qa_orders 컬럼 상세에서 이름 id 입력 후 타입 검색 inte → INTEGER/INTERVAL 결과 확인. 이름 ACK 이후 qa_orders 및 속성 편집이 사라지고 qa_race_table만 남음(목록2→1). 타입 선택 노드 disconnected.
- 오너 DB read에 두 테이블 저장됨이 확인되어 **데이터 삭제가 아닌 live UI state/가시성 소실**로 분류. OFF/전체 필터에서도 재현, reload 복구.
- 사이드바 관찰 PASS: 이름→타입→설명→기본 키(PK), NULL·기본값·배열 차원 기본접힘, 작은 속성편집/형식편집/현재 타입 요약 없음. 타입 검색 결과 자체는 PASS, 선택 완료는 소실로 중단.

### QA-01/02 수정 후 재검증 PASS

- 새 qa_status_fixed 생성 → 빈 값 행 추가 → 생성 ACK 후 기존 값1 입력란에 ready 입력 → 목록 `public.qa_status_fixed 1 ready` 반영.
- textarea isConnected=true, value=ready, 높이64px. 값목록 fieldset 높이319px. [수정 화면](screenshots/2026-10-08-Editor-WorkflowBrowserQA/enum-fixed.jpg).
- 생성 폼 초기화 및 높이 눌림은 재현되지 않음.

### QA-04 / P2 / ENUM 미완성 입력의 원시 검증 JSON 노출

- ENUM 추가 → 이름 qa_status_fixed 입력 → 아직 값0개일 때 자동 저장 시 화면에 origin=array, code=too_small, path=[value,values], Too small: expected array to have >=1 items JSON이 표시됨.
- 값 추가/ready 저장 후 오류는 사라짐. 기능을 막지는 않지만 사용자용 안내로 변환되어야 함.

### 중간 PASS 기록

- 고급 편집: 항목 종류 → 편집 대상 → 핵심 설정 순서. 기본 인덱스, 식 트리의 생성하려는 식 선택(컬럼 참조)→컬럼 선택, 고급 인덱스 옵션/기존 식 묶기/진단 기본 접힘 확인.
- 새 테이블 만들기 sidebar 섹션 기본 접힘 확인.
- toolbar 속성 패널 버튼이 핀 패널 버튼보다 앞에 있음.
- 작업 중 여러 번 명시적 조작 없이 갤러리로 전환됨. 코드/HMR 영향 가능하여 독립 결함으로 확정하지 않으며 검증 중단 구간은 최종 표에 별도 표시.

### QA-03 수정 후 1차 PASS

- 최신 reload 후 qa_orders 컬럼 id→id_fixed→id_fixed2 두 차례 저장.
- 첫 ACK 중 열었던 타입 검색 inte의 INTEGER 선택 정상, TEXT로 복귀 정상.
- 두 ACK 이후 qa_orders/qa_race_table 두 카드 및 목록2 유지, 컬럼명 input isConnected=true/value=id_fixed2 확인. [화면](screenshots/2026-10-08-Editor-WorkflowBrowserQA/sidebar-fixed.jpg).
- 최종 빌드 종료 뒤 reload 지속성/컬럼추가 ACK 확인 예정.

### 논리 모드 검증

- 기본 OFF 메뉴 '논리 설계 켜기' 확인.
- ON 시 physical 전용 테이블은 숨겨짐(의도된 scope 동작), 논리 새 테이블 생성 시 논리 이름/논리 정의 실제 입력란 노출.
- 논리 이름 `논리 주문`, 정의 `QA 논리 편집 유지` 입력 및 저장 기준 확인됨 후 OFF 전환. 논리 편집란/논리 카드 숨김, 기존 physical 카드2 복귀 확인.

## 최종 결과

- 요청된 20항목은 아래 관찰 범위에서 PASS. 발견한 QA-01~04 모두 수정 후 재검증 통과, 현재 확인된 미해결 결함 없음.
- 중간 조작 중단 사유는 **오너 중간상태 확인 요청**이다. 이후 오너 지시에 따라 남은 5항목만 마무리했다.
- 코드 수정·Git add/commit 없음. Chrome QA 탭 322938574는 최종 결과 확인용으로 유지했다.
- 오너 전달 전체 check 결과: 223파일/2764테스트 및 format/type/build PASS. 이는 오너 제공 결과이며 이 QA에서 재실행하지 않았다.

## 20항목 최종 검증표

| # | 요구사항 | 판정 | 실제 관찰 증거/범위 |
|---|---|---|---|
| 1 | type 검색 | PASS | inte→INTEGER/INTERVAL 결과, INTEGER 선택 및 TEXT 복귀 |
| 2 | PK 위치 | PASS | 이름→타입→설명→기본 키(PK), 옵션 앞 배치 |
| 3 | 800ms 중 편집/이동 | PASS | 지연 환경에서 이름 입력과 카드 drag 연속 수행, 보관된 입력/저장중 UI 사용 가능, 최종 이름·좌표 유지. 엄밀800ms이전/네트워크 ACK 시점은 미측정 |
| 4 | ENUM | PASS | QA01/02 생성 ACK 뒤 ready 입력·저장 및 정상높이, QA04 친절안내, QA전용 qa_status 삭제 후 목록3→2 |
| 5 | 새 테이블 접힘 | PASS | 미선택 sidebar 새 테이블 만들기 기본접힘 |
| 6 | 카드 표시 없음 | PASS | 테이블 sidebar와 펼친 DB 옵션·표시에 별도 ‘카드 표시’ UI 없음. NULL/컬럼 설명 표시 설정은 유지 |
| 7 | 도메인 점 | PASS | QA Sales 실제 도메인 생성·소속 지정, 필터에 색상 점 rgb(137,147,163) 노출 |
| 8 | 컬럼 버튼 정리 | PASS | 카드+ 버튼, sidebar 컬럼 추가 ›, 상세 컬럼 삭제 |
| 9 | 작은 제목/현재 type 없음 | PASS | 컬럼 속성의 속성편집·형식편집·현재타입요약 없음. 테이블 DB 스키마 현재값 안내는 별개로 유지 |
| 10 | 고급 계층 | PASS | 종류→대상→핵심설정, 식 종류→컬럼 선택, 고급옵션/진단 접힘 |
| 11 | 상세정보 | PASS | DB옵션·컬럼TEXT/NOT NULL·ENUM값 조회 |
| 12 | filter 정상 | PASS | QA Sales만 적용 시 목록2→1, 필터해제 복구. 팝업320×281.6px로 viewport 내부 |
| 13 | sidebar/pin 순서 | PASS | toolbar 속성패널→핀패널 |
| 14 | 논리 OFF/ON | PASS | 기본OFF, ON 논리이름/정의 실제 입력, OFF 숨김과physical 카드 복귀 |
| 15 | 즉시 빈 table | PASS | 저장중 이름 없는 빈카드·선택·sidebar 입력 노출, 같은 CUA호출 create→fill 수행. strict800ms 이전은 미입증 |
| 16 | 우클릭 | PASS | 객체 메뉴: 오려두기/복사하기/핀/삭제 정상노출 |
| 17 | history 최신/높이 | PASS | 3→2→1 최신순, 콘텐츠442px로 viewport내 표시 |
| 18 | resize2px | PASS | sidebar 시각선 ::after 2px, hit영역6px. 실제 drag320→420px |
| 19 | zoom 고정 | PASS | 100→120%에서 배율버튼 x2058.21875/y1155 동일,100%복귀 |
| 20 | H/V | PASS | 카드 이름·타입 편집 중 hv문자 유지/손도구false, Escape후H 손도구true·V복귀. sidebar입력 hv보존, toolbar포커스H/V 동작 |

## 최종 5항목 마무리 증거

1. **ENUM 삭제:** qa_status 삭제→삭제 영향 확인 true→삭제 실행 확인. qa_status 사라지고 qa_status_fixed ready 및 qa_empty_validation valid만 유지, ENUM3→2. [삭제 결과](screenshots/2026-10-08-Editor-WorkflowBrowserQA/enum-delete-final.jpg).
2. **sidebar resize:** 한 번의 drag로 aria-valuenow320→420. 시각선2px/hit영역6px는 앞선 DOM 측정값.
3. **이동 좌표 reload 보존:** qa_orders_final의 reload 전후 style가 left380px/top173px/width490.8px/height260px로 동일. 최종 이름·컬럼id_fixed2/hv_sidebarhv 및 qa_race_table도 유지. [최종 화면](screenshots/2026-10-08-Editor-WorkflowBrowserQA/final-persistence.jpg).
4. **console:** 최종 build 이후 첫 reload부터 조작 구간, 지속성 확인용 마지막 reload 이후 모두 captured warn/error 0건. 이전 HMR 중 경고와 구분했다.
5. **카드 표시 없음:** 선택 테이블 sidebar와 DB 옵션·표시 펼친 DOM에서 ‘카드 표시’ 문구/컨트롤 없음 확인.

## 결함 종료 확인

- QA01/02: 동일 생성 흐름의 textarea connected=true, ready 저장; textarea64px/fieldset319px. [수정 화면](screenshots/2026-10-08-Editor-WorkflowBrowserQA/enum-fixed.jpg).
- QA03: 이름 수정 반복 ACK 및 컬럼추가 ACK에도 두 카드/목록2/입력 연결 유지. 최종 reload 후 이름·컬럼·이동좌표 동일.
- QA04: 값0개 입력 시 `값을 하나 이상 추가해 주세요. 입력한 내용은 유지됩니다.` 안내. 원시 Zod JSON 없음. 이후 valid값 생성 저장 성공. [안내 화면](screenshots/2026-10-08-Editor-WorkflowBrowserQA/enum-validation-final.jpg).

## 검증 한계

- HTTP 요청 횟수와 ACK 네트워크 시점은 실측하지 않았다. strict800ms 이전 race는 브라우저에서 입증하지 않았으며 PASS는 지연 환경의 실사용 입력·이동·최종보존에 한정한다.
- 오너/MAIN은 deferred transport 회귀로 create→patch 순서와 rejection rollback을 검증했다고 전달했다. 이 보고서는 해당 unit 결과를 독립 재실행한 것으로 주장하지 않는다.
- 실제 사용자 DB가 아닌 지정 임시 QA DB만 사용했다. 새 기능·범위 확장 및 코드 수정 없이 종료한다.
