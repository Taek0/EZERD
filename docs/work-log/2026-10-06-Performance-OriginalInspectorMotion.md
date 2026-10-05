# 원본 Inspector 컴포넌트와 모션 복원

- 계획: [OriginalComponentsMotion](../planning/2026-10-06-Performance-OriginalComponentsMotion.md)
- Native 화면의 4탭을 원본 속성/목록 탭과 선택 배지로 교체했다.
- 공통 PanelSection, PanelRow, PanelListDetail을 사용하여 컬럼 선택/닫힘 애니메이션을 복원했다.
- 도메인 필터는 원본 DialogTrigger/UntitledPopover/Checkbox를 사용한다. Native 입력은 공통 Select/Input/Textarea를 사용한다.
- 패널 닫힘은 DOM과 입력을 유지하고 inert/aria-hidden 및 220ms 그리드, 180ms opacity 전환으로 처리한다. reduced motion 설정을 존중한다.
- 기존 Native 저장/입력 복구/권한 검증은 유지한다. 상세 DB 속성은 별도 접이식 섹션에 보존한다.
- 검증: web typecheck, NativeProjectView/NativeProjectDraftRecovery/native-private-recovery-busy 23개 테스트 통과.
- 이어서 핀/댓글과 toolbar/전환의 전체 통합을 진행한다. 이 단계만으로 전체 UI 복원 완료를 의미하지 않는다.
