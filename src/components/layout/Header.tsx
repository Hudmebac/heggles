
"use client"; // Required for usePathname and client-side interactions

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ThemeSwitcher } from '@/components/theme/ThemeSwitcher';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { BrainCircuit, ListChecks, ClipboardList, HelpCircle, FileUp } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { LOCALSTORAGE_KEYS } from '@/lib/constants';
import type { ShoppingListItem, ToDoListItem } from '@/lib/types';
import {
  downloadShoppingListTemplate,
  exportShoppingList,
  downloadToDoListTemplate,
  exportToDoList
} from '@/lib/list-export-utils';

export function Header() {
  const { toast } = useToast();
  const pathname = usePathname();

  const isShoppingListPage = pathname === '/shopping-list';
  const isToDoListPage = pathname === '/to-do-list';

  const handleDownloadTemplate = (listType: 'shopping' | 'todo', format: 'csv' | 'excel' | 'json') => {
    if (listType === 'shopping') {
      downloadShoppingListTemplate(format);
    } else {
      downloadToDoListTemplate(format);
    }
    toast({ title: `${listType === 'shopping' ? 'Shopping' : 'To-Do'} List Template Downloaded`, description: `Format: ${format.toUpperCase()}` });
  };

  const handleExport = (listType: 'shopping' | 'todo', format: 'csv' | 'json' | 'excel') => {
    const key = listType === 'shopping' ? LOCALSTORAGE_KEYS.SHOPPING_LIST : LOCALSTORAGE_KEYS.TODO_LIST;
    try {
      const itemsString = localStorage.getItem(key);
      const items = itemsString ? JSON.parse(itemsString) : [];
      if (items.length === 0) {
        toast({ title: "List is Empty", description: `Cannot export an empty ${listType === 'shopping' ? 'Shopping' : 'To-Do'} list.`, variant: "default" });
        return;
      }
      if (listType === 'shopping') {
        exportShoppingList(items as ShoppingListItem[], format);
      } else {
        exportToDoList(items as ToDoListItem[], format);
      }
      toast({ title: `${listType === 'shopping' ? 'Shopping' : 'To-Do'} List Exported`, description: `Format: ${format.toUpperCase()}` });
    } catch (error) {
      toast({ title: "Export Error", description: `Could not export ${listType === 'shopping' ? 'Shopping' : 'To-Do'} list.`, variant: "destructive" });
      console.error("Export error:", error);
    }
  };

  const handleImport = (listType: 'shopping' | 'todo', format: 'csv' | 'json' | 'excel') => {
    const targetPage = listType === 'shopping' ? '/shopping-list' : '/to-do-list';
    console.log(`[Header] handleImport: listType=${listType}, format=${format}, current pathname=${pathname}, targetPage=${targetPage}`);

    if (pathname !== targetPage) {
      console.warn(`[Header] Import trigger attempted for ${listType} list from incorrect page: ${pathname}. Required: ${targetPage}`);
      toast({
        title: "Navigation Required",
        description: `Please navigate to the ${listType === 'shopping' ? 'Shopping List' : 'To-Do List'} page to import.`,
        variant: "default"
      });
      return;
    }
    
    const inputId = `import-${listType}-list-${format}`;
    console.log(`[Header] Constructed inputId: ${inputId}`);
    
    // Attempt to click after a very short delay to ensure DOM is ready
    setTimeout(() => {
        const fileInput = document.getElementById(inputId);
        console.log(`[Header] Attempting to find element with ID: ${inputId}. Found:`, fileInput);
        
        if (fileInput) {
          try {
            fileInput.click();
            console.log(`[Header] Successfully called click() on element ID: ${inputId}`);
          } catch (e) {
            console.error(`[Header] Error calling click() on element ID ${inputId}:`, e);
            toast({ title: "Import Click Error", description: `Failed to trigger file dialog. Error: ${(e as Error).message}`, variant: "destructive"});
          }
        } else {
          console.error(`[Header] File input element with ID '${inputId}' not found on page ${pathname}.`);
          toast({ title: "Import Error", description: `File input element for import was not found on the page. Please ensure you are on the correct list page. Expected ID: ${inputId}`, variant: "destructive"});
        }
    }, 0); // A timeout of 0 ms defers execution slightly
  };


  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur-md">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 text-xl font-bold">
          <BrainCircuit className="h-7 w-7 text-primary" />
          Heggles
        </Link>
        <nav className="flex items-center gap-1 sm:gap-0.5 md:gap-1">
          <Button variant="ghost" asChild>
            <Link href="/">Dashboard</Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link href="/memory-vault">Memory Vault</Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link href="/shopping-list" className="flex items-center">
              <ListChecks className="h-5 w-5 sm:mr-1 md:mr-2" />
              <span className="hidden sm:inline">Shopping</span>
            </Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link href="/to-do-list" className="flex items-center">
              <ClipboardList className="h-5 w-5 sm:mr-1 md:mr-2" />
              <span className="hidden sm:inline">To-Do</span>
            </Link>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="flex items-center px-2 sm:px-3">
                <FileUp className="h-5 w-5 sm:mr-1 md:mr-2" />
                <span className="hidden sm:inline">Import/Export</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Shopping List</DropdownMenuLabel>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Download Template</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={() => handleDownloadTemplate('shopping', 'csv')}>CSV</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleDownloadTemplate('shopping', 'json')}>JSON</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleDownloadTemplate('shopping', 'excel')}>Excel</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Export List</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={() => handleExport('shopping', 'csv')}>CSV</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport('shopping', 'json')}>JSON</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport('shopping', 'excel')}>Excel</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={!isShoppingListPage}>Import</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={() => handleImport('shopping', 'csv')} disabled={!isShoppingListPage}>CSV</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleImport('shopping', 'json')} disabled={!isShoppingListPage}>JSON</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleImport('shopping', 'excel')} disabled={!isShoppingListPage}>Excel</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuSeparator />
              <DropdownMenuLabel>To-Do List</DropdownMenuLabel>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Download Template</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={() => handleDownloadTemplate('todo', 'csv')}>CSV</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleDownloadTemplate('todo', 'json')}>JSON</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleDownloadTemplate('todo', 'excel')}>Excel</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Export List</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={() => handleExport('todo', 'csv')}>CSV</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport('todo', 'json')}>JSON</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport('todo', 'excel')}>Excel</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={!isToDoListPage}>Import</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={() => handleImport('todo', 'csv')} disabled={!isToDoListPage}>CSV</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleImport('todo', 'json')} disabled={!isToDoListPage}>JSON</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleImport('todo', 'excel')} disabled={!isToDoListPage}>Excel</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>
          
          <Button variant="ghost" asChild>
             <Link href="/how-to" className="flex items-center px-2 sm:px-3">
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
