
import Link from 'next/link';
import { ThemeSwitcher } from '@/components/theme/ThemeSwitcher';
import { Button } from '@/components/ui/button';
import { BrainCircuit, ListChecks } from 'lucide-react';

export function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur-md">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 text-xl font-bold">
          <BrainCircuit className="h-7 w-7 text-primary" />
          HegSync
        </Link>
        <nav className="flex items-center gap-2 sm:gap-4">
          <Button variant="ghost" asChild>
            <Link href="/">Dashboard</Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link href="/memory-vault">Memory Vault</Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link href="/shopping-list" className="flex items-center">
              <ListChecks className="h-5 w-5 sm:mr-2" />
              <span className="hidden sm:inline">Shopping List</span>
            </Link>
          </Button>
          <ThemeSwitcher />
        </nav>
      </div>
    </header>
  );
}
