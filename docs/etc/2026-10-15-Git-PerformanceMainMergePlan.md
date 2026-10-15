# 성능 워크트리 원격 main 병합 계획

- 대상: codex/performance-lab, product-performance-pr/ERD. 시작 HEAD 7d10d5a, 미커밋 변경 없음.
- origin/main 26b3610을 merge하여 계측 도구/기록을 보존한다. 기존 cherry-pick 이력 때문에 커밋 수 차이는 실제 코드 차이와 다르다.
- 신규 generic DB 지원, 개인 화면/API 정리, websocket 갱신 변경과 계측 코드의 호환성을 확인한다.
- 충돌이 발생하면 최신 제품 동작을 기준으로 계측 전용 변경을 이식한다. docs/EZERD.txt는 직접 편집하지 않는다.
- 병합 후 포맷·타입·테스트·제품 빌드 및 성능 빌드를 검증하고 결과를 기록한다. 이 요청에서는 원격 push를 하지 않는다.
