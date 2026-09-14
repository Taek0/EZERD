import { useCallback, useEffect, useState } from 'react';
import { healthSchema, readinessSchema } from '@ezerd/contracts';

type Connection = 'checking' | 'ready' | 'unavailable';

export function App() {
  const [api, setApi] = useState<Connection>('checking');
  const [database, setDatabase] = useState<Connection>('checking');
  const [busy, setBusy] = useState(false);

  const check = useCallback(async (signal?: AbortSignal) => {
    setBusy(true);
    setApi('checking');
    setDatabase('checking');
    await Promise.all([
      fetch('/api/health', { signal: signal ?? null }).then(async response => {
        if (!response.ok) throw new Error('API unavailable');
        healthSchema.parse(await response.json());
        if (!signal?.aborted) setApi('ready');
      }).catch(() => { if (!signal?.aborted) setApi('unavailable'); }),
      fetch('/api/health/ready', { signal: signal ?? null }).then(async response => {
        const result = readinessSchema.parse(await response.json());
        if (!signal?.aborted) setDatabase(response.ok && result.status === 'ready' ? 'ready' : 'unavailable');
      }).catch(() => { if (!signal?.aborted) setDatabase('unavailable'); }),
    ]);
    if (!signal?.aborted) setBusy(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void check(controller.signal);
    return () => controller.abort();
  }, [check]);

  const label = (value: Connection) => ({ checking: '확인 중', ready: '연결됨', unavailable: '확인 필요' })[value];

  return <div className="app-shell">
    <header><a className="brand" href="/" aria-label="EZERD 시작 화면"><span className="brand-symbol">E</span> EZERD</a><span className="environment">LOCAL DEVELOPMENT</span></header>
    <main>
      <div className="eyebrow"><span /> YOUR TEAM’S MODELING SPACE</div>
      <h1>도메인에서 시작하는<br /><em>우리 팀의 데이터 설계.</em></h1>
      <p className="intro">EZERD의 개발 환경을 준비하고 있습니다.<br />화면, API, 데이터베이스의 연결 상태를 여기에서 확인하세요.</p>
      <section className="connections" aria-labelledby="connections-title">
        <div className="section-heading"><div><span className="overline">WORKSPACE STATUS</span><h2 id="connections-title">개발 환경 연결</h2></div><button onClick={() => void check()} disabled={busy}>{busy ? '확인 중…' : '다시 확인 ↗'}</button></div>
        <div className="status-grid" aria-live="polite">
          <article><span className="step">01</span><h3>브라우저</h3><p>React · TypeScript · Vite</p><span className="badge ready">실행 중</span></article>
          <article><span className="step">02</span><h3>API 서버</h3><p>Node.js · NestJS</p><span className={`badge ${api}`}>{label(api)}</span></article>
          <article><span className="step">03</span><h3>데이터베이스</h3><p>PostgreSQL · Drizzle</p><span className={`badge ${database}`}>{label(database)}</span></article>
        </div>
        {database === 'unavailable' && <p className="help">PostgreSQL이 실행 중인지, 초기 마이그레이션이 적용되었는지 확인해주세요. 실행 순서는 저장소의 README에 정리되어 있습니다.</p>}
      </section>
      <section className="next"><div><span className="overline">WHAT WE’RE BUILDING</span><h2>하나의 흐름으로 연결되는 설계</h2></div><p>프로젝트 갤러리 <span>→</span> 도메인 맵 <span>→</span> 논리·물리 ERD</p><small>이 화면은 개발 환경 확인용입니다. 캔버스 편집과 실시간 협업은 다음 구현 단계입니다.</small></section>
    </main>
    <footer><span>EZERD / TEAM WORKSPACE</span><span>작은 모델에서, 함께 만드는 구조로.</span></footer>
  </div>;
}
