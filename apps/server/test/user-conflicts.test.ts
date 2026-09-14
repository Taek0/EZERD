import {expect,it} from 'vitest';
import {isUsernameConflict} from '../src/user-conflicts.js';
it('recognizes only the username uniqueness constraint through wrapped errors',()=>{
 expect(isUsernameConflict({cause:{code:'23505',constraint:'users_username_unique'}})).toBe(true);
 expect(isUsernameConflict({code:'23505',constraint:'other_key'})).toBe(false);
 expect(isUsernameConflict(new Error('database offline'))).toBe(false);
 const cycle:{cause?:unknown}={};cycle.cause=cycle;expect(isUsernameConflict(cycle)).toBe(false);
});

