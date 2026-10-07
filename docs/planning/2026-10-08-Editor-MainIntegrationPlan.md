# MAIN UI 통합 계획

- 담당: NativeProjectView, NativeCanvasToolbar, 신규 논리 모드 provider, 구조/관계 편집기 논리 UI 연결 및 전용 테스트/CSS.
- 논리 설계는 기본 OFF. 문서 데이터는 변경하지 않고 표시만 제어한다.
- `NativeLogicalModeProvider`의 `enabled`, `onEnabledChange`와 `useNativeLogicalMode()`의 동일 API를 하위 컴포넌트에 제공한다. provider 밖의 기본값도 OFF다.
- toolbar의 더 보기 메뉴에서 논리 설계를 전환한다. 기존 물리/논리 버튼은 제거한다.
- 도메인 필터 레이아웃, 패널 버튼 순서, 빈 테이블 즉시 생성, sidebar 기본 접힘, 도메인 색상점, 컬럼 작업 버튼 정리를 통합한다.
- 상세 설계는 담당자가 제공하는 NativeDesignDetails 계약 확인 후 교체한다.
- 다른 담당 파일은 직접 수정하지 않는다. 대상 파일만 Prettier 적용 및 관련 동작 테스트. Git add/commit 하지 않는다.

## 확정한 통합 계약

- 논리 ON은 논리 뷰, OFF는 물리 뷰로 전환한다. 명시적으로 논리 전용 초안을 복구할 때도 논리 모드를 활성화한다.
- 빈 테이블 미리보기는 `add_table`과 `add_table_reference` 두 명령에만 허용한다. immutable intent를 먼저 보존한 뒤 부모가 문서 미리보기와 선택을 갱신한다.
- 후속 편집은 기존 저장 큐의 단조 증가 순서로 생성 뒤에 등록한다. 기존 pending 원문과 ACK 연결을 바꾸지 않는다.
- 서버의 명시적 거절 시 미리보기를 제거한다. 응답 불명 상태는 기존 pending 복구 흐름을 유지하며, 속성 입력의 durable draft는 기존 편집기가 보존한다.
- Canvas에는 화면용 document와 별도로 원본 sourceDocument에 신규 생성만 합성한 `optimisticSourceDocument`를 전달한다. ACK 전에도 inline 이름 편집에서 새 객체를 조회할 수 있다.
- 개인 뷰에서 새 테이블을 만들면 전체 테이블 화면으로 이동해 공유 테이블을 생성한다. 개인 배치와 공유 생성에 걸친 별도 저장 프로토콜은 추가하지 않는다.
- 자동저장 750ms/최대 2초 정책과 타이머 회귀는 구현 초안 후 Feynman에게 이관했다.
