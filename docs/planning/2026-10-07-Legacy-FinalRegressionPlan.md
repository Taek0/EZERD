# v1 정리 최종 타입·QA 점검과 회귀 검증

- 실제 v1/v2 JSON 저장값을 반영하는 StoredDesignDocument 타입을 도입하고 projects.document 및 sync_client_baselines.document에 적용한다. DB 기본값·스키마 마이그레이션·기존 데이터는 변경하지 않는다.
- 레거시 export 정규화 경계는 명시적 버전 판별로 유지하고, Native 생성에 필요했던 부정확한 v1 타입 cast를 정리한다.
- 남은 QA 스크립트와 모델·계약의 참조를 조사한다. 폐기된 v1 UI/API만 대상으로 한 QA는 제거하고, Native 회귀·파일 변환·역사적 증거·현재 도구의 소비자는 유지한다.
- 단위별로 검증·커밋한다. 최종 포맷·타입·전체 테스트·빌드와 새 임시 DB에서 주요 API/MCP·Native 저장/변환/히스토리/취소 회귀를 수행한다.
- 최종 결과에는 유지한 호환 범위와 실제 검증 범위/제약을 명시한다. 다른 작업의 변경, 사용자 DB, docs/EZERD.txt 및 실행 중인 서버는 건드리지 않는다.
