import { describe, it, expect, vi } from 'vitest';
import {
  sameOriginPath,
  signIn,
  signInWithGoogle,
  signUp,
  signOut,
} from './authClient';

describe('sameOriginPath', () => {
  it('keeps only same-origin paths', () => {
    expect(sameOriginPath('/?page=graph', 'http://localhost:3000')).toBe('/?page=graph');
    expect(sameOriginPath('http://localhost:3000/x?y=1', 'http://localhost:3000')).toBe(
      '/x?y=1',
    );
  });

  it('rejects other origins and protocol-relative URLs', () => {
    expect(sameOriginPath('https://evil.example/steal', 'http://localhost:3000')).toBe('/');
    expect(sameOriginPath('//evil.example/steal', 'http://localhost:3000')).toBe('/');
    expect(sameOriginPath(undefined, 'http://localhost:3000')).toBe('/');
  });
});

describe('signInWithGoogle', () => {
  it('asks for the provider URL with a same-origin callback and no auto redirect', async () => {
    const client = {
      signIn: {
        social: vi.fn().mockResolvedValue({
          data: { url: 'https://accounts.google.com/o/oauth2/auth?x=1', redirect: false },
          error: null,
        }),
      },
    } as any;

    const res = await signInWithGoogle('https://evil.example/steal', client);

    expect(res.ok).toBe(true);
    expect(res.data?.url).toBe('https://accounts.google.com/o/oauth2/auth?x=1');
    expect(client.signIn.social).toHaveBeenCalledWith({
      provider: 'google',
      callbackURL: '/',
      disableRedirect: true,
    });
  });

  it('surfaces a provider error and a missing redirect URL', async () => {
    const errored = {
      signIn: {
        social: vi.fn().mockResolvedValue({ data: null, error: { message: 'Provider disabled' } }),
      },
    } as any;
    const res1 = await signInWithGoogle('/', errored);
    expect(res1.ok).toBe(false);
    expect(res1.error).toBe('Provider disabled');

    const empty = {
      signIn: { social: vi.fn().mockResolvedValue({ data: {}, error: null }) },
    } as any;
    const res2 = await signInWithGoogle('/', empty);
    expect(res2.ok).toBe(false);
    expect(res2.error).toContain('redirect URL');
  });
});

describe('authClient', () => {
  describe('signIn', () => {
    it('validates email and password inputs', async () => {
      const client = { signIn: { email: vi.fn() } } as any;
      const res1 = await signIn({ email: '@', password: '123' }, client);
      expect(res1.ok).toBe(false);
      expect(res1.error).toContain('valid email');
      expect(client.signIn.email).not.toHaveBeenCalled();

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
      const client = { signUp: { email: vi.fn() } } as any;
      const invalid = await signUp({ email: 'user@', password: 'password123' }, client);
      expect(invalid.ok).toBe(false);
      expect(invalid.error).toContain('valid email');
      expect(client.signUp.email).not.toHaveBeenCalled();

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
