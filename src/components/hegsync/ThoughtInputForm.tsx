
"use client";

import React, { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Brain, Loader2, Mic, Radio, AlertTriangleIcon, MicOff, PlayCircle, StopCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription as UiAlertDescription, AlertTitle as UiAlertTitle } from '@/components/ui/alert'; // Renamed AlertDescription to avoid conflict
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
import type { Thought, ShoppingListItem, ToDoListItem, IntentAnalysisOutput } from '@/lib/types';
import { WAKE_WORDS, LOCALSTORAGE_KEYS, RECORDING_DURATION_MS } from '@/lib/constants';

interface ThoughtInputFormProps {
  onThoughtRecalled: (thought: Thought) => void;
  onEmptyRecalledThoughts: () => void;
  isExternallyLongRecording: boolean;
  onStopLongRecordingParent: () => void;
}

export interface ThoughtInputFormHandle {
  startLongRecording: () => Promise<boolean>;
  stopLongRecordingAndProcess: () => void;
}

export const ThoughtInputForm = forwardRef<ThoughtInputFormHandle, ThoughtInputFormProps>(
  ({ onThoughtRecalled, onEmptyRecalledThoughts, isExternallyLongRecording, onStopLongRecordingParent }, ref) => {
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
    
    // Continuous recording (header button)
    const [isCapturingAudioForLongRecording, setIsCapturingAudioForLongRecording] = useState(false);
    const longRecordingMediaRecorderRef = useRef<MediaRecorder | null>(null);
    const longRecordingSpeechRecognizerRef = useRef<SpeechRecognition | null>(null);
    const longRecordingTranscriptRef = useRef<string>('');
    const longRecordingAudioChunksRef = useRef<Blob[]>([]);

    // Dashboard dictation mic (in-card mic button)
    const [isDashboardDictationActive, setIsDashboardDictationActive] = useState(false);
    const dashboardDictationRecognitionRef = useRef<SpeechRecognition | null>(null);
    const dashboardDictationPauseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const dashboardDictationFinalTranscriptRef = useRef<string>(''); 
    
    const [alertDialogConfig, setAlertDialogConfig] = useState<{
      title: string;
      description: React.ReactNode;
      itemText?: string;
      listKey?: string;
      listName?: string;
      dataToRecallOnCancel?: Omit<Thought, "id" | "timestamp">; 
      onConfirm: () => void;
      actionLabel?: string;
    } | null>(null);
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
        toast({ title: "Mic Unavailable", variant: "destructive" }); return;
      }
      if (isLoading || isCapturingAudioForSnippet || isDashboardDictationActive || isCapturingAudioForLongRecording) {
        toast({ title: "System Busy", description:"Another audio process is active.", variant: "default" }); return;
      }
      
      const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognitionAPI || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          toast({ title: "Browser Not Supported for Recording", variant: "destructive" });
          return;
      }
      
      setIsLoading(true);
      setIsCapturingAudioForSnippet(true);
      toast({ title: "Recording 10s Audio & Speech...", description: `Recording live audio & speech for AI processing.` });
      
      snippetAudioChunksRef.current = [];
      snippetTranscriptRef.current = '';

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        snippetMediaRecorderRef.current = new MediaRecorder(stream);
        snippetMediaRecorderRef.current.ondataavailable = (event) => {
          if (event.data.size > 0) snippetAudioChunksRef.current.push(event.data);
        };

        snippetMediaRecorderRef.current.onstop = async () => {
          stream.getTracks().forEach(track => track.stop()); // Stop all tracks from the stream
          const audioBlob = new Blob(snippetAudioChunksRef.current, { type: 'audio/webm' }); 
          const reader = new FileReader();
          reader.readAsDataURL(audioBlob);
          reader.onloadend = async () => {
            const base64AudioData = reader.result as string;
            const liveTranscript = snippetTranscriptRef.current.trim();
            snippetTranscriptRef.current = ''; 
            
            try {
              const processedData = await processRecordedAudio(base64AudioData, liveTranscript);
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
          let interim = "";
          let finalizedThisTurn = "";
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              finalizedThisTurn += event.results[i][0].transcript + ' ';
            } else {
              interim += event.results[i][0].transcript;
            }
          }
          if(finalizedThisTurn) {
            snippetTranscriptRef.current = (snippetTranscriptRef.current + finalizedThisTurn).trim();
          }
        };
        
        localSnippetRecognizer.onerror = (event: SpeechRecognitionErrorEvent) => {
          console.warn("Snippet speech recognition error:", event.error, event.message);
          if (event.error !== 'aborted' && event.error !== 'no-speech') {
            // Don't toast for common 'no-speech' or 'aborted'
            toast({title: "Snippet Transcription Error", description: event.message, variant: "destructive"});
          }
        };

        localSnippetRecognizer.onend = () => {
          snippetRecognitionRef.current = null; // Important to nullify after use
        };

        snippetMediaRecorderRef.current.start();
        localSnippetRecognizer.start();

        setTimeout(() => {
          if (snippetMediaRecorderRef.current?.state === "recording") {
            snippetMediaRecorderRef.current.stop();
          }
          if (snippetRecognitionRef.current) { // Check if still exists
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
      hasMicPermission, isLoading, isCapturingAudioForSnippet, isDashboardDictationActive, isCapturingAudioForLongRecording, 
      toast, onThoughtRecalled, isBrowserUnsupported
    ]);
    
    const handleProcessInputText = useCallback(async () => {
      const textToProcess = inputText.trim();
      if (!textToProcess) {
        toast({ title: "Input empty", variant: "destructive" });
        return;
      }
      
      setIsLoading(true);
      confirmedDialogActionRef.current = false; 
      let dialogShownForAISuggestion = false;
      let actionExecutedWithoutDialog = false;

      const hegglesBaseLower = WAKE_WORDS.HEGGLES_BASE.toLowerCase();
      const lowerText = textToProcess.toLowerCase();
      
      if (lowerText === WAKE_WORDS.HEGGLES_REPLAY_THAT.toLowerCase()) {
        await startAudioRecordingForSnippet(); 
        setInputText(''); 
        // isLoading will be handled by startAudioRecordingForSnippet
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
            description: isDeletingByNumber ? <>Are you sure you want to delete item number <strong>{itemNumberToDelete}</strong> from your {listName}?</> : <>Are you sure you want to delete "<strong>{itemNameToDelete}</strong>" from your {listName}?</>,
            onConfirm: () => { if (isDeletingByNumber) deleteListItem(listKey, itemNumberToDelete, listName); else deleteListItem(listKey, itemNameToDelete, listName); }, actionLabel: "Delete"
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

        // Check for AI-identified system commands
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
        
        // Check for AI suggestions to add to list (if not already handled by system command check)
        if (!aiSuggestionHandled && processedData.intentAnalysis?.isAction && processedData.intentAnalysis.extractedAction && processedData.intentAnalysis.suggestedList && processedData.intentAnalysis.suggestedList !== 'none') {
          const intent = processedData.intentAnalysis;
          const listKey = intent.suggestedList === 'shopping' ? LOCALSTORAGE_KEYS.SHOPPING_LIST : LOCALSTORAGE_KEYS.TODO_LIST;
          const listName = intent.suggestedList === 'shopping' ? "Shopping List" : "To-Do List";
          setAlertDialogConfig({
              title: `AI Suggestion: Add to ${listName}?`,
              description: <>The AI suggests adding "<strong>{intent.extractedAction}</strong>" to your {listName}. Add it?</>,
              itemText: intent.extractedAction, listKey: listKey, listName: listName,
              dataToRecallOnCancel: processedData,
              onConfirm: () => { addListItem(listKey, intent.extractedAction!, listName); },
              actionLabel: listName === "Shopping List" ? "Add Item" : "Add Task"
          });
          setIsAlertDialogOpen(true); aiSuggestionHandled = true; dialogShownForAISuggestion = true;
        }
        
        // Check actionItems from refineThought (if not already handled by other checks)
        if (!aiSuggestionHandled && processedData.actionItems && processedData.actionItems.length > 0) {
          for (const actionItem of processedData.actionItems) {
            const lowerActionItem = actionItem.toLowerCase();
            let itemToAdd: string | null = null; let targetListKey: string | null = null; let targetListName: string | null = null;
            
            const shoppingPatternRefined = new RegExp(`(?:add|buy|get|purchase|pick up)\\s+(?:['"]?)(.+?)(?:['"]?)(?:\\s+(?:to|for|in|on)\\s+(?:my\\s+|the\\s+)?shopping\\s+list)?$`);
            const todoPatternRefined = new RegExp(`(?:add|schedule|create|complete|do|finish|call|email|text|set up|organize|remember to)\\s+(?:['"]?)(.+?)(?:['"]?)(?:\\s+(?:to|for|in|on)\\s+(?:my\\s+|the\\s+)?(?:to\\s*do|todo)\\s+list)?$`);

            const shoppingMatchRefined = lowerActionItem.match(shoppingPatternRefined);
            if (shoppingMatchRefined && shoppingMatchRefined[1]) { itemToAdd = shoppingMatchRefined[1].trim(); targetListKey = LOCALSTORAGE_KEYS.SHOPPING_LIST; targetListName = "Shopping List"; } 
            else { const todoMatchRefined = lowerActionItem.match(todoPatternRefined); if (todoMatchRefined && todoMatchRefined[1]) { itemToAdd = todoMatchRefined[1].trim(); targetListKey = LOCALSTORAGE_KEYS.TODO_LIST; targetListName = "To-Do List"; }}
            
            if (itemToAdd && targetListKey && targetListName) {
              setAlertDialogConfig({
                title: `AI Suggestion: Add to ${targetListName}?`,
                description: <>The AI refined this to: "<strong>{actionItem}</strong>". Add "<strong>{itemToAdd}</strong>" to your {targetListName}?</>,
                itemText: itemToAdd, listKey: targetListKey, listName: targetListName, dataToRecallOnCancel: processedData,
                onConfirm: () => { addListItem(targetListKey!, itemToAdd!, targetListName!); },
                actionLabel: targetListName === "Shopping List" ? "Add Item" : "Add Task"
              });
              setIsAlertDialogOpen(true); aiSuggestionHandled = true; dialogShownForAISuggestion = true; break; 
            }
          }
        }

        if (!aiSuggestionHandled && !dialogShownForAISuggestion) { 
           onThoughtRecalled({ id: crypto.randomUUID(), timestamp: Date.now(), ...processedData });
           if (processedData.aiAnswer) toast({ title: "Thought Processed", description: "AI answered your question."});
           else toast({ title: "Thought Processed", description: "AI analysis complete." });
           actionExecutedWithoutDialog = true;
        }
      } catch (error) {
        toast({ title: "Error Processing Thought", description: (error as Error).message, variant: "destructive" });
        actionExecutedWithoutDialog = true; 
      } finally {
         // Only reset if a dialog wasn't opened or if an action was executed without a dialog
         if (!isAlertDialogOpen && !dialogShownForAISuggestion) {
           setIsLoading(false);
           if(actionExecutedWithoutDialog) setInputText('');    
        }
      }
    }, [
        inputText, toast, onThoughtRecalled, addListItem, deleteListItem, startAudioRecordingForSnippet, 
        onEmptyRecalledThoughts, clearShoppingList, completeAllToDoTasks
    ]);
    
    const handleDashboardMicClick = useCallback(async () => {
        if (isDashboardDictationActive) {
            if (dashboardDictationRecognitionRef.current) { try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/} }
            if (dashboardDictationPauseTimeoutRef.current) { clearTimeout(dashboardDictationPauseTimeoutRef.current); }
            setIsDashboardDictationActive(false);
            // Process text if any was dictated and pause timeout didn't already handle it
            if (dashboardDictationFinalTranscriptRef.current.trim()) {
              setInputText(dashboardDictationFinalTranscriptRef.current.trim());
              // Don't auto-submit, user clicks Brain icon
            }
            dashboardDictationFinalTranscriptRef.current = ''; // Clear after use or stop
            return;
        }

        if (isBrowserUnsupported || hasMicPermission === false) { toast({ title: "Mic Unavailable", variant: "destructive" }); return; }
        if (isLoading || isCapturingAudioForSnippet || isCapturingAudioForLongRecording) { 
            toast({ title: "System Busy", description: "Another audio process is active or system is loading.", variant: "default" }); 
            return; 
        }
        
        let currentMicPermission = hasMicPermission;
        if (hasMicPermission === null) { 
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                stream.getTracks().forEach(track => track.stop());
                setHasMicPermission(true);
                currentMicPermission = true;
            } catch (err) {
                setHasMicPermission(false);
                toast({ title: "Mic Access Denied", variant: "destructive" }); return;
            }
        }
        if (currentMicPermission === false) return;

        const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognitionAPI) return; 

        if (dashboardDictationRecognitionRef.current) { try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/} }
        if (dashboardDictationPauseTimeoutRef.current) { clearTimeout(dashboardDictationPauseTimeoutRef.current); }
        
        dashboardDictationFinalTranscriptRef.current = ''; 
        setInputText(''); 

        const recognition = new SpeechRecognitionAPI();
        dashboardDictationRecognitionRef.current = recognition;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onstart = () => {
            setIsDashboardDictationActive(true);
            dashboardDictationFinalTranscriptRef.current = '';
            setInputText('');
        };

        recognition.onresult = (event: SpeechRecognitionEvent) => {
            if (dashboardDictationPauseTimeoutRef.current) { clearTimeout(dashboardDictationPauseTimeoutRef.current); }
            
            let fullTranscriptThisSession = "";
            for (let i = 0; i < event.results.length; ++i) {
                fullTranscriptThisSession += event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    fullTranscriptThisSession += ' '; // Add space after final segments for better accumulation
                }
            }
            fullTranscriptThisSession = fullTranscriptThisSession.trim();
            setInputText(fullTranscriptThisSession); // Live update in textarea

            const lowerTranscriptForEndCheck = fullTranscriptThisSession.toLowerCase();
            const endCommand = WAKE_WORDS.END_DICTATION.toLowerCase();
            const stopCommand = WAKE_WORDS.STOP_DICTATION.toLowerCase();

            if (lowerTranscriptForEndCheck.endsWith(endCommand) || lowerTranscriptForEndCheck.endsWith(stopCommand)) {
                let finalText = fullTranscriptThisSession;
                if (lowerTranscriptForEndCheck.endsWith(endCommand)) { 
                    finalText = fullTranscriptThisSession.substring(0, fullTranscriptThisSession.toLowerCase().lastIndexOf(WAKE_WORDS.END_DICTATION.toLowerCase())).trim();
                } else if (lowerTranscriptForEndCheck.endsWith(stopCommand)) { 
                    finalText = fullTranscriptThisSession.substring(0, fullTranscriptThisSession.toLowerCase().lastIndexOf(WAKE_WORDS.STOP_DICTATION.toLowerCase())).trim();
                }
                dashboardDictationFinalTranscriptRef.current = finalText;
                setInputText(finalText);
                if (dashboardDictationRecognitionRef.current) { try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/} }
            } else {
                dashboardDictationPauseTimeoutRef.current = setTimeout(() => {
                    if (dashboardDictationRecognitionRef.current) { try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/} }
                }, 2000); 
            }
        };
        recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
            if (dashboardDictationPauseTimeoutRef.current) { clearTimeout(dashboardDictationPauseTimeoutRef.current); }
            if (event.error === 'aborted') { console.info('Dashboard dictation aborted.'); }
            else if (event.error === 'no-speech' && isDashboardDictationActive) { console.warn("No speech detected for dictation"); } 
            else if (event.error !== 'no-speech' && event.error !== 'aborted') { 
                console.error('Dashboard dictation error:', event.error, event.message); 
                toast({ title: "Dictation Error", description: event.message || "An unknown error occurred.", variant: "destructive" }); 
            }
            setIsDashboardDictationActive(false);
            dashboardDictationFinalTranscriptRef.current = inputText.trim(); // Save whatever was transcribed before error
        };
        recognition.onend = () => {
            setIsDashboardDictationActive(false);
            if (dashboardDictationPauseTimeoutRef.current) { clearTimeout(dashboardDictationPauseTimeoutRef.current); }
            dashboardDictationRecognitionRef.current = null;
            // Ensure final transcript is in inputText, if not already set by stop command or error
            if (inputText.trim() !== dashboardDictationFinalTranscriptRef.current.trim()) {
                setInputText(dashboardDictationFinalTranscriptRef.current.trim());
            }
            // User then clicks Brain icon to process.
        };
        recognition.start();
    }, [
        isBrowserUnsupported, hasMicPermission, isLoading, isCapturingAudioForSnippet, 
        isDashboardDictationActive, toast, isCapturingAudioForLongRecording, inputText // Added inputText
    ]);

    const startLongRecording = useCallback(async (): Promise<boolean> => {
      console.log('[ThoughtInputForm] Attempting to startLongRecording. States:', {
        isBrowserUnsupported,
        hasMicPermission: String(hasMicPermission), // Log actual value
        isLoading,
        isCapturingAudioForSnippet,
        isDashboardDictationActive,
        isCapturingAudioForLongRecording,
      });

      if (isBrowserUnsupported || hasMicPermission === false) {
        toast({ title: "Mic Unavailable", description: isBrowserUnsupported ? "Browser not supported." : "Mic permission denied.", variant: "destructive" });
        return false;
      }
      if (isLoading || isCapturingAudioForSnippet || isDashboardDictationActive || isCapturingAudioForLongRecording) {
        toast({ title: "System Busy", description: "Another audio process is active or system is loading.", variant: "default" });
        return false;
      }
       if (hasMicPermission === null) { 
           toast({ title: "Mic permission pending", description:"Please respond to the browser's microphone permission prompt.", variant:"default"});
           return false;
       }

      const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognitionAPI || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        toast({ title: "Browser Not Supported for Continuous Recording", variant: "destructive" });
        return false;
      }

      const startRecordingFlow = async (): Promise<boolean> => {
        setIsCapturingAudioForLongRecording(true); 
        longRecordingTranscriptRef.current = '';
        longRecordingAudioChunksRef.current = [];
        setInputText(''); 

        try {
          longRecordingSpeechRecognizerRef.current = new SpeechRecognitionAPI();
          const recognizer = longRecordingSpeechRecognizerRef.current;
          recognizer.continuous = true;
          recognizer.interimResults = true;
          recognizer.lang = 'en-US';

          recognizer.onstart = () => {
             longRecordingTranscriptRef.current = ''; 
             setInputText('');
          }; 

          recognizer.onresult = (event: SpeechRecognitionEvent) => {
            let fullTranscriptThisSession = "";
            for (let i = 0; i < event.results.length; ++i) {
                fullTranscriptThisSession += event.results[i][0].transcript;
                 if (event.results[i].isFinal) {
                    fullTranscriptThisSession += ' '; 
                }
            }
            setInputText(fullTranscriptThisSession.trim());
          };
          
          recognizer.onerror = (event: SpeechRecognitionErrorEvent) => {
             if (event.error === 'aborted') { console.info("Continuous recording speech recognition aborted (intentional stop)"); }
             else if (event.error === 'no-speech') { console.warn("Continuous recording: no speech detected."); }
             else { 
                console.error("Continuous recording speech recognition error:", event.error, event.message); 
                if(event.message) toast({ title: "Continuous Recording Transcription Error", description: event.message, variant: "destructive" }); 
            }
          };
          
          recognizer.onend = () => {
            // The final transcript should already be in inputText due to onresult
            // This ref is for potential use if we needed to access it directly before setInputText finishes
            longRecordingTranscriptRef.current = inputText.trim(); 
            
            // No automatic processing here, just update states
            // The setInputText in onresult handles live updates.
            // The parent component's stop handler (onStopLongRecordingParent) will be called from stopLongRecordingAndProcess.
            // setIsCapturingAudioForLongRecording(false); // This will be handled by stopLongRecordingAndProcess or parent
            // onStopLongRecordingParent(); // This is called by stopLongRecordingAndProcess
            // No toast here for stopping, parent shows "Processing" if it proceeds to process.
            longRecordingSpeechRecognizerRef.current = null;
          };
          
          recognizer.start();

          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          longRecordingMediaRecorderRef.current = new MediaRecorder(stream);
          longRecordingMediaRecorderRef.current.ondataavailable = (event) => {
            if (event.data.size > 0) longRecordingAudioChunksRef.current.push(event.data);
          };
          
          longRecordingMediaRecorderRef.current.onstop = async () => {
            stream.getTracks().forEach(track => track.stop());
            longRecordingAudioChunksRef.current = []; 
            // Transcript is already in inputText from SpeechRecognition's onresult.
            // The parent component will handle what to do with inputText.
            // No direct processing call here.
             if (isCapturingAudioForLongRecording) { // Ensure this is only called if it was actually stopping this mode
                setIsCapturingAudioForLongRecording(false);
                onStopLongRecordingParent(); 
                // A toast is typically shown by the parent after this (e.g. "Recording stopped, processing...")
                // For now, let's keep it simple: text is in inputText, user clicks Brain.
                if (inputText.trim()) {
                     toast({ title: "Recording Stopped", description: "Transcript populated. Click Brain icon to process." });
                } else {
                    toast({ title: "Recording Stopped", description: "No speech detected. Transcript area empty." });
                }
            }
          };
          longRecordingMediaRecorderRef.current.start();
          return true; 

        } catch (err) {
          console.error("Error starting continuous recording:", err);
          toast({ title: "Continuous Recording Error", description: (err as Error).message, variant: "destructive" });
          setIsCapturingAudioForLongRecording(false); 
          if (longRecordingSpeechRecognizerRef.current) { try { longRecordingSpeechRecognizerRef.current.stop(); } catch (e) {/* ignore */}}
          if (longRecordingMediaRecorderRef.current?.state === "recording") {
            try { longRecordingMediaRecorderRef.current.stop(); } catch (e) {/* ignore */}
          }
          onStopLongRecordingParent(); 
          return false; 
        }
      };
      return startRecordingFlow();
    }, [
        isBrowserUnsupported, hasMicPermission, isLoading, isCapturingAudioForSnippet,
        isDashboardDictationActive, isCapturingAudioForLongRecording,
        toast, onStopLongRecordingParent, inputText // Added inputText
    ]);

    const stopLongRecordingAndProcess = useCallback(() => {
      if (!isCapturingAudioForLongRecording && !isExternallyLongRecording) {
        if (isExternallyLongRecording) onStopLongRecordingParent(); 
        return;
      }

      if (longRecordingSpeechRecognizerRef.current) {
        try { 
          longRecordingSpeechRecognizerRef.current.stop(); 
        } catch(e) { console.warn("Error stopping long recording speech recognizer:", e); }
      }
      // MediaRecorder's onstop will handle the rest of the logic (like setting inputText and calling onStopLongRecordingParent)
      if (longRecordingMediaRecorderRef.current?.state === "recording") {
        try { 
          longRecordingMediaRecorderRef.current.stop(); 
        } 
        catch(e) { 
          console.error("Error stopping long recording media recorder:", e);
          // Fallback if mediarecorder onstop doesn't fire or errors out
          setIsCapturingAudioForLongRecording(false);
          onStopLongRecordingParent();
          longRecordingTranscriptRef.current = inputText.trim(); // Ensure transcript is captured
           if (longRecordingTranscriptRef.current) {
               toast({ title: "Recording Stopped (Fallback)", description: "Transcript populated. Click Brain icon to process." });
           } else {
               toast({ title: "Recording Stopped (Fallback)", description: "No speech detected during recording." });
           }
        }
      } else {
        // If media recorder was never started or already stopped, ensure state is consistent
        setIsCapturingAudioForLongRecording(false);
        onStopLongRecordingParent();
        longRecordingTranscriptRef.current = inputText.trim(); 
         if (longRecordingTranscriptRef.current) {
            toast({ title: "Recording Finalized", description: "Transcript populated. Click Brain icon to process." });
        } else if (isExternallyLongRecording) { // If it was externally controlled and stopped, but no text
            toast({ title: "Recording Stopped", description: "No speech detected." });
        }
      }
    }, [
        isCapturingAudioForLongRecording, onStopLongRecordingParent, 
        isExternallyLongRecording, inputText, toast // Added inputText, toast
    ]);
    
    // Sync external recording state with internal
    useEffect(() => {
        if (isExternallyLongRecording && !isCapturingAudioForLongRecording) {
            startLongRecording();
        } else if (!isExternallyLongRecording && isCapturingAudioForLongRecording) {
             stopLongRecordingAndProcess();
        }
    }, [isExternallyLongRecording, isCapturingAudioForLongRecording, startLongRecording, stopLongRecordingAndProcess]);


    useEffect(() => {
      const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognitionAPI) {
        setIsBrowserUnsupported(true);
        setHasMicPermission(false);
        return;
      }
      setIsBrowserUnsupported(false);

      if (hasMicPermission === null) {
        navigator.mediaDevices.getUserMedia({ audio: true })
          .then((stream) => {
            stream.getTracks().forEach(track => track.stop());
            setHasMicPermission(true);
          })
          .catch(err => {
            console.warn("Initial mic permission check error:", err.name, err.message);
            setHasMicPermission(false);
          });
      }
      
      // Cleanup effect for all speech recognition and media recorder instances
      return () => {
        if (snippetRecognitionRef.current) { try { snippetRecognitionRef.current.stop(); } catch(e) {/*ignore*/} snippetRecognitionRef.current = null; }
        if (snippetMediaRecorderRef.current?.state === "recording") { try { snippetMediaRecorderRef.current.stop(); } catch(e) {/*ignore*/} snippetMediaRecorderRef.current = null; }
        
        if (longRecordingSpeechRecognizerRef.current) { try { longRecordingSpeechRecognizerRef.current.stop(); } catch(e) {/*ignore*/} longRecordingSpeechRecognizerRef.current = null; }
        if (longRecordingMediaRecorderRef.current?.state === "recording") { try { longRecordingMediaRecorderRef.current.stop(); } catch(e) {/*ignore*/} longRecordingMediaRecorderRef.current = null; }
        
        if (dashboardDictationRecognitionRef.current) { try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/} dashboardDictationRecognitionRef.current = null; }
        if (dashboardDictationPauseTimeoutRef.current) { clearTimeout(dashboardDictationPauseTimeoutRef.current); }
      };
    }, [hasMicPermission]); // Added hasMicPermission to re-check if it changes
    

    const getDashboardDictationButtonIcon = () => {
 if (isDashboardDictationActive) {
 return <Radio className="h-12 w-12 text-blue-500 animate-pulse" />; // Blue when working, doubled size
 }
 if (isBrowserUnsupported || hasMicPermission === false || isLoading || isCapturingAudioForSnippet || isCapturingAudioForLongRecording || isExternallyLongRecording) {
 // Grey when not selectable (browser unsupported, permission denied, system busy with other audio/loading)
 return <MicOff className="h-12 w-12 text-gray-500" />; // Grey, doubled size
 }
 // Green when can be selected (browser supported, permission granted, system not busy)
 return <Mic className="h-12 w-12 text-green-500" />; // Green, doubled size

    };
    
    const getMicStatusText = (): React.ReactNode => {
        if (isBrowserUnsupported) return "Voice input not supported by browser.";
        if (hasMicPermission === false) return "Mic permission denied. Please enable in browser settings.";
        if (hasMicPermission === null) return "Checking microphone permission...";

        if (isCapturingAudioForLongRecording || isExternallyLongRecording) return <span className="text-red-500 animate-pulse">Continuous recording active... Transcript populates below. Click stop when done.</span>;
        if (isCapturingAudioForSnippet) return <span className="text-orange-500 animate-pulse">Recording 10s audio & speech for 'heggles replay that'...</span>;
        if (isDashboardDictationActive) {
          return (
            <span className="text-blue-500 animate-pulse">
              Heggling in Progress... Press Stop Dictation when finished.
            </span>
          );
        }
        
        if (isLoading && !isAlertDialogOpen) return "Processing thought...";
        
        return "Use header mic for continuous recording. Use card mic for dictation. Click Brain to process.";
    };

    const getTextareaPlaceholder = (): string => {
      if (isCapturingAudioForLongRecording || isExternallyLongRecording) return "Continuous recording active. Transcript will populate here. Click Brain icon to process when stopped.";
      if (isDashboardDictationActive) return "Dictate your thought... Click mic again, or say 'Heggles end/stop', or pause to finish.";
      if (isCapturingAudioForSnippet) return "Recording 10s audio & speech for 'heggles replay that' processing...";
      if (isLoading && !isAlertDialogOpen) return "Processing...";
      
      return "Type thought or use a microphone. Click Brain icon to process text.";
    };
    
    return (
      <>
        <Card className="w-full shadow-lg">
          <CardHeader>
            <CardTitle className="text-xl">Input & Recall</CardTitle>
            <CardDescription>
              Use the header microphone for continuous recording, or the microphone below for dictation into the text area. Click the <Brain aria-hidden="true" className="inline-block h-3.5 w-3.5 align-middle"/> icon to process the text.
            </CardDescription>
             <div className="text-xs text-muted-foreground pt-1 min-h-[1.25rem] flex items-center">
                {getMicStatusText()}
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {(isBrowserUnsupported && hasMicPermission === null && !isCapturingAudioForLongRecording && !isDashboardDictationActive && !isCapturingAudioForSnippet) && (
                <Alert variant="destructive" className="mb-4">
                  <AlertTriangleIcon className="h-4 w-4" />
                  <UiAlertTitle>Browser May Not Support Speech</UiAlertTitle>
                  <UiAlertDescription>Speech recognition features may not be available.</UiAlertDescription>
                </Alert>
              )}
              {(hasMicPermission === false && !isBrowserUnsupported && !isCapturingAudioForLongRecording && !isDashboardDictationActive && !isCapturingAudioForSnippet) && ( 
                <Alert variant="destructive" className="mb-4">
                  <AlertTriangleIcon className="h-4 w-4" />
                  <UiAlertTitle>Microphone Access Denied</UiAlertTitle>
                  <UiAlertDescription>Voice input features require microphone access. Please enable it in your browser settings for this site.</UiAlertDescription>
                </Alert>
              )}

              <Textarea
                placeholder={getTextareaPlaceholder()}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                rows={4}
                disabled={isLoading || isCapturingAudioForSnippet || isCapturingAudioForLongRecording || isDashboardDictationActive || isExternallyLongRecording}
                className="resize-none"
                aria-label="Thought input area"
              />
              <div className="flex items-stretch gap-2">
                <Button
                  type="button"
                  onClick={handleDashboardMicClick}
                  disabled={isBrowserUnsupported || hasMicPermission === false || isLoading || isCapturingAudioForSnippet || isCapturingAudioForLongRecording || isExternallyLongRecording}
                  size="icon"
                  variant="outline"
 aria-label={isDashboardDictationActive ? "Stop dictation" : "Dictate thought into text area"}
                  title={isDashboardDictationActive ? "Stop dictation (or say 'Heggles end/stop' or pause)" : "Dictate thought into text area"}
                >
                  {getDashboardDictationButtonIcon()}
                </Button>
                <Button
                  type="button"
                  onClick={handleProcessInputText}
                  disabled={isLoading || isCapturingAudioForSnippet || isCapturingAudioForLongRecording || !inputText.trim() || isExternallyLongRecording || isDashboardDictationActive}
                  size="icon"
                  variant="outline"
 aria-label="Process text from input area with AI"
                  title="Process text from input area with AI"
                >
                  {/* Blue when working (isLoading AND no alert dialog open, indicating processing) */}
 {isLoading && !isAlertDialogOpen && inputText.trim() ? ( // Blue when working, doubled size
 <Loader2 className="h-12 w-12 animate-spin text-blue-500" />
                  ) : /* Green when can be selected (not loading, input text exists, not busy) */ !isLoading &&
                    inputText.trim() &&
                    !isCapturingAudioForSnippet &&
                    !isCapturingAudioForLongRecording &&
                    !isExternallyLongRecording &&
                    !isDashboardDictationActive ? (<Brain className="h-12 w-12 text-green-500" /> ) : ( <Brain className="h-12 w-12 text-gray-500" />) }

                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {alertDialogConfig && (
          <AlertDialog
            open={isAlertDialogOpen}
            onOpenChange={(open) => {
              setIsAlertDialogOpen(open);
              if (!open) {
                if (!confirmedDialogActionRef.current && alertDialogConfig.dataToRecallOnCancel) {
                  // If suggestion was declined and dataToRecallOnCancel exists (meaning it was AI suggestion of some sort),
                  // treat it as a general question/thought if it wasn't a list add suggestion.
                  // If it WAS a list add suggestion that was declined, the full original thought is in dataToRecallOnCancel
                  // and will be processed as a general thought/question.
                  // onThoughtRecalled({ id: crypto.randomUUID(), timestamp: Date.now(), ...alertDialogConfig.dataToRecallOnCancel }); // Moved this inside the if below
                  onThoughtRecalled({ id: crypto.randomUUID(), timestamp: Date.now(), ...alertDialogConfig.dataToRecallOnCancel });
                  toast({ title: "Suggestion Declined", description: "Original thought captured in Recent Thoughts." });
                }
                confirmedDialogActionRef.current = false; 
                setAlertDialogConfig(null); 
                setIsLoading(false); 
                setInputText('');    
              }
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{alertDialogConfig.title}</AlertDialogTitle>
                <AlertDialogDescription>
                  {alertDialogConfig.description}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => { 
                    confirmedDialogActionRef.current = false;
                    // State is handled by onOpenChange when dialog closes
                    // No need to explicitly setInputText here as onOpenChange will handle it
                }}>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => {
                  if (alertDialogConfig) {
                    confirmedDialogActionRef.current = true; 
                    alertDialogConfig.onConfirm();
                  }
                  // Closing and resetting is handled by onOpenChange
                }}>{alertDialogConfig.actionLabel || "Confirm"}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </>
    );
  });

ThoughtInputForm.displayName = "ThoughtInputForm";

    