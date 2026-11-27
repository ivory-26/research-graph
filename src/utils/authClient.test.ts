import { describe, it, expect, vi } from 'vitest';
import { signIn, signUp, signOut } from './authClient';

describe('authClient', () => {
  describe('signIn', () => {
    it('validates email and password inputs', async () => {
      const res1 = await signIn({ email: 'bad-email', password: '123' });
      expect(res1.ok).toBe(false);
      expect(res1.error).toContain('valid email');

      const res2 = await signIn({ email: 'user@example.com', password: '' });
      expect(res2.ok).toBe(false);
      expect(res2.error).toContain('Password is required');
    });

    it('submits credentials via authClient.signIn.email and handles success', async () => {
      const mockClient = {
        signIn: {
          email: vi.fn().mockResolvedValue({
            data: { user: { id: 'u1', email: 'user@example.com', name: 'User' } },
            error: null,
          }),
        },
      };

      const res = await signIn(
        { email: 'user@example.com', password: 'secretpassword' },
        mockClient as any,
      );
      expect(res.ok).toBe(true);
      expect(mockClient.signIn.email).toHaveBeenCalledWith({
        email: 'user@example.com',
        password: 'secretpassword',
      });
    });

    it('handles sign in error response from adapter', async () => {
      const mockClient = {
        signIn: {
          email: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'Invalid credentials' },
          }),
        },
      };

      const res = await signIn(
        { email: 'user@example.com', password: 'wrong' },
        mockClient as any,
      );
      expect(res.ok).toBe(false);
      expect(res.error).toBe('Invalid credentials');
    });
  });

  describe('signUp', () => {
    it('requires valid email and minimum password length', async () => {
      const res = await signUp({ email: 'user@example.com', password: '123' });
      expect(res.ok).toBe(false);
      expect(res.error).toContain('at least 8 characters');
    });

    it('submits credentials via authClient.signUp.email', async () => {
      const mockClient = {
        signUp: {
          email: vi.fn().mockResolvedValue({
            data: { user: { id: 'u2', email: 'new@example.com', name: 'New User' } },
            error: null,
          }),
        },
      };

      const res = await signUp(
        { email: 'new@example.com', password: 'strongpassword123', name: 'New User' },
        mockClient as any,
      );
      expect(res.ok).toBe(true);
      expect(mockClient.signUp.email).toHaveBeenCalledWith({
        email: 'new@example.com',
        password: 'strongpassword123',
        name: 'New User',
      });
    });
  });

  describe('signOut', () => {
    it('dispatches sign out via authClient.signOut', async () => {
      const mockClient = {
        signOut: vi.fn().mockResolvedValue({ error: null }),
      };

      const res = await signOut(mockClient as any);
      expect(res.ok).toBe(true);
      expect(mockClient.signOut).toHaveBeenCalled();
    });
  });
});
