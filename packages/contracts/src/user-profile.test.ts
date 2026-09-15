import { expect, it } from 'vitest';
import { usernameInputSchema, updateUserSchema, userSchema } from './index.js';
it('requires exactly four numeric characters and preserves a leading zero', () => {
  expect(usernameInputSchema.parse({ username: '  name ', pin: '0012' })).toEqual({
    username: 'name',
    pin: '0012',
  });
  for (const pin of ['', '123', '12345', '12a4', '1234\n', ' 1234', '１２３４', 1234])
    expect(usernameInputSchema.safeParse({ username: 'name', pin }).success).toBe(false);
});
it('accepts partial profile changes and normalizes valid colors only', () => {
  expect(updateUserSchema.parse({ color: '#12ABEF' })).toEqual({ color: '#12abef' });
  expect(updateUserSchema.parse({ username: ' new ' })).toEqual({ username: 'new' });
  for (const value of [
    {},
    { color: 'red' },
    { color: '#abc' },
    { color: '#123456\n' },
    { color: '#12345678' },
    { pin: '1234' },
  ])
    expect(updateUserSchema.safeParse(value).success).toBe(false);
});
it('does not expose PIN or its hash in public user contracts', () => {
  const user = {
    id: '00000000-0000-4000-8000-000000000001',
    username: 'name',
    color: '#4169e1',
    createdAt: '2026-09-15T00:00:00.000Z',
    updatedAt: '2026-09-15T00:00:00.000Z',
  };
  expect(userSchema.parse(user)).toEqual(user);
  expect(userSchema.safeParse({ ...user, pin: '0012' }).success).toBe(false);
  expect(userSchema.safeParse({ ...user, pinHash: 'hash' }).success).toBe(false);
});

it('normalizes mixed-case usernames for registration and profile updates', () => {
  expect(usernameInputSchema.parse({ username: '  TaEk  ', pin: '0012' }).username).toBe('taek');
  expect(updateUserSchema.parse({ username: 'TAEK' }).username).toBe('taek');
});
