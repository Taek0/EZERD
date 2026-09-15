export function isUsernameConflict(error: unknown): boolean {
 const seen=new Set<unknown>();let current=error;
 while(current&&typeof current==='object'&&!seen.has(current)){
  seen.add(current);const value=current as {code?:unknown;constraint?:unknown;cause?:unknown};
  if(value.code==='23505'&&value.constraint==='users_username_pin_unique')return true;
  current=value.cause;
 }
 return false;
}
