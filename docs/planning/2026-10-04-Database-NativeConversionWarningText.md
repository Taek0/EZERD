# Native 변환 환경 안내 수정 계획

- 실제 signed PG→MySQL 검토에서 mysql.environment-profile-assumed warning을 일반 변환 불가 문장으로 표시한 모순을 수정한다. 원래 warning 및 적용 가능 정책은 유지하며, 표시된 MySQL 설정과 실제 서버 설정의 확인 안내로 매핑한다.
- 실제 model-backed positive 검토 SSR에서 warning의 정확한 안내와 적용 가능 유지, 변환 불가 문장 부재를 확인한다. blocked 진단과 기존 raw/profile 비노출 검증도 유지한다.
- 전체 검증 및 최종 브라우저 번들 확인은 후속 QA에 합산한다.