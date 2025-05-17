
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
  onEmptyRecalledThoughts: () => void; // Added for emptying recent thoughts
  isExternallyLongRecording: boolean;
  onStopLongRecordingParent: () => void;
}

export interface ThoughtInputFormHandle {
  simulateWakeWordAndListen: () => void;
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
    const utteranceTranscriptRef = useRef<string>(''); // Stores full utterance if "Heggles" is detected
    const commandProcessedSuccessfullyRef = useRef<boolean>(false); // To manage state clearing in onend

    // Dashboard mic button dictation (continuous until pause or "Heggles end/stop")
    const [isDashboardDictationActive, setIsDashboardDictationActive] = useState(false);
    const dashboardDictationRecognitionRef = useRef<SpeechRecognition | null>(null);
    const dashboardDictationPauseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const accumulatedDictationTranscriptRef = useRef<string>(''); // For dashboard dictation accumulation

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

    const parseSpokenBufferTime = useCallback((spokenDuration: string): string | null => {
        const lowerSpoken = spokenDuration.toLowerCase().replace("always on", "always-on"); 
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
            setPartialWakeWordDetected(false);
            commandProcessedSuccessfullyRef.current = true;
        } else {
            toast({ title: "Buffer Time Not Understood", description: `Could not recognize "${spokenDuration}" as a valid buffer time. Try "1 minute", "always on", etc.`, variant: "destructive" });
            commandProcessedSuccessfullyRef.current = true; // Still mark as processed to reset listener
        }
    }, [toast, parseSpokenBufferTime, setInputText, setPartialWakeWordDetected]);
    

    const startAudioRecordingForSnippet = useCallback(async () => {
      if (!hasMicPermission) {
        toast({ title: "Microphone Permission Required", variant: "destructive" });
        return;
      }
      if (isLoading || isCapturingAudioForSnippet || isDashboardDictationActive || isCapturingAudioForLongRecording) {
        toast({ title: "System Busy", variant: "default" });
        return;
      }

      const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognitionAPI || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          toast({ title: "Browser Not Supported", variant: "destructive" });
          return;
      }

      setIsCapturingAudioForSnippet(true);
      setIsLoading(true);
      toast({ title: "Recording Audio Snippet...", description: `Recording ${RECORDING_DURATION_MS / 1000}s of audio and speech.` });
      
      audioChunksRef.current = [];
      snippetTranscriptRef.current = '';

      // Ensure main command listener is stopped
      if (recognitionRef.current) {
        commandProcessedSuccessfullyRef.current = true; // Signal clean stop for main listener
        recognitionRef.current.stop();
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        mediaRecorderRef.current = new MediaRecorder(stream);
        mediaRecorderRef.current.ondataavailable = (event) => {
          if (event.data.size > 0) audioChunksRef.current.push(event.data);
        };

        mediaRecorderRef.current.onstop = async () => {
          stream.getTracks().forEach(track => track.stop());
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' }); // Or 'audio/wav' if preferred and supported
          const reader = new FileReader();
          reader.readAsDataURL(audioBlob);
          reader.onloadend = async () => {
            const base64AudioData = reader.result as string;
            const liveTranscript = snippetTranscriptRef.current.trim();
            snippetTranscriptRef.current = ''; // Reset for next use
            
            try {
              const processedData = await processRecordedAudio(base64AudioData, liveTranscript);
              onThoughtRecalled({ id: crypto.randomUUID(), timestamp: Date.now(), ...processedData });
              toast({ title: "Recorded Snippet Processed" });
            } catch (error) {
              toast({ title: "Error Processing Snippet", description: (error as Error).message, variant: "destructive" });
            } finally {
              setIsLoading(false);
              setIsCapturingAudioForSnippet(false);
              // Main listener will restart via useEffect if conditions are met
            }
          };
          audioChunksRef.current = [];
        };

        snippetRecognitionRef.current = new SpeechRecognitionAPI();
        const snippetRecognizer = snippetRecognitionRef.current;
        snippetRecognizer.continuous = true; 
        snippetRecognizer.interimResults = true;
        snippetRecognizer.lang = 'en-US';
        
        snippetRecognizer.onresult = (event: SpeechRecognitionEvent) => {
          let interim = "";
          let finalizedThisTurn = "";
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) finalizedThisTurn += event.results[i][0].transcript + ' ';
            else interim += event.results[i][0].transcript;
          }
          if(finalizedThisTurn) snippetTranscriptRef.current = (snippetTranscriptRef.current + finalizedThisTurn).trim();
          // No direct UI update from snippet transcript
        };
        
        snippetRecognizer.onerror = (event: SpeechRecognitionErrorEvent) => {
          console.warn("Snippet recognition error:", event.error, event.message);
          if (event.error !== 'aborted' && event.error !== 'no-speech') {
            toast({title: "Snippet Transcription Error", description: event.message, variant: "destructive"});
          }
        };

        snippetRecognizer.onend = () => {
          snippetRecognitionRef.current = null;
        };

        mediaRecorderRef.current.start();
        snippetRecognizer.start();

        setTimeout(() => {
          if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
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
      toast, onThoughtRecalled
    ]);


    const handleProcessInputText = useCallback(async () => {
      const textToProcess = inputText.trim();
      if (!textToProcess) {
        toast({ title: "Input empty", variant: "destructive" });
        return;
      }
      
      setIsLoading(true);
      const hegglesBaseLower = WAKE_WORDS.HEGGLES_BASE.toLowerCase();
      const lowerText = textToProcess.toLowerCase();

      confirmedDialogActionRef.current = false; 

      // Check for "Heggles replay that" from text input
      if (lowerText === WAKE_WORDS.HEGGLES_REPLAY_THAT.toLowerCase()) {
          startAudioRecordingForSnippet(); 
          setInputText('');
          // startAudioRecordingForSnippet handles isLoading and toasts
          return; 
      }
      
      const shoppingListAddPattern = new RegExp(`^${hegglesBaseLower}\\s+${WAKE_WORDS.HEGGLES_ADD_TO_SHOPPING_LIST_PREFIX.substring(hegglesBaseLower.length).trim().toLowerCase()}\\s+(.+?)(?:\\s+${WAKE_WORDS.TO_SHOPPING_LIST_SUFFIX_REGEX_PART.toLowerCase()})?$`);
      const shoppingListAddMatch = lowerText.match(shoppingListAddPattern);
      
      const todoListAddPattern = new RegExp(`^${hegglesBaseLower}\\s+${WAKE_WORDS.HEGGLES_ADD_TO_TODO_LIST_PREFIX.substring(hegglesBaseLower.length).trim().toLowerCase()}\\s+(.+?)(?:\\s+${WAKE_WORDS.TO_TODO_LIST_SUFFIX_REGEX_PART.toLowerCase()})?$`);
      const todoListAddMatch = lowerText.match(todoListAddPattern);
            
      const deleteListPattern = new RegExp(`^${hegglesBaseLower}\\s+${WAKE_WORDS.DELETE_ITEM_PREFIX.toLowerCase()}\\s+(.*?)(?:\\s+${WAKE_WORDS.FROM_SHOPPING_LIST_TRIGGER.toLowerCase()}|\\s+${WAKE_WORDS.FROM_TODO_LIST_TRIGGER.toLowerCase()})$`);
      const deleteListMatch = lowerText.match(deleteListPattern);

      if (shoppingListAddMatch && shoppingListAddMatch[1]) {
        const item = shoppingListAddMatch[1].trim();
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
        setAlertDialogConfig({
            title: "Empty Recent Thoughts?",
            description: "Are you sure you want to clear all thoughts from the 'Recent Thoughts' list on the dashboard?",
            onConfirm: onEmptyRecalledThoughts,
            actionLabel: "Empty Thoughts"
        });
        setIsAlertDialogOpen(true);
        return;
      } else if (lowerText === WAKE_WORDS.CLEAR_SHOPPING_LIST_COMMAND.toLowerCase()) {
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
        
        // Check AI identified system commands first
        if (processedData.intentAnalysis?.isAction && processedData.intentAnalysis.extractedAction) {
          const aiActionLower = processedData.intentAnalysis.extractedAction.toLowerCase();
          if (aiActionLower === WAKE_WORDS.EMPTY_RECENT_THOUGHTS_COMMAND.toLowerCase()) {
            setAlertDialogConfig({
                title: "AI Suggestion: Empty Recent Thoughts?",
                description: "The AI understood this as a command to clear all recent thoughts. Proceed?",
                onConfirm: onEmptyRecalledThoughts, actionLabel: "Empty Thoughts",
                dataToRecallOnCancel: processedData,
            });
            setIsAlertDialogOpen(true); dialogShownForAISuggestion = true; return;
          }
          if (aiActionLower === WAKE_WORDS.CLEAR_SHOPPING_LIST_COMMAND.toLowerCase()) {
             setAlertDialogConfig({
                title: "AI Suggestion: Clear Shopping List?",
                description: "The AI understood this as a command to clear your shopping list. Proceed?",
                onConfirm: clearShoppingList, actionLabel: "Clear List",
                dataToRecallOnCancel: processedData,
            });
            setIsAlertDialogOpen(true); dialogShownForAISuggestion = true; return;
          }
           if (aiActionLower.startsWith(WAKE_WORDS.COMPLETE_ALL_TASKS_PREFIX.toLowerCase()) &&
              (aiActionLower.endsWith(WAKE_WORDS.COMPLETE_ALL_TASKS_COMMAND_SUFFIX_TODO.toLowerCase()) || 
               aiActionLower.endsWith(WAKE_WORDS.COMPLETE_ALL_TASKS_COMMAND_SUFFIX_TODOS.toLowerCase()))) {
             setAlertDialogConfig({
                title: "AI Suggestion: Complete All To-Do Tasks?",
                description: "The AI understood this as a command to complete all to-do tasks. Proceed?",
                onConfirm: completeAllToDoTasks, actionLabel: "Complete All",
                dataToRecallOnCancel: processedData,
            });
            setIsAlertDialogOpen(true); dialogShownForAISuggestion = true; return;
          }
        }


        // Then check AI suggested list additions (from intentAnalysis)
        if (!dialogShownForAISuggestion && 
            processedData.intentAnalysis?.isAction &&
            processedData.intentAnalysis.extractedAction &&
            processedData.intentAnalysis.suggestedList &&
            processedData.intentAnalysis.suggestedList !== 'none') {
          
          const action = processedData.intentAnalysis.extractedAction;
          const listKey = processedData.intentAnalysis.suggestedList === 'shopping' ? LOCALSTORAGE_KEYS.SHOPPING_LIST : LOCALSTORAGE_KEYS.TODO_LIST;
          const listName = processedData.intentAnalysis.suggestedList === 'shopping' ? "Shopping List" : "To-Do List";
          
          setAlertDialogConfig({
            title: `AI Suggestion: Add to ${listName}?`,
            description: <>The AI suggests adding "<strong>{action}</strong>" to your {listName}. Add it?</>,
            itemText: action, listKey: listKey, listName: listName,
            dataToRecallOnCancel: processedData,
            onConfirm: () => { addListItem(listKey, action, listName); },
            actionLabel: listName === "Shopping List" ? "Add Item" : "Add Task"
          });
          setIsAlertDialogOpen(true); dialogShownForAISuggestion = true; return; 
        }
        
        // Then check refined actionItems (from refineThought)
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
              setAlertDialogConfig({
                title: `AI Suggestion: Add to ${targetListName}?`,
                description: <>The AI refined this to: "<strong>{actionItem}</strong>". Add "<strong>{itemToAdd}</strong>" to your {targetListName}?</>,
                itemText: itemToAdd, listKey: targetListKey, listName: targetListName,
                dataToRecallOnCancel: processedData,
                onConfirm: () => { addListItem(targetListKey!, itemToAdd!, targetListName!); },
                actionLabel: targetListName === "Shopping List" ? "Add Item" : "Add Task"
              });
              setIsAlertDialogOpen(true); dialogShownForAISuggestion = true; return; 
            }
          }
        }

        if (!dialogShownForAISuggestion) {
           onThoughtRecalled({ id: crypto.randomUUID(), timestamp: Date.now(), ...processedData });
           if (processedData.aiAnswer) toast({ title: "Thought Processed", description: "AI answered your question."});
           else toast({ title: "Thought Processed", description: "AI analysis complete." });
        }
      } catch (error) {
        toast({ title: "Error Processing Thought", description: (error as Error).message, variant: "destructive" });
      } finally {
         if (!isAlertDialogOpen && !dialogShownForAISuggestion) { // Condition to prevent clearing if dialog just opened
           setIsLoading(false);
           setInputText('');
        }
      }
    }, [
        inputText, toast, onThoughtRecalled, addListItem, deleteListItem, onEmptyRecalledThoughts, 
        clearShoppingList, completeAllToDoTasks, startAudioRecordingForSnippet, isAlertDialogOpen
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

      if (hasMicPermission === null) {
        navigator.mediaDevices.getUserMedia({ audio: true })
          .then((stream) => {
            stream.getTracks().forEach(track => track.stop());
            setHasMicPermission(true);
          })
          .catch(err => {
            console.warn("Mic permission check error:", err.name, err.message);
            setHasMicPermission(false);
          });
      }
    }, [hasMicPermission]);


    // Main "Heggles" command listener
    useEffect(() => {
        const shouldBeListening = hasMicPermission === true && !isLoading && !isCapturingAudioForSnippet && !isDashboardDictationActive && !isCapturingAudioForLongRecording;

        if (shouldBeListening && !recognitionRef.current) {
            const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
            if (!SpeechRecognitionAPI) return;

            const recognition = new SpeechRecognitionAPI();
            recognitionRef.current = recognition;
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.lang = 'en-US';

            recognition.onstart = () => {
                setIsRecognizingSpeech(true);
                commandProcessedSuccessfullyRef.current = false;
                // utteranceTranscriptRef.current = ''; // Reset here to ensure clean start for each full recognition session
                // setPartialWakeWordDetected(false); // Also reset here
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

                const hegglesBaseLower = WAKE_WORDS.HEGGLES_BASE.toLowerCase();

                if (newlyFinalizedSegmentThisTurn.trim() && !partialWakeWordDetected) {
                    if (newlyFinalizedSegmentThisTurn.toLowerCase().trim().startsWith(hegglesBaseLower)) {
                        setPartialWakeWordDetected(true);
                        utteranceTranscriptRef.current = newlyFinalizedSegmentThisTurn.toLowerCase().trim();
                    }
                } else if (partialWakeWordDetected && newlyFinalizedSegmentThisTurn.trim()) {
                    utteranceTranscriptRef.current = (utteranceTranscriptRef.current + " " + newlyFinalizedSegmentThisTurn.trim()).trim();
                }
                
                if (partialWakeWordDetected) {
                   setInputText(utteranceTranscriptRef.current + (interimTranscript ? " " + interimTranscript.trim() : ""));
                }


                const lastResultIsFinal = event.results[event.results.length - 1].isFinal;
                if (lastResultIsFinal && partialWakeWordDetected) {
                    const finalUtterance = utteranceTranscriptRef.current.toLowerCase().trim();
                    
                    if (finalUtterance === WAKE_WORDS.HEGGLES_TURN_ON.toLowerCase()) {
                        // This should be handled by parent/global state, but for now, just toast if already on
                        toast({ title: "Listening is already ON" });
                        commandProcessedSuccessfullyRef.current = true;
                    } else if (finalUtterance === WAKE_WORDS.HEGGLES_TURN_OFF.toLowerCase()) {
                        toast({ title: "Turning Listening OFF...", description: "Passive listening will be disabled." });
                        // Parent should handle actual toggling, this command may not directly call it
                        commandProcessedSuccessfullyRef.current = true;
                    } else if (finalUtterance.startsWith(WAKE_WORDS.HEGGLES_SET_BUFFER.toLowerCase())) {
                        const spokenDuration = finalUtterance.substring(WAKE_WORDS.HEGGLES_SET_BUFFER.toLowerCase().length).trim();
                        setBufferTimeByVoice(spokenDuration); // This sets commandProcessedSuccessfullyRef
                    } else if (finalUtterance === WAKE_WORDS.HEGGLES_REPLAY_THAT.toLowerCase()) {
                        setInputText(WAKE_WORDS.HEGGLES_REPLAY_THAT); // Populate for Brain button
                        commandProcessedSuccessfullyRef.current = true;
                    } else if (finalUtterance.startsWith(hegglesBaseLower)) {
                        // For other "Heggles..." commands, they are now in inputText.
                        // User will click Brain icon. Signal this voice command cycle is done.
                        setInputText(finalUtterance); // Ensure final full command is in input text
                        commandProcessedSuccessfullyRef.current = true;
                    } else {
                         // Should not happen if partialWakeWordDetected is true and finalUtterance does not start with hegglesBaseLower
                        // But as a fallback, treat as command processed to reset.
                        commandProcessedSuccessfullyRef.current = true;
                    }
                    
                    if (commandProcessedSuccessfullyRef.current && recognitionRef.current) {
                        recognitionRef.current.stop();
                    }
                } else if (lastResultIsFinal && !partialWakeWordDetected) {
                    // Finalized speech but "Heggles" was not at the start of this utterance.
                    // Clear utterance ref as it's not a Heggles command.
                    utteranceTranscriptRef.current = '';
                    commandProcessedSuccessfullyRef.current = true; // Mark as "processed" (ignored)
                    if (recognitionRef.current) recognitionRef.current.stop();
                }
            };

            recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
              if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
                console.error('Main command recognition error:', event.error, event.message);
                setHasMicPermission(false);
                toast({ title: "Mic Access Issue", variant: "destructive" });
              } else if (event.error === 'network') {
                console.error('Main command recognition error - network:', event.error, event.message);
                toast({ title: "Network Error", variant: "destructive" });
              } else if (event.error === 'no-speech' && isRecognizingSpeech && partialWakeWordDetected){
                // If "Heggles" was said, then silence, keep listening if continuous, or stop if not.
                // For continuous=true, browser might auto-stop on long silence. 'onend' handles restart.
                // No specific toast here, as it's more of a pause.
              } else if (event.error !== 'aborted' && event.error !== 'no-speech') {
                 console.error('Main command recognition error:', event.error, event.message);
              }
              commandProcessedSuccessfullyRef.current = true; // Treat errors as end of command attempt
            };

            recognition.onend = () => {
                setIsRecognizingSpeech(false);
                if (commandProcessedSuccessfullyRef.current) {
                    utteranceTranscriptRef.current = '';
                    setPartialWakeWordDetected(false);
                } else {
                    // If ended due to pause after "Heggles" (commandProcessedSuccessfullyRef is false),
                    // keep partialWakeWordDetected and utteranceTranscriptRef as they are
                    // so the next recognition session can append to it.
                    // InputText should already reflect the partial "Heggles..."
                }
                recognitionRef.current = null;
            };
            
            try {
                // Reset state *before* starting, critical for restart after pause
                utteranceTranscriptRef.current = '';
                setPartialWakeWordDetected(false);
                recognition.start();
            } catch (err) {
                console.error("Failed to start main command recognition:", err);
                recognitionRef.current = null;
                setIsRecognizingSpeech(false);
            }

        } else if (!shouldBeListening && recognitionRef.current) {
            commandProcessedSuccessfullyRef.current = true; // Ensure clean stop
            recognitionRef.current.stop();
        }

        return () => {
            if (recognitionRef.current) {
                commandProcessedSuccessfullyRef.current = true; // Ensure clean stop
                recognitionRef.current.stop();
                recognitionRef.current = null;
            }
        };
    }, [
        hasMicPermission, 
        isLoading, 
        isCapturingAudioForSnippet, 
        isDashboardDictationActive, 
        isCapturingAudioForLongRecording,
        setBufferTimeByVoice,
        toast,
        isRecognizingSpeech // Added to help re-trigger effect reliably
    ]);


    const handleDashboardMicClick = useCallback(async () => {
        if (isDashboardDictationActive) {
            if (dashboardDictationRecognitionRef.current) {
                try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
            }
            if (dashboardDictationPauseTimeoutRef.current) {
                clearTimeout(dashboardDictationPauseTimeoutRef.current);
            }
            setIsDashboardDictationActive(false);
            // If text was dictated, it's already in inputText, ready for Brain button.
            // No auto-submit.
            return;
        }

        if (isBrowserUnsupported || hasMicPermission === false) {
            toast({ title: "Mic Unavailable", variant: "destructive" }); return;
        }
        if (isLoading || isCapturingAudioForSnippet || isCapturingAudioForLongRecording || isRecognizingSpeech) {
            toast({ title: "System Busy", variant: "default" }); return;
        }

        if (hasMicPermission === null) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                stream.getTracks().forEach(track => track.stop());
                setHasMicPermission(true);
            } catch (err) {
                setHasMicPermission(false);
                toast({ title: "Mic Access Denied", variant: "destructive" });
                return;
            }
        }
        if (hasMicPermission === false) return;

        const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognitionAPI) return;

        if (dashboardDictationRecognitionRef.current) {
            try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
        }
        if (dashboardDictationPauseTimeoutRef.current) {
            clearTimeout(dashboardDictationPauseTimeoutRef.current);
        }
        
        accumulatedDictationTranscriptRef.current = inputText; // Start with current text if any
        // setInputText(''); // Or clear it: setInputText('');

        const recognition = new SpeechRecognitionAPI();
        dashboardDictationRecognitionRef.current = recognition;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onstart = () => {
            setIsDashboardDictationActive(true);
             if (recognitionRef.current) { // Stop main command listener
                commandProcessedSuccessfullyRef.current = true; 
                recognitionRef.current.stop();
            }
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
                 // Do NOT auto-submit, user clicks Brain
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
             if (event.error === 'aborted') { /* console.info('Dashboard dictation aborted.'); */ }
             else if (event.error === 'no-speech' && isDashboardDictationActive) {
                toast({ title: "No speech detected for dictation", variant: "default" });
             } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
                console.error('Dashboard dictation error:', event.error, event.message);
                toast({ title: "Dictation Error", variant: "destructive" });
            }
            setIsDashboardDictationActive(false);
        };
        
        recognition.onend = () => {
            setIsDashboardDictationActive(false);
            if (dashboardDictationPauseTimeoutRef.current) {
                clearTimeout(dashboardDictationPauseTimeoutRef.current);
            }
            dashboardDictationRecognitionRef.current = null;
            // Final transcript is already in inputText
            // User will click Brain icon to process
        };
        recognition.start();
    }, [
        isBrowserUnsupported, hasMicPermission, isLoading, isCapturingAudioForSnippet, 
        isDashboardDictationActive, toast, isCapturingAudioForLongRecording, isRecognizingSpeech, inputText
    ]);


    // Imperative handle methods for parent (DashboardPage)
    const startLongRecording = useCallback(() => {
      if (isBrowserUnsupported || hasMicPermission === false) {
        toast({ title: "Mic Unavailable", variant: "destructive" }); return false;
      }
      if (isLoading || isCapturingAudioForSnippet || isDashboardDictationActive || isCapturingAudioForLongRecording || isRecognizingSpeech) {
        toast({ title: "System Busy", variant: "default" }); return false;
      }
       if (hasMicPermission === null) {
           toast({ title: "Mic permission pending", variant:"default"}); return false;
       }

      const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognitionAPI || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        toast({ title: "Browser Not Supported", variant: "destructive" }); return false;
      }

      const startRecordingFlow = async () => {
        try {
          setIsCapturingAudioForLongRecording(true);
          longRecordingTranscriptRef.current = '';
          longRecordingAudioChunksRef.current = [];
          setInputText(''); 

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

          recognizer.onstart = () => {
            // Explicitly set isRecognizingSpeech false if continuous recording takes over.
            // This prevents main listener from trying to restart if it was somehow active.
            setIsRecognizingSpeech(false); 
          }; 

          recognizer.onresult = (event: SpeechRecognitionEvent) => {
            let interim = "";
            let finalizedThisTurn = "";
            for (let i = event.resultIndex; i < event.results.length; ++i) {
              if (event.results[i].isFinal) finalizedThisTurn += event.results[i][0].transcript + ' ';
              else interim += event.results[i][0].transcript;
            }
            if (finalizedThisTurn) longRecordingTranscriptRef.current = (longRecordingTranscriptRef.current + finalizedThisTurn).trim();
            setInputText(longRecordingTranscriptRef.current + (interim ? " " + interim.trim() : ""));
          };
          
          recognizer.onerror = (event: SpeechRecognitionErrorEvent) => {
             if (event.error === 'aborted') { /* console.info("Continuous recording speech recognition aborted (intentional stop)"); */ }
             else if (event.error === 'no-speech') { /* This is fine for continuous */ }
             else {
               console.error("Continuous recording speech recognition error:", event.error, event.message);
               toast({ title: "Continuous Rec Transcription Error", description: event.message, variant: "destructive" });
             }
          };
          
          recognizer.onend = () => {
            longRecordingSpeechRecognizerRef.current = null;
            // Transcript is in longRecordingTranscriptRef.current and inputText
            // Actual processing happens when media recorder stops.
          };
          
          recognizer.start();

          // MediaRecorder setup (remains unchanged conceptually, audio data not used currently by AI for STT)
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          longRecordingMediaRecorderRef.current = new MediaRecorder(stream);
          longRecordingMediaRecorderRef.current.ondataavailable = (event) => {
            if (event.data.size > 0) longRecordingAudioChunksRef.current.push(event.data);
          };
          
          longRecordingMediaRecorderRef.current.onstop = async () => { // THIS IS KEY
            stream.getTracks().forEach(track => track.stop());
            const finalTranscriptToSet = longRecordingTranscriptRef.current.trim();
            
            // Critical state updates BEFORE calling parent
            setIsCapturingAudioForLongRecording(false); 
            setInputText(finalTranscriptToSet); // Ensure final transcript is in the input
            onStopLongRecordingParent(); // Notify parent: this might trigger re-renders

            if (finalTranscriptToSet) {
              toast({ title: "Recording Stopped", description: "Transcript populated. Click Brain icon to process." });
            } else {
              toast({ title: "Recording Stopped", description: "No speech detected during recording." });
            }
            longRecordingAudioChunksRef.current = []; // Clear chunks
            // DO NOT CALL AI PROCESSING HERE - USER CLICKS BRAIN
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
        toast, setInputText, onStopLongRecordingParent 
    ]);

    const stopLongRecordingAndProcess = useCallback(() => {
      if (!isCapturingAudioForLongRecording) return;

      if (longRecordingSpeechRecognizerRef.current) {
        try { longRecordingSpeechRecognizerRef.current.stop(); } catch(e) { /* ignore */ }
      }
      if (longRecordingMediaRecorderRef.current?.state === "recording") {
        try { longRecordingMediaRecorderRef.current.stop(); } // onstop handler will do the rest
        catch(e) { 
          console.error("Error stopping media recorder:", e);
          // Fallback to ensure UI updates if mediaRecorder.stop() fails critically
          const finalTranscript = longRecordingTranscriptRef.current.trim();
          setIsCapturingAudioForLongRecording(false);
          onStopLongRecordingParent();
          setInputText(finalTranscript);
           if (finalTranscript) toast({ title: "Recording Stopped", description: "Transcript populated." });
           else toast({ title: "Recording Stopped", description: "No speech detected." });
        }
      } else { 
        // If media recorder wasn't even recording or already stopped
        const finalTranscript = longRecordingTranscriptRef.current.trim();
        setIsCapturingAudioForLongRecording(false);
        onStopLongRecordingParent();
        setInputText(finalTranscript);
         if (finalTranscript) toast({ title: "Recording Stopped", description: "Transcript populated." });
         else toast({ title: "Recording Stopped", description: "No speech detected." });
      }
    }, [
        isCapturingAudioForLongRecording, onStopLongRecordingParent, setInputText, toast
    ]);
    
    useImperativeHandle(ref, () => ({
      simulateWakeWordAndListen: () => {
        if (isBrowserUnsupported || hasMicPermission === false) {
            toast({ title: "Mic Unavailable", variant: "destructive" }); return;
        }
        if (isLoading || isCapturingAudioForSnippet || isDashboardDictationActive || isRecognizingSpeech || isCapturingAudioForLongRecording) {
            toast({ title: "System Busy", variant: "default" }); return;
        }
        
        toast({ title: "Heggles Activated", description: "Listening for your command..." });
        setPartialWakeWordDetected(true);
        utteranceTranscriptRef.current = WAKE_WORDS.HEGGLES_BASE.toLowerCase() + " ";
        setInputText(utteranceTranscriptRef.current);

        if (recognitionRef.current) {
            commandProcessedSuccessfullyRef.current = true; // Force reset of old session
            recognitionRef.current.stop(); // Stop if running, onend will nullify, useEffect will restart
        } else {
            // If not running, trigger useEffect to start it (state change might be needed if deps are minimal)
            // For now, assume useEffect will pick it up due to hasMicPermission & other flags.
            // A more direct way is to call a local start function if useEffect logic is complex.
            // But the existing useEffect should cover this.
        }
      },
      startLongRecording,
      stopLongRecordingAndProcess,
    }), [
        isBrowserUnsupported, hasMicPermission, isLoading, isCapturingAudioForSnippet, 
        isDashboardDictationActive, isRecognizingSpeech, toast, 
        startLongRecording, stopLongRecordingAndProcess, isCapturingAudioForLongRecording // Added isCapturingAudioForLongRecording
    ]);
    
    // Effect to synchronize with parent's long recording toggle
    useEffect(() => {
        if (isExternallyLongRecording && !isCapturingAudioForLongRecording) {
            startLongRecording();
        } else if (!isExternallyLongRecording && isCapturingAudioForLongRecording) {
            stopLongRecordingAndProcess();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isExternallyLongRecording, isCapturingAudioForLongRecording, startLongRecording, stopLongRecordingAndProcess]);


    // Cleanup effect for all speech recognition and media recorder instances
    useEffect(() => {
      return () => {
        if (recognitionRef.current) {
          try { commandProcessedSuccessfullyRef.current = true; recognitionRef.current.stop(); } catch(e) {/*ignore*/}
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
        if (mediaRecorderRef.current?.state === "recording") {
            try { mediaRecorderRef.current.stop(); } catch(e) {/*ignore*/}
            mediaRecorderRef.current = null;
        }
         if (longRecordingSpeechRecognizerRef.current) {
          try { longRecordingSpeechRecognizerRef.current.stop(); } catch(e) {/*ignore*/}
          longRecordingSpeechRecognizerRef.current = null;
        }
        if (longRecordingMediaRecorderRef.current?.state === "recording") {
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
        if (hasMicPermission === false) return "Mic permission denied.";
        if (hasMicPermission === null) return "Checking mic permission...";

        if (isCapturingAudioForLongRecording) return <span className="text-red-500 animate-pulse">Continuous recording active... Transcript populates below.</span>;
        if (isCapturingAudioForSnippet) return <span className="text-orange-500 animate-pulse">Recording 10s audio & speech for replay...</span>;
        if (isDashboardDictationActive) return <span className="text-blue-500 animate-pulse">Dictating into text area... Say 'Heggles end/stop' or pause.</span>;
        
        if (isLoading && !isAlertDialogOpen) return "Processing thought...";

        if (isRecognizingSpeech) { // Main Heggles command listener is active
            if (partialWakeWordDetected) return <span className="text-yellow-500 animate-pulse">'<strong>Heggles</strong>' detected, awaiting command...</span>;
            return "Say '<strong>Heggles</strong>' + command...";
        }
        return "Voice listener idle. Use header mic or type, then click Brain icon.";
    };

    const getTextareaPlaceholder = (): string => {
      if (isCapturingAudioForLongRecording) return "Continuous recording active. Transcript populates here. Click Brain icon to process when stopped.";
      if (isDashboardDictationActive) return "Dictate your thought... Say 'Heggles end' or 'Heggles stop', or pause to finish.";
      if (isLoading && !isAlertDialogOpen) return "Processing...";
      
      if (partialWakeWordDetected && isRecognizingSpeech) return "'Heggles' detected. Finish your command...";
      if (isRecognizingSpeech) return "Listening for 'Heggles' + command...";
      return "Type thought, paste text, or use header mic for continuous recording. Click Brain icon to process.";
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
                  <AlertDescription>Speech recognition for commands may not be supported.</AlertDescription>
                </Alert>
              )}
              {hasMicPermission === false && !isBrowserUnsupported && ( 
                <Alert variant="destructive" className="mb-4">
                  <AlertTriangleIcon className="h-4 w-4" />
                  <UiAlertTitle>Microphone Access Denied</UiAlertTitle>
                  <AlertDescription>Voice commands require microphone access.</AlertDescription>
                </Alert>
              )}

              <Textarea
                placeholder={getTextareaPlaceholder()}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                rows={4}
                disabled={isLoading || isCapturingAudioForSnippet || isCapturingAudioForLongRecording} // Dashboard dictation doesn't disable textarea
                className="resize-none"
                aria-label="Thought input area"
              />
              <div className="flex items-stretch gap-2">
                 {/* Removed specific dashboard dictation mic button. Header mic is primary. */}
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
                <AlertDialogCancel onClick={() => { 
                    confirmedDialogActionRef.current = false; // Explicitly set on cancel click
                    // onOpenChange will handle the rest of cleanup
                }}>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => {
                  if (alertDialogConfig) {
                    confirmedDialogActionRef.current = true; 
                    alertDialogConfig.onConfirm();
                    // onOpenChange will handle the rest of cleanup after action
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
