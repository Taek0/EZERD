/** Local expiry updates need no server polling; keep only the next deadline armed. */
export function watchInvitationExpiry(
  invitations: readonly { status: string; expiresAt: string }[],
  onExpire: () => void,
) {
  const deadlines = invitations
    .filter((item) => item.status === 'pending')
    .map((item) => Date.parse(item.expiresAt))
    .filter((time) => Number.isFinite(time) && time > Date.now())
    .sort((a, b) => a - b);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    const deadline = deadlines[0];
    if (deadline === undefined) return;
    timer = setTimeout(
      () => {
        if (deadline <= Date.now()) {
          while (deadlines.length && deadlines[0]! <= Date.now()) deadlines.shift();
          onExpire();
        }
        schedule();
      },
      Math.min(Math.max(0, deadline - Date.now()), 2147483647),
    );
  };
  schedule();
  return () => clearTimeout(timer);
}
