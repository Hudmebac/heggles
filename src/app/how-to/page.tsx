
// src/app/how-to/page.tsx
"use client";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Brain, Mic, Radio, ListChecks, ClipboardList, Archive, Pin, Sparkles, HelpCircle, Volume2, PlayCircle, StopCircle } from 'lucide-react';

export default function HowToPage() {
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
          <AccordionTrigger className="text-xl font-semibold">Dashboard Usage</AccordionTrigger>
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
                <li>Processed thoughts appear here.</li>
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
              Key Text Commands (for the
              <Brain className="h-5 w-5 mx-1.5" />
              Button)
            </span>
          </AccordionTrigger>
          <AccordionContent className="space-y-2 pt-2 text-muted-foreground">
            <p>Type these commands into the "Input & Recall" text area (or get them there via continuous recording or in-card dictation) and then click the <Brain className="inline-block h-4 w-4 mx-0.5 align-middle" /> button.</p>
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
              <li><code>complete all tasks in to do list</code> (or <code>complete all to do list tasks</code>) - Marks all tasks in your to-do list as complete (confirmation).</li>
            </ul>
            <p className="mt-2"><strong>Note:</strong> For list additions/deletions, the AI might also suggest these actions if you type a more general thought and process it. You'll always be asked for confirmation.</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="item-3">
          <AccordionTrigger>
            <span className="text-xl font-semibold flex items-center">
              List Management (
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
                <li>Import/Export your lists (CSV, JSON, Excel, Text). Import buttons are on the list pages, Export is in the header.</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-foreground mb-1">To-Do List Specifics:</h4>
              <ul className="list-disc pl-5 space-y-1">
                <li>Set due dates and various time settings (All Day, AM/PM, specific start/end times).</li>
                <li>Reorder tasks using drag-and-drop or move buttons (when "Default Order" sort is active).</li>
                <li>Sort tasks by due date, alphabetically, or by priority.</li>
                <li>Visual reminders for overdue or upcoming tasks.</li>
                <li>Share list via Email or WhatsApp (To-Do list also offers .ics calendar export).</li>
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
              Memory Vault (
              <Archive className="h-5 w-5 mx-1.5" />)
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
          <AccordionTrigger className="text-xl font-semibold">AI Features & Clarification</AccordionTrigger>
          <AccordionContent className="space-y-2 pt-2 text-muted-foreground">
            <p>Heggles uses AI to enhance your thoughts (when processed by the <Brain className="inline-block h-4 w-4 align-middle mx-0.5"/> button):</p>
            <ul className="list-disc pl-5 space-y-1">
                <li><strong>Summarization & Keywords:</strong> Automatically generated for processed thoughts.</li>
                <li><strong>Refinement:</strong> The "Clarify" option (<Sparkles className="inline-block h-4 w-4 mx-0.5 align-middle" />) refines transcripts and extracts potential action items.</li>
                <li><strong>Intent Analysis:</strong> The AI tries to understand if your thought is a question or implies an action.
                    <ul className="list-circle pl-5 space-y-0.5 mt-1">
                        <li>If it's a question, the AI attempts to answer it (answer displayed in the thought card with a <Volume2 className="inline-block h-4 w-4 mx-0.5 align-middle" /> play button).</li>
                        <li>If it suggests an action for a list (or a system command like "clear shopping list"), you'll be prompted to confirm before the action is taken.</li>
                    </ul>
                </li>
            </ul>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
