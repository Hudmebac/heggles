
"use client";

import type { Theme } from '@/lib/types';
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useLocalStorage } from '@/lib/hooks/useLocalStorage';

interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}

interface ThemeProviderState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const initialState: ThemeProviderState = {
  theme: 'light',
  setTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
  children,
  defaultTheme = 'light',
  storageKey = 'hegsync-theme',
}: ThemeProviderProps) {
  const [storedTheme, setStoredTheme] = useLocalStorage<Theme>(storageKey, defaultTheme);
  const [theme, setThemeState] = useState<Theme>(() => storedTheme || defaultTheme);

  useEffect(() => {
    setThemeState(storedTheme);
  }, [storedTheme]);

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark', 'theme-high-contrast-light', 'theme-high-contrast-dark');

    if (theme === 'system') { // 'system' theme can be added later if needed
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      root.classList.add(systemTheme);
      return;
    }
    
    if (theme === 'dark') {
      root.classList.add('dark');
    } else if (theme === 'high-contrast-light') {
      root.classList.add('theme-high-contrast-light');
    } else if (theme === 'high-contrast-dark') {
      root.classList.add('theme-high-contrast-dark');
    } else {
      root.classList.add('light'); // Default to light theme class
    }
  }, [theme]);

  const setTheme = (newTheme: Theme) => {
    setStoredTheme(newTheme);
    setThemeState(newTheme);
  };

  return (
    <ThemeProviderContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
