import { useEffect, useState, type FormEvent } from 'react';
import { body, message, request } from './client.js';
import { Button, Input } from './components/ui/index.js';

type TokenSummary = {
  id: string;
  name: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
};
type IssuedToken = TokenSummary & { token: string };

export function McpConnectionPanel({ onClose }: { onClose: () => void }) {
  const [tokens, setTokens] = useState<TokenSummary[]>([]);
  const [name, setName] = useState('내 MCP 클라이언트');
  const [issued, setIssued] = useState<IssuedToken | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mcpUrl = new URL('/mcp', window.location.origin).toString();

  async function load() {
    try {
      setTokens(await request<TokenSummary[]>('/api/mcp-tokens'));
    } catch (cause) {
      setError(message(cause));
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function issue(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const value = await request<IssuedToken>('/api/mcp-tokens', body('POST', { name }));
      setIssued(value);
      setTokens((current) => [value, ...current]);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    setError('');
    try {
      const value = await request<TokenSummary>(`/api/mcp-tokens/${id}`, { method: 'DELETE' });
      setTokens((current) => current.map((token) => (token.id === id ? value : token)));
      if (issued?.id === id) setIssued(null);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mcp-panel" aria-label="MCP 연결 설정">
      <div className="mcp-panel-heading">
        <div>
          <strong>MCP 연결</strong>
          <p>개인 토큰으로 EZERD 도구를 연결합니다.</p>
        </div>
        <Button aria-label="MCP 연결 닫기" onClick={onClose}>
          ×
        </Button>
      </div>
      {error && (
        <p className="mcp-error" role="alert">
          {error}
        </p>
      )}
      {issued && (
        <div className="mcp-issued" role="status">
          <strong>지금 토큰을 복사하세요</strong>
          <p>
            이 값은 다시 표시되지 않으며 {new Date(issued.expiresAt).toLocaleDateString('ko-KR')}에
            만료됩니다.
          </p>
          <code>{issued.token}</code>
          <Button onClick={() => void navigator.clipboard.writeText(issued.token)}>
            토큰 복사
          </Button>
        </div>
      )}
      <dl className="mcp-endpoint">
        <dt>MCP 주소</dt>
        <dd>
          <code>{mcpUrl}</code>
        </dd>
      </dl>
      <form onSubmit={(event) => void issue(event)}>
        <label htmlFor="mcp-token-name">토큰 이름</label>
        <Input
          id="mcp-token-name"
          value={name}
          maxLength={80}
          required
          onChange={(event) => setName(event.target.value)}
        />
        <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
          90일 토큰 발급
        </Button>
      </form>
      <div className="mcp-token-list">
        <h2>발급한 토큰</h2>
        {!tokens.length && <p>발급한 토큰이 없습니다.</p>}
        {tokens.map((token) => (
          <article key={token.id}>
            <div>
              <strong>{token.name}</strong>
              <small>
                {token.revokedAt
                  ? `폐기 ${new Date(token.revokedAt).toLocaleDateString('ko-KR')}`
                  : `만료 ${new Date(token.expiresAt).toLocaleDateString('ko-KR')}`}
                {token.lastUsedAt
                  ? ` · 최근 사용 ${new Date(token.lastUsedAt).toLocaleDateString('ko-KR')}`
                  : ''}
              </small>
            </div>
            {!token.revokedAt && (
              <Button disabled={busy} onClick={() => void revoke(token.id)}>
                폐기
              </Button>
            )}
          </article>
        ))}
      </div>
      <details>
        <summary>Codex 설정 예시</summary>
        <pre>{`[mcp_servers.ezerd]\nurl = "${mcpUrl}"\nbearer_token_env_var = "EZERD_MCP_TOKEN"\ndefault_tools_approval_mode = "writes"\ntool_timeout_sec = 60`}</pre>
      </details>
      <p className="mcp-security-note">
        토큰과 PIN은 채팅에 붙여 넣지 말고 클라이언트 실행 환경에 저장하세요.
      </p>
    </section>
  );
}
