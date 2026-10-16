# 관계선 배치 수명주기 검증 결과

- 계획: [관계선 배치 수명주기 수정 계획](../planning/2026-10-16-Relations-ArrangeLifecyclePlan.md)
- 실제 localhost:3001이 제공하는 index-CR7v5ldy.js에는 jsxDEV, React 개발 런타임 및 main.tsx의 StrictMode가 포함되어 있었다. 서버 실행 시 NODE_ENV=production을 설정해도 이미 생성된 웹 번들의 개발 런타임은 바뀌지 않는다.
- 기존 NativeERDCanvas는 useMemo로 컨트롤러를 생성하고 passive effect 정리에서 dispose했다. StrictMode의 setup → cleanup → setup 과정에서는 memo 인스턴스를 유지하므로 dispose의 영구 플래그가 남았다. 이후 활성화된 메뉴를 눌러도 start의 disposed 검사에서 반환되어 worker와 상태 알림이 시작되지 않았다.
- UI 구현은 컨트롤러 생성/정리를 같은 layout effect에서 수행하고 ref를 통해 현재 인스턴스의 start/cancel/undo를 호출하도록 바뀌었다. 정리된 컨트롤러를 되살리지 않는다.
- 회귀 테스트는 실제 React StrictMode로 NativeERDCanvas를 마운트하고 활성화된 관계선 배치 메뉴를 호출한다. worker 입력 전송, 배치 진행 상태 및 unmount 때 worker 정리를 검증한다. 메뉴 표현과 장면 렌더링 자식만 격리하며 컨트롤러와 React hook 동작은 실제 구현을 사용한다.
- 동일 테스트와 git show HEAD로 만든 임시 기존 캔버스 모듈의 조합은 worker 수 expected 1 / actual 0으로 실패했다. 수정된 실제 캔버스에서는 통과했다. 임시 파일 2개는 삭제했다.
- 관련 검증: lifecycle/controller/toast 3개 파일의 15개 테스트 통과, 웹 TypeScript 검사 통과. 변경 파일 Prettier 적용 및 확인.
- 모든 수정과 테스트는 격리 lab에서 수행했다. D:/ChatGPT/ERD 파일/브랜치/서버는 변경하지 않았다. 통합 및 커밋은 상위 작업자가 진행한다.

## 통합 검증

- pnpm check 통과: 2,991 tests passed / 499 skipped, 포맷·전체 타입·제품 빌드 성공.
- 빌드 환경 수정과 함께 생성한 index-Cn3Lvk7V.js에서 React 개발 경고/JSXDev가 없고 production 오류 런타임을 확인했다.
- 현재 3001은 기존 D:/ChatGPT/ERD 빌드를 계속 제공한다. 격리 워크트리의 수정 검증과 실제 3001 반영은 구분한다. 원본 문서 조작, main 변경, 서버 재시작, 원격 push는 하지 않았다.
- 로그: artifacts/performance/2026-10-16-arrange-lifecycle-check.log (Git 제외).

## 최신 main 기준 PR 검증

- 원격 main 53ff53a에 두 수정 커밋만 충돌 없이 적용했다. PR 브랜치: codex/arrange-lifecycle-fix.
- pnpm check 통과: 2,979 tests passed / 499 skipped, 포맷·타입·제품 빌드 성공. 신규 PR 워크트리의 첫 실행에서는 기존 폰트 해시 테스트만 5초 timeout이 발생했고, 소스·timeout·skip 변경 없이 동일 명령 재실행으로 통과했다.
- 구성 검사에는 더미 로컬 DATABASE_URL을 사용했으며 DB 통합 테스트는 실행하지 않았다. 서버 API·DB 스키마·실행 서버 변경은 없다.
