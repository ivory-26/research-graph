import { describe, it, expect, vi } from 'vitest';
import {
  signIn,
  signUp,
  signOut,
  getSession,
} from './authClient';

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

    it('submits credentials to /api/auth/sign-in/email and handles success', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null),
        },
        json: async () => ({ user: { id: 'u1', email: 'user@example.com', name: 'User' } }),
      });

      const res = await signIn({ email: 'user@example.com', password: 'secretpassword' }, mockFetch as any);
      expect(res.ok).toBe(true);
      expect(res.status).toBe(200);
      expect(res.data?.user.email).toBe('user@example.com');
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/auth/sign-in/email',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ email: 'user@example.com', password: 'secretpassword' }),
        }),
      );
    });

    it('handles sign in error response', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: {
          get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null),
        },
        json: async () => ({ message: 'Invalid credentials' }),
      });

      const res = await signIn({ email: 'user@example.com', password: 'wrong' }, mockFetch as any);
      expect(res.ok).toBe(false);
      expect(res.status).toBe(401);
      expect(res.error).toBe('Invalid credentials');
    });
  });

  describe('signUp', () => {
    it('requires valid email and minimum password length', async () => {
      const res = await signUp({ email: 'user@example.com', password: '123' });
      expect(res.ok).toBe(false);
      expect(res.error).toContain('at least 8 characters');
    });

    it('submits credentials to /api/auth/sign-up/email', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null),
        },
        json: async () => ({ user: { id: 'u2', email: 'new@example.com', name: 'New User' } }),
      });

      const res = await signUp(
        { email: 'new@example.com', password: 'strongpassword123', name: 'New User' },
        mockFetch as any,
      );
      expect(res.ok).toBe(true);
      expect(res.data?.user.id).toBe('u2');
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/auth/sign-up/email',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            email: 'new@example.com',
            password: 'strongpassword123',
            name: 'New User',
          }),
        }),
      );
    });
  });

  describe('signOut and getSession', () => {
    it('dispatches sign out to /api/auth/sign-out', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => null },
      });

      const res = await signOut(mockFetch as any);
      expect(res.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/auth/sign-out',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('checks session state and handles 401 as signed-out visitor', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: { get: () => null },
      });

      const res = await getSession(mockFetch as any);
      expect(res.ok).toBe(true);
      expect(res.data).toBeNull();
    });
  });
});
