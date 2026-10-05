# 캔버스 복원 커밋 원격 반영 결과

- [계획](./2026-10-06-Git-CanvasRestorationPushPlan.md)에 따라 제품 기준점 `a134c60aa01b1d7afde98b45d56aed349a04be04`까지 로컬 main 전용 커밋 21개를 원격 main에 반영했다.
- 원격 시작점은 `eff2f6a3aadce24865a16651e51054fd9960e361`였다. 계획 커밋 `f909dfc`를 포함해 일반 fast-forward push했고, `git ls-remote`로 원격 main이 `f909dfc642133325131835d2863c50cd885d3339`와 일치함을 확인했다.
- 반영 범위는 공통 flow layout, native inspector/toolbar/card/relation/inline editing/type search/선택·메뉴·키보드/관계 툴팁 등 원본 UI 복원, isolated HTTP 검증과 복원 감사 기록, localhost 실행·새 빌드·스키마 준비 상태 기록이다.
- merge/rebase/force push 없이 기존 커밋 이력을 유지했다. 이번 작업에서 제품 코드·폰트·사용자 관리 `docs/EZERD.txt`를 수정하지 않았으며, 다른 브랜치와 실행 중인 localhost 앱·DB도 변경하지 않았다.

## 격리 checkout 검증

- 요청 기준점과 동일한 제품 tree를 새 managed worktree에 준비했다. frozen lockfile 설치·공급망 정책 검사 및 공개 예시 환경 준비를 완료했다. lockfile 변경 없음.
- 전체 `pnpm check` PASS: 포맷·전체 타입·테스트·서버/웹 빌드 통과. 테스트 215개 파일·2,742개 PASS, 27개 파일·500개 조건부 SKIP.
- 조건부 DB/브라우저 통합 검증을 이번 push 검사에서 전부 새로 실행한 것으로 계산하지 않는다. 원본 작업의 실제 검증은 해당 커밋의 작업 기록과 구분한다.
- Vite의 기존 500 kB 초과 번들 경고는 유지된다. GitHub는 의존성 취약점 10건(높음 5, 중간 4, 낮음 1)을 알렸다. [Dependabot 알림](https://github.com/Taek0/EZERD/security/dependabot)에서 후속 확인한다. 이번 push에서 의존성 버전을 바꾸지 않았다.
- 제품 기준점 대비 계획 기록만 제외한 tree 동일성·diff 공백·clean checkout을 확인했다. 의존성·빌드 산출물·예시 `.env`는 커밋에 포함하지 않았다.

## 마무리

- 결과 기록을 독립 커밋해 같은 원격 main에 일반 push하고 최종 HEAD를 대조한다.
- 원래 main에 계획 이후 새 커밋이 없으면 이 결과 문서 추가만 포함하는 fast-forward로 맞춘다. 작업 중 새 변경이 있다면 보존하고 브랜치를 재작성하지 않는다.
- 검증 worktree는 완료 후 보관한다. 이 작업은 원격 Git 반영이며 실행 중인 앱 재시작이나 배포는 수행하지 않는다.
