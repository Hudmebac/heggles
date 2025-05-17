
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

const initialContextState: ThemeProviderState = {
  theme: 'light', 
  setTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialContextState);

export function ThemeProvider({
  children,
  defaultTheme = 'light',
  storageKey = 'hegsync-theme',
}: ThemeProviderProps) {
  const [storedThemeFromLocalStorage, setStoredThemeInLocalStorage] = useLocalStorage<Theme>(storageKey, defaultTheme);
  const [effectiveTheme, setEffectiveTheme] = useState<Theme>(defaultTheme);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) {
      setEffectiveTheme(storedThemeFromLocalStorage);
    }
  }, [mounted, storedThemeFromLocalStorage]);

  useEffect(() => {
    if (!mounted) {
      return;
    }

    const root = window.document.documentElement;
    root.classList.remove('light', 'dark', 'theme-high-contrast-light', 'theme-high-contrast-dark');

    if (effectiveTheme === 'dark') {
      root.classList.add('dark');
    } else if (effectiveTheme === 'high-contrast-light') {
      root.classList.add('theme-high-contrast-light');
    } else if (effectiveTheme === 'high-contrast-dark') {
      root.classList.add('theme-high-contrast-dark');
    } else { 
      root.classList.add('light');
    }
  }, [effectiveTheme, mounted]);

  const setTheme = (newTheme: Theme) => {
    setStoredThemeInLocalStorage(newTheme); 
    setEffectiveTheme(newTheme);
  };
  
  const contextThemeValue = mounted ? effectiveTheme : defaultTheme;

  return (
    <ThemeProviderContext.Provider value={{ theme: contextThemeValue, setTheme }}>
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
