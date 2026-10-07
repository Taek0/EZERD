# 남은 미사용 호환 reader·함수 정리

- 참조를 재확인한 tableClipboardReadSchema/parseTableClipboardRead, translateSelectedNodes, isEffectiveChange/canApplyInverse/retainPendingOperations만 제거한다.
- Native clipboard의 참조·private payload 거부는 실제 nativeTableClipboardSchema로 검증하고, JSON/UTF-8 검증은 현재 readNativeClipboard 테스트를 유지한다.
- 변경 의미·undo 충돌·overlay 검증은 실제 사용되거나 계속 유지되는 모델 함수로 연결한다. Native 그룹 이동과 durable ACK 검증을 보존한다.
- 운영 코드·테스트·QA 잔여 참조, 포맷·타입·전체 테스트·빌드를 확인하고 결과를 기록한 뒤 커밋한다.
- 진행률은 레포의 v1 운영 의존성 정리라는 합의 범위를 기준으로 대략 추정한다. 파일 변환·과거 이력 호환을 없애는 작업이나 배포는 완료율의 목표에 포함하지 않는다. DB 저장 타입과 잔여 QA/최종 감사는 후속으로 남는다.
- DB 데이터·서버 실행 상태·docs/EZERD.txt는 변경하지 않는다.
