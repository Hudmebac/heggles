
// src/app/how-to/page.tsx
"use client";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Brain, Mic, Radio, ListChecks, ClipboardList, Archive, Pin, Sparkles, HelpCircle, Volume2, FileUp, Download } from 'lucide-react';
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
} from "@/components/ui/dropdown-menu";
import { useToast } from '@/hooks/use-toast';
import { LOCALSTORAGE_KEYS } from '@/lib/constants';
import type { ShoppingListItem, ToDoListItem } from '@/lib/types';
import {
  downloadShoppingListTemplate,
  exportShoppingList,
  downloadToDoListTemplate,
  exportToDoList
} from '@/lib/list-export-utils';

export default function HowToPage() {
  const { toast } = useToast();

  const handleDownloadTemplate = (listType: 'shopping' | 'todo', format: 'csv' | 'excel' | 'json' | 'text') => {
    if (listType === 'shopping') {
      downloadShoppingListTemplate(format);
    } else {
      downloadToDoListTemplate(format);
    }
    toast({ title: `${listType === 'shopping' ? 'Shopping' : 'To-Do'} List Template Downloaded`, description: `Format: ${format.toUpperCase()}` });
  };

  const handleExport = (listType: 'shopping' | 'todo', format: 'csv' | 'json' | 'excel' | 'text') => {
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

  return (
    <div className="space-y-8 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <HelpCircle className="h-10 w-10 text-primary" />
        <h1 className="text-4xl font-bold tracking-tight">How to Use Heggles</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Core Concept</CardTitle>
          <CardDescription>
            Heggles helps you capture, organise, and recall your thoughts with the new improved Heggle brain.
            Use the Dashboard for quick input and 'Heggle' processing, manage your lists, and store important thoughts in the Memory Vault.
          </CardDescription>
        </CardHeader>
      </Card>

      <Accordion type="single" collapsible className="w-full">
        <AccordionItem value="item-1">
          <AccordionTrigger className="text-xl font-semibold">
            <span className="flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-layout-dashboard mr-2"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7"height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>
              Dashboard Usage
            </span>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pt-2 text-muted-foreground">
            <p>The Dashboard is your central hub for inputting thoughts. All voice input methods populate the "Input & Recall" text area, which is then processed by clicking the <Brain className="inline-block h-4 w-4 mx-0.5 align-middle" /> button.</p>
            <div>
              <h4 className="font-semibold text-foreground mb-1">Continuous Voice Recording (Header Microphone):</h4>
              <ul className="list-disc pl-5 space-y-1">
                <li>Click the <Mic className="inline-block h-4 w-4 mx-0.5 align-middle" /> icon in the header to start continuous voice recording.</li>
                <li>The icon will change to a pulsing <Radio className="inline-block h-4 w-4 mx-0.5 align-middle text-red-500" />.</li>
                <li>Speak your thoughts. When you're done, click the <Radio className="inline-block h-4 w-4 mx-0.5 align-middle text-red-500" /> icon again to stop.</li>
                <li>Your transcribed speech will appear in the "Input & Recall" text area. Click the <Brain className="inline-block h-4 w-4 mx-0.5 align-middle" /> button to process it.</li>
              </ul>
            </div>
             <div>
              <h4 className="font-semibold text-foreground mb-1">Dictation into Input Area (In-Card Microphone):</h4>
              <ul className="list-disc pl-5 space-y-1">
                <li>In the "Input & Recall" card, click the <Mic className="inline-block h-4 w-4 mx-0.5 align-middle" /> icon button.</li>
                <li>The icon will change to a pulsing <Radio className="inline-block h-4 w-4 mx-0.5 align-middle text-red-500" />.</li>
                <li>Dictate your thought. The text will appear live in the input area.</li>
                <li>To stop dictation, click the <Radio className="inline-block h-4 w-4 mx-0.5 align-middle text-red-500" /> icon again, say "Heggles end" or "Heggles stop", or pause speaking for 2 seconds.</li>
                <li>Once dictation is complete, click the <Brain className="inline-block h-4 w-4 mx-0.5 align-middle" /> button to process the text.</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-foreground mb-1">Text Input & AI Processing:</h4>
              <ul className="list-disc pl-5 space-y-1">
                <li>You can directly type or paste text into the "Input & Recall" text area.</li>
                <li>Once your text (typed, from continuous recording, or from in-card dictation) is in the text area, click the <Brain className="inline-block h-4 w-4 mx-0.5 align-middle" /> icon button.</li>
                <li>Heggles will process this text:
                  <ul className="list-circle pl-5 space-y-0.5 mt-1">
                    <li>If it recognizes a command (see "Text Commands" below), it will ask for confirmation and then perform the action.</li>
                    <li>If the text is "heggles replay that", it will initiate a 10-second live audio recording and transcription, then process that result.</li>
                    <li>Otherwise, it will treat the text as a general thought, analyze it with AI (for summary, keywords, potential actions, or answers to questions), and display the result in "Recent Thoughts."</li>
                  </ul>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-foreground mb-1">Recent Thoughts:</h4>
              <ul className="list-disc pl-5 space-y-1">
                <li>Processed thoughts appear here. Max 15 shown.</li>
                <li>Each thought card shows the original text, AI summary, keywords, and any AI-identified actions or answers.</li>
                <li><Pin className="inline-block h-4 w-4 mx-0.5 align-middle" />: Pin a thought to save it to your Memory Vault.</li>
                <li><Sparkles className="inline-block h-4 w-4 mx-0.5 align-middle" />: Clarify a thought with AI to refine its transcript and identify action items.</li>
                <li>You can delete thoughts from this list.</li>
              </ul>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="item-2">
          <AccordionTrigger>
            <span className="text-xl font-semibold flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" className="lucide lucide-terminal mr-2"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>
              Key Text Commands (for the
              <Brain className="h-5 w-5 mx-1.5" />
              Button)
            </span>
          </AccordionTrigger>
          <AccordionContent className="space-y-2 pt-2 text-muted-foreground">
            <p>Type these commands into the "Input & Recall" text area on the Dashboard and then click the <Brain className="inline-block h-4 w-4 mx-0.5 align-middle" /> button.</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><code>heggles replay that</code> - Initiates a 10-second live audio recording & transcription, then processes the result with AI.</li>
              <li><code>heggles add [item name] to my shopping list</code> - Adds the item to your shopping list (will ask for confirmation).</li>
              <li><code>heggles add [task name] to my to do list</code> - Adds the task to your to-do list (will ask for confirmation).</li>
              <li><code>heggles delete [item name] from my shopping list</code> - Deletes by name (confirmation).</li>
              <li><code>heggles delete item number [X] from my shopping list</code> - Deletes by number (confirmation).</li>
              <li><code>heggles delete [task name] from my to do list</code> - Deletes by name (confirmation).</li>
              <li><code>heggles delete item number [X] from my to do list</code> - Deletes by number (confirmation).</li>
              <li><code>empty recent thoughts</code> - Clears all thoughts from the "Recent Thoughts" list on the dashboard (confirmation).</li>
              <li><code>clear shopping list</code> - Removes all items from your shopping list (confirmation).</li>
              <li><code>complete all tasks in to do list</code> (or <code>complete all to do list</code>) - Marks all tasks in your to-do list as complete (confirmation).</li>
            </ul>
            <p className="mt-2"><strong>Note:</strong> For list additions/deletions, the AI might also suggest these actions if you type a more general thought and process it. You'll always be asked for confirmation.</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="item-3">
          <AccordionTrigger>
            <span className="text-xl font-semibold flex items-center">
              <ListChecks className="h-5 w-5 mx-1.5" />
              Shopping &amp;
              <ClipboardList className="h-5 w-5 mx-1.5" />
              To-Do)
            </span>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pt-2 text-muted-foreground">
            <p>Access these lists from the header.</p>
            <div>
              <h4 className="font-semibold text-foreground mb-1">Common Features:</h4>
              <ul className="list-disc pl-5 space-y-1">
                <li>Add items manually using the input field.</li>
                <li>Use the <Mic className="inline-block h-4 w-4 mx-0.5 align-middle" /> icon next to the input field for voice dictation to fill the field. Say "Heggles end" or "Heggles stop" to finish dictation, or pause for 2 seconds.</li>
                <li>Mark items as complete.</li>
                <li>Edit item text.</li>
                <li>Delete items.</li>
                <li>Import items via the "Import" button on each list page (supports CSV, JSON, Excel, Text).</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-foreground mb-1">To-Do List Specifics:</h4>
              <ul className="list-disc pl-5 space-y-1">
                <li>Set due dates and various time settings (All Day, AM/PM, specific start/end times).</li>
                <li>Reorder tasks using drag-and-drop or move buttons (when "Default Order" sort is active).</li>
                <li>Sort tasks by due date, alphabetically, or by priority.</li>
                <li>Visual reminders for overdue or upcoming tasks.</li>
                <li>Share list via Email or WhatsApp. Includes an option to download an .ics calendar file for tasks with due dates.</li>
              </ul>
            </div>
             <div>
              <h4 className="font-semibold text-foreground mb-1">Shopping List Specifics:</h4>
              <ul className="list-disc pl-5 space-y-1">
                 <li>Share list via Email or WhatsApp.</li>
              </ul>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="item-4">
          <AccordionTrigger>
            <span className="text-xl font-semibold flex items-center">
              <Archive className="h-5 w-5 mx-1.5" />Memory Vault
            </span>
          </AccordionTrigger>
          <AccordionContent className="space-y-2 pt-2 text-muted-foreground">
            <p>The Memory Vault stores thoughts you've pinned for long-term recall.</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Pin thoughts from the "Recent Thoughts" list on the Dashboard.</li>
              <li>Pinned thoughts automatically get AI-suggested categories.</li>
              <li>Search and filter your pinned thoughts by keywords or categories.</li>
              <li>Clarify pinned thoughts further with AI.</li>
              <li>Unpin thoughts to remove them from the vault.</li>
            </ul>
          </AccordionContent>
        </AccordionItem>

         <AccordionItem value="item-5">
          <AccordionTrigger className="text-xl font-semibold">
            <span className="flex items-center">
                <Sparkles className="h-5 w-5 mx-1.5" /> AI Features & Clarification
            </span>
            </AccordionTrigger>
          <AccordionContent className="space-y-2 pt-2 text-muted-foreground">
            <p>Heggles uses AI to enhance your thoughts when processed by the <Brain className="inline-block h-4 w-4 align-middle mx-0.5"/> button on the Dashboard:</p>
            <ul className="list-disc pl-5 space-y-1">
                <li><strong>Summarization & Keywords:</strong> Automatically generated for processed thoughts.</li>
                <li><strong>Refinement:</strong> The "Clarify" option (<Sparkles className="inline-block h-4 w-4 mx-0.5 align-middle" />) on a thought card refines its transcript and identifies potential action items.</li>
                <li><strong>Intent Analysis:</strong> The AI tries to understand if your thought is a question or implies an action.
                    <ul className="list-circle pl-5 space-y-0.5 mt-1">
                        <li>If it's a question, the AI attempts to answer it (answer displayed in the thought card with a <Volume2 className="inline-block h-4 w-4 mx-0.5 align-middle" /> play button). If the AI can't answer, it might suggest searching on Google or exploring in Google AI Studio.</li>
                        <li>If it's a request for directions, it will suggest opening Google Maps.</li>
                        <li>If it's a creative request (e.g., "write a poem"), it will suggest using Google AI Studio.</li>
                        <li>If it suggests an action for a list (e.g., "add milk to shopping list") or a system command (e.g., "clear shopping list"), you'll be prompted to confirm before the action is taken.</li>
                    </ul>
                </li>
            </ul>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="item-6">
          <AccordionTrigger>
            <span className="text-xl font-semibold flex items-center">
              <FileUp className="h-5 w-5 mx-1.5" /> Exporting Your Data
            </span>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pt-2 text-muted-foreground">
            <p>You can export your Shopping List and To-Do List data in various formats. You can also download templates to help with importing data.</p>
            <div className="flex justify-center">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="h-10" aria-label="Export Data or Download Templates">
                    <FileUp className="mr-2 h-5 w-5" /> Export / Download Templates
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center" className="w-56">
                  <DropdownMenuLabel>Shopping List</DropdownMenuLabel>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>Download Template</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem onClick={() => handleDownloadTemplate('shopping', 'csv')}>CSV</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleDownloadTemplate('shopping', 'json')}>JSON</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleDownloadTemplate('shopping', 'excel')}>Excel</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleDownloadTemplate('shopping', 'text')}>Text (.txt)</DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>Export List</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem onClick={() => handleExport('shopping', 'csv')}>CSV</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleExport('shopping', 'json')}>JSON</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleExport('shopping', 'excel')}>Excel</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleExport('shopping', 'text')}>Text (.txt)</DropdownMenuItem>
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
                      <DropdownMenuItem onClick={() => handleDownloadTemplate('todo', 'text')}>Text (.txt)</DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>Export List</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem onClick={() => handleExport('todo', 'csv')}>CSV</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleExport('todo', 'json')}>JSON</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleExport('todo', 'excel')}>Excel</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleExport('todo', 'text')}>Text (.txt)</DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <p className="text-sm">Importing data can be done directly on the <Link href="/shopping-list" className="text-primary hover:underline">Shopping List</Link> or <Link href="/to-do-list" className="text-primary hover:underline">To-Do List</Link> pages using their respective "Import" buttons.</p>
          </AccordionContent>
        </AccordionItem>

      </Accordion>
    </div>
  );
}
