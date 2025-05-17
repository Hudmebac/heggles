
"use client";

import { Moon, Sun, Contrast } from 'lucide-react';
import { useTheme } from '@/components/theme/ThemeProvider';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Theme } from '@/lib/types';

export function ThemeSwitcher() {
  const { setTheme } = useTheme();

  const themes: { name: string; value: Theme; icon: JSX.Element }[] = [
    { name: 'Light', value: 'light', icon: <Sun className="mr-2 h-4 w-4" /> },
    { name: 'Dark', value: 'dark', icon: <Moon className="mr-2 h-4 w-4" /> },
    { name: 'High Contrast Light', value: 'high-contrast-light', icon: <Contrast className="mr-2 h-4 w-4" /> },
    { name: 'High Contrast Dark', value: 'high-contrast-dark', icon: <Contrast className="mr-2 h-4 w-4 text-primary-foreground" /> },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon">
          <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {themes.map((themeItem) => (
          <DropdownMenuItem key={themeItem.value} onClick={() => setTheme(themeItem.value)}>
            {themeItem.icon}
            {themeItem.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
