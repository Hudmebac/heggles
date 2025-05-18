
"use client";

import React, { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Brain, Loader2, Mic, Radio, AlertTriangleIcon, PlayCircle, StopCircle, MicOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle as UiAlertTitle } from '@/components/ui/alert';
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

    // Main command listener ("Heggles" wake word)
    const [isRecognizingSpeech, setIsRecognizingSpeech] = useState(false);
    const [partialWakeWordDetected, setPartialWakeWordDetected] = useState(false);
    const recognitionRef = useRef<SpeechRecognition | null>(null);
    const utteranceTranscriptRef = useRef<string>(''); 
    const commandProcessedSuccessfullyRef = useRef<boolean>(false);

    // For "Heggles replay that" (10s snippet recording & transcription)
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
    const accumulatedDictationTranscriptRef = useRef<string>(''); 
    

    // Alert Dialog for confirmations
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
    }, [hasMicPermission]);


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
      if (hasMicPermission === null) {
        toast({ title: "Mic permission pending", variant:"default"}); return;
      }

      const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognitionAPI || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          toast({ title: "Browser Not Supported for Snippet Recording", variant: "destructive" });
          return;
      }
      
      // Ensure main command listener is stopped if active
      if (recognitionRef.current) {
        commandProcessedSuccessfullyRef.current = true; // Treat this initiation as a command success for the main listener
        try { recognitionRef.current.stop(); } catch (e) { console.warn("Error stopping main recognizer before snippet:", e); }
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
          stream.getTracks().forEach(track => track.stop());
          const audioBlob = new Blob(snippetAudioChunksRef.current, { type: 'audio/webm' }); // Or appropriate mime type
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
            if (event.results[i].isFinal) finalizedThisTurn += event.results[i][0].transcript + ' ';
            else interim += event.results[i][0].transcript;
          }
          if(finalizedThisTurn) snippetTranscriptRef.current = (snippetTranscriptRef.current + finalizedThisTurn).trim();
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
          if (snippetMediaRecorderRef.current?.state === "recording") snippetMediaRecorderRef.current.stop();
          if (snippetRecognitionRef.current) { try { snippetRecognitionRef.current.stop(); } catch (e) {/* ignore */} }
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
    

    const parseSpokenBufferTime = useCallback((spokenText: string): string | null => {
      const lowerSpokenText = spokenText.toLowerCase();
      for (const option of WAKE_WORDS.BUFFER_TIME_MAP) {
          if (lowerSpokenText.includes(option.spoken.toLowerCase())) {
              return option.value;
          }
      }
      if (lowerSpokenText.includes(WAKE_WORDS.BUFFER_ALWAYS_ON.spoken.toLowerCase())) {
          return WAKE_WORDS.BUFFER_ALWAYS_ON.value;
      }
      return null;
    }, []);


    const setBufferTimeByVoice = useCallback((fullCommand: string) => {
        const prefix = `${WAKE_WORDS.HEGGLES_BASE} ${WAKE_WORDS.HEGGLES_SET_BUFFER_PREFIX}`.toLowerCase();
        const durationSpoken = fullCommand.toLowerCase().substring(prefix.length).trim();
        const selectedBufferTime = parseSpokenBufferTime(durationSpoken);

        if (selectedBufferTime) {
            localStorage.setItem(LOCALSTORAGE_KEYS.BUFFER_TIME, selectedBufferTime);
            window.dispatchEvent(new StorageEvent('storage', { key: LOCALSTORAGE_KEYS.BUFFER_TIME, newValue: selectedBufferTime }));
            toast({ title: "Buffer Time Set", description: `Conceptual buffer time set to ${durationSpoken}.` });
        } else {
            toast({ title: "Buffer Time Not Understood", description: `Could not parse "${durationSpoken}". Please try "1 minute", "always on", etc.`, variant: "default" });
        }
        setInputText('');
        setPartialWakeWordDetected(false);
    }, [toast, parseSpokenBufferTime, setInputText, setPartialWakeWordDetected]);
    

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
      
      // Direct commands from text input
      if (lowerText === WAKE_WORDS.HEGGLES_REPLAY_THAT.toLowerCase()) {
        await startAudioRecordingForSnippet(); 
        setInputText(''); 
        setIsLoading(false); // startAudioRecordingForSnippet handles its own loading state and sets to false
        return; 
      }

      const shoppingListAddPattern = new RegExp(`^${hegglesBaseLower}\\s+${WAKE_WORDS.HEGGLES_ADD_TO_SHOPPING_LIST_PREFIX.substring(hegglesBaseLower.length).trim().toLowerCase()}\\s+(.+?)(?:\\s+${WAKE_WORDS.TO_SHOPPING_LIST_SUFFIX_REGEX_PART.toLowerCase()})?$`);
      const shoppingListAddMatch = lowerText.match(shoppingListAddPattern);
      
      const todoListAddPattern = new RegExp(`^${hegglesBaseLower}\\s+${WAKE_WORDS.HEGGLES_ADD_TO_TODO_LIST_PREFIX.substring(hegglesBaseLower.length).trim().toLowerCase()}\\s+(.+?)(?:\\s+${WAKE_WORDS.TO_TODO_LIST_SUFFIX_REGEX_PART.toLowerCase()})?$`);
      const todoListAddMatch = lowerText.match(todoListAddPattern);
            
      const deleteListPattern = new RegExp(`^${hegglesBaseLower}\\s+${WAKE_WORDS.DELETE_ITEM_PREFIX.toLowerCase()}\\s+(.*?)(?:\\s+${WAKE_WORDS.FROM_SHOPPING_LIST_TRIGGER.toLowerCase()}|\\s+${WAKE_WORDS.FROM_TODO_LIST_TRIGGER.toLowerCase()})$`);
      const deleteListMatch = lowerText.match(deleteListPattern);

      const emptyRecentPattern = new RegExp(`^${WAKE_WORDS.EMPTY_RECENT_THOUGHTS_COMMAND.toLowerCase()}`);
      const clearShoppingPattern = new RegExp(`^${WAKE_WORDS.CLEAR_SHOPPING_LIST_COMMAND.toLowerCase()}`);
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
      
      // If no direct command, process as general text thought with AI
      try {
        const processedData = await processTextThought(textToProcess);
        let aiSuggestionHandled = false;

        if (processedData.intentAnalysis) {
            const intent = processedData.intentAnalysis;
            if (intent.isAction && intent.extractedAction) {
                const actionLower = intent.extractedAction.toLowerCase();
                if (actionLower === WAKE_WORDS.EMPTY_RECENT_THOUGHTS_COMMAND.toLowerCase()) {
                    setAlertDialogConfig({ title: "AI Suggestion: Empty Recent Thoughts?", description: "The AI suggests clearing recent thoughts. Proceed?", onConfirm: onEmptyRecalledThoughts, actionLabel: "Empty Thoughts", dataToRecallOnCancel: processedData });
                    setIsAlertDialogOpen(true); aiSuggestionHandled = true; dialogShownForAISuggestion = true;
                } else if (actionLower === WAKE_WORDS.CLEAR_SHOPPING_LIST_COMMAND.toLowerCase()) {
                    setAlertDialogConfig({ title: "AI Suggestion: Clear Shopping List?", description: "The AI suggests clearing your shopping list. Proceed?", onConfirm: clearShoppingList, actionLabel: "Clear List", dataToRecallOnCancel: processedData });
                    setIsAlertDialogOpen(true); aiSuggestionHandled = true; dialogShownForAISuggestion = true;
                } else if (actionLower.startsWith(completeAllPrefixLower) && (actionLower.endsWith(completeAllSuffixTodoLower) || actionLower.endsWith(completeAllSuffixTodosLower))) {
                    setAlertDialogConfig({ title: "AI Suggestion: Complete All To-Do Tasks?", description: "The AI suggests completing all to-do tasks. Proceed?", onConfirm: completeAllToDoTasks, actionLabel: "Complete All", dataToRecallOnCancel: processedData });
                    setIsAlertDialogOpen(true); aiSuggestionHandled = true; dialogShownForAISuggestion = true;
                } else if (intent.suggestedList && intent.suggestedList !== 'none') {
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
            }
        }
        
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

        if (!aiSuggestionHandled && !dialogShownForAISuggestion) { // Ensure not to recall if a dialog was shown but cancelled
           onThoughtRecalled({ id: crypto.randomUUID(), timestamp: Date.now(), ...processedData });
           if (processedData.aiAnswer) toast({ title: "Thought Processed", description: "AI answered your question."});
           else toast({ title: "Thought Processed", description: "AI analysis complete." });
           actionExecutedWithoutDialog = true;
        }
      } catch (error) {
        toast({ title: "Error Processing Thought", description: (error as Error).message, variant: "destructive" });
        actionExecutedWithoutDialog = true; 
      } finally {
         if (!isAlertDialogOpen && !dialogShownForAISuggestion) {
           setIsLoading(false);
           if(actionExecutedWithoutDialog) setInputText('');    
        }
      }
    }, [
        inputText, toast, onThoughtRecalled, addListItem, deleteListItem, onEmptyRecalledThoughts, 
        clearShoppingList, completeAllToDoTasks, startAudioRecordingForSnippet, isAlertDialogOpen, 
        setInputText, setIsLoading, setAlertDialogConfig, setIsAlertDialogOpen
    ]);
    
    // Main command listener ("Heggles" wake word)
    useEffect(() => {
        const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
        const shouldBeListening = !isDashboardDictationActive && !isCapturingAudioForSnippet && !isCapturingAudioForLongRecording && !isLoading;

        if (shouldBeListening && hasMicPermission === true && SpeechRecognitionAPI) {
            if (!recognitionRef.current) {
                const recognition = new SpeechRecognitionAPI();
                recognitionRef.current = recognition;
                recognition.continuous = true;
                recognition.interimResults = true;
                recognition.lang = 'en-US';

                recognition.onstart = () => {
                    setIsRecognizingSpeech(true);
                    utteranceTranscriptRef.current = '';
                    setPartialWakeWordDetected(false);
                    commandProcessedSuccessfullyRef.current = false;
                };

                recognition.onresult = (event: SpeechRecognitionEvent) => {
                    let interimTranscript = '';
                    let newlyFinalizedSegmentThisTurn = '';
                    let lastResultIsFinal = false;

                    for (let i = event.resultIndex; i < event.results.length; ++i) {
                        const segment = event.results[i][0].transcript;
                        if (event.results[i].isFinal) {
                            newlyFinalizedSegmentThisTurn += segment + ' ';
                            lastResultIsFinal = true;
                        } else {
                            interimTranscript += segment;
                        }
                    }
                    
                    const hegglesBaseLower = WAKE_WORDS.HEGGLES_BASE.toLowerCase();

                    if (!partialWakeWordDetected && newlyFinalizedSegmentThisTurn.toLowerCase().trim().startsWith(hegglesBaseLower)) {
                        setPartialWakeWordDetected(true);
                        utteranceTranscriptRef.current = newlyFinalizedSegmentThisTurn.trim() + " ";
                    } else if (partialWakeWordDetected && newlyFinalizedSegmentThisTurn) {
                         utteranceTranscriptRef.current += newlyFinalizedSegmentThisTurn.trim() + " ";
                    }
                    
                    if (partialWakeWordDetected) {
                        setInputText((utteranceTranscriptRef.current + interimTranscript).trim());
                    }


                    if (lastResultIsFinal && partialWakeWordDetected) {
                        const finalUtterance = utteranceTranscriptRef.current.trim().toLowerCase();
                        console.log("[ThoughtInputForm] Final utterance:", finalUtterance);
                        let commandMatched = false;

                        if (finalUtterance === WAKE_WORDS.HEGGLES_TURN_OFF.toLowerCase()) {
                            onEmptyRecalledThoughts(); // Example of immediate action - replace with actual parent toggle
                            toast({ title: "Voice Commands Deactivated" });
                            setInputText(''); setPartialWakeWordDetected(false); utteranceTranscriptRef.current = '';
                            commandMatched = true; commandProcessedSuccessfullyRef.current = true;
                        } else if (finalUtterance === WAKE_WORDS.HEGGLES_TURN_ON.toLowerCase()) {
                            // Logic to inform parent to enable listening (if it was programmatically controllable)
                            toast({ title: "Voice Commands Activated" });
                            setInputText(''); setPartialWakeWordDetected(false); utteranceTranscriptRef.current = '';
                            commandMatched = true; commandProcessedSuccessfullyRef.current = true;
                        } else if (finalUtterance.startsWith(WAKE_WORDS.HEGGLES_BASE.toLowerCase() + " " + WAKE_WORDS.HEGGLES_SET_BUFFER_PREFIX.toLowerCase())) {
                            setBufferTimeByVoice(finalUtterance); // This also clears inputText
                            commandMatched = true; commandProcessedSuccessfullyRef.current = true;
                        } else if (finalUtterance === WAKE_WORDS.HEGGLES_REPLAY_THAT.toLowerCase()) {
                            // This is now handled by Brain button, text already populated by setInputText above.
                            // User needs to click Brain.
                            // For direct voice action, we'd call startAudioRecordingForSnippet here.
                            // For now, let's assume "replay that" in text area -> brain button click.
                             commandMatched = true; commandProcessedSuccessfullyRef.current = true; // To clear utterance for next command.
                        }
                        // Other commands (add, delete) are handled by handleProcessInputText after Brain click
                        // If it's "Heggles" + something not an immediate command, it populates inputText for Brain.
                        // So, if it's just "heggles" or "heggles some random text", commandMatched remains false here for the immediate actions.
                        // but utteranceTranscriptRef is populated and will be handled.

                        if (commandMatched && recognitionRef.current) {
                            try { recognitionRef.current.stop(); } catch(e) {console.warn("Error stopping main recognizer after command:", e);}
                        } else if (finalUtterance === hegglesBaseLower) {
                            // Just "heggles" was said. Keep listening.
                            commandProcessedSuccessfullyRef.current = false;
                        } else if (finalUtterance.startsWith(hegglesBaseLower)) {
                            // "heggles" + something else, populates input. Stop this session.
                            commandProcessedSuccessfullyRef.current = true; 
                            if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch(e) {console.warn("Error stopping main recognizer after partial command for input:", e);} }
                        }
                    }
                };

                recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
                    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
                        setHasMicPermission(false);
                        toast({ title: "Microphone Access Issue", description: "Speech recognition service denied. Check browser settings or permissions.", variant: "destructive" });
                    } else if (event.error === 'network') {
                         toast({ title: "Network Error", description: "Speech recognition requires a network connection.", variant: "destructive" });
                    } else if (event.error !== 'aborted' && event.error !== 'no-speech') {
                         console.error('Main command recognition error:', event.error, event.message);
                    }
                    setIsRecognizingSpeech(false);
                    setPartialWakeWordDetected(false);
                };

                recognition.onend = () => {
                    setIsRecognizingSpeech(false);
                    if (recognitionRef.current) {
                        recognitionRef.current.onstart = null;
                        recognitionRef.current.onresult = null;
                        recognitionRef.current.onerror = null;
                        recognitionRef.current.onend = null;
                        recognitionRef.current = null;
                    }
                    if (commandProcessedSuccessfullyRef.current) {
                        setPartialWakeWordDetected(false);
                        utteranceTranscriptRef.current = '';
                    }
                    // The useEffect will re-evaluate and restart if shouldBeListening is still true
                };
                
                try {
                    recognition.start();
                } catch (e) {
                    console.error("Error starting main command recognition:", e);
                    toast({title: "Recognition Error", description: "Could not start voice commands.", variant: "destructive"});
                    if (recognitionRef.current) {
                        recognitionRef.current = null; // Ensure it's null so it can be re-initialized
                    }
                    setIsRecognizingSpeech(false);
                }
            }
        } else {
            if (recognitionRef.current) {
                commandProcessedSuccessfullyRef.current = true; // Signal that any active session should clean up fully.
                try { recognitionRef.current.stop(); } catch (e) { console.warn("Error stopping main recognizer due to shouldBeListening false:", e); }
            }
        }

        return () => {
            if (recognitionRef.current) {
                commandProcessedSuccessfullyRef.current = true;
                try { recognitionRef.current.stop(); } catch(e) {/* ignore */}
                recognitionRef.current = null;
            }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        hasMicPermission, 
        isLoading, 
        isDashboardDictationActive, 
        isCapturingAudioForSnippet, 
        isCapturingAudioForLongRecording, 
        toast,
        // onToggleListeningParent, // Removed if not used for *starting* recognition here
        setBufferTimeByVoice,    // memoized
        onEmptyRecalledThoughts, // memoized
        onThoughtRecalled,       // memoized
        addListItem,             // memoized
        deleteListItem,          // memoized
        isRecognizingSpeech      // Added dependency
    ]);
    
    
    // Dashboard dictation mic
    const handleDashboardMicClick = useCallback(async () => {
        if (isDashboardDictationActive) {
            if (dashboardDictationRecognitionRef.current) { try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/} }
            if (dashboardDictationPauseTimeoutRef.current) { clearTimeout(dashboardDictationPauseTimeoutRef.current); }
            setIsDashboardDictationActive(false);
            // After stopping, content is in inputText. User clicks Brain to process.
            if (inputText.trim()) {
                handleProcessInputText(); // Auto-process on stop if there's content
            }
            return;
        }

        if (isBrowserUnsupported || hasMicPermission === false) { toast({ title: "Mic Unavailable", variant: "destructive" }); return; }
        if (isLoading || isCapturingAudioForSnippet || isRecognizingSpeech || isCapturingAudioForLongRecording) { toast({ title: "System Busy", variant: "default" }); return; }
        
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
        
        accumulatedDictationTranscriptRef.current = ''; 
        setInputText(''); 

        const recognition = new SpeechRecognitionAPI();
        dashboardDictationRecognitionRef.current = recognition;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onstart = () => {
            setIsDashboardDictationActive(true);
            accumulatedDictationTranscriptRef.current = '';
            setInputText('');
        };

        recognition.onresult = (event: SpeechRecognitionEvent) => {
            if (dashboardDictationPauseTimeoutRef.current) { clearTimeout(dashboardDictationPauseTimeoutRef.current); }
            let interim = ""; let currentDictationTranscript = accumulatedDictationTranscriptRef.current;
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                const segment = event.results[i][0].transcript;
                if (event.results[i].isFinal) { currentDictationTranscript += segment + ' '; } 
                else { interim += segment; }
            }
            accumulatedDictationTranscriptRef.current = currentDictationTranscript.trim();
            setInputText((currentDictationTranscript + " " + interim).trim());

            const lowerTranscriptForEndCheck = (currentDictationTranscript + " " + interim).trim().toLowerCase();
            const endCommand = WAKE_WORDS.END_DICTATION.toLowerCase();
            const stopCommand = WAKE_WORDS.STOP_DICTATION.toLowerCase();

            if (lowerTranscriptForEndCheck.endsWith(endCommand) || lowerTranscriptForEndCheck.endsWith(stopCommand)) {
                 let finalSpokenText = accumulatedDictationTranscriptRef.current; 
                if (lowerTranscriptForEndCheck.endsWith(endCommand)) { finalSpokenText = finalSpokenText.substring(0, finalSpokenText.length - endCommand.length).trim(); } 
                else if (lowerTranscriptForEndCheck.endsWith(stopCommand)) { finalSpokenText = finalSpokenText.substring(0, finalSpokenText.length - stopCommand.length).trim(); }
                accumulatedDictationTranscriptRef.current = finalSpokenText;
                setInputText(finalSpokenText);
                if (dashboardDictationRecognitionRef.current) { try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/} }
            } else {
                dashboardDictationPauseTimeoutRef.current = setTimeout(() => {
                    if (dashboardDictationRecognitionRef.current) { try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/} }
                }, 2000); // 2-second pause
            }
        };
        recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
            if (dashboardDictationPauseTimeoutRef.current) { clearTimeout(dashboardDictationPauseTimeoutRef.current); }
            if (event.error === 'aborted') { /* console.info('Dashboard dictation aborted.'); */ }
            else if (event.error === 'no-speech' && isDashboardDictationActive) { /* console.warn("No speech detected for dictation"); */ } 
            else if (event.error !== 'no-speech' && event.error !== 'aborted') { 
                console.error('Dashboard dictation error:', event.error, event.message); 
                toast({ title: "Dictation Error", description: event.message || "An unknown error occurred.", variant: "destructive" }); 
            }
            setIsDashboardDictationActive(false);
        };
        recognition.onend = () => {
            setIsDashboardDictationActive(false);
            if (dashboardDictationPauseTimeoutRef.current) { clearTimeout(dashboardDictationPauseTimeoutRef.current); }
            dashboardDictationRecognitionRef.current = null;
            // Auto-submit if text is present
            if (inputText.trim()) {
                handleProcessInputText();
            }
        };
        recognition.start();
    }, [
        isBrowserUnsupported, hasMicPermission, isLoading, isCapturingAudioForSnippet, 
        isDashboardDictationActive, toast, isRecognizingSpeech, isCapturingAudioForLongRecording,
        inputText, handleProcessInputText // Added inputText & handleProcessInputText for auto-submit
    ]);

    const startLongRecording = useCallback(async (): Promise<boolean> => {
      console.log('[ThoughtInputForm] Attempting to startLongRecording. States:', {
        isBrowserUnsupported,
        hasMicPermission,
        isLoading,
        isCapturingAudioForSnippet,
        isDashboardDictationActive,
        isCapturingAudioForLongRecording,
        isRecognizingSpeech
      });

      if (isBrowserUnsupported || hasMicPermission === false) {
        toast({ title: "Mic Unavailable", description: isBrowserUnsupported ? "Browser not supported." : "Mic permission denied.", variant: "destructive" });
        return false;
      }
      if (isLoading || isCapturingAudioForSnippet || isDashboardDictationActive || isRecognizingSpeech || isCapturingAudioForLongRecording) {
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
        longRecordingTranscriptRef.current = '';
        longRecordingAudioChunksRef.current = [];
        setInputText(''); 

        try {
          setIsCapturingAudioForLongRecording(true); 
          
          longRecordingSpeechRecognizerRef.current = new SpeechRecognitionAPI();
          const recognizer = longRecordingSpeechRecognizerRef.current;
          recognizer.continuous = true;
          recognizer.interimResults = true;
          recognizer.lang = 'en-US';

          recognizer.onstart = () => {
            // console.log("Continuous recording speech recognition started.");
             longRecordingTranscriptRef.current = ''; // Ensure transcript is clear at start
          }; 

          recognizer.onresult = (event: SpeechRecognitionEvent) => {
            let interim = ""; let finalizedThisTurn = "";
            for (let i = event.resultIndex; i < event.results.length; ++i) {
              if (event.results[i].isFinal) finalizedThisTurn += event.results[i][0].transcript + ' ';
              else interim += event.results[i][0].transcript;
            }
            if (finalizedThisTurn) longRecordingTranscriptRef.current = (longRecordingTranscriptRef.current + finalizedThisTurn).trim();
            setInputText(longRecordingTranscriptRef.current + (interim ? " " + interim.trim() : ""));
          };
          
          recognizer.onerror = (event: SpeechRecognitionErrorEvent) => {
             if (event.error === 'aborted') { console.info("Continuous recording speech recognition aborted (intentional stop)"); }
             else if (event.error === 'no-speech') { /* This is fine for continuous */ }
             else { 
                console.error("Continuous recording speech recognition error:", event.error, event.message); 
                // Avoid toast if message is empty, which can happen on some 'aborted' scenarios if not caught above
                if(event.message) toast({ title: "Continuous Recording Transcription Error", description: event.message, variant: "destructive" }); 
            }
          };
          
          recognizer.onend = () => {
            longRecordingSpeechRecognizerRef.current = null;
            // MediaRecorder.onstop will handle transcript population and parent notification
          };
          
          recognizer.start();

          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          longRecordingMediaRecorderRef.current = new MediaRecorder(stream);
          longRecordingMediaRecorderRef.current.ondataavailable = (event) => {
            if (event.data.size > 0) longRecordingAudioChunksRef.current.push(event.data);
          };
          
          longRecordingMediaRecorderRef.current.onstop = async () => {
            stream.getTracks().forEach(track => track.stop());
            const finalTranscriptToSet = longRecordingTranscriptRef.current.trim();
            
            setInputText(finalTranscriptToSet);
            setIsCapturingAudioForLongRecording(false); // Set this before calling parent
            onStopLongRecordingParent(); // Notify parent that recording has stopped


            if (finalTranscriptToSet) {
              toast({ title: "Recording Stopped", description: "Transcript populated. Click Brain icon to process." });
            } else {
              toast({ title: "Recording Stopped", description: "No speech detected during recording." });
            }
            longRecordingAudioChunksRef.current = []; 
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
        isDashboardDictationActive, isCapturingAudioForLongRecording, isRecognizingSpeech,
        toast, onStopLongRecordingParent, setInputText
    ]);

    const stopLongRecordingAndProcess = useCallback(() => {
      if (!isCapturingAudioForLongRecording) {
        if (isExternallyLongRecording) { 
            onStopLongRecordingParent();
        }
        return;
      }

      if (longRecordingSpeechRecognizerRef.current) {
        try { longRecordingSpeechRecognizerRef.current.stop(); } catch(e) { /* ignore */ }
      }
      if (longRecordingMediaRecorderRef.current?.state === "recording") {
        try { longRecordingMediaRecorderRef.current.stop(); } 
        catch(e) { 
          console.error("Error stopping media recorder:", e);
          const finalTranscript = longRecordingTranscriptRef.current.trim();
          setInputText(finalTranscript); 
          setIsCapturingAudioForLongRecording(false);
          onStopLongRecordingParent();
           if (finalTranscript) toast({ title: "Recording Stopped (Error)", description: "Transcript populated." });
           else toast({ title: "Recording Stopped (Error)", description: "No speech detected." });
        }
      } else { 
        // This case might happen if speech recognition stops first, then this is called.
        // MediaRecorder.onstop would have already handled most things.
        const finalTranscript = longRecordingTranscriptRef.current.trim();
        setInputText(finalTranscript);
        setIsCapturingAudioForLongRecording(false);
        onStopLongRecordingParent();
      }
    }, [
        isCapturingAudioForLongRecording, onStopLongRecordingParent, 
        setInputText, toast, isExternallyLongRecording
    ]);
    
    useImperativeHandle(ref, () => ({
      startLongRecording,
      stopLongRecordingAndProcess,
    }), [startLongRecording, stopLongRecordingAndProcess]);
    
    useEffect(() => {
        if (isExternallyLongRecording && !isCapturingAudioForLongRecording) {
            startLongRecording();
        } else if (!isExternallyLongRecording && isCapturingAudioForLongRecording) {
             stopLongRecordingAndProcess();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isExternallyLongRecording, isCapturingAudioForLongRecording, startLongRecording, stopLongRecordingAndProcess]);


    useEffect(() => {
      return () => {
        if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch(e) {/*ignore*/} recognitionRef.current = null; }
        if (snippetRecognitionRef.current) { try { snippetRecognitionRef.current.stop(); } catch(e) {/*ignore*/} snippetRecognitionRef.current = null; }
        if (snippetMediaRecorderRef.current?.state === "recording") { try { snippetMediaRecorderRef.current.stop(); } catch(e) {/*ignore*/} snippetMediaRecorderRef.current = null; }
        if (longRecordingSpeechRecognizerRef.current) { try { longRecordingSpeechRecognizerRef.current.stop(); } catch(e) {/*ignore*/} longRecordingSpeechRecognizerRef.current = null; }
        if (longRecordingMediaRecorderRef.current?.state === "recording") { try { longRecordingMediaRecorderRef.current.stop(); } catch(e) {/*ignore*/} longRecordingMediaRecorderRef.current = null; }
        if (dashboardDictationRecognitionRef.current) { try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/} dashboardDictationRecognitionRef.current = null; }
        if (dashboardDictationPauseTimeoutRef.current) { clearTimeout(dashboardDictationPauseTimeoutRef.current); }
      };
    }, []);
    

    const getDashboardDictationButtonIcon = () => {
        if (isDashboardDictationActive) return <Radio className="h-5 w-5 text-red-500 animate-pulse" />;
        if (isBrowserUnsupported || hasMicPermission === false) return <MicOff className="h-5 w-5 text-muted-foreground" />;
        return <Mic className="h-5 w-5" />;
    };
    
    const getMicStatusText = (): React.ReactNode => {
        if (isBrowserUnsupported) return "Voice input not supported by browser.";
        if (hasMicPermission === false) return "Mic permission denied.";
        if (hasMicPermission === null) return "Voice status checking...";

        if (isCapturingAudioForLongRecording) return <span className="text-red-500 animate-pulse">Continuous recording active... Transcript populates below.</span>;
        if (isCapturingAudioForSnippet) return <span className="text-orange-500 animate-pulse">Recording 10s audio & speech for 'Heggles replay that'...</span>;
        if (isDashboardDictationActive) {
          return (
            <span className="text-blue-500 animate-pulse">
              Heggling in Progress... Press Stop Dictation when finished.
            </span>
          );
        }
        if (partialWakeWordDetected) {
          return <span className="text-yellow-500 animate-pulse">&apos;<strong>Heggles</strong>&apos; detected, awaiting command...</span>;
        }
        if (isRecognizingSpeech) {
          return "Say '<strong>Heggles</strong>' + command (e.g., 'Heggles replay that', 'Heggles add bread to shopping list').";
        }
        if (isLoading && !isAlertDialogOpen) return "Processing thought...";
        
        return "Ready. Use header mic for continuous recording or type below. Click Brain to process.";
    };

    const getTextareaPlaceholder = (): string => {
      if (isCapturingAudioForLongRecording) return "Continuous recording active. Transcript populates here. Click Brain icon to process when stopped.";
      if (isDashboardDictationActive) return "Dictate your thought... Click mic again, say 'Heggles end/stop', or pause to finish.";
      if (isLoading && !isAlertDialogOpen) return "Processing...";
      if (partialWakeWordDetected) return "'Heggles' detected. Finish your command...";
      if (isRecognizingSpeech) return "Listening for 'Heggles' + command...";
      
      return "Type thought, or use header mic for continuous recording. Click Brain icon to process text.";
    };
    

    return (
      <>
        <Card className="w-full shadow-lg">
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle className="text-xl">Input & Recall</CardTitle>
            </div>
            <CardDescription>
             Use header <Mic className="inline-block h-3.5 w-3.5 align-middle"/> / <Radio className="inline-block h-3.5 w-3.5 align-middle text-red-500"/> for continuous recording. 
             Transcript populates below. Click <Brain className="inline-block h-3.5 w-3.5 align-middle"/> to process.
            </CardDescription>
             <div className="text-xs text-muted-foreground pt-1 min-h-[1.25rem] flex items-center">
                {getMicStatusText()}
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {isBrowserUnsupported && hasMicPermission === null && (
                <Alert variant="destructive" className="mb-4">
                  <AlertTriangleIcon className="h-4 w-4" />
                  <UiAlertTitle>Browser May Not Support Speech</UiAlertTitle>
                  <AlertDescription>Speech recognition may not be supported.</AlertDescription>
                </Alert>
              )}
              {hasMicPermission === false && !isBrowserUnsupported && ( 
                <Alert variant="destructive" className="mb-4">
                  <AlertTriangleIcon className="h-4 w-4" />
                  <UiAlertTitle>Microphone Access Denied</UiAlertTitle>
                  <AlertDescription>Voice input requires microphone access.</AlertDescription>
                </Alert>
              )}

              <Textarea
                placeholder={getTextareaPlaceholder()}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                rows={4}
                disabled={isLoading || isCapturingAudioForSnippet || isCapturingAudioForLongRecording || isDashboardDictationActive || isRecognizingSpeech}
                className="resize-none"
                aria-label="Thought input area"
              />
              <div className="flex items-stretch gap-2">
                <Button
                  type="button"
                  onClick={handleDashboardMicClick}
                  disabled={isBrowserUnsupported || hasMicPermission === false || isLoading || isCapturingAudioForSnippet || isRecognizingSpeech || isCapturingAudioForLongRecording }
                  size="icon"
                  variant="outline"
                  aria-label={isDashboardDictationActive ? "Stop dictation" : "Start dictation into text area"}
                  title={isDashboardDictationActive ? "Stop dictation (or say 'Heggles end/stop' or pause)" : "Dictate thought into text area"}
                >
                  {getDashboardDictationButtonIcon()}
                </Button>
                <Button
                  type="button"
                  onClick={handleProcessInputText}
                  disabled={isLoading || isCapturingAudioForSnippet || !inputText.trim() || isDashboardDictationActive || isRecognizingSpeech || isCapturingAudioForLongRecording }
                  size="icon"
                  aria-label="Process text from input area with AI"
                  title="Process text from input area with AI"
                  variant="outline"
                >
                  {(isLoading && !isAlertDialogOpen && inputText.trim()) ? <Loader2 className="h-5 w-5 animate-spin" /> : <Brain className="h-5 w-5" />}
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
                    // onOpenChange (triggered by closing) will handle the rest
                }}>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => {
                  if (alertDialogConfig) {
                    confirmedDialogActionRef.current = true; 
                    alertDialogConfig.onConfirm();
                  }
                }}>{alertDialogConfig.actionLabel || "Confirm"}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </>
    );
  });

ThoughtInputForm.displayName = "ThoughtInputForm";

