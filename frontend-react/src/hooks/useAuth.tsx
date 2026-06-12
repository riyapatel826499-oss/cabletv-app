import { useState, useContext, createContext, type ReactNode } from 'react';
import { getStoredUser, login as apiLogin, logout as apiLogout } from '../api/auth';
import type { User } from '../types';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(getStoredUser());
  // Session is read synchronously from storage, so there's no async load gap.
  const [loading] = useState(false);

  const login = async (username: string, password: string) => {
    const res = await apiLogin({ username, password });
    localStorage.setItem('token', res.access_token);
    localStorage.setItem('user', JSON.stringify(res.user));
    setUser(res.user);
  };

  const logout = () => {
    apiLogout();
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        login,
        logout,
        loading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook colocated with its provider
export function useAuth() {
  return useContext(AuthContext);
}
