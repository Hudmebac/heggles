
"use client";

import React, { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Brain, Loader2, Mic, Radio, AlertTriangleIcon, PlayCircle, StopCircle } from 'lucide-react';
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
  startLongRecording: () => boolean;
  stopLongRecordingAndProcess: () => void;
}

export const ThoughtInputForm = forwardRef<ThoughtInputFormHandle, ThoughtInputFormProps>(
  ({ onThoughtRecalled, onEmptyRecalledThoughts, isExternallyLongRecording, onStopLongRecordingParent }, ref) => {
    const [inputText, setInputText] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const { toast } = useToast();
    
    const [hasMicPermission, setHasMicPermission] = useState<boolean | null>(null);
    const [isBrowserUnsupported, setIsBrowserUnsupported] = useState(false);

    // Main command listener (wake word "Heggles")
    const [isRecognizingSpeech, setIsRecognizingSpeech] = useState(false);
    const [partialWakeWordDetected, setPartialWakeWordDetected] = useState(false);
    const recognitionRef = useRef<SpeechRecognition | null>(null);
    const utteranceTranscriptRef = useRef<string>('');
    const commandProcessedSuccessfullyRef = useRef<boolean>(false);

    // Dashboard mic button dictation
    const [isDashboardDictationActive, setIsDashboardDictationActive] = useState(false);
    const dashboardDictationRecognitionRef = useRef<SpeechRecognition | null>(null);
    const dashboardDictationPauseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const accumulatedDictationTranscriptRef = useRef<string>('');

    // For "Heggles replay that" - 10s snippet recording & transcription
    const [isCapturingAudioForSnippet, setIsCapturingAudioForSnippet] = useState(false);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const snippetRecognitionRef = useRef<SpeechRecognition | null>(null);
    const snippetTranscriptRef = useRef<string>('');
    const audioChunksRef = useRef<Blob[]>([]);
    
    // Continuous recording (header button)
    const [isCapturingAudioForLongRecording, setIsCapturingAudioForLongRecording] = useState(false);
    const longRecordingMediaRecorderRef = useRef<MediaRecorder | null>(null);
    const longRecordingSpeechRecognizerRef = useRef<SpeechRecognition | null>(null);
    const longRecordingTranscriptRef = useRef<string>('');
    const longRecordingAudioChunksRef = useRef<Blob[]>([]);

    // Alert Dialog
    const [alertDialogConfig, setAlertDialogConfig] = useState<{
      title: string;
      description: React.ReactNode;
      itemText?: string;
      listKey?: string;
      listName?: string;
      dataToRecallOnCancel?: Omit<Thought, "id" | "timestamp">; // Store full thought for recall on cancel
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


    const parseSpokenBufferTime = useCallback((spokenDuration: string): string | null => {
        const lowerSpoken = spokenDuration.toLowerCase().replace("always on", "always-on"); // Normalize "always on"
        const option = WAKE_WORDS.BUFFER_TIME_OPTIONS.find(opt => 
            lowerSpoken.includes(opt.label.toLowerCase().replace("always on (continuous)", "always-on")) ||
            lowerSpoken.includes(opt.value.toLowerCase())
        );
        return option ? option.value : null;
    }, []);

    const setBufferTimeByVoice = useCallback((spokenDuration: string) => {
        const bufferValue = parseSpokenBufferTime(spokenDuration);
        if (bufferValue) {
            localStorage.setItem(LOCALSTORAGE_KEYS.BUFFER_TIME, bufferValue);
            window.dispatchEvent(new StorageEvent('storage', { key: LOCALSTORAGE_KEYS.BUFFER_TIME, newValue: bufferValue }));
            toast({ title: "Buffer Time Updated", description: `Conceptual buffer time set to ${WAKE_WORDS.BUFFER_TIME_OPTIONS.find(opt => opt.value === bufferValue)?.label || bufferValue}.` });
            setInputText('');
            setPartialWakeWordDetected(false); // Reset after command
        } else {
            toast({ title: "Buffer Time Not Understood", description: `Could not recognize "${spokenDuration}" as a valid buffer time. Try "1 minute", "always on", etc.`, variant: "destructive" });
        }
        commandProcessedSuccessfullyRef.current = true;
    }, [toast, parseSpokenBufferTime, setInputText, setPartialWakeWordDetected]);
    

    const startAudioRecordingForSnippet = useCallback(async () => {
      if (!hasMicPermission) {
        toast({ title: "Microphone Permission Required", description: "Please grant microphone access to record audio.", variant: "destructive" });
        return;
      }
      if (isLoading || isCapturingAudioForSnippet || isDashboardDictationActive || isCapturingAudioForLongRecording) {
        toast({ title: "System Busy", description: "Another audio process is active.", variant: "default" });
        return;
      }

      const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognitionAPI || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          toast({ title: "Browser Not Supported", description: "Audio recording or speech recognition not supported.", variant: "destructive" });
          return false;
      }

      setIsCapturingAudioForSnippet(true);
      setIsLoading(true); // Show loading while recording and processing
      toast({ title: "Recording Audio Snippet...", description: `Recording ${RECORDING_DURATION_MS / 1000}s of audio and speech.` });
      
      audioChunksRef.current = [];
      snippetTranscriptRef.current = '';

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // Start MediaRecorder for audio blob
        mediaRecorderRef.current = new MediaRecorder(stream);
        mediaRecorderRef.current.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };

        mediaRecorderRef.current.onstop = async () => {
          stream.getTracks().forEach(track => track.stop()); // Stop all tracks from this stream
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          const reader = new FileReader();
          reader.readAsDataURL(audioBlob);
          reader.onloadend = async () => {
            const base64AudioData = reader.result as string;
            const liveTranscript = snippetTranscriptRef.current.trim();
            
            try {
              const processedData = await processRecordedAudio(base64AudioData, liveTranscript);
              onThoughtRecalled({ id: crypto.randomUUID(), timestamp: Date.now(), ...processedData });
              toast({ title: "Recorded Snippet Processed", description: "AI analysis of recorded audio complete." });
            } catch (error) {
              toast({ title: "Error Processing Recorded Snippet", description: (error as Error).message, variant: "destructive" });
            } finally {
              setIsLoading(false);
              setIsCapturingAudioForSnippet(false);
              // Do not clear inputText here as this flow doesn't populate it directly for user submission
            }
          };
          audioChunksRef.current = [];
        };

        // Start SpeechRecognition for live transcript during snippet
        snippetRecognitionRef.current = new SpeechRecognitionAPI();
        const snippetRecognizer = snippetRecognitionRef.current;
        snippetRecognizer.continuous = true; // Listen throughout the snippet duration
        snippetRecognizer.interimResults = true;
        snippetRecognizer.lang = 'en-US';
        
        snippetRecognizer.onresult = (event: SpeechRecognitionEvent) => {
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
          // No need to update inputText here as this is for background transcription of the snippet
        };
        
        snippetRecognizer.onerror = (event: SpeechRecognitionErrorEvent) => {
          console.warn("Snippet recognition error:", event.error, event.message);
          // Don't show toast for minor errors during snippet, main processing toast is enough
        };

        snippetRecognizer.onend = () => {
          snippetRecognitionRef.current = null;
        };

        mediaRecorderRef.current.start();
        snippetRecognizer.start();

        setTimeout(() => {
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
            mediaRecorderRef.current.stop();
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
      hasMicPermission, isLoading, isCapturingAudioForSnippet, isDashboardDictationActive, isCapturingAudioForLongRecording, 
      toast, onThoughtRecalled
    ]);


    const handleProcessInputText = useCallback(async () => {
      const textToProcess = inputText.trim();
      if (!textToProcess) {
        toast({ title: "Input empty", description: "Cannot process an empty thought.", variant: "destructive" });
        return;
      }
      
      setIsLoading(true);
      const hegglesBaseLower = WAKE_WORDS.HEGGLES_BASE.toLowerCase();
      const lowerText = textToProcess.toLowerCase(); // Processed from inputText

      // Check for "heggles replay that" specifically from text input
      if (lowerText === WAKE_WORDS.HEGGLES_REPLAY_THAT.toLowerCase()) {
          startAudioRecordingForSnippet(); // This sets isLoading itself and handles toast
          setInputText(''); // Clear input after initiating replay
          // startAudioRecordingForSnippet also sets isLoading to false when done
          return; // Don't proceed with further text processing
      }

      // Pattern matching for "heggles add..." and "heggles delete..." from text input
      const shoppingListAddPattern = new RegExp(`^${hegglesBaseLower}\\s+${WAKE_WORDS.HEGGLES_ADD_TO_SHOPPING_LIST_PREFIX.substring(hegglesBaseLower.length).trim()}\\s+(.+?)(?:\\s+${WAKE_WORDS.TO_SHOPPING_LIST_SUFFIX_REGEX_PART.toLowerCase()})?$`);
      const shoppingListAddMatch = lowerText.match(shoppingListAddPattern);
      
      const todoListAddPattern = new RegExp(`^${hegglesBaseLower}\\s+${WAKE_WORDS.HEGGLES_ADD_TO_TODO_LIST_PREFIX.substring(hegglesBaseLower.length).trim()}\\s+(.+?)(?:\\s+${WAKE_WORDS.TO_TODO_LIST_SUFFIX_REGEX_PART.toLowerCase()})?$`);
      const todoListAddMatch = lowerText.match(todoListAddPattern);
            
      const deleteListPattern = new RegExp(`^${hegglesBaseLower}\\s+${WAKE_WORDS.DELETE_ITEM_PREFIX.toLowerCase()}\\s+(.*?)(?:\\s+${WAKE_WORDS.FROM_SHOPPING_LIST_TRIGGER.toLowerCase()}|\\s+${WAKE_WORDS.FROM_TODO_LIST_TRIGGER.toLowerCase()})$`);
      const deleteListMatch = lowerText.match(deleteListPattern);

      if (shoppingListAddMatch && shoppingListAddMatch[1]) {
        const item = shoppingListAddMatch[1].trim();
        confirmedDialogActionRef.current = false;
        setAlertDialogConfig({
          title: "Add to Shopping List?",
          description: <>Do you want to add <strong>"{item}"</strong> to your shopping list?</>,
          itemText: item,
          listKey: LOCALSTORAGE_KEYS.SHOPPING_LIST,
          listName: "Shopping List",
          onConfirm: () => { addListItem(LOCALSTORAGE_KEYS.SHOPPING_LIST, item, "Shopping List"); },
          actionLabel: "Add Item"
        });
        setIsAlertDialogOpen(true);
        return; 
      } else if (todoListAddMatch && todoListAddMatch[1]) {
        const task = todoListAddMatch[1].trim();
        confirmedDialogActionRef.current = false;
        setAlertDialogConfig({
          title: "Add to To-Do List?",
          description: <>Do you want to add <strong>"{task}"</strong> to your to-do list?</>,
          itemText: task,
          listKey: LOCALSTORAGE_KEYS.TODO_LIST,
          listName: "To-Do List",
          onConfirm: () => { addListItem(LOCALSTORAGE_KEYS.TODO_LIST, task, "To-Do List"); },
          actionLabel: "Add Task"
        });
        setIsAlertDialogOpen(true);
        return;
      } else if (deleteListMatch && deleteListMatch[1]) {
        const itemIdentifierStr = deleteListMatch[1].trim();
        let listKey = "";
        let listName = "";

        if (lowerText.includes(WAKE_WORDS.FROM_SHOPPING_LIST_TRIGGER.toLowerCase())) {
          listKey = LOCALSTORAGE_KEYS.SHOPPING_LIST; listName = "Shopping List";
        } else if (lowerText.includes(WAKE_WORDS.FROM_TODO_LIST_TRIGGER.toLowerCase())) {
          listKey = LOCALSTORAGE_KEYS.TODO_LIST; listName = "To-Do List";
        }

        if (listKey && itemIdentifierStr) {
          confirmedDialogActionRef.current = false;
          const itemNumberPrefixLower = WAKE_WORDS.ITEM_NUMBER_PREFIX.toLowerCase();
          let isDeletingByNumber = false;
          let itemNumberToDelete = -1;
          let itemNameToDelete = itemIdentifierStr;

          if (itemIdentifierStr.toLowerCase().startsWith(itemNumberPrefixLower)) {
            const numberStr = itemIdentifierStr.substring(itemNumberPrefixLower.length).trim();
            itemNumberToDelete = parseInt(numberStr, 10);
            if (!isNaN(itemNumberToDelete) && itemNumberToDelete > 0) isDeletingByNumber = true;
            else {
              toast({ title: "Invalid Item Number", description: `"${numberStr}" is not valid.`, variant: "default" });
              setIsLoading(false); setInputText(''); return;
            }
          }
          
          setAlertDialogConfig({
            title: `Delete from ${listName}?`,
            description: isDeletingByNumber 
              ? <>Are you sure you want to delete item number <strong>{itemNumberToDelete}</strong> from your {listName}?</>
              : <>Are you sure you want to delete "<strong>{itemNameToDelete}</strong>" from your {listName}?</>,
            onConfirm: () => {
              if (isDeletingByNumber) deleteListItem(listKey, itemNumberToDelete, listName);
              else deleteListItem(listKey, itemNameToDelete, listName);
            },
            actionLabel: "Delete"
          });
          setIsAlertDialogOpen(true);
          return; 
        }
      } else if (lowerText === WAKE_WORDS.EMPTY_RECENT_THOUGHTS_COMMAND.toLowerCase()) {
        confirmedDialogActionRef.current = false;
        setAlertDialogConfig({
            title: "Empty Recent Thoughts?",
            description: "Are you sure you want to clear all thoughts from the 'Recent Thoughts' list on the dashboard?",
            onConfirm: onEmptyRecalledThoughts,
            actionLabel: "Empty Thoughts"
        });
        setIsAlertDialogOpen(true);
        return;
      } else if (lowerText === WAKE_WORDS.CLEAR_SHOPPING_LIST_COMMAND.toLowerCase()) {
        confirmedDialogActionRef.current = false;
        setAlertDialogConfig({
            title: "Clear Shopping List?",
            description: "Are you sure you want to remove all items from your shopping list?",
            onConfirm: clearShoppingList,
            actionLabel: "Clear List"
        });
        setIsAlertDialogOpen(true);
        return;
      } else if (lowerText.startsWith(WAKE_WORDS.COMPLETE_ALL_TASKS_PREFIX.toLowerCase()) && 
          (lowerText.endsWith(WAKE_WORDS.COMPLETE_ALL_TASKS_COMMAND_SUFFIX_TODO.toLowerCase()) || lowerText.endsWith(WAKE_WORDS.COMPLETE_ALL_TASKS_COMMAND_SUFFIX_TODOS.toLowerCase()))) {
        confirmedDialogActionRef.current = false;
        setAlertDialogConfig({
            title: "Complete All To-Do Tasks?",
            description: "Are you sure you want to mark all tasks in your to-do list as complete?",
            onConfirm: completeAllToDoTasks,
            actionLabel: "Complete All"
        });
        setIsAlertDialogOpen(true);
        return;
      }
      
      // If no direct command, process as general text thought
      try {
        const processedData = await processTextThought(textToProcess);
        let dialogShownForAISuggestion = false;
        let dataToRecallIfDialogCancelled: Omit<Thought, "id" | "timestamp"> | undefined = processedData;

        // Check if AI's extractedAction matches a known system command
        if (processedData.intentAnalysis?.isAction && processedData.intentAnalysis.extractedAction) {
            const aiActionLower = processedData.intentAnalysis.extractedAction.toLowerCase();

            if (aiActionLower === WAKE_WORDS.EMPTY_RECENT_THOUGHTS_COMMAND.toLowerCase()) {
                confirmedDialogActionRef.current = false;
                setAlertDialogConfig({
                    title: "AI Suggestion: Empty Recent Thoughts?",
                    description: "The AI understood this as a command to clear all recent thoughts. Proceed?",
                    onConfirm: onEmptyRecalledThoughts,
                    actionLabel: "Empty Thoughts",
                    dataToRecallOnCancel: dataToRecallIfDialogCancelled,
                });
                setIsAlertDialogOpen(true);
                dialogShownForAISuggestion = true;
                // Return here because dialog closure will handle loading state and input text
                return; 
            }
            if (aiActionLower === WAKE_WORDS.CLEAR_SHOPPING_LIST_COMMAND.toLowerCase()) {
                confirmedDialogActionRef.current = false;
                setAlertDialogConfig({
                    title: "AI Suggestion: Clear Shopping List?",
                    description: "The AI understood this as a command to clear your shopping list. Proceed?",
                    onConfirm: clearShoppingList,
                    actionLabel: "Clear List",
                    dataToRecallOnCancel: dataToRecallIfDialogCancelled,
                });
                setIsAlertDialogOpen(true);
                dialogShownForAISuggestion = true;
                return;
            }
            if (aiActionLower.startsWith(WAKE_WORDS.COMPLETE_ALL_TASKS_PREFIX.toLowerCase()) &&
                (aiActionLower.endsWith(WAKE_WORDS.COMPLETE_ALL_TASKS_COMMAND_SUFFIX_TODO.toLowerCase()) || 
                 aiActionLower.endsWith(WAKE_WORDS.COMPLETE_ALL_TASKS_COMMAND_SUFFIX_TODOS.toLowerCase()))) {
                confirmedDialogActionRef.current = false;
                setAlertDialogConfig({
                    title: "AI Suggestion: Complete All To-Do Tasks?",
                    description: "The AI understood this as a command to complete all to-do tasks. Proceed?",
                    onConfirm: completeAllToDoTasks,
                    actionLabel: "Complete All",
                    dataToRecallOnCancel: dataToRecallIfDialogCancelled,
                });
                setIsAlertDialogOpen(true);
                dialogShownForAISuggestion = true;
                return;
            }
        }

        // If AI suggested adding to a list (via intentAnalysis.suggestedList)
        if (!dialogShownForAISuggestion && 
            processedData.intentAnalysis?.isAction &&
            processedData.intentAnalysis.extractedAction &&
            processedData.intentAnalysis.suggestedList &&
            processedData.intentAnalysis.suggestedList !== 'none') {
          
          const action = processedData.intentAnalysis.extractedAction;
          const listKey = processedData.intentAnalysis.suggestedList === 'shopping' ? LOCALSTORAGE_KEYS.SHOPPING_LIST : LOCALSTORAGE_KEYS.TODO_LIST;
          const listName = processedData.intentAnalysis.suggestedList === 'shopping' ? "Shopping List" : "To-Do List";
          
          confirmedDialogActionRef.current = false;
          setAlertDialogConfig({
            title: `AI Suggestion: Add to ${listName}?`,
            description: <>The AI suggests adding "<strong>{action}</strong>" to your {listName}. Add it?</>,
            itemText: action,
            listKey: listKey,
            listName: listName,
            dataToRecallOnCancel: dataToRecallIfDialogCancelled,
            onConfirm: () => { addListItem(listKey, action, listName); },
            actionLabel: listName === "Shopping List" ? "Add Item" : "Add Task"
          });
          setIsAlertDialogOpen(true);
          dialogShownForAISuggestion = true;
          return; 
        }
        
        // Fallback: if AI suggested action items from refineThought, check those
        if (!dialogShownForAISuggestion && processedData.actionItems && processedData.actionItems.length > 0) {
          for (const actionItem of processedData.actionItems) {
            const lowerActionItem = actionItem.toLowerCase();
            let itemToAdd: string | null = null;
            let targetListKey: string | null = null;
            let targetListName: string | null = null;

            const shoppingPatternRefined = new RegExp(`(?:add|buy|get|purchase|pick up)\\s+(?:['"]?)(.+?)(?:['"]?)(?:\\s+(?:to|for|in|on)\\s+(?:my\\s+|the\\s+)?shopping\\s+list)?$`);
            const todoPatternRefined = new RegExp(`(?:add|schedule|create|complete|do|finish|call|email|text|set up|organize|remember to)\\s+(?:['"]?)(.+?)(?:['"]?)(?:\\s+(?:to|for|in|on)\\s+(?:my\\s+|the\\s+)?(?:to\\s*do|todo)\\s+list)?$`);

            const shoppingMatchRefined = lowerActionItem.match(shoppingPatternRefined);
            if (shoppingMatchRefined && shoppingMatchRefined[1]) {
              itemToAdd = shoppingMatchRefined[1].trim();
              targetListKey = LOCALSTORAGE_KEYS.SHOPPING_LIST;
              targetListName = "Shopping List";
            } else {
              const todoMatchRefined = lowerActionItem.match(todoPatternRefined);
              if (todoMatchRefined && todoMatchRefined[1]) {
                itemToAdd = todoMatchRefined[1].trim();
                targetListKey = LOCALSTORAGE_KEYS.TODO_LIST;
                targetListName = "To-Do List";
              }
            }

            if (itemToAdd && targetListKey && targetListName) {
              confirmedDialogActionRef.current = false;
              setAlertDialogConfig({
                title: `AI Suggestion: Add to ${targetListName}?`,
                description: <>The AI refined this to: "<strong>{actionItem}</strong>". Add "<strong>{itemToAdd}</strong>" to your {targetListName}?</>,
                itemText: itemToAdd,
                listKey: targetListKey,
                listName: targetListName,
                dataToRecallOnCancel: dataToRecallIfDialogCancelled,
                onConfirm: () => { addListItem(targetListKey!, itemToAdd!, targetListName!); },
                actionLabel: targetListName === "Shopping List" ? "Add Item" : "Add Task"
              });
              setIsAlertDialogOpen(true);
              dialogShownForAISuggestion = true;
              return; 
            }
          }
        }

        // If no dialog was shown for an AI suggestion, and it's not a question with an answer, recall thought
        if (!dialogShownForAISuggestion) {
           onThoughtRecalled({ id: crypto.randomUUID(), timestamp: Date.now(), ...processedData });
           if (processedData.aiAnswer) {
             toast({ title: "Thought Processed", description: "AI answered your question."});
           } else {
             toast({ title: "Thought Processed", description: "AI analysis complete." });
           }
        }
      } catch (error) {
        toast({ title: "Error Processing Thought", description: (error as Error).message, variant: "destructive" });
      } finally {
         if (!dialogShownForAISuggestion) {
           setIsLoading(false);
           setInputText('');
        }
      }
    }, [
        inputText, toast, onThoughtRecalled, addListItem, deleteListItem, startAudioRecordingForSnippet, 
        onEmptyRecalledThoughts, clearShoppingList, completeAllToDoTasks
    ]);


    // Effect to check for mic permission on mount
    useEffect(() => {
      const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognitionAPI) {
        setIsBrowserUnsupported(true);
        setHasMicPermission(false);
        return;
      }
      setIsBrowserUnsupported(false);

      if (hasMicPermission === null) { // Only check on initial mount if not already determined
        navigator.mediaDevices.getUserMedia({ audio: true })
          .then((stream) => {
            stream.getTracks().forEach(track => track.stop()); // Release mic immediately after permission check
            setHasMicPermission(true);
          })
          .catch(err => {
            console.warn("Microphone permission request error:", err.name, err.message);
            setHasMicPermission(false); // Could be 'denied' or another issue
          });
      }
    }, [hasMicPermission]);


    // Main "Heggles" command listener
    useEffect(() => {
      if (isBrowserUnsupported || isDashboardDictationActive || isCapturingAudioForSnippet || isCapturingAudioForLongRecording) {
        if (recognitionRef.current) {
          commandProcessedSuccessfullyRef.current = true; // Signal to clear state in onend
          recognitionRef.current.stop();
        }
        return;
      }

      const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognitionAPI) return;

      if (hasMicPermission === true && !recognitionRef.current) {
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
          let interimTranscript = "";
          let newlyFinalizedSegmentThisTurn = "";

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            const segment = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              newlyFinalizedSegmentThisTurn += segment + ' ';
            } else {
              interimTranscript += segment;
            }
          }
          
          const currentFullInterim = (utteranceTranscriptRef.current + newlyFinalizedSegmentThisTurn + interimTranscript).toLowerCase().trim();
          
          if (!partialWakeWordDetected && currentFullInterim.startsWith(WAKE_WORDS.HEGGLES_BASE.toLowerCase())) {
              setPartialWakeWordDetected(true);
              // Start populating utteranceTranscriptRef from "heggles" onwards
              utteranceTranscriptRef.current = currentFullInterim.substring(currentFullInterim.indexOf(WAKE_WORDS.HEGGLES_BASE.toLowerCase()));
          } else if (partialWakeWordDetected) {
              // Append new speech to the existing utterance that started with "heggles"
              utteranceTranscriptRef.current = (utteranceTranscriptRef.current + newlyFinalizedSegmentThisTurn).trim();
          }
          
          if (partialWakeWordDetected) {
            setInputText(utteranceTranscriptRef.current + (interimTranscript ? " " + interimTranscript.trim() : ""));
          }


          const lastResultIsFinal = event.results[event.results.length - 1].isFinal;
          if (lastResultIsFinal) {
            const finalUtterance = utteranceTranscriptRef.current.toLowerCase().trim();
            
            if (finalUtterance.startsWith(WAKE_WORDS.HEGGLES_BASE.toLowerCase())) {
                // Immediate actions
                if (finalUtterance === WAKE_WORDS.HEGGLES_TURN_ON.toLowerCase()) {
                    // This state is handled by parent via PassiveListenerControls, no direct action here other than acknowledging.
                    // Consider if a prop callback is needed if parent isn't already managing this via a global 'isListening' state.
                    toast({ title: "Listening is already ON" });
                    commandProcessedSuccessfullyRef.current = true;
                    if (recognitionRef.current) recognitionRef.current.stop();
                } else if (finalUtterance === WAKE_WORDS.HEGGLES_TURN_OFF.toLowerCase()) {
                    // Similar to TURN_ON, parent should manage this state.
                    // This command implies global listening state change.
                    // For now, we'll just toast and stop. Parent should handle actual toggling.
                    toast({ title: "Turning Listening OFF...", description: "Passive listening will be disabled." });
                    commandProcessedSuccessfullyRef.current = true; // Signal processing
                    // Parent component `page.tsx` should handle the actual toggling of listening state.
                    // This voice command doesn't directly call onToggleListeningParent from here currently.
                    // TODO: Potentially call onToggleListeningParent(false) if it's passed as a prop.
                    if (recognitionRef.current) recognitionRef.current.stop();
                } else if (finalUtterance.startsWith(WAKE_WORDS.HEGGLES_SET_BUFFER.toLowerCase())) {
                    const spokenDuration = finalUtterance.substring(WAKE_WORDS.HEGGLES_SET_BUFFER.toLowerCase().length).trim();
                    setBufferTimeByVoice(spokenDuration); // This sets commandProcessedSuccessfullyRef
                    if (recognitionRef.current) recognitionRef.current.stop();
                } else if (finalUtterance === WAKE_WORDS.HEGGLES_REPLAY_THAT.toLowerCase()) {
                    // "heggles replay that" will be processed by the Brain button from inputText
                    // So, just ensure it's in inputText and stop recognition for this turn.
                    setInputText(WAKE_WORDS.HEGGLES_REPLAY_THAT); // Ensure exact command is in input
                    commandProcessedSuccessfullyRef.current = true;
                    if (recognitionRef.current) recognitionRef.current.stop();
                } else {
                    // For other "heggles..." commands, they are now in inputText.
                    // User will click Brain icon. Signal this voice command cycle is done.
                    commandProcessedSuccessfullyRef.current = true;
                    if (recognitionRef.current) recognitionRef.current.stop();
                }
            } else {
                // Speech detected but not starting with "heggles" and wake word not previously detected.
                // This case should ideally not be reached if partialWakeWordDetected is the gate.
                // If it is, means wake word was not detected at the start.
                utteranceTranscriptRef.current = ''; // Clear if it wasn't a Heggles command
                setPartialWakeWordDetected(false);
                 commandProcessedSuccessfullyRef.current = true; // Consider this "processed" as ignored
                if (recognitionRef.current) recognitionRef.current.stop();
            }
          }
        };

        recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
          if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            console.error('Main command recognition error:', event.error, event.message);
            setHasMicPermission(false);
            toast({ title: "Microphone Access Issue", description: "Speech recognition service denied. Check browser settings.", variant: "destructive" });
          } else if (event.error === 'network') {
            console.error('Main command recognition error - network:', event.error, event.message);
            toast({ title: "Network Error", description: "Speech recognition requires network access.", variant: "destructive" });
          } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
             console.error('Main command recognition error:', event.error, event.message);
          }
          // No specific toast for 'no-speech' or 'aborted' to reduce noise
          commandProcessedSuccessfullyRef.current = true; // Treat errors as end of command attempt
        };

        recognition.onend = () => {
          setIsRecognizingSpeech(false);
          if (!commandProcessedSuccessfullyRef.current) {
            // If ended due to pause after "Heggles" and not a full command, keep partial state
            // utteranceTranscriptRef and partialWakeWordDetected remain as they are
          } else {
            // If command processed or error, clear partial states
            utteranceTranscriptRef.current = '';
            setPartialWakeWordDetected(false);
          }
          recognitionRef.current = null; // Allow useEffect to restart if needed
        };
        
        try {
          recognition.start();
        } catch (err) {
            console.error("Failed to start main command recognition:", err);
            recognitionRef.current = null; // Ensure it can be re-initialized
        }

      } else if (hasMicPermission !== true && recognitionRef.current) {
        commandProcessedSuccessfullyRef.current = true;
        recognitionRef.current.stop();
      }

      return () => {
        if (recognitionRef.current) {
          commandProcessedSuccessfullyRef.current = true;
          recognitionRef.current.stop();
          recognitionRef.current = null;
        }
      };
    }, [
        hasMicPermission, 
        isBrowserUnsupported, 
        isDashboardDictationActive, 
        isCapturingAudioForSnippet,
        isCapturingAudioForLongRecording, // Added this missing dependency
        setBufferTimeByVoice, // Already memoized
        toast, // Stable from useToast
        isRecognizingSpeech // Added to help re-trigger effect reliably
    ]);


    // Dashboard mic button (direct dictation)
    const handleDashboardMicClick = useCallback(async () => {
        if (isDashboardDictationActive) {
            if (dashboardDictationRecognitionRef.current) {
                try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
            }
            if (dashboardDictationPauseTimeoutRef.current) {
                clearTimeout(dashboardDictationPauseTimeoutRef.current);
            }
            setIsDashboardDictationActive(false);
            // Process accumulated text after stopping
            if(accumulatedDictationTranscriptRef.current.trim()){
                setInputText(accumulatedDictationTranscriptRef.current.trim());
                // No auto-submit, user clicks Brain
            }
            return;
        }

        if (isBrowserUnsupported || hasMicPermission === false) {
            toast({ title: "Microphone Unavailable", description: "Check permissions or browser support.", variant: "destructive" });
            return;
        }
        if (isLoading || isCapturingAudioForSnippet || isCapturingAudioForLongRecording) {
            toast({ title: "System Busy", description: "Another audio process is active.", variant: "default" });
            return;
        }

        if (hasMicPermission === null) { // Prompt if not yet determined
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                stream.getTracks().forEach(track => track.stop());
                setHasMicPermission(true);
            } catch (err) {
                setHasMicPermission(false);
                toast({ title: "Microphone Access Denied", variant: "destructive" });
                return;
            }
        }
        if (hasMicPermission === false) return; // Guard if permission was just denied

        const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognitionAPI) return;

        if (dashboardDictationRecognitionRef.current) { // Stop any previous instance
            try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
        }
        if (dashboardDictationPauseTimeoutRef.current) {
            clearTimeout(dashboardDictationPauseTimeoutRef.current);
        }
        
        accumulatedDictationTranscriptRef.current = ''; // Clear for new dictation
        setInputText(''); // Clear visible input text too

        const recognition = new SpeechRecognitionAPI();
        dashboardDictationRecognitionRef.current = recognition;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onstart = () => {
            setIsDashboardDictationActive(true);
        };

        recognition.onresult = (event: SpeechRecognitionEvent) => {
            if (dashboardDictationPauseTimeoutRef.current) {
                clearTimeout(dashboardDictationPauseTimeoutRef.current);
            }
            let interim = "";
            let currentDictationTranscript = accumulatedDictationTranscriptRef.current;

            for (let i = event.resultIndex; i < event.results.length; ++i) {
                const segment = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    currentDictationTranscript += segment + ' ';
                } else {
                    interim += segment;
                }
            }
            accumulatedDictationTranscriptRef.current = currentDictationTranscript.trim();
            setInputText((currentDictationTranscript + " " + interim).trim());


            const lowerTranscriptForEndCheck = (currentDictationTranscript + " " + interim).trim().toLowerCase();
            const endCommand = WAKE_WORDS.END_DICTATION.toLowerCase();
            const stopCommand = WAKE_WORDS.STOP_DICTATION.toLowerCase();

            if (lowerTranscriptForEndCheck.endsWith(endCommand) || lowerTranscriptForEndCheck.endsWith(stopCommand)) {
                let finalSpokenText = accumulatedDictationTranscriptRef.current; 
                if (lowerTranscriptForEndCheck.endsWith(endCommand)) {
                    finalSpokenText = finalSpokenText.substring(0, finalSpokenText.length - endCommand.length).trim();
                } else if (lowerTranscriptForEndCheck.endsWith(stopCommand)) {
                    finalSpokenText = finalSpokenText.substring(0, finalSpokenText.length - stopCommand.length).trim();
                }
                accumulatedDictationTranscriptRef.current = finalSpokenText;
                setInputText(finalSpokenText);
                if (dashboardDictationRecognitionRef.current) {
                    try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
                }
            } else {
                dashboardDictationPauseTimeoutRef.current = setTimeout(() => {
                    if (dashboardDictationRecognitionRef.current) {
                        try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
                    }
                }, 2000);
            }
        };

        recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
            if (dashboardDictationPauseTimeoutRef.current) {
                clearTimeout(dashboardDictationPauseTimeoutRef.current);
            }
            if (event.error === 'aborted') {
                console.info('Dashboard dictation aborted.');
            } else if (event.error !== 'no-speech') {
                console.error('Dashboard dictation error:', event.error, event.message);
                toast({ title: "Dictation Error", description: event.message || "Could not recognize speech.", variant: "destructive" });
            } else if (event.error === 'no-speech' && isDashboardDictationActive) {
                toast({ title: "No speech detected for dictation", variant: "default" });
            }
            setIsDashboardDictationActive(false);
        };
        
        recognition.onend = () => {
            setIsDashboardDictationActive(false);
            if (dashboardDictationPauseTimeoutRef.current) {
                clearTimeout(dashboardDictationPauseTimeoutRef.current);
            }
            dashboardDictationRecognitionRef.current = null;
            // Final transcript is already in inputText or accumulatedDictationTranscriptRef
            // If recognition ended by pause and there's text, it remains in inputText for Brain processing
            // No auto-submit here
            if (accumulatedDictationTranscriptRef.current.trim()) {
                 setInputText(accumulatedDictationTranscriptRef.current.trim());
            }
        };
        recognition.start();
    }, [
        isBrowserUnsupported, hasMicPermission, isLoading, isCapturingAudioForSnippet, 
        isDashboardDictationActive, toast, isCapturingAudioForLongRecording
    ]);


    // Imperative handle for parent (DashboardPage) to control long recording
    useImperativeHandle(ref, () => ({
      startLongRecording: () => {
        if (isBrowserUnsupported || hasMicPermission === false) {
          toast({ title: "Microphone Unavailable", variant: "destructive" }); return false;
        }
        if (isLoading || isCapturingAudioForSnippet || isDashboardDictationActive || isCapturingAudioForLongRecording) {
          toast({ title: "System Busy", variant: "default" }); return false;
        }
         if (hasMicPermission === null) { // Should ideally be true by now
             toast({ title: "Mic permission pending", description:"Please grant mic permission first.", variant:"default"}); return false;
         }


        const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognitionAPI || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          toast({ title: "Browser Not Supported for Long Recording", variant: "destructive" }); return false;
        }

        const startRecordingFlow = async () => {
          try {
            setIsCapturingAudioForLongRecording(true);
            longRecordingTranscriptRef.current = '';
            longRecordingAudioChunksRef.current = [];
            setInputText(''); // Clear input when long recording starts

            if (recognitionRef.current) { // Stop main command listener
                commandProcessedSuccessfullyRef.current = true; 
                recognitionRef.current.stop();
            }
            if (dashboardDictationRecognitionRef.current) { // Stop dashboard dictation
                dashboardDictationRecognitionRef.current.stop();
            }


            longRecordingSpeechRecognizerRef.current = new SpeechRecognitionAPI();
            const recognizer = longRecordingSpeechRecognizerRef.current;
            recognizer.continuous = true;
            recognizer.interimResults = true;
            recognizer.lang = 'en-US';

            recognizer.onstart = () => {}; 

            recognizer.onresult = (event: SpeechRecognitionEvent) => {
              let interim = "";
              let finalizedThisTurn = "";
              for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                  finalizedThisTurn += event.results[i][0].transcript + ' ';
                } else {
                  interim += event.results[i][0].transcript;
                }
              }
              if (finalizedThisTurn) {
                longRecordingTranscriptRef.current = (longRecordingTranscriptRef.current + finalizedThisTurn).trim();
              }
              setInputText(longRecordingTranscriptRef.current + (interim ? " " + interim.trim() : ""));
            };
            
            recognizer.onerror = (event: SpeechRecognitionErrorEvent) => {
               if (event.error === 'aborted') {
                console.info("Continuous recording speech recognition aborted (likely intentional stop):", event.message);
              } else if (event.error === 'no-speech') {
                // This is fine for continuous, just means silence
              } else {
                console.error("Continuous recording speech recognition error:", event.error, event.message);
                toast({ title: "Continuous Recording Transcription Error", description: event.message, variant: "destructive" });
              }
            };
            
            recognizer.onend = () => {
              longRecordingSpeechRecognizerRef.current = null;
              // Transcript is already in longRecordingTranscriptRef.current and possibly inputText
            };
            
            recognizer.start();

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            longRecordingMediaRecorderRef.current = new MediaRecorder(stream);
            longRecordingMediaRecorderRef.current.ondataavailable = (event) => {
              if (event.data.size > 0) {
                longRecordingAudioChunksRef.current.push(event.data);
              }
            };
            
            longRecordingMediaRecorderRef.current.onstop = async () => {
              stream.getTracks().forEach(track => track.stop());
              const finalTranscriptToSet = longRecordingTranscriptRef.current.trim();
              
              // Ensure these states are set *before* calling parent,
              // so parent's re-render doesn't cause effect to restart main listener too soon.
              setIsCapturingAudioForLongRecording(false); 
              setInputText(finalTranscriptToSet); 
              onStopLongRecordingParent(); // Notify parent recording has stopped

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
            if (longRecordingMediaRecorderRef.current && longRecordingMediaRecorderRef.current.state === "recording") {
              try { longRecordingMediaRecorderRef.current.stop(); } catch (e) {/* ignore */}
            }
            onStopLongRecordingParent(); 
            return false; 
          }
        };
        return startRecordingFlow();
      },
      stopLongRecordingAndProcess: () => {
        if (!isCapturingAudioForLongRecording) return;

        if (longRecordingSpeechRecognizerRef.current) {
          try { longRecordingSpeechRecognizerRef.current.stop(); } catch(e) { /* ignore */ }
        }
        if (longRecordingMediaRecorderRef.current && longRecordingMediaRecorderRef.current.state === "recording") {
          try { longRecordingMediaRecorderRef.current.stop(); } catch(e) { 
            console.error("Error stopping media recorder:", e);
            // Fallback to ensure UI updates if mediaRecorder.stop() fails
            const finalTranscript = longRecordingTranscriptRef.current.trim();
            setIsCapturingAudioForLongRecording(false);
            onStopLongRecordingParent();
            setInputText(finalTranscript);
             if (finalTranscript) {
               toast({ title: "Recording Stopped", description: "Transcript populated. Click Brain icon to process." });
             } else {
               toast({ title: "Recording Stopped", description: "No speech detected." });
             }
          }
        } else { 
          const finalTranscript = longRecordingTranscriptRef.current.trim();
          setIsCapturingAudioForLongRecording(false);
          onStopLongRecordingParent();
          setInputText(finalTranscript);
           if (finalTranscript) {
             toast({ title: "Recording Stopped", description: "Transcript populated. Click Brain icon to process." });
           } else {
             toast({ title: "Recording Stopped", description: "No speech detected." });
           }
        }
      }
    }), [
        isBrowserUnsupported, hasMicPermission, isLoading, isCapturingAudioForSnippet, 
        isDashboardDictationActive, isCapturingAudioForLongRecording, 
        toast, onStopLongRecordingParent, setInputText // Added setInputText
    ]);
    
    // Effect to synchronize with parent's long recording toggle
     useEffect(() => {
        if (isExternallyLongRecording && !isCapturingAudioForLongRecording) {
            if (typeof ref !== 'function' && ref?.current) {
               ref.current.startLongRecording();
            }
        } else if (!isExternallyLongRecording && isCapturingAudioForLongRecording) {
             if (typeof ref !== 'function' && ref?.current) {
                ref.current.stopLongRecordingAndProcess();
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isExternallyLongRecording, isCapturingAudioForLongRecording, ref, startLongRecording, stopLongRecordingAndProcess]);


    // Cleanup effect for all speech recognition and media recorder instances
    useEffect(() => {
      return () => {
        if (recognitionRef.current) {
          try { recognitionRef.current.stop(); } catch(e) {/*ignore*/}
          recognitionRef.current = null;
        }
        if (dashboardDictationRecognitionRef.current) {
            try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
            dashboardDictationRecognitionRef.current = null;
        }
        if (snippetRecognitionRef.current) {
            try { snippetRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
            snippetRecognitionRef.current = null;
        }
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
            try { mediaRecorderRef.current.stop(); } catch(e) {/*ignore*/}
            mediaRecorderRef.current = null;
        }
         if (longRecordingSpeechRecognizerRef.current) {
          try { longRecordingSpeechRecognizerRef.current.stop(); } catch(e) {/*ignore*/}
          longRecordingSpeechRecognizerRef.current = null;
        }
        if (longRecordingMediaRecorderRef.current && longRecordingMediaRecorderRef.current.state === "recording") {
            try { longRecordingMediaRecorderRef.current.stop(); } catch(e) {/*ignore*/}
            longRecordingMediaRecorderRef.current = null;
        }
        if (dashboardDictationPauseTimeoutRef.current) {
            clearTimeout(dashboardDictationPauseTimeoutRef.current);
        }
      };
    }, []);
    

    const getDashboardDictationButtonIcon = () => {
        if (isDashboardDictationActive) return <Radio className="h-5 w-5 text-red-500 animate-pulse" />;
        if (isBrowserUnsupported || hasMicPermission === false) return <MicOff className="h-5 w-5 text-muted-foreground" />;
        return <Mic className="h-5 w-5" />;
    };
    
    const getMicStatusText = (): React.ReactNode => {
        if (isBrowserUnsupported) return "Voice input not supported by browser.";
        if (hasMicPermission === false) return "Microphone permission denied.";
        if (hasMicPermission === null) return "Checking mic permission...";

        if (isCapturingAudioForLongRecording) return <span className="text-red-500 animate-pulse">Continuous recording active... Transcript populates below.</span>;
        if (isCapturingAudioForSnippet) return <span className="text-orange-500 animate-pulse">Recording 10s audio & speech snippet...</span>;
        if (isDashboardDictationActive) return <span className="text-blue-500 animate-pulse">Dictating into text area... Say 'Heggles end' or pause.</span>;
        
        if (isLoading && !isAlertDialogOpen) return "Processing thought...";

        if (isRecognizingSpeech) {
            if (partialWakeWordDetected) return <span className="text-yellow-500 animate-pulse">'<strong>Heggles</strong>' detected, awaiting command...</span>;
            return "Say '<strong>Heggles</strong>' + command...";
        }
        return "Voice listener idle. Click Brain to process text.";
    };

    const getTextareaPlaceholder = (): string => {
      if (isCapturingAudioForLongRecording) return "Continuous recording active. Transcript populates here. Click Brain icon to process when stopped.";
      if (isDashboardDictationActive) return "Dictate your thought... Say 'Heggles end' or 'Heggles stop', or pause to finish.";
      if (isLoading && !isAlertDialogOpen) return "Processing...";
      if (partialWakeWordDetected && isRecognizingSpeech) return "'Heggles' detected. Finish your command...";
      if (isRecognizingSpeech) return "Listening for 'Heggles' + command...";
      return "Type thought, paste text, or use header mic for continuous recording. Click Brain icon to process.";
    };
    
    const recallCmdSuffix = WAKE_WORDS.HEGGLES_REPLAY_THAT.substring(WAKE_WORDS.HEGGLES_BASE.length);

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
              {isBrowserUnsupported && hasMicPermission === null && ( // Show only if not explicitly denied
                <Alert variant="destructive" className="mb-4">
                  <AlertTriangleIcon className="h-4 w-4" />
                  <UiAlertTitle>Browser May Not Support Speech</UiAlertTitle>
                  <AlertDescription>Speech recognition for commands may not be supported. Manual input available.</AlertDescription>
                </Alert>
              )}
              {hasMicPermission === false && !isBrowserUnsupported && ( 
                <Alert variant="destructive" className="mb-4">
                  <AlertTriangleIcon className="h-4 w-4" />
                  <UiAlertTitle>Microphone Access Denied</UiAlertTitle>
                  <AlertDescription>Voice commands require microphone access. Manual input and continuous recording (if permitted) available.</AlertDescription>
                </Alert>
              )}

              <Textarea
                placeholder={getTextareaPlaceholder()}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                rows={4}
                disabled={isLoading || isCapturingAudioForSnippet || isDashboardDictationActive || isCapturingAudioForLongRecording}
                className="resize-none"
                aria-label="Thought input area"
              />
              <div className="flex items-stretch gap-2">
                <Button
                  type="button"
                  onClick={handleDashboardMicClick}
                  disabled={isBrowserUnsupported || hasMicPermission === false || isLoading || isCapturingAudioForSnippet || isCapturingAudioForLongRecording}
                  size="icon"
                  aria-label="Dictate thought into text area"
                  title="Dictate thought into text area"
                  variant="outline"
                >
                  {getDashboardDictationButtonIcon()}
                </Button>
                <Button
                  type="button"
                  onClick={handleProcessInputText}
                  disabled={isLoading || isCapturingAudioForSnippet || !inputText.trim() || isDashboardDictationActive || isCapturingAudioForLongRecording }
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
                <AlertDialogCancel onClick={() => { /* State handled by onOpenChange */ setInputText(''); }}>Cancel</AlertDialogCancel>
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


    