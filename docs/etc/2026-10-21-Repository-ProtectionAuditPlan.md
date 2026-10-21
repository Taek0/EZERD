# 원격 저장소 보호 설정 검토 계획

- 작성일: 2026-10-21 (Asia/Seoul)
- 대상: https://github.com/Taek0/EZERD
- 목적: 공개 저장소의 접근 제어, PR 검토, main 보호 규칙, 자동 검사, 외부 PR Actions 권한과 스팸 대응 설정을 실측한다.
- 범위: 원격 설정과 기본 브랜치 파일을 읽고, 제공된 체크리스트별 충족 여부·근거·조회 한계를 기록한다. 원격 설정과 제품 코드는 변경하지 않는다.
- 절차: 저장소 공개 여부와 기본 브랜치 → collaborator 및 branch protection/ruleset → CI 실행과 워크플로 → Actions 권한과 fork 승인 → interaction limits 순서로 확인한다.
- 검증: 공식 GitHub 문서와 현재 API 또는 설정 화면을 대조하고, 권한 부족을 설정 미적용으로 해석하지 않는다. 문서 링크와 diff를 확인한 후 계획·결과만 로컬 커밋한다. 원격 push는 하지 않는다.
- 결과: [검토 결과](./2026-10-21-Repository-ProtectionAuditResult.md)
