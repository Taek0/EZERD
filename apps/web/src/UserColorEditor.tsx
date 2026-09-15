import { userColorStyle } from './user-color-style.js';
import { useState, type FormEvent } from 'react';
import { userSchema } from '@ezerd/contracts';
import { body, message, request } from './client.js';
import { Avatar, Button } from './components/ui/index.js';
import { DomainColorPicker } from './DomainColorPicker.js';
import './user-color.css';
type ColorUser = {
  id: string;
  username: string;
  color: string;
  createdAt: string;
  updatedAt: string;
};
export function UserColorEditor({
  user,
  onSaved,
  onClose,
}: {
  user: ColorUser;
  onSaved: (user: ColorUser) => void;
  onClose: () => void;
}) {
  const [draftColor, setDraftColor] = useState(user.color),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const updated = userSchema.parse(
        await request(
          '/api/users/' + encodeURIComponent(user.id),
          body('PATCH', { color: draftColor }),
        ),
      );
      onSaved(updated);
      onClose();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="identity-popover user-color-editor"
      aria-label="사용자 색상 변경"
      aria-busy={busy}
    >
      <form onSubmit={(event) => void save(event)}>
        <h2>사용자 색상 변경</h2>
        <div className="user-color-preview">
          <Avatar aria-hidden="true" style={userColorStyle(draftColor)}>
            {user.username.slice(0, 1)}
          </Avatar>
          <span>{user.username}</span>
        </div>
        <DomainColorPicker
          label="사용자 색상"
          value={draftColor}
          onChange={setDraftColor}
          disabled={busy}
        />
        <p>프로필과 내가 작성한 핀에 표시되는 색상입니다.</p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="actions">
          <Button
            type="submit"
            disabled={busy || draftColor.toLowerCase() === user.color.toLowerCase()}
          >
            {busy ? '저장 중…' : '색상 저장'}
          </Button>
          <Button type="button" disabled={busy} onClick={onClose}>
            취소
          </Button>
        </div>
      </form>
    </section>
  );
}
