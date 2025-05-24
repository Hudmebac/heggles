
"use client";

import React, { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Brain, Loader2, Mic, Radio, AlertTriangleIcon, MicOff, PlayCircle, StopCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription as UiAlertDescription, AlertTitle as UiAlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { processTextThought, processRecordedAudio } from '@/lib/actions';
import type { Thought, PinnedThought, ShoppingListItem, ToDoListItem, IntentAnalysisOutput } from '@/lib/types';
import { WAKE_WORDS, LOCALSTORAGE_KEYS, RECORDING_DURATION_MS } from '@/lib/constants';

interface ThoughtInputFormProps {
  onThoughtRecalled: (thought: Thought) => void;
  onEmptyRecalledThoughts: () => void;
  isExternallyHeaderDictating: boolean; 
  onStopHeaderDictationParent: () => void; 
}

export interface ThoughtInputFormHandle {
  startHeaderDictation: () => Promise<boolean>; 
  stopHeaderDictation: () => void;        
}

interface AlertDialogConfigType {
  title: string;
  description: React.ReactNode;
  itemText?: string;
  listKey?: string;
  listName?: string;
  dataToRecallOnCancel?: Omit<Thought, "id" | "timestamp">; 
  onConfirm: () => void;
  actionLabel?: string;
}

export const ThoughtInputForm = forwardRef<ThoughtInputFormHandle, ThoughtInputFormProps>(
  ({ onThoughtRecalled, onEmptyRecalledThoughts, isExternallyHeaderDictating, onStopHeaderDictationParent }, ref) => {
    const [inputText, setInputText] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const { toast } = useToast();
    
    const [hasMicPermission, setHasMicPermission] = useState<boolean | null>(null);
    const [isBrowserUnsupported, setIsBrowserUnsupported] = useState(false);

    // For "heggles replay that" (10s snippet recording & transcription) initiated by Brain button
    const [isCapturingAudioForSnippet, setIsCapturingAudioForSnippet] = useState(false);
    const snippetMediaRecorderRef = useRef<MediaRecorder | null>(null);
    const snippetRecognitionRef = useRef<SpeechRecognition | null>(null);
    const snippetTranscriptRef = useRef<string>('');
    const snippetAudioChunksRef = useRef<Blob[]>([]);
    
    // Header dictation (controlled by parent/header button)
    const [isHeaderDictationActiveInternal, setIsHeaderDictationActiveInternal] = useState(false);
    const headerDictationRecognitionRef = useRef<SpeechRecognition | null>(null);
    const headerDictationPauseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const headerDictationFinalTranscriptRef = useRef<string>('');

    // Dashboard dictation mic (in-card mic button)
    const [isDashboardDictationActive, setIsDashboardDictationActive] = useState(false);
    const dashboardDictationRecognitionRef = useRef<SpeechRecognition | null>(null);
    const dashboardDictationPauseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const dashboardDictationFinalTranscriptRef = useRef<string>(''); 
    const triggerProcessAfterDictationRef = useRef(false);
        
    const [alertDialogConfig, setAlertDialogConfig] = useState<AlertDialogConfigType | null>(null);
    const [isAlertDialogOpen, setIsAlertDialogOpen] = useState(false);
    const confirmedDialogActionRef = useRef(false);


    const addListItem = useCallback((listKey: string, itemTextToAdd: string, listName: string) => {
      const item = itemTextToAdd.trim();
      if (!item) {
        toast({ title: "No item specified", description: `Please specify the item to add to ${listName}.`, variant: "default" });
        return;
      }
      try {
        const currentItemsString = localStorage.getItem(listKey);
        let currentItems: Array<ShoppingListItem | ToDoListItem> = currentItemsString ? JSON.parse(currentItemsString) : [];

        if (listKey === LOCALSTORAGE_KEYS.SHOPPING_LIST) {
          const newItem: ShoppingListItem = { id: crypto.randomUUID(), text: item, completed: false };
          currentItems = [...currentItems, newItem] as ShoppingListItem[];
        } else if (listKey === LOCALSTORAGE_KEYS.TODO_LIST) {
          const newItem: ToDoListItem = {
            id: crypto.randomUUID(),
            text: item,
            completed: false,
            timeSettingType: 'not_set',
            startTime: null,
            endTime: null,
            dueDate: null
          };
          currentItems = [...currentItems, newItem] as ToDoListItem[];
        }

        localStorage.setItem(listKey, JSON.stringify(currentItems));
        window.dispatchEvent(new StorageEvent('storage', { key: listKey, newValue: JSON.stringify(currentItems) }));
        toast({ title: "Item Added", description: `"${item}" added to your ${listName}.` });
      } catch (error) {
        console.error(`Error adding to ${listName}:`, error);
        toast({ title: `Error updating ${listName}`, description: "Could not save the item.", variant: "destructive" });
      }
    }, [toast]);

    const deleteListItem = useCallback((listKey: string, identifier: string | number, listName: string) => {
      try {
        const currentItemsString = localStorage.getItem(listKey);
        if (!currentItemsString) {
          toast({ title: "List not found", description: `The ${listName} is empty.`, variant: "default" });
          return;
        }
        let currentItems: Array<ShoppingListItem | ToDoListItem> = JSON.parse(currentItemsString);
        let itemDeleted = false;
        let deletedItemText = "";

        if (typeof identifier === 'number') {
          const indexToDelete = identifier - 1;
          if (indexToDelete >= 0 && indexToDelete < currentItems.length) {
            deletedItemText = currentItems[indexToDelete].text;
            currentItems.splice(indexToDelete, 1);
            itemDeleted = true;
          } else {
            toast({ title: "Invalid Item Number", description: `Item number ${identifier} not found in ${listName}.`, variant: "default" });
          }
        } else {
          const lowerIdentifier = identifier.toLowerCase();
          const itemFound = currentItems.find(item => item.text.toLowerCase() === lowerIdentifier);
          if (itemFound) deletedItemText = itemFound.text;

          const originalLength = currentItems.length;
          currentItems = currentItems.filter(item => item.text.toLowerCase() !== lowerIdentifier);
          if (currentItems.length < originalLength) {
            itemDeleted = true;
          } else {
            toast({ title: "Item Not Found", description: `"${identifier}" not found in ${listName}.`, variant: "default" });
          }
        }

        if (itemDeleted) {
          localStorage.setItem(listKey, JSON.stringify(currentItems));
          window.dispatchEvent(new StorageEvent('storage', { key: listKey, newValue: JSON.stringify(currentItems) }));
          toast({ title: "Item Deleted", description: `"${deletedItemText}" removed from your ${listName}.` });
        }
      } catch (error) {
        console.error(`Error deleting from ${listName}:`, error);
        toast({ title: `Error updating ${listName}`, description: "Could not delete the item.", variant: "destructive" });
      }
    }, [toast]);
    
    const clearShoppingList = useCallback(() => {
        localStorage.setItem(LOCALSTORAGE_KEYS.SHOPPING_LIST, JSON.stringify([]));
        window.dispatchEvent(new StorageEvent('storage', { key: LOCALSTORAGE_KEYS.SHOPPING_LIST, newValue: JSON.stringify([]) }));
        toast({ title: "Shopping List Cleared" });
    }, [toast]);

    const completeAllToDoTasks = useCallback(() => {
        try {
            const currentItemsString = localStorage.getItem(LOCALSTORAGE_KEYS.TODO_LIST);
            let currentItems: ToDoListItem[] = currentItemsString ? JSON.parse(currentItemsString) : [];
            const updatedItems = currentItems.map(item => ({ ...item, completed: true }));
            localStorage.setItem(LOCALSTORAGE_KEYS.TODO_LIST, JSON.stringify(updatedItems));
            window.dispatchEvent(new StorageEvent('storage', { key: LOCALSTORAGE_KEYS.TODO_LIST, newValue: JSON.stringify(updatedItems) }));
            toast({ title: "All To-Do Tasks Marked Complete" });
        } catch (error) {
            toast({ title: "Error Updating To-Do List", variant: "destructive" });
        }
    }, [toast]);


    const startAudioRecordingForSnippet = useCallback(async () => {
      if (isBrowserUnsupported || hasMicPermission === false) {
        toast({ title: "Mic Unavailable for Snippet", variant: "destructive" }); return;
      }
      if (isLoading || isCapturingAudioForSnippet || isDashboardDictationActive || isHeaderDictationActiveInternal) {
        toast({ title: "System Busy for Snippet", description: "Another audio process is active.", variant: "default" }); return;
      }
      
      const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognitionAPI || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          toast({ title: "Browser Not Supported for Recording", variant: "destructive" });
          return;
      }
      
      setIsLoading(true);
      setIsCapturingAudioForSnippet(true);
      toast({ title: "Recording 10s Audio & Speech...", description: "Recording live audio & speech for AI processing." });
      
      snippetAudioChunksRef.current = [];
      snippetTranscriptRef.current = '';

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        snippetMediaRecorderRef.current = new MediaRecorder(stream);
        snippetMediaRecorderRef.current.ondataavailable = (event) => {
          if (event.data.size > 0) snippetAudioChunksRef.current.push(event.data);
        };

        snippetMediaRecorderRef.current.onstop = async () => {
          stream.getTracks().forEach(track => track.stop()); 
          const audioBlob = new Blob(snippetAudioChunksRef.current, { type: 'audio/webm' }); 
          const reader = new FileReader();
          reader.readAsDataURL(audioBlob);
          reader.onloadend = async () => {
            const base64AudioData = reader.result as string;
            const liveTranscript = snippetTranscriptRef.current.trim();
            snippetTranscriptRef.current = ''; 
            
            try {
              const processedData = await processRecordedAudio(base64AudioData, liveTranscript || "No speech detected during recording.");
              onThoughtRecalled({ id: crypto.randomUUID(), timestamp: Date.now(), ...processedData });
              toast({ title: "Recorded Snippet Processed" });
            } catch (error) {
              toast({ title: "Error Processing Snippet", description: (error as Error).message, variant: "destructive" });
            } finally {
              setIsLoading(false);
              setIsCapturingAudioForSnippet(false);
            }
          };
          snippetAudioChunksRef.current = [];
        };

        snippetRecognitionRef.current = new SpeechRecognitionAPI();
        const localSnippetRecognizer = snippetRecognitionRef.current; 
        localSnippetRecognizer.continuous = true; 
        localSnippetRecognizer.interimResults = true;
        localSnippetRecognizer.lang = 'en-US';
        
        localSnippetRecognizer.onresult = (event: SpeechRecognitionEvent) => {
          let fullTranscriptThisSnippetSession = "";
            for (let i = 0; i < event.results.length; ++i) { 
                fullTranscriptThisSnippetSession += event.results[i][0].transcript;
            }
            snippetTranscriptRef.current = fullTranscriptThisSnippetSession.trim();
        };
        
        localSnippetRecognizer.onerror = (event: SpeechRecognitionErrorEvent) => {
          console.warn("Snippet speech recognition error:", event.error, event.message);
          if (event.error !== 'aborted' && event.error !== 'no-speech') {
            toast({title: "Snippet Transcription Error", description: event.message, variant: "destructive"});
          }
        };

        localSnippetRecognizer.onend = () => {
          snippetRecognitionRef.current = null; 
        };

        snippetMediaRecorderRef.current.start();
        localSnippetRecognizer.start();

        setTimeout(() => {
          if (snippetMediaRecorderRef.current?.state === "recording") {
            snippetMediaRecorderRef.current.stop();
          }
          if (snippetRecognitionRef.current) { 
            try { snippetRecognitionRef.current.stop(); } catch (e) {/* ignore */}
          }
        }, RECORDING_DURATION_MS);

      } catch (err) {
        console.error("Error starting audio snippet recording:", err);
        toast({ title: "Audio Snippet Error", description: (err as Error).message, variant: "destructive" });
        setIsLoading(false);
        setIsCapturingAudioForSnippet(false);
      }
    }, [
      hasMicPermission, isLoading, isCapturingAudioForSnippet, isDashboardDictationActive, isHeaderDictationActiveInternal, 
      toast, onThoughtRecalled, isBrowserUnsupported
    ]);
    
    const actuallyProcessInputText = useCallback(async (textToProcess: string) => {
      if (!textToProcess.trim()) {
        toast({ title: "Input empty", variant: "destructive" });
        setIsLoading(false);
        return;
      }
      
      confirmedDialogActionRef.current = false; 
      let dialogShownForAISuggestion = false;
      let actionExecutedWithoutDialog = false;

      const hegglesBaseLower = WAKE_WORDS.HEGGLES_BASE.toLowerCase();
      const lowerText = textToProcess.toLowerCase();
      
      if (lowerText === WAKE_WORDS.HEGGLES_REPLAY_THAT.toLowerCase()) {
        await startAudioRecordingForSnippet(); 
        setInputText(''); 
        return; 
      }

      const shoppingListAddPattern = new RegExp(`^${hegglesBaseLower}\\s+${WAKE_WORDS.HEGGLES_ADD_TO_SHOPPING_LIST_PREFIX.substring(hegglesBaseLower.length).trim().toLowerCase()}\\s+(.+?)(?:\\s+${WAKE_WORDS.TO_SHOPPING_LIST_SUFFIX_REGEX_PART.toLowerCase()})?$`);
      const shoppingListAddMatch = lowerText.match(shoppingListAddPattern);
      
      const todoListAddPattern = new RegExp(`^${hegglesBaseLower}\\s+${WAKE_WORDS.HEGGLES_ADD_TO_TODO_LIST_PREFIX.substring(hegglesBaseLower.length).trim().toLowerCase()}\\s+(.+?)(?:\\s+${WAKE_WORDS.TO_TODO_LIST_SUFFIX_REGEX_PART.toLowerCase()})?$`);
      const todoListAddMatch = lowerText.match(todoListAddPattern);
            
      const deleteListPattern = new RegExp(`^${hegglesBaseLower}\\s+${WAKE_WORDS.DELETE_ITEM_PREFIX.toLowerCase()}\\s+(.*?)(?:\\s+${WAKE_WORDS.FROM_SHOPPING_LIST_TRIGGER.toLowerCase()}|\\s+${WAKE_WORDS.FROM_TODO_LIST_TRIGGER.toLowerCase()})$`);
      const deleteListMatch = lowerText.match(deleteListPattern);

      const emptyRecentPattern = new RegExp(`^${WAKE_WORDS.EMPTY_RECENT_THOUGHTS_COMMAND.toLowerCase()}$`);
      const clearShoppingPattern = new RegExp(`^${WAKE_WORDS.CLEAR_SHOPPING_LIST_COMMAND.toLowerCase()}$`);
      const completeAllPrefixLower = WAKE_WORDS.COMPLETE_ALL_TASKS_PREFIX.toLowerCase();
      const completeAllSuffixTodoLower = WAKE_WORDS.COMPLETE_ALL_TASKS_COMMAND_SUFFIX_TODO.toLowerCase();
      const completeAllSuffixTodosLower = WAKE_WORDS.COMPLETE_ALL_TASKS_COMMAND_SUFFIX_TODOS.toLowerCase();

      if (shoppingListAddMatch && shoppingListAddMatch[1]) {
        const item = shoppingListAddMatch[1].trim();
        setAlertDialogConfig({
          title: "Add to Shopping List?",
          description: <>Do you want to add <strong>"{item}"</strong> to your shopping list?</>,
          itemText: item, listKey: LOCALSTORAGE_KEYS.SHOPPING_LIST, listName: "Shopping List",
          onConfirm: () => { addListItem(LOCALSTORAGE_KEYS.SHOPPING_LIST, item, "Shopping List"); }, actionLabel: "Add Item"
        });
        setIsAlertDialogOpen(true); return; 
      } else if (todoListAddMatch && todoListAddMatch[1]) {
        const task = todoListAddMatch[1].trim();
        setAlertDialogConfig({
          title: "Add to To-Do List?",
          description: <>Do you want to add <strong>"{task}"</strong> to your to-do list?</>,
          itemText: task, listKey: LOCALSTORAGE_KEYS.TODO_LIST, listName: "To-Do List",
          onConfirm: () => { addListItem(LOCALSTORAGE_KEYS.TODO_LIST, task, "To-Do List"); }, actionLabel: "Add Task"
        });
        setIsAlertDialogOpen(true); return;
      } else if (deleteListMatch && deleteListMatch[1]) {
        const itemIdentifierStr = deleteListMatch[1].trim();
        let listKey = ""; let listName = "";
        if (lowerText.includes(WAKE_WORDS.FROM_SHOPPING_LIST_TRIGGER.toLowerCase())) { listKey = LOCALSTORAGE_KEYS.SHOPPING_LIST; listName = "Shopping List"; } 
        else if (lowerText.includes(WAKE_WORDS.FROM_TODO_LIST_TRIGGER.toLowerCase())) { listKey = LOCALSTORAGE_KEYS.TODO_LIST; listName = "To-Do List"; }

        if (listKey && itemIdentifierStr) {
          const itemNumberPrefixLower = WAKE_WORDS.ITEM_NUMBER_PREFIX.toLowerCase();
          let isDeletingByNumber = false; let itemNumberToDelete = -1; let itemNameToDelete = itemIdentifierStr;
          if (itemIdentifierStr.toLowerCase().startsWith(itemNumberPrefixLower)) {
            const numberStr = itemIdentifierStr.substring(itemNumberPrefixLower.length).trim();
            itemNumberToDelete = parseInt(numberStr, 10);
            if (!isNaN(itemNumberToDelete) && itemNumberToDelete > 0) isDeletingByNumber = true;
            else { toast({ title: "Invalid Item Number", description: `"${numberStr}" is not valid.`, variant: "default" }); setIsLoading(false); setInputText(''); return; }
          }
          setAlertDialogConfig({
            title: `Delete from ${listName}?`,
            description: isDeletingByNumber ? <>Are you sure you want to delete item number <strong>{itemNumberToDelete}</strong> from your {listName}?</> : <>Are you sure you want to delete "<strong>{itemNameToDelete}</strong>" from your {listName}?</>,\n            onConfirm: () => { if (isDeletingByNumber) deleteListItem(listKey, itemNumberToDelete, listName); else deleteListItem(listKey, itemNameToDelete, listName); }, actionLabel: "Delete"
          });
          setIsAlertDialogOpen(true); return; 
        }
      } else if (emptyRecentPattern.test(lowerText)) {
        setAlertDialogConfig({ title: "Empty Recent Thoughts?", description: "Are you sure you want to clear all thoughts from the 'Recent Thoughts' list?", onConfirm: onEmptyRecalledThoughts, actionLabel: "Empty Thoughts" });
        setIsAlertDialogOpen(true); return;
      } else if (clearShoppingPattern.test(lowerText)) {
        setAlertDialogConfig({ title: "Clear Shopping List?", description: "Are you sure you want to remove all items from your shopping list?", onConfirm: clearShoppingList, actionLabel: "Clear List" });
        setIsAlertDialogOpen(true); return;
      } else if (lowerText.startsWith(completeAllPrefixLower) && (lowerText.endsWith(completeAllSuffixTodoLower) || lowerText.endsWith(completeAllSuffixTodosLower))) {
        setAlertDialogConfig({ title: "Complete All To-Do Tasks?", description: "Are you sure you want to mark all tasks in your to-do list as complete?", onConfirm: completeAllToDoTasks, actionLabel: "Complete All" });
        setIsAlertDialogOpen(true); return;
      }
      
      // General AI processing if no direct command matched
      try {
        const processedData = await processTextThought(textToProcess);
        let aiSuggestionHandled = false;

        // Check for AI-identified system commands first
        if (processedData.intentAnalysis?.isAction && processedData.intentAnalysis.extractedAction) {
            const aiActionLower = processedData.intentAnalysis.extractedAction.toLowerCase();
            if (aiActionLower === WAKE_WORDS.EMPTY_RECENT_THOUGHTS_COMMAND.toLowerCase()) {
                setAlertDialogConfig({ title: "AI Suggestion: Empty Recent Thoughts?", description: "The AI suggests clearing recent thoughts. Proceed?", onConfirm: onEmptyRecalledThoughts, actionLabel: "Empty Thoughts", dataToRecallOnCancel: processedData });
                setIsAlertDialogOpen(true); aiSuggestionHandled = true; dialogShownForAISuggestion = true;
            } else if (aiActionLower === WAKE_WORDS.CLEAR_SHOPPING_LIST_COMMAND.toLowerCase()) {
                setAlertDialogConfig({ title: "AI Suggestion: Clear Shopping List?", description: "The AI suggests clearing your shopping list. Proceed?", onConfirm: clearShoppingList, actionLabel: "Clear List", dataToRecallOnCancel: processedData });
                setIsAlertDialogOpen(true); aiSuggestionHandled = true; dialogShownForAISuggestion = true;
            } else if (aiActionLower.startsWith(completeAllPrefixLower) && (aiActionLower.endsWith(completeAllSuffixTodoLower) || aiActionLower.endsWith(completeAllSuffixTodosLower))) {
                setAlertDialogConfig({ title: "AI Suggestion: Complete All To-Do Tasks?", description: "The AI suggests completing all to-do tasks. Proceed?", onConfirm: completeAllToDoTasks, actionLabel: "Complete All", dataToRecallOnCancel: processedData });
                setIsAlertDialogOpen(true); aiSuggestionHandled = true; dialogShownForAISuggestion = true;
            }
        }
        
        // Then, check for AI suggestions to add to list (if not already handled by system command check)
        if (!aiSuggestionHandled && processedData.intentAnalysis?.isAction && processedData.intentAnalysis.extractedAction && processedData.intentAnalysis.suggestedList && processedData.intentAnalysis.suggestedList !== 'none') {
          const intent = processedData.intentAnalysis;
          const listKey = intent.suggestedList === 'shopping' ? LOCALSTORAGE_KEYS.SHOPPING_LIST : LOCALSTORAGE_KEYS.TODO_LIST;
          const listName = intent.suggestedList === 'shopping' ? "Shopping List" : "To-Do List";
          setAlertDialogConfig({
              title: `AI Suggestion: Add to ${listName}?`,
              description: <>The AI suggests adding "<strong>{intent.extractedAction}</strong>" to your {listName}. Add it?</>,\n              itemText: intent.extractedAction, listKey: listKey, listName: listName,
              dataToRecallOnCancel: processedData,
              onConfirm: () => { addListItem(listKey, intent.extractedAction!, listName); },
              actionLabel: listName === "Shopping List" ? "Add Item" : "Add Task"
          });
          setIsAlertDialogOpen(true); aiSuggestionHandled = true; dialogShownForAISuggestion = true;
        }
        
        // Check actionItems from refineThought (if not already handled by other checks)
        if (!aiSuggestionHandled && processedData.actionItems && processedData.actionItems.length > 0) {
          const nonSearchActionItems = processedData.actionItems.filter(
            item => !(item.title.toLowerCase().includes('search') || item.title.toLowerCase().includes('studio') || item.title.toLowerCase().includes('copilot'))
          );

          if (nonSearchActionItems.length > 0) {
            for (const actionItem of nonSearchActionItems) {
              const lowerActionItem = actionItem.title.toLowerCase(); 
              let itemToAdd: string | null = null; let targetListKey: string | null = null; let targetListName: string | null = null;
              
              const shoppingPatternRefined = new RegExp(`(?:add|buy|get|purchase|pick up)\\s+(?:['\"]?)(.+?)(?:['\"]?)(?:\\s+(?:to|for|in|on)\\s+(?:my\\s+|the\\s+)?shopping\\s+list)?$`);
              const todoPatternRefined = new RegExp(`(?:add|schedule|create|complete|do|finish|call|email|text|set up|organize|remember to)\\s+(?:['\"]?)(.+?)(?:['\"]?)(?:\\s+(?:to|for|in|on)\\s+(?:my\\s+|the\\s+)?(?:to\\s*do|todo)\\s+list)?$`);
  
              const shoppingMatchRefined = lowerActionItem.match(shoppingPatternRefined);
              if (shoppingMatchRefined && shoppingMatchRefined[1]) { itemToAdd = shoppingMatchRefined[1].trim(); targetListKey = LOCALSTORAGE_KEYS.SHOPPING_LIST; targetListName = "Shopping List"; } 
              else { const todoMatchRefined = lowerActionItem.match(todoPatternRefined); if (todoMatchRefined && todoMatchRefined[1]) { itemToAdd = todoMatchRefined[1].trim(); targetListKey = LOCALSTORAGE_KEYS.TODO_LIST; targetListName = "To-Do List"; }}
              
              if (itemToAdd && targetListKey && targetListName) {
                setAlertDialogConfig({
                  title: `AI Suggestion: Add to ${targetListName}?`,
                  description: <>The AI refined this to: <strong>{actionItem.title}</strong>. Add "<strong>{itemToAdd}</strong>" to your {targetListName}?</>,\n                  itemText: itemToAdd, listKey: targetListKey, listName: targetListName, dataToRecallOnCancel: processedData,
                  onConfirm: () => { addListItem(targetListKey!, itemToAdd!, targetListName!); },
                  actionLabel: targetListName === "Shopping List" ? "Add Item" : "Add Task"
                });
                setIsAlertDialogOpen(true); aiSuggestionHandled = true; dialogShownForAISuggestion = true; break; 
              }
            }
          }
        }

        if (!aiSuggestionHandled && !dialogShownForAISuggestion) { 
           onThoughtRecalled({ id: crypto.randomUUID(), timestamp: Date.now(), ...processedData });
           if (processedData.aiAnswer) toast({ title: "Thought Processed", description: "AI answered your question."});
           else toast({ title: "Thought Processed", description: "AI analysis complete." });
           actionExecutedWithoutDialog = true;
        }
      } catch (error) {\n        toast({ title: "Error Processing Thought", description: (error as Error).message, variant: "destructive" });\n        actionExecutedWithoutDialog = true; \n      } finally {\n         if (!isAlertDialogOpen && !dialogShownForAISuggestion) {\n           setIsLoading(false);\n           if(actionExecutedWithoutDialog) setInputText('');    \n        }\n      }\n    }, [\n        toast, onThoughtRecalled, addListItem, deleteListItem, startAudioRecordingForSnippet, \n        onEmptyRecalledThoughts, clearShoppingList, completeAllToDoTasks\n    ]);\n\n    const handleProcessInputText = useCallback(() => {\n      setIsLoading(true);\n      if (isDashboardDictationActive) {\n        triggerProcessAfterDictationRef.current = true;\n        if (dashboardDictationRecognitionRef.current) {\n          try { dashboardDictationRecognitionRef.current.stop(); } catch (e) { /* ignore */ }\n        }\n      } else if (isHeaderDictationActiveInternal) {\n        actuallyProcessInputText(headerDictationFinalTranscriptRef.current || inputText.trim());\n      } else {\n        actuallyProcessInputText(inputText.trim());\n      }\n    }, [isDashboardDictationActive, isHeaderDictationActiveInternal, inputText, actuallyProcessInputText]);\n    \n    const handleDashboardMicClick = useCallback(async () => {\n        if (isDashboardDictationActive) {\n            if (dashboardDictationRecognitionRef.current) { try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/} }\n            if (dashboardDictationPauseTimeoutRef.current) { clearTimeout(dashboardDictationPauseTimeoutRef.current); }\n            setIsDashboardDictationActive(false);\n            dashboardDictationFinalTranscriptRef.current = inputText.trim();\n            return;\n        }\n\n        if (isBrowserUnsupported || hasMicPermission === false) { toast({ title: \"Mic Unavailable\", variant: \"destructive\" }); return; }\n        if (isLoading || isCapturingAudioForSnippet || isHeaderDictationActiveInternal) { \n            toast({ title: \"System Busy\", description: \"Another audio process is active or system is loading.\", variant: \"default\" }); \n            return; \n        }\n        \n        let currentMicPermission = hasMicPermission;\n        if (hasMicPermission === null) { \n            try {\n                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });\n                stream.getTracks().forEach(track => track.stop());\n                setHasMicPermission(true);\n                currentMicPermission = true;\n            } catch (err) {\n                setHasMicPermission(false);\n                toast({ title: \"Mic Access Denied\", variant: \"destructive\" }); return;\n            }\n        }\n        if (currentMicPermission === false) return;\n\n        const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;\n        if (!SpeechRecognitionAPI) return; \n\n        if (dashboardDictationRecognitionRef.current) { try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/} }\n        if (dashboardDictationPauseTimeoutRef.current) { clearTimeout(dashboardDictationPauseTimeoutRef.current); }\n        \n        dashboardDictationFinalTranscriptRef.current = ''; \n        setInputText(''); \n\n        const recognition = new SpeechRecognitionAPI();\n        dashboardDictationRecognitionRef.current = recognition;\n        recognition.continuous = true;\n        recognition.interimResults = true;\n        recognition.lang = 'en-US';\n\n        recognition.onstart = () => {\n            setIsDashboardDictationActive(true);\n            dashboardDictationFinalTranscriptRef.current = '';\n            setInputText('');\n        };\n\n        recognition.onresult = (event: SpeechRecognitionEvent) => {\n            if (dashboardDictationPauseTimeoutRef.current) { clearTimeout(dashboardDictationPauseTimeoutRef.current); }\n            \n            let fullTranscriptThisSession = \"\";\n            for (let i = 0; i < event.results.length; ++i) {\n                fullTranscriptThisSession += event.results[i][0].transcript;\n            }\n            setInputText(fullTranscriptThisSession.trim());\n\n            const lowerTranscriptForEndCheck = fullTranscriptThisSession.toLowerCase();\n            const endCommand = WAKE_WORDS.END_DICTATION.toLowerCase();\n            const stopCommand = WAKE_WORDS.STOP_DICTATION.toLowerCase();\n\n            if (lowerTranscriptForEndCheck.endsWith(endCommand) || lowerTranscriptForEndCheck.endsWith(stopCommand)) {\n                let finalText = fullTranscriptThisSession;\n                if (lowerTranscriptForEndCheck.endsWith(endCommand)) { \n                    finalText = fullTranscriptThisSession.substring(0, fullTranscriptThisSession.toLowerCase().lastIndexOf(WAKE_WORDS.END_DICTATION.toLowerCase())).trim();\n                } else if (lowerTranscriptForEndCheck.endsWith(stopCommand)) { \n                    finalText = fullTranscriptThisSession.substring(0, fullTranscriptThisSession.toLowerCase().lastIndexOf(WAKE_WORDS.STOP_DICTATION.toLowerCase())).trim();\n                }\n                dashboardDictationFinalTranscriptRef.current = finalText;\n                setInputText(finalText);\n                if (dashboardDictationRecognitionRef.current) { try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/} }\n            } else {\n                dashboardDictationPauseTimeoutRef.current = setTimeout(() => {\n                    if (dashboardDictationRecognitionRef.current) { try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/} }\n                }, 2000); \n            }\n        };\n        recognition.onerror = (event: SpeechRecognitionErrorEvent) => {\n            if (dashboardDictationPauseTimeoutRef.current) { clearTimeout(dashboardDictationPauseTimeoutRef.current); }\n            if (event.error === 'aborted') { console.info('Dashboard dictation aborted.'); }\n            else if (event.error === 'no-speech' && isDashboardDictationActive) { console.warn(\"No speech detected for dictation\"); } \n            else if (event.error !== 'no-speech' && event.error !== 'aborted') { \n                console.error('Dashboard dictation error:', event.error, event.message); \n                toast({ title: \"Dictation Error\", description: event.message || \"An unknown error occurred.\", variant: \"destructive\" }); \n            }\n            setIsDashboardDictationActive(false);\n            dashboardDictationFinalTranscriptRef.current = inputText.trim(); // Save whatever was transcribed before error\n        };\n        recognition.onend = () => {\n            setIsDashboardDictationActive(false);\n            if (dashboardDictationPauseTimeoutRef.current) { clearTimeout(dashboardDictationPauseTimeoutRef.current); }\n            const finalTranscriptFromDictation = dashboardDictationFinalTranscriptRef.current.trim();\n            if (inputText.trim() !== finalTranscriptFromDictation) {\n                 setInputText(finalTranscriptFromDictation);\n            }\n            if (triggerProcessAfterDictationRef.current) {\n              if (finalTranscriptFromDictation) { // Only process if there's actually text\n                actuallyProcessInputText(finalTranscriptFromDictation);\n              }\n              triggerProcessAfterDictationRef.current = false;\n            }\n            dashboardDictationRecognitionRef.current = null;\n        };\n        try {\n          recognition.start();\n        } catch (err) {\n          console.error(\"Error starting dashboard dictation:\", err);\n          toast({ title: \"Dictation Error\", description: \"Could not start microphone.\", variant: \"destructive\" });\n          setIsDashboardDictationActive(false);\n        }\n    }, [\n        isBrowserUnsupported, hasMicPermission, isLoading, isCapturingAudioForSnippet, \n        isDashboardDictationActive, toast, isHeaderDictationActiveInternal, inputText, actuallyProcessInputText\n    ]);\n\n    // Imperative methods for header dictation\n    useImperativeHandle(ref, () => ({\n      startHeaderDictation: async (): Promise<boolean> => {\n        console.log('[ThoughtInputForm] startHeaderDictation called. States:', {\n          isBrowserUnsupported,\n          hasMicPermission: String(hasMicPermission),\n          isLoading,\n          isCapturingAudioForSnippet,\n          isDashboardDictationActive,\n          isHeaderDictationActiveInternal,\n        });\n\n        if (isBrowserUnsupported || hasMicPermission === false) {\n          toast({ title: \"Mic Unavailable for Header Dictation\", variant: \"destructive\" });\n          return false;\n        }\n        if (isLoading || isCapturingAudioForSnippet || isDashboardDictationActive || isHeaderDictationActiveInternal) {\n          toast({ title: \"System Busy for Header Dictation\", description: \"Another audio process is active.\", variant: \"default\" });\n          return false;\n        }\n        let currentMicPermission = hasMicPermission;\n        if (hasMicPermission === null) {\n          try {\n            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });\n            stream.getTracks().forEach(track => track.stop());\n            setHasMicPermission(true);\n            currentMicPermission = true;\n          } catch (err) {\n            setHasMicPermission(false);\n            toast({ title: \"Mic Access Denied for Header\", variant: \"destructive\" });\n            return false;\n          }\n        }\n        if (currentMicPermission === false) return false;\n\n        const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;\n        if (!SpeechRecognitionAPI) {\n          toast({ title: \"Speech API Not Supported\", variant: \"destructive\" });\n          return false;\n        }\n\n        if (headerDictationRecognitionRef.current) { try { headerDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/} }\n        if (headerDictationPauseTimeoutRef.current) { clearTimeout(headerDictationPauseTimeoutRef.current); }\n        headerDictationFinalTranscriptRef.current = '';\n        setInputText(''); // Clear input text when starting header dictation\n\n        const recognition = new SpeechRecognitionAPI();\n        headerDictationRecognitionRef.current = recognition;\n        recognition.continuous = true;\n        recognition.interimResults = true;\n        recognition.lang = 'en-US';\n\n        recognition.onstart = () => {\n          setIsHeaderDictationActiveInternal(true);\n          headerDictationFinalTranscriptRef.current = '';\n          setInputText('');\n        };\n\n        recognition.onresult = (event: SpeechRecognitionEvent) => {\n          if (headerDictationPauseTimeoutRef.current) { clearTimeout(headerDictationPauseTimeoutRef.current); }\n          let fullTranscriptThisSession = \"\";\n            for (let i = 0; i < event.results.length; ++i) {\n                fullTranscriptThisSession += event.results[i][0].transcript;\n            }\n          setInputText(fullTranscriptThisSession.trim());\n\n          const lowerTranscriptForEndCheck = fullTranscriptThisSession.toLowerCase();\n          const endCommand = WAKE_WORDS.END_DICTATION.toLowerCase();\n          const stopCommand = WAKE_WORDS.STOP_DICTATION.toLowerCase();\n\n          if (lowerTranscriptForEndCheck.endsWith(endCommand) || lowerTranscriptForEndCheck.endsWith(stopCommand)) {\n            let finalText = fullTranscriptThisSession;\n            if (lowerTranscriptForEndCheck.endsWith(endCommand)) { \n                finalText = fullTranscriptThisSession.substring(0, fullTranscriptThisSession.toLowerCase().lastIndexOf(WAKE_WORDS.END_DICTATION.toLowerCase())).trim();\n            } else if (lowerTranscriptForEndCheck.endsWith(stopCommand)) { \n                finalText = fullTranscriptThisSession.substring(0, fullTranscriptThisSession.toLowerCase().lastIndexOf(WAKE_WORDS.STOP_DICTATION.toLowerCase())).trim();\n            }\n            headerDictationFinalTranscriptRef.current = finalText;\n            setInputText(finalText);\n            if (headerDictationRecognitionRef.current) { try { headerDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/} }\n          } else {\n            headerDictationPauseTimeoutRef.current = setTimeout(() => {\n                if (headerDictationRecognitionRef.current) { try { headerDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/} }\n            }, 2000); \n          }\n        };\n\n        recognition.onerror = (event: SpeechRecognitionErrorEvent) => {\n          if (headerDictationPauseTimeoutRef.current) { clearTimeout(headerDictationPauseTimeoutRef.current); }\n          if (event.error === 'aborted') { console.info('Header dictation aborted.'); }\n          else if (event.error === 'no-speech' && isHeaderDictationActiveInternal) { console.warn(\"No speech detected for header dictation\"); } \n          else if (event.error !== 'no-speech' && event.error !== 'aborted') { \n            console.error('Header dictation error:', event.error, event.message); \n            toast({ title: \"Header Dictation Error\", description: event.message || \"An unknown error occurred.\", variant: \"destructive\" }); \n          }\n          setIsHeaderDictationActiveInternal(false);\n          onStopHeaderDictationParent();\n          headerDictationFinalTranscriptRef.current = inputText.trim();\n        };\n\n        recognition.onend = () => {\n          setIsHeaderDictationActiveInternal(false);\n          onStopHeaderDictationParent();\n          if (headerDictationPauseTimeoutRef.current) { clearTimeout(headerDictationPauseTimeoutRef.current); }\n          const finalTranscriptFromHeader = headerDictationFinalTranscriptRef.current.trim();\n          if (inputText.trim() !== finalTranscriptFromHeader) {\n               setInputText(finalTranscriptFromHeader);\n          }\n          headerDictationRecognitionRef.current = null;\n        };\n        try {\n          recognition.start();\n          return true;\n        } catch (err) {\n            console.error(\"Failed to start header dictation\", err);\n            toast({title: \"Header Dictation Error\", description: \"Could not start microphone.\", variant: \"destructive\"});\n            setIsHeaderDictationActiveInternal(false);\n            onStopHeaderDictationParent();\n            return false;\n        }\n      },\n      stopHeaderDictation: () => {\n        if (headerDictationRecognitionRef.current) {\n          try { headerDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}\n        }\n        if (headerDictationPauseTimeoutRef.current) { clearTimeout(headerDictationPauseTimeoutRef.current); }\n        setIsHeaderDictationActiveInternal(false);\n        onStopHeaderDictationParent(); \n        headerDictationFinalTranscriptRef.current = inputText.trim(); \n      }\n    }), [\n      isBrowserUnsupported, hasMicPermission, isLoading, isCapturingAudioForSnippet, isDashboardDictationActive, \n      isHeaderDictationActiveInternal, toast, inputText, onStopHeaderDictationParent,\n      actuallyProcessInputText, \n      startAudioRecordingForSnippet, addListItem, deleteListItem, onEmptyRecalledThoughts,\n      clearShoppingList, completeAllToDoTasks \n    ]);\n    \n    useEffect(() => {\n      const currentRef = ref as React.MutableRefObject<ThoughtInputFormHandle | null>; \n      if (currentRef && isExternallyHeaderDictating && !isHeaderDictationActiveInternal) {\n          currentRef.current?.startHeaderDictation();\n      } else if (currentRef && !isExternallyHeaderDictating && isHeaderDictationActiveInternal) {\n          currentRef.current?.stopHeaderDictation();\n      }\n  }, [isExternallyHeaderDictating, isHeaderDictationActiveInternal, ref]);\n\n\n    // Effect to manage microphone permissions and global cleanup\n    useEffect(() => {\n      const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;\n      if (!SpeechRecognitionAPI) {\n        setIsBrowserUnsupported(true);\n        setHasMicPermission(false);\n        return;\n      }\n      setIsBrowserUnsupported(false);\n      if (hasMicPermission === null) { // Only request if permission status is not yet determined\n        navigator.mediaDevices.getUserMedia({ audio: true })\n          .then((stream) => {\n            stream.getTracks().forEach(track => track.stop());\n            setHasMicPermission(true);\n          })\n          .catch(err => {\n            console.warn(\"Initial mic permission check error:\", err.name, err.message);\n            setHasMicPermission(false);\n          });\n      }\n      return () => {\n        if (snippetRecognitionRef.current) { try { snippetRecognitionRef.current.stop(); } catch(e) {/*ignore*/} snippetRecognitionRef.current = null; }\n        if (snippetMediaRecorderRef.current?.state === \"recording\") { try { snippetMediaRecorderRef.current.stop(); } catch(e) {/*ignore*/} snippetMediaRecorderRef.current = null; }\n        if (dashboardDictationRecognitionRef.current) { try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/} dashboardDictationRecognitionRef.current = null; }\n        if (dashboardDictationPauseTimeoutRef.current) { clearTimeout(dashboardDictationPauseTimeoutRef.current); }\n        if (headerDictationRecognitionRef.current) { try { headerDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/} headerDictationRecognitionRef.current = null; }\n        if (headerDictationPauseTimeoutRef.current) { clearTimeout(headerDictationPauseTimeoutRef.current); }\n      };\n    }, [hasMicPermission]); \n    \n    const getDashboardDictationButtonIcon = () => {\n        if (isDashboardDictationActive) return <Radio className=\"h-6 w-6 text-red-500 animate-pulse\" />;\n        if (isBrowserUnsupported || hasMicPermission === false) return <MicOff className=\"h-6 w-6 text-muted-foreground\" />;\n        return <Mic className=\"h-6 w-6\" />;\n    };\n    \n    const getMicStatusText = (): React.ReactNode => {\n        if (isBrowserUnsupported) return \"Voice input not supported by browser.\";\n        if (hasMicPermission === false) return \"Mic permission denied. Please enable in browser settings.\";\n        if (hasMicPermission === null) return \"Checking microphone permission...\";\n\n        if (isHeaderDictationActiveInternal) return <span className=\"text-red-500 animate-pulse\">Header dictation active... Transcript populates below. Click header mic to stop.</span>;\n        if (isCapturingAudioForSnippet) return <span className=\"text-orange-500 animate-pulse\">Recording 10s audio & speech for 'heggles replay that'...</span>;\n        if (isDashboardDictationActive) {\n          return (\n            <span className=\"text-blue-500 animate-pulse\">\n              Heggling in Progress... Press Stop Dictation when finished.\n            </span>\n          );\n        }\n        \n        if (isLoading && !isAlertDialogOpen) return \"Processing thought...\";\n        \n        return \"Use header mic for continuous recording, or card mic for dictation. Click Brain to process.\";\n    };\n\n    const getTextareaPlaceholder = (): string => {\n      if (isHeaderDictationActiveInternal) return \"Header dictation active. Transcript will populate here. Click Brain icon to process when stopped.\";\n      if (isDashboardDictationActive) return \"Dictate your thought... Click mic again, or say 'Heggles end/stop', or pause to finish.\";\n      if (isCapturingAudioForSnippet) return \"Recording 10s audio & speech for 'heggles replay that' processing...\";\n      if (isLoading && !isAlertDialogOpen) return \"Processing...\";\n      \n      return \"Type thought or use a microphone. Click Brain icon to process text.\";\n    };\n    \n    return (\n      <>\n        <Card className=\"w-full shadow-lg\">\n          <CardHeader>\n            <CardTitle className=\"text-xl\">Input & Recall</CardTitle>\n            <CardDescription>\n              Use the header microphone for continuous dictation, or the microphone below for dictating directly into the text area. Click the <Brain aria-hidden=\"true\" className=\"inline-block h-3.5 w-3.5 align-middle\"/> icon to process the text in the area below.\n            </CardDescription>\n             <div className=\"text-xs text-muted-foreground pt-1 min-h-[1.25rem] flex items-center\">\n                {getMicStatusText()}\n            </div>\n          </CardHeader>\n          <CardContent>\n            <div className=\"space-y-4\">\n              {(isBrowserUnsupported && hasMicPermission === null && !isHeaderDictationActiveInternal && !isDashboardDictationActive && !isCapturingAudioForSnippet) && (\n                <Alert variant=\"destructive\" className=\"mb-4\">\n                  <AlertTriangleIcon className=\"h-4 w-4\" />\n                  <UiAlertTitle>Browser May Not Support Speech</UiAlertTitle>\n                  <UiAlertDescription>Speech recognition features may not be available.</UiAlertDescription>\n                </Alert>\n              )}\n              {(hasMicPermission === false && !isBrowserUnsupported && !isHeaderDictationActiveInternal && !isDashboardDictationActive && !isCapturingAudioForSnippet) && ( \n                <Alert variant=\"destructive\" className=\"mb-4\">\n                  <AlertTriangleIcon className=\"h-4 w-4\" />\n                  <UiAlertTitle>Microphone Access Denied</UiAlertTitle>\n                  <UiAlertDescription>Voice input features require microphone access. Please enable it in your browser settings for this site.</UiAlertDescription>\n                </Alert>\n              )}\n\n              <Textarea\n                placeholder={getTextareaPlaceholder()}\n                value={inputText}\n                onChange={(e) => setInputText(e.target.value)}\n                rows={4}\n                disabled={isLoading || isCapturingAudioForSnippet || isDashboardDictationActive || isHeaderDictationActiveInternal}\n                className=\"resize-none\"\n                aria-label=\"Thought input area\"\n              />\n              <div className=\"flex items-stretch gap-2\">\n                <Button\n                  type=\"button\"\n                  onClick={handleDashboardMicClick}\n                  disabled={isBrowserUnsupported || hasMicPermission === false || isLoading || isCapturingAudioForSnippet || isHeaderDictationActiveInternal}\n                  size=\"icon\"\n                  variant=\"outline\"\n                  aria-label={isDashboardDictationActive ? \"Stop dictation\" : \"Dictate thought into text area\"}\n                  title={isDashboardDictationActive ? \"Stop dictation (or say 'Heggles end/stop' or pause)\" : \"Dictate thought into text area\"}\n                >\n                  {getDashboardDictationButtonIcon()}\n                </Button>\n                <Button\n                  type=\"button\"\n                  onClick={handleProcessInputText}\n                  disabled={isLoading || isCapturingAudioForSnippet || isDashboardDictationActive || isHeaderDictationActiveInternal || !inputText.trim()}\n                  size=\"icon\"\n                  variant=\"outline\"\n                  aria-label=\"Process text from input area with AI\"\n                  title=\"Process text from input area with AI\"\n                >\n                  {(isLoading && !isAlertDialogOpen && inputText.trim()) ? <Loader2 className=\"h-6 w-6 animate-spin\" /> : <Brain className=\"h-6 w-6\" />}\n                </Button>\n              </div>\n            </div>\n          </CardContent>\n        </Card>\n\n        {alertDialogConfig && (\n          <AlertDialog\n            open={isAlertDialogOpen}\n            onOpenChange={(open) => {\n              setIsAlertDialogOpen(open);\n              if (!open) { \n                if (!confirmedDialogActionRef.current && alertDialogConfig.dataToRecallOnCancel) {\n                  onThoughtRecalled({ id: crypto.randomUUID(), timestamp: Date.now(), ...alertDialogConfig.dataToRecallOnCancel });\n                  toast({ title: \"Suggestion Declined\", description: \"Original thought captured in Recent Thoughts.\" });\n                }\n                confirmedDialogActionRef.current = false; \n                setAlertDialogConfig(null); \n                setIsLoading(false); \n                setInputText('');    \n              }\n            }}\n          >\n            <AlertDialogContent>\n              <AlertDialogHeader>\n                <AlertDialogTitle>{alertDialogConfig.title}</AlertDialogTitle>\n                <AlertDialogDescription>\n                  {alertDialogConfig.description}\n                </AlertDialogDescription>\n              </AlertDialogHeader>\n              <AlertDialogFooter>\n                <AlertDialogCancel onClick={() => { \n                    confirmedDialogActionRef.current = false;\n                }}>Cancel</AlertDialogCancel>\n                <AlertDialogAction onClick={() => {\n                  if (alertDialogConfig) {\n                    confirmedDialogActionRef.current = true; \n                    alertDialogConfig.onConfirm();\n                  }\n                }}>{alertDialogConfig.actionLabel || \"Confirm\"}</AlertDialogAction>\n              </AlertDialogFooter>\n            </AlertDialogContent>\n          </AlertDialog>\n        )}\n      </>\n    );\n  });\n\nThoughtInputForm.displayName = \"ThoughtInputForm\";\n"
>       |                                                                 ^
> 
> Expected unicode escape
> 
> 