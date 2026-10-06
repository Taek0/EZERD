# 고급 편집 폼의 패널 전환 재검증 제거

상세 Profiler에서 이벤트 경계 분리 이후에도 남은 약 270ms 중 약 263ms가 접힌 NativeAdvancedEditor에서 발생했다. NativeAdvancedIndexForm의 정책/설계 검증을 포함한 하위 트리가 패널 상태 변경마다 재렌더링됐다.

NativeAdvancedEditor의 초안과 검증 폼은 계속 mount해 두고, 문서/table 및 userId/snapshot/busy가 같을 때 하위 트리를 memo로 유지한다. onSave는 최신 commit된 함수로 전달하므로 함수 참조 고정을 이유로 이전 권한이나 저장 기준을 사용하지 않는다. 문서·권한·actor·명시적 recovery 입력 변화는 memo 입력을 변경한다.

추가 callback/context 회귀와 advanced policy/UI/draft recovery 5개 파일·58개 테스트 통과. 전체 검사와 동일 panel 계측의 최종 결과는 별도 검증 기록에 남긴다.
