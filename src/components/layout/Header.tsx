
"use client"; 

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ThemeSwitcher } from '@/components/theme/ThemeSwitcher'; // Corrected import path
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { BrainCircuit, ListChecks, HelpCircle, Archive, LayoutDashboard } from 'lucide-react';

export function Header() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur-md">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 text-xl font-bold">
          <BrainCircuit className="h-7 w-7 text-primary" />
          Heggles
        </Link>
        <nav className="flex items-center gap-0.5 md:gap-1">
          <Button variant="ghost" asChild className="px-2 sm:px-3">
            <Link href="/" className="flex items-center">
              <LayoutDashboard className="h-5 w-5 sm:mr-1 md:mr-2" />
              <span className="hidden sm:inline">Dashboard</span>
            </Link>
          </Button>
          <Button variant="ghost" asChild className="px-2 sm:px-3">
            <Link href="/memory-vault" className="flex items-center">
              <Archive className="h-5 w-5 sm:mr-1 md:mr-2" />
              <span className="hidden sm:inline">Memory Vault</span>
            </Link>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="flex items-center px-2 sm:px-3">
                <ListChecks className="h-5 w-5 sm:mr-1 md:mr-2" />
                <span className="hidden sm:inline">Lists</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem asChild>
                <Link href="/shopping-list">Shopping List</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/to-do-list">To-Do List</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          
           <Button variant="ghost" asChild className="px-2 sm:px-3">
             <Link href="/how-to" className="flex items-center">
                <HelpCircle className="h-5 w-5 sm:mr-1 md:mr-2" />
               <span className="hidden sm:inline">How To</span>
             </Link>
           </Button>
          <ThemeSwitcher />
        </nav>
      </div>
    </header>
  );
}
