
"use client";

import React, { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Brain, Loader2, Mic, MicOff, AlertTriangleIcon, Radio, PlayCircle, StopCircle, Zap } from 'lucide-react';
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
import type { Thought, ShoppingListItem, ToDoListItem, BufferTimeValue, IntentAnalysisOutput } from '@/lib/types';
import {
  WAKE_WORDS,
  LOCALSTORAGE_KEYS,
  BUFFER_TIME_OPTIONS,
  DEFAULT_BUFFER_TIME,
  RECORDING_DURATION_MS,
} from '@/lib/constants';

interface ThoughtInputFormProps {
  onThoughtRecalled: (thought: Thought) => void;
  isListening: boolean;
  onToggleListeningParent: (isListening: boolean) => void;
  isExternallyLongRecording: boolean;
  onStopLongRecordingParent: () => void;
}

export interface ThoughtInputFormHandle {
  simulateWakeWordAndListen: () => void;
  startLongRecording: () => boolean;
  stopLongRecordingAndProcess: () => void;
}

export const ThoughtInputForm = forwardRef<ThoughtInputFormHandle, ThoughtInputFormProps>(
  ({ onThoughtRecalled, isListening, onToggleListeningParent, isExternallyLongRecording, onStopLongRecordingParent }, ref) => {
    const [inputText, setInputText] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const { toast } = useToast();

    const [hasMicPermission, setHasMicPermission] = useState<boolean | null>(null);
    const [isRecognizingSpeech, setIsRecognizingSpeech] = useState(false); // For main command listener
    const [isBrowserUnsupported, setIsBrowserUnsupported] = useState(false);
    const [partialWakeWordDetected, setPartialWakeWordDetected] = useState(false);
    const recognitionRef = useRef<SpeechRecognition | null>(null);
    const utteranceTranscriptRef = useRef<string>(''); // Accumulates transcript for current Heggles command
    const commandProcessedSuccessfullyRef = useRef<boolean>(false); // Tracks if a Heggles command finished processing

    // State and refs for Dashboard Dictation Mic (button in this card)
    const [isDashboardDictationActive, setIsDashboardDictationActive] = useState(false);
    const dashboardDictationRecognitionRef = useRef<SpeechRecognition | null>(null);
    const dashboardDictationPauseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const dashboardDictationAccumulatedTranscriptRef = useRef<string>('');

    // State and refs for Snippet Recording (triggered by "Heggles replay that" processed via Brain button)
    const [isCapturingAudioForSnippet, setIsCapturingAudioForSnippet] = useState(false);
    const snippetMediaRecorderRef = useRef<MediaRecorder | null>(null);
    const snippetRecognitionRef = useRef<SpeechRecognition | null>(null);
    const snippetTranscriptRef = useRef<string>('');
    const snippetAudioChunksRef = useRef<Blob[]>([]);

    // State and refs for Long Recording (triggered by header Play/Stop button)
    const [isCapturingAudioForLongRecording, setIsCapturingAudioForLongRecording] = useState(false);
    const longRecordingMediaRecorderRef = useRef<MediaRecorder | null>(null);
    const longRecordingSpeechRecognizerRef = useRef<SpeechRecognition | null>(null);
    const longRecordingTranscriptRef = useRef<string>('');
    const longRecordingAudioChunksRef = useRef<Blob[]>([]);


    const [alertDialogConfig, setAlertDialogConfig] = useState<{
      title: string;
      description: React.ReactNode;
      itemText?: string;
      listKey?: string;
      listName?: string;
      dataToRecallOnCancel?: Omit<Thought, "id" | "timestamp">;
      onConfirm: () => void;
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
    
    const parseSpokenBufferTime = useCallback((spokenDuration: string): BufferTimeValue | null => {
      const cleanedSpoken = spokenDuration.toLowerCase().trim();
      if (cleanedSpoken.includes('always on') || cleanedSpoken.includes('continuous')) return 'continuous';
      for (const option of BUFFER_TIME_OPTIONS) {
        if (option.value !== 'continuous') {
          const labelMatchValue = option.label.toLowerCase().match(/^(\d+)\s*minute/);
          if (labelMatchValue && labelMatchValue[1]) {
            const numericLabelValue = labelMatchValue[1];
            if (cleanedSpoken.startsWith(numericLabelValue) && (cleanedSpoken.includes("minute") || cleanedSpoken.includes("min"))) {
              return option.value;
            }
          }
          if (cleanedSpoken === option.value || cleanedSpoken === option.label.toLowerCase().replace(/\s*minute(s)?/, '')) return option.value;
        }
      }
      const generalMinuteMatch = cleanedSpoken.match(/^(\d+)\s*(minute|min)s?$/);
      if (generalMinuteMatch && generalMinuteMatch[1]) {
        const numericValue = generalMinuteMatch[1];
        const foundOption = BUFFER_TIME_OPTIONS.find(opt => opt.value === numericValue);
        if (foundOption) return foundOption.value;
      }
      return null;
    }, []);

    const setBufferTimeByVoice = useCallback((spokenDuration: string) => {
      if (typeof window === 'undefined') return;
      const parsedValue = parseSpokenBufferTime(spokenDuration);
      if (parsedValue) {
        localStorage.setItem(LOCALSTORAGE_KEYS.BUFFER_TIME, JSON.stringify(parsedValue));
        window.dispatchEvent(new StorageEvent('storage', { key: LOCALSTORAGE_KEYS.BUFFER_TIME, newValue: JSON.stringify(parsedValue) }));
        const matchedOption = BUFFER_TIME_OPTIONS.find(opt => opt.value === parsedValue);
        toast({ title: "Buffer Time Set By Voice", description: <>Conceptual buffer time set to <strong>{matchedOption?.label || parsedValue}</strong>.</> });
      } else {
        toast({ title: "Buffer Time Not Understood", description: "Please try '1 minute', 'always on', etc.", variant: "default" });
      }
      setInputText('');
      setPartialWakeWordDetected(false);
      utteranceTranscriptRef.current = '';
      commandProcessedSuccessfullyRef.current = true;
    }, [toast, parseSpokenBufferTime, setInputText, setPartialWakeWordDetected]);

    const startAudioRecordingForSnippet = useCallback(async () => {
      const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognitionAPI || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        toast({ title: "Browser Not Supported", description: "Audio recording or speech recognition not supported.", variant: "destructive" });
        setIsLoading(false);
        return false;
      }
      if (hasMicPermission !== true) {
        toast({ title: "Microphone Access Denied", description: "Cannot record audio without microphone permission.", variant: "destructive" });
        setIsLoading(false);
        return false;
      }
       if (isLoading || isCapturingAudioForSnippet || isDashboardDictationActive || isCapturingAudioForLongRecording || isRecognizingSpeech) {
        toast({ title: "System Busy", description: "Another audio process is active.", variant: "default" });
        return false;
      }

      setIsLoading(true);
      setIsCapturingAudioForSnippet(true);
      snippetTranscriptRef.current = '';
      snippetAudioChunksRef.current = [];
      toast({ title: "Recording Audio & Speech...", description: <>Capturing for {RECORDING_DURATION_MS / 1000} seconds.</> });

      if (recognitionRef.current) {
        commandProcessedSuccessfullyRef.current = true; // Signal that Heggles Replay That is handling this
        try { recognitionRef.current.stop(); } catch (e) { console.warn("Error stopping main rec before snippet:", e); }
      }
      setIsRecognizingSpeech(false); // Ensure main listener is off

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        snippetMediaRecorderRef.current = new MediaRecorder(stream);
        snippetMediaRecorderRef.current.ondataavailable = (event) => {
          if (event.data.size > 0) {
            snippetAudioChunksRef.current.push(event.data);
          }
        };

        snippetMediaRecorderRef.current.onstop = async () => {
          stream.getTracks().forEach(track => track.stop());
          
          const audioBlob = new Blob(snippetAudioChunksRef.current, { type: 'audio/webm' });
          snippetAudioChunksRef.current = [];

          const base64AudioData = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.readAsDataURL(audioBlob);
            reader.onloadend = () => resolve(reader.result as string);
          });

          const liveTranscript = snippetTranscriptRef.current.trim();
          snippetTranscriptRef.current = '';
          
          try {
            const processedData = await processRecordedAudio(base64AudioData, liveTranscript);
            onThoughtRecalled({ id: crypto.randomUUID(), timestamp: Date.now(), ...processedData });
            toast({ title: "Recorded Snippet Processed", description: "AI analysis of live recording complete." });
          } catch (error) {
            toast({ title: "Error Processing Snippet", description: (error as Error).message, variant: "destructive" });
          } finally {
            setIsCapturingAudioForSnippet(false);
            setIsLoading(false);
          }
        };
        snippetMediaRecorderRef.current.start();

        snippetRecognitionRef.current = new SpeechRecognitionAPI();
        const snippetRecognizer = snippetRecognitionRef.current;
        snippetRecognizer.continuous = true;
        snippetRecognizer.interimResults = true;
        snippetRecognizer.lang = 'en-US';
        snippetRecognizer.onresult = (event: SpeechRecognitionEvent) => {
          let interim = "";
          let finalized = "";
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              finalized += event.results[i][0].transcript + ' ';
            } else {
              interim += event.results[i][0].transcript;
            }
          }
          if (finalized) {
            snippetTranscriptRef.current = (snippetTranscriptRef.current + finalized).trim();
          }
        };
        snippetRecognizer.onerror = (event: SpeechRecognitionErrorEvent) => {
          if (event.error === 'aborted') console.info('Snippet transcription aborted (expected on stop).');
          else if (event.error === 'no-speech') console.warn('Snippet transcription: No speech detected.');
          else console.warn('Snippet transcription error:', event.error, event.message);
        };
        snippetRecognizer.onend = () => {
          snippetRecognitionRef.current = null;
        };
        snippetRecognizer.start();

        setTimeout(() => {
          if (snippetMediaRecorderRef.current && snippetMediaRecorderRef.current.state === "recording") {
            try { snippetMediaRecorderRef.current.stop(); } catch (e) { console.warn("Error stopping media recorder for snippet:", e); }
          }
          if (snippetRecognitionRef.current) {
            try { snippetRecognitionRef.current.stop(); } catch (e) { console.warn("Error stopping snippet recognizer:", e); }
          }
        }, RECORDING_DURATION_MS);
        return true;

      } catch (err) {
        console.error("Error starting audio snippet recording:", err);
        toast({ title: "Audio Snippet Recording Error", description: (err as Error).message, variant: "destructive" });
        setIsCapturingAudioForSnippet(false);
        setIsLoading(false);
        if (snippetMediaRecorderRef.current && snippetMediaRecorderRef.current.state === "recording") {
          try { snippetMediaRecorderRef.current.stop(); } catch(e) {/* ignore */}
        }
        if (snippetRecognitionRef.current) {
          try { snippetRecognitionRef.current.stop(); } catch(e) {/* ignore */}
        }
        return false;
      }
    }, [
        hasMicPermission, 
        isLoading, 
        isCapturingAudioForSnippet, 
        isDashboardDictationActive, 
        isCapturingAudioForLongRecording, 
        isRecognizingSpeech, 
        toast, 
        onThoughtRecalled
    ]);

    const handleProcessInputText = useCallback(async () => {
      const textToProcess = inputText.trim();
      if (!textToProcess) {
        toast({ title: "Input empty", description: "Cannot process an empty thought.", variant: "destructive" });
        return;
      }
      
      setIsLoading(true);
      const hegglesBaseLower = WAKE_WORDS.HEGGLES_BASE.toLowerCase();
      const lowerText = textToProcess.toLowerCase();

      const shoppingListAddPattern = new RegExp(`^${hegglesBaseLower}\\s+${WAKE_WORDS.ADD_TO_SHOPPING_LIST_FULL_PREFIX_REGEX_PART.toLowerCase()}\\s+(.+?)(?:\\s+${WAKE_WORDS.TO_SHOPPING_LIST_SUFFIX_REGEX_PART.toLowerCase()})?$`);
      const shoppingListAddMatch = lowerText.match(shoppingListAddPattern);
      
      const todoListAddPattern = new RegExp(`^${hegglesBaseLower}\\s+${WAKE_WORDS.ADD_TO_TODO_LIST_FULL_PREFIX_REGEX_PART.toLowerCase()}\\s+(.+?)(?:\\s+${WAKE_WORDS.TO_TODO_LIST_SUFFIX_REGEX_PART.toLowerCase()})?$`);
      const todoListAddMatch = lowerText.match(todoListAddPattern);
            
      const deleteListPattern = new RegExp(`^${hegglesBaseLower}\\s+${WAKE_WORDS.DELETE_ITEM_PREFIX.toLowerCase()}\\s+(.*?)(?:\\s+${WAKE_WORDS.FROM_SHOPPING_LIST_TRIGGER.toLowerCase()}|\\s+${WAKE_WORDS.FROM_TODO_LIST_TRIGGER.toLowerCase()})$`);
      const deleteListMatch = lowerText.match(deleteListPattern);


      if (lowerText === WAKE_WORDS.HEGGLES_REPLAY_THAT.toLowerCase()) {
          setInputText(''); // Clear input before starting recording for "replay that"
          const recordingStarted = await startAudioRecordingForSnippet();
          if (!recordingStarted) {
            setIsLoading(false); // Reset loading if recording couldn't start
          }
          // isLoading will be reset by startAudioRecordingForSnippet or its onstop handler
          return;
      } else if (shoppingListAddMatch && shoppingListAddMatch[1]) {
        const item = shoppingListAddMatch[1].trim();
        confirmedDialogActionRef.current = false;
        setAlertDialogConfig({
          title: "Add to Shopping List?",
          description: <>Do you want to add <strong>"{item}"</strong> to your shopping list?</>,
          itemText: item,
          listKey: LOCALSTORAGE_KEYS.SHOPPING_LIST,
          listName: "Shopping List",
          onConfirm: () => {
            addListItem(LOCALSTORAGE_KEYS.SHOPPING_LIST, item, "Shopping List");
          },
        });
        setIsAlertDialogOpen(true);
        // setIsLoading(false) will be handled by AlertDialog onOpenChange
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
          onConfirm: () => {
            addListItem(LOCALSTORAGE_KEYS.TODO_LIST, task, "To-Do List");
          },
        });
        setIsAlertDialogOpen(true);
        // setIsLoading(false) will be handled by AlertDialog onOpenChange
        return;
      } else if (deleteListMatch && deleteListMatch[1]) {
        const itemIdentifierStr = deleteListMatch[1].trim();
        let listKey = "";
        let listName = "";

        if (lowerText.includes(WAKE_WORDS.FROM_SHOPPING_LIST_TRIGGER.toLowerCase())) {
          listKey = LOCALSTORAGE_KEYS.SHOPPING_LIST;
          listName = "Shopping List";
        } else if (lowerText.includes(WAKE_WORDS.FROM_TODO_LIST_TRIGGER.toLowerCase())) {
          listKey = LOCALSTORAGE_KEYS.TODO_LIST;
          listName = "To-Do List";
        }

        if (listKey && itemIdentifierStr) {
          const lowerIdentifierStr = itemIdentifierStr.toLowerCase();
          const itemNumberPrefix = WAKE_WORDS.ITEM_NUMBER_PREFIX.toLowerCase();
          if (lowerIdentifierStr.startsWith(itemNumberPrefix)) {
            const numberStr = lowerIdentifierStr.substring(itemNumberPrefix.length).trim();
            const itemNumber = parseInt(numberStr, 10);
            if (!isNaN(itemNumber) && itemNumber > 0) {
              deleteListItem(listKey, itemNumber, listName);
            } else {
              toast({ title: "Invalid Item Number", description: `"${numberStr}" is not a valid number.`, variant: "default" });
            }
          } else {
            deleteListItem(listKey, itemIdentifierStr, listName);
          }
        } else {
          toast({ title: "Deletion Command Incomplete", description: "Specify item and list (e.g., '...from my shopping list').", variant: "default" });
        }
        setInputText('');
        setIsLoading(false);
      } else { // General text processing
        try {
          const processedData = await processTextThought(textToProcess);
          let dialogShownForAISuggestion = false;
          let dataToRecallIfDialogCancelled: Omit<Thought, "id" | "timestamp"> | undefined = processedData;


          if (processedData.intentAnalysis?.isAction &&
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
              onConfirm: () => {
                addListItem(listKey, action, listName);
              },
            });
            setIsAlertDialogOpen(true);
            dialogShownForAISuggestion = true;
            // setIsLoading(false) will be handled by AlertDialog onOpenChange
            return; // Stop further processing, dialog will handle next steps
          } 
          else if (processedData.actionItems && processedData.actionItems.length > 0) {
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
                  onConfirm: () => {
                    addListItem(targetListKey!, itemToAdd!, targetListName!);
                  },
                });
                setIsAlertDialogOpen(true);
                dialogShownForAISuggestion = true;
                // setIsLoading(false) will be handled by AlertDialog onOpenChange
                return; // Stop further processing, dialog will handle next steps
              }
            }
          }

          // If no dialog was shown for an AI suggestion, then recall the thought
          if (!dialogShownForAISuggestion) {
             onThoughtRecalled({ id: crypto.randomUUID(), timestamp: Date.now(), ...processedData });
             toast({ title: "Thought Processed", description: processedData.aiAnswer ? "AI answered your question." : "AI analysis complete." });
             setInputText('');
             setIsLoading(false);
          }
        } catch (error) {
          toast({ title: "Error Processing Thought", description: (error as Error).message, variant: "destructive" });
          setIsLoading(false);
        }
      }
    }, [inputText, toast, onThoughtRecalled, addListItem, deleteListItem, startAudioRecordingForSnippet, setInputText, setIsLoading]);
    
    // --- START: Imperative handle methods exposed to parent (DashboardPage) ---
    const startLongRecording = useCallback((): boolean => {
        if (!isListening || hasMicPermission !== true || isLoading || isDashboardDictationActive || isCapturingAudioForSnippet || isCapturingAudioForLongRecording) {
          if (!isListening) toast({title: "Cannot Start Recording", description: "Voice Commands are disabled."});
          else if (hasMicPermission !== true) toast({title: "Cannot Start Recording", description: "Microphone permission missing."});
          else toast({title: "Cannot Start Recording", description: "System busy with another audio task."});
          return false;
        }
        
        // Stop other listeners
        if (recognitionRef.current) { commandProcessedSuccessfullyRef.current = true; try { recognitionRef.current.stop(); } catch(e) {/*ignore*/} }
        if (dashboardDictationRecognitionRef.current) { try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/} }
        if (snippetRecognitionRef.current) { try { snippetRecognitionRef.current.stop(); } catch(e) {/*ignore*/} }
        setIsRecognizingSpeech(false);
        setPartialWakeWordDetected(false);
        setIsDashboardDictationActive(false);
        setIsCapturingAudioForSnippet(false);
        utteranceTranscriptRef.current = '';
        
        const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognitionAPI || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          toast({ title: "Browser Not Supported", description: "Audio recording or speech recognition not supported.", variant: "destructive" });
          return false;
        }

        const startRecordingFlow = async () => {
          try {
            setIsCapturingAudioForLongRecording(true);
            longRecordingTranscriptRef.current = '';
            longRecordingAudioChunksRef.current = [];
            setInputText(''); // Clear input field when long recording starts

            longRecordingSpeechRecognizerRef.current = new SpeechRecognitionAPI();
            const recognizer = longRecordingSpeechRecognizerRef.current;
            recognizer.continuous = true;
            recognizer.interimResults = true;
            recognizer.lang = 'en-US';

            recognizer.onstart = () => {}; // Can add toast or UI update if needed

            recognizer.onresult = (event: SpeechRecognitionEvent) => {
              let interimTranscript = "";
              let finalTranscriptForThisResult = "";
              for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                  finalTranscriptForThisResult += event.results[i][0].transcript + ' ';
                } else {
                  interimTranscript += event.results[i][0].transcript;
                }
              }
              if (finalTranscriptForThisResult) {
                longRecordingTranscriptRef.current = (longRecordingTranscriptRef.current + finalTranscriptForThisResult).trim();
              }
              // Update inputText in real-time with combined final and interim transcript
              setInputText(longRecordingTranscriptRef.current + (interimTranscript ? " " + interimTranscript.trim() : ""));
            };
            recognizer.onerror = (event: SpeechRecognitionErrorEvent) => {
               if (event.error === 'aborted') {
                console.info("Continuous recording speech recognition aborted (likely intentional stop):", event.message);
              } else if (event.error === 'no-speech') {
                console.warn("Continuous recording speech recognition: No speech detected.", event.message);
              } else {
                console.error("Continuous recording speech recognition error:", event.error, event.message);
                // Only show toast for actual errors, not aborted/no-speech
                toast({ title: "Continuous Recording Transcription Error", description: event.message, variant: "destructive" });
              }
            };
            recognizer.onend = () => {
              // This onend might be called before mediarecorder.onstop if stop is called externally
              // The primary logic for processing should be in mediarecorder.onstop
              longRecordingSpeechRecognizerRef.current = null;
            };
            recognizer.start();

            // Start MediaRecorder
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            longRecordingMediaRecorderRef.current = new MediaRecorder(stream);
            longRecordingMediaRecorderRef.current.ondataavailable = (event) => {
              if (event.data.size > 0) {
                longRecordingAudioChunksRef.current.push(event.data);
              }
            };
            longRecordingMediaRecorderRef.current.onstop = async () => {
              // This is the main handler for when recording actually stops (after speech rec might have ended)
              stream.getTracks().forEach(track => track.stop());
              
              const finalTranscriptToSet = longRecordingTranscriptRef.current.trim();
              setIsCapturingAudioForLongRecording(false); // Reset state first
              setInputText(finalTranscriptToSet); // Ensure input text is set
              onStopLongRecordingParent(); // Notify parent AFTER internal states are set

              if (finalTranscriptToSet) {
                toast({ title: "Recording Stopped", description: "Transcript populated. Click Brain icon to process." });
              } else {
                toast({ title: "Recording Stopped", description: "No speech detected during recording." });
              }
              // Do NOT process automatically. User clicks Brain icon.
              longRecordingAudioChunksRef.current = []; // Clear chunks for next recording
            };
            longRecordingMediaRecorderRef.current.start();
            return true; // Successfully started

          } catch (err) {
            console.error("Error starting continuous recording:", err);
            toast({ title: "Continuous Recording Error", description: `Could not start recording: ${(err as Error).message}`, variant: "destructive" });
            setIsCapturingAudioForLongRecording(false); // Reset state
            if (longRecordingSpeechRecognizerRef.current) { try { longRecordingSpeechRecognizerRef.current.stop(); } catch (e) {/* ignore */}}
            if (longRecordingMediaRecorderRef.current && longRecordingMediaRecorderRef.current.state === "recording") {
              try { longRecordingMediaRecorderRef.current.stop(); } catch (e) {/* ignore */}
            }
            onStopLongRecordingParent(); // Notify parent
            return false; // Failed to start
          }
        };
        return startRecordingFlow();
    }, [
      isListening, hasMicPermission, isLoading, isDashboardDictationActive, isCapturingAudioForSnippet, isCapturingAudioForLongRecording,
      toast, setInputText, onStopLongRecordingParent 
    ]);

    const stopLongRecordingAndProcess = useCallback(() => {
        if (!isCapturingAudioForLongRecording) return;

        // Stop speech recognizer first, its onend will handle its cleanup
        if (longRecordingSpeechRecognizerRef.current) {
          try { longRecordingSpeechRecognizerRef.current.stop(); } catch(e) { /* ignore */ }
        }
        // Then stop media recorder, its onstop will handle transcript population and notifying parent
        if (longRecordingMediaRecorderRef.current && longRecordingMediaRecorderRef.current.state === "recording") {
          try { longRecordingMediaRecorderRef.current.stop(); } catch(e) { 
            // If stopping media recorder fails, manually ensure state is reset
            console.error("Error stopping media recorder:", e);
            const finalTranscript = longRecordingTranscriptRef.current.trim();
            setInputText(finalTranscript);
            setIsCapturingAudioForLongRecording(false);
            onStopLongRecordingParent();
             if (finalTranscript) {
               toast({ title: "Recording Stopped", description: "Transcript populated. Click Brain icon to process." });
             } else {
               toast({ title: "Recording Stopped", description: "No speech detected." });
             }
          }
        } else {
          // Fallback if media recorder wasn't recording but state thought it was
          const finalTranscript = longRecordingTranscriptRef.current.trim();
          setInputText(finalTranscript);
          setIsCapturingAudioForLongRecording(false);
          onStopLongRecordingParent();
           if (finalTranscript) {
             toast({ title: "Recording Stopped", description: "Transcript populated. Click Brain icon to process." });
           } else {
             toast({ title: "Recording Stopped", description: "No speech detected." });
           }
        }
    }, [isCapturingAudioForLongRecording, setInputText, onStopLongRecordingParent, toast]);

    useImperativeHandle(ref, () => ({
      simulateWakeWordAndListen: () => {
        if (!isListening || hasMicPermission !== true || isLoading || isCapturingAudioForSnippet || isDashboardDictationActive || isCapturingAudioForLongRecording) {
            toast({ title: "Cannot Simulate Wake Word", description: "Listener is off, busy, or mic permission is missing.", variant: "default" });
            return;
        }
        toast({ title: "Heggles Activated", description: "Listening for your command...", duration: 2000});

        commandProcessedSuccessfullyRef.current = false; // We are starting a new command sequence
        utteranceTranscriptRef.current = WAKE_WORDS.HEGGLES_BASE + " "; // Pre-fill with wake word
        setInputText(utteranceTranscriptRef.current); // Show in UI
        setPartialWakeWordDetected(true); // We've detected the wake word
        
        // If main recognizer is active, stop it. The useEffect will restart it with new state.
        if (recognitionRef.current && isRecognizingSpeech) {
            try { recognitionRef.current.stop(); } catch (e) { console.warn("Simulate: Error stopping existing main recognition:", e); }
        } else if (!isRecognizingSpeech && recognitionRef.current === null) {
            // If not active and null, useEffect will pick it up. This branch might be redundant if useEffect logic is robust.
        }
      },
      startLongRecording,
      stopLongRecordingAndProcess,
    }));
    // --- END: Imperative handle methods ---


    // Effect for browser support and initial mic permission check
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
            stream.getTracks().forEach(track => track.stop()); // Important to release mic immediately after permission check
            setHasMicPermission(true);
          })
          .catch(err => {
            console.warn("Microphone permission request error:", err.name, err.message);
            setHasMicPermission(false);
          });
      }
    }, [hasMicPermission]);

    // Effect to synchronize externally controlled long recording with internal state
     useEffect(() => {
        if (isExternallyLongRecording && !isCapturingAudioForLongRecording) {
          startLongRecording();
        } else if (!isExternallyLongRecording && isCapturingAudioForLongRecording) {
            stopLongRecordingAndProcess();
        }
    }, [isExternallyLongRecording, isCapturingAudioForLongRecording, startLongRecording, stopLongRecordingAndProcess]);


    // Main effect for Heggles wake word and command recognition
    useEffect(() => {
        const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognitionAPI) return;

        const shouldBeListening = isListening &&
                                  hasMicPermission === true &&
                                  !isLoading && 
                                  !isCapturingAudioForSnippet &&
                                  !isDashboardDictationActive &&
                                  !isCapturingAudioForLongRecording;

        if (shouldBeListening) {
          if (recognitionRef.current === null) { // Only create if null
            try {
                recognitionRef.current = new SpeechRecognitionAPI();
                const recognition = recognitionRef.current;
                recognition.continuous = true; 
                recognition.interimResults = true;
                recognition.lang = 'en-US';

                recognition.onstart = () => {
                  setIsRecognizingSpeech(true);
                  commandProcessedSuccessfullyRef.current = false; // Reset for new session
                  // utteranceTranscriptRef.current = ''; // Reset here, or preserve if wake word was just said
                  // setPartialWakeWordDetected(false); // Reset here, or preserve
                  if (!partialWakeWordDetected) { // If not resuming after "Heggles" pause
                    utteranceTranscriptRef.current = '';
                  }
                };

                recognition.onend = () => {
                  setIsRecognizingSpeech(false);
                  if (commandProcessedSuccessfullyRef.current) { // If a command was fully processed or intentionally stopped
                    utteranceTranscriptRef.current = '';
                    setPartialWakeWordDetected(false);
                  }
                  // If ended due to pause after just "Heggles", utteranceTranscriptRef and partialWakeWordDetected are preserved by onresult.
                  recognitionRef.current = null; // Nullify to allow re-creation
                };

                recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
                  if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
                    console.error('Main command recognition error:', event.error, event.message);
                    setHasMicPermission(false);
                    toast({ title: "Microphone Access Issue", variant: "destructive", description: "Speech recognition service denied. Check browser settings or permissions." });
                  } else if (event.error === 'no-speech' || event.error === 'aborted') {
                    // these are common, onend will handle cleanup and this useEffect will attempt restart if shouldBeListening
                  } else {
                     console.error('Main command recognition error:', event.error, event.message);
                  }
                  setPartialWakeWordDetected(false); // Reset on any error
                  utteranceTranscriptRef.current = '';
                  commandProcessedSuccessfullyRef.current = true; // Treat as processed to allow clean restart
                };

                recognition.onresult = (event: SpeechRecognitionEvent) => {
                  let newlyFinalizedSegmentThisTurn = "";
                  let currentInterimSegment = "";
                
                  for (let i = event.resultIndex; i < event.results.length; ++i) {
                    const segment = event.results[i][0].transcript;
                    if (event.results[i].isFinal) {
                      newlyFinalizedSegmentThisTurn += (newlyFinalizedSegmentThisTurn ? " " : "") + segment.trim();
                    } else {
                      currentInterimSegment += segment;
                    }
                  }
                
                  const hegglesBaseLower = WAKE_WORDS.HEGGLES_BASE.toLowerCase();
                  
                  // Update partialWakeWordDetected based on the very latest speech (interim or final)
                  const latestSpeechForWakeWordCheck = (currentInterimSegment || newlyFinalizedSegmentThisTurn).toLowerCase();
                  if (!partialWakeWordDetected && latestSpeechForWakeWordCheck.includes(hegglesBaseLower)) {
                      setPartialWakeWordDetected(true);
                      // Initialize utteranceTranscriptRef with "Heggles" and the rest of this segment
                      utteranceTranscriptRef.current = hegglesBaseLower + latestSpeechForWakeWordCheck.substring(latestSpeechForWakeWordCheck.indexOf(hegglesBaseLower) + hegglesBaseLower.length);
                      setInputText(utteranceTranscriptRef.current.trim() + " ");
                  } else if (partialWakeWordDetected && newlyFinalizedSegmentThisTurn) {
                      // Append newly finalized text if already wake-word-detected
                      utteranceTranscriptRef.current = (utteranceTranscriptRef.current + " " + newlyFinalizedSegmentThisTurn).trim();
                      setInputText(utteranceTranscriptRef.current + " ");
                  } else if (partialWakeWordDetected && currentInterimSegment) {
                      // Show interim results if wake-word-detected
                      setInputText(utteranceTranscriptRef.current + " " + currentInterimSegment.trim() + " ");
                  } else if (!partialWakeWordDetected && newlyFinalizedSegmentThisTurn) {
                      // Finalized speech, but no Heggles detected from start. Ignore for input population.
                      // This might be where the "Unrelated speech" toast could go if desired, but per spec, we ignore.
                      commandProcessedSuccessfullyRef.current = true; // Consider this utterance attempt "done"
                      if (recognitionRef.current) try { recognitionRef.current.stop(); } catch(e) {/*ignore*/}
                      return; // Don't populate input text
                  }

                  const lastResultIsFinal = event.results[event.results.length - 1].isFinal;
                
                  if (lastResultIsFinal && partialWakeWordDetected && utteranceTranscriptRef.current) {
                    const finalUtterance = utteranceTranscriptRef.current.trim();
                    const finalLower = finalUtterance.toLowerCase();
                
                    commandProcessedSuccessfullyRef.current = false; // Default to false, set true if command processed
                
                    // Check for immediate action commands
                    if (finalLower === WAKE_WORDS.HEGGLES_TURN_OFF.toLowerCase()) {
                      onToggleListeningParent(false);
                      commandProcessedSuccessfullyRef.current = true;
                      setInputText(''); // Clear input after immediate command
                    } else if (finalLower === WAKE_WORDS.HEGGLES_TURN_ON.toLowerCase()) {
                      onToggleListeningParent(true); 
                      commandProcessedSuccessfullyRef.current = true;
                      setInputText('');
                    } else if (finalLower.startsWith(WAKE_WORDS.HEGGLES_SET_BUFFER.toLowerCase())) {
                      const spokenDuration = finalUtterance.substring(WAKE_WORDS.HEGGLES_SET_BUFFER.length).trim();
                      setBufferTimeByVoice(spokenDuration); // This sets commandProcessedSuccessfullyRef.current = true internally
                      // setInputText is also cleared by setBufferTimeByVoice
                    } else if (finalLower === WAKE_WORDS.HEGGLES_REPLAY_THAT.toLowerCase()) {
                        // For "replay that", we populate the input text, then user clicks Brain.
                        // The Brain button handler will then call startAudioRecordingForSnippet.
                        setInputText(finalUtterance); // Ensure input text has "heggles replay that"
                        toast({ title: "Command Ready", description: "'Heggles replay that' recognized. Click Brain icon to record & process.", duration: 3000 });
                        commandProcessedSuccessfullyRef.current = true;
                    } else if (finalLower.startsWith(hegglesBaseLower)) { 
                        // For other "Heggles..." commands, populate input and let user click Brain
                        setInputText(finalUtterance); 
                        toast({ title: "Command Populated", description: "Click the Brain icon to process.", duration: 3000 });
                        commandProcessedSuccessfullyRef.current = true;
                    } else {
                        // This branch might be hit if utteranceTranscriptRef had "Heggles" but the final segment didn't extend it into a command.
                        // Or if partialWakeWordDetected was true but utterance somehow didn't start with Heggles.
                        // This indicates an unrecognized "Heggles..." attempt.
                        setInputText(finalUtterance); // Populate with what was said
                        toast({ title: "Command Not Fully Recognized", description: "Populated input. Click Brain to process or edit.", duration: 3000 });
                        commandProcessedSuccessfullyRef.current = true; 
                    }
                
                    if (recognitionRef.current && commandProcessedSuccessfullyRef.current) {
                      try { recognitionRef.current.stop(); } catch(e) { console.warn("Error stopping main cmd rec after final result processing:", e); }
                    } else if (recognitionRef.current && finalLower === hegglesBaseLower && !currentInterimSegment && !commandProcessedSuccessfullyRef.current) {
                       // Only "Heggles" was said, keep listening (continuous = true handles this)
                       // commandProcessedSuccessfullyRef remains false, so onend (if from pause) preserves state.
                    }
                  } else if (lastResultIsFinal && !partialWakeWordDetected && newlyFinalizedSegmentThisTurn) {
                    // Finalized speech, but no Heggles detected at all for this utterance. Ignore.
                     commandProcessedSuccessfullyRef.current = true; // This "session" of listening is over
                     if (recognitionRef.current) try { recognitionRef.current.stop(); } catch(e) {/*ignore*/}
                  }
                };
                
                // Check again before starting, state might have changed
                if ( isListening && hasMicPermission === true && !isLoading && !isCapturingAudioForSnippet && 
                     !isDashboardDictationActive && !isCapturingAudioForLongRecording && recognitionRef.current && !isRecognizingSpeech) {
                    try {
                        recognitionRef.current.start();
                    } catch (e) {
                        console.error("Failed to start main command speech recognition (inner try):", e);
                        if (recognitionRef.current) { try { recognitionRef.current.abort(); } catch (se) {/*ignore*/} }
                        recognitionRef.current = null; // Allow re-creation
                        setIsRecognizingSpeech(false); 
                    }
                }
            } catch (errOuter) {
                console.error("Failed to create main command speech recognition (outer try):", errOuter);
                 if (recognitionRef.current) {
                    try { recognitionRef.current.abort(); } catch (se) {/*ignore*/}
                    recognitionRef.current = null; // Allow re-creation
                }
                setIsRecognizingSpeech(false);
            }
          }
        } else { 
          // Conditions to listen are not met (e.g., !isListening, isLoading, etc.)
          if (recognitionRef.current) {
            commandProcessedSuccessfullyRef.current = true; // Signal that any ongoing session should clean up fully
            try {
              recognitionRef.current.stop();
            } catch(e) {
              console.warn("Error stopping main command recognition (in useEffect else):", e);
            }
            // onend will set recognitionRef.current to null
          }
        }

        return () => { // Cleanup function for the useEffect
          if (recognitionRef.current) {
            commandProcessedSuccessfullyRef.current = true; // Ensure cleanup on unmount/re-run
            try { recognitionRef.current.stop(); } catch (e) { /* ignore */ }
            recognitionRef.current = null;
          }
        };
    }, [
        isListening,
        hasMicPermission,
        isLoading, // Important: re-evaluate when loading changes
        isCapturingAudioForSnippet,
        isDashboardDictationActive,
        isCapturingAudioForLongRecording,
        onToggleListeningParent, // memoized
        setBufferTimeByVoice,    // memoized
        toast,
        isRecognizingSpeech,     // Added dependency
        addListItem,             // memoized
        deleteListItem,          // memoized
        startAudioRecordingForSnippet, // memoized
        handleProcessInputText, // memoized
        setInputText, 
        setPartialWakeWordDetected,
        setIsRecognizingSpeech
    ]);

    // --- START: Dashboard Dictation Mic Logic ---
    const handleDashboardMicClick = useCallback(async () => {
      const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognitionAPI) {
        toast({ title: "Browser Not Supported", variant: "destructive", description: "Speech recognition for dictation not available." });
        return;
      }
       if (isCapturingAudioForSnippet || isCapturingAudioForLongRecording || isLoading || isRecognizingSpeech) {
         toast({ title: "Action unavailable", description: "Another recording/processing is already in progress.", variant: "default"});
        return;
      }
      if (hasMicPermission === false) {
        toast({ title: "Microphone Access Denied", variant: "destructive" });
        return;
      }
      if (hasMicPermission === null) { // Should ideally be true by now, but as a fallback
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach(t => t.stop());
          setHasMicPermission(true);
        } catch (err) {
          setHasMicPermission(false);
          toast({ title: "Microphone Access Denied", variant: "destructive" });
          return;
        }
      }

      if (isDashboardDictationActive) { // If already dictating, stop it.
        if (dashboardDictationRecognitionRef.current) {
          try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
        }
        if (dashboardDictationPauseTimeoutRef.current) clearTimeout(dashboardDictationPauseTimeoutRef.current);
        // onend of dashboardDictationRecognitionRef will handle processing inputText if needed
        return;
      }

      // Stop main Heggles listener if active
      if (recognitionRef.current) {
        commandProcessedSuccessfullyRef.current = true; // Tell it to clean up
        try { recognitionRef.current.stop(); } catch (e) { /* ignore */ }
      }
      setIsRecognizingSpeech(false);
      setPartialWakeWordDetected(false);
      utteranceTranscriptRef.current = '';

      setIsDashboardDictationActive(true);
      dashboardDictationAccumulatedTranscriptRef.current = ''; // Clear previous dictation
      setInputText(''); // Clear the main input text for new dictation

      dashboardDictationRecognitionRef.current = new SpeechRecognitionAPI();
      const recognition = dashboardDictationRecognitionRef.current;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {}; // Optional: UI feedback for dictation start
      recognition.onresult = (event: SpeechRecognitionEvent) => {
        if (dashboardDictationPauseTimeoutRef.current) clearTimeout(dashboardDictationPauseTimeoutRef.current);

        let interim = "";
        let finalizedThisTurn = "";

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const segment = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalizedThisTurn += (finalizedThisTurn ? " " : "") + segment.trim();
          } else {
            interim += segment;
          }
        }
        
        if (finalizedThisTurn) {
          dashboardDictationAccumulatedTranscriptRef.current = (dashboardDictationAccumulatedTranscriptRef.current + (dashboardDictationAccumulatedTranscriptRef.current ? " " : "") + finalizedThisTurn).trim();
        }
        
        setInputText(dashboardDictationAccumulatedTranscriptRef.current + (interim ? (dashboardDictationAccumulatedTranscriptRef.current ? " " : "") + interim.trim() : ""));

        // Check for "Heggles end" or "Heggles stop" to terminate dictation
        const currentDictationTranscriptForEndCheck = dashboardDictationAccumulatedTranscriptRef.current + (interim ? " " + interim.trim() : "");
        const lowerTranscriptForEndCheck = currentDictationTranscriptForEndCheck.toLowerCase();
        const endCommand = WAKE_WORDS.END_DICTATION.toLowerCase();
        const stopCommand = WAKE_WORDS.STOP_DICTATION.toLowerCase();

        if (lowerTranscriptForEndCheck.endsWith(endCommand) || lowerTranscriptForEndCheck.endsWith(stopCommand)) {
          let finalSpokenText = dashboardDictationAccumulatedTranscriptRef.current; // Use accumulated final parts
          if (lowerTranscriptForEndCheck.endsWith(endCommand)) {
            const endCmdIdx = finalSpokenText.toLowerCase().lastIndexOf(endCommand);
            if (endCmdIdx !== -1) finalSpokenText = finalSpokenText.substring(0, endCmdIdx).trim();
          } else if (lowerTranscriptForEndCheck.endsWith(stopCommand)) {
            const stopCmdIdx = finalSpokenText.toLowerCase().lastIndexOf(stopCommand);
            if (stopCmdIdx !== -1) finalSpokenText = finalSpokenText.substring(0, stopCmdIdx).trim();
          }
          setInputText(finalSpokenText); // Update input text without the "end/stop" command
          if (dashboardDictationRecognitionRef.current) try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
          // Note: onend will then trigger processing if text is present
        } else {
          // Set timeout to stop if user pauses for 2 seconds
          dashboardDictationPauseTimeoutRef.current = setTimeout(() => {
            if (dashboardDictationRecognitionRef.current) try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
          }, 2000);
        }
      };
      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (event.error === 'aborted') {
          console.info('Dashboard dictation aborted.');
        } else if (event.error === 'no-speech') {
           if (isDashboardDictationActive) toast({title: "No speech detected for dictation.", variant: "default"})
        } else {
          console.error('Dashboard dictation error:', event.error, event.message);
          toast({ title: "Dictation Error", description: event.message || "Could not recognize speech.", variant: "destructive" });
        }
        if (dashboardDictationPauseTimeoutRef.current) clearTimeout(dashboardDictationPauseTimeoutRef.current);
        setIsDashboardDictationActive(false);
      };
      recognition.onend = () => {
        if (dashboardDictationPauseTimeoutRef.current) clearTimeout(dashboardDictationPauseTimeoutRef.current);
        setIsDashboardDictationActive(false);
        dashboardDictationRecognitionRef.current = null;
        
        // The inputText is already populated by onresult.
        // User will click Brain icon to process.
        const finalDictatedText = dashboardDictationAccumulatedTranscriptRef.current.trim();
        setInputText(finalDictatedText); // Ensure final accumulated text is set
        if (finalDictatedText) {
          toast({ title: "Dictation Ended", description: "Click Brain icon to process.", duration: 3000 });
        }
        dashboardDictationAccumulatedTranscriptRef.current = ''; // Clear for next time
      };

      try {
        recognition.start();
      } catch (e) {
        console.error("Failed to start dashboard dictation:", e);
        setIsDashboardDictationActive(false);
        toast({ title: "Dictation Error", description: "Could not start dictation.", variant: "destructive" });
      }
    }, [
        toast, 
        hasMicPermission, 
        isCapturingAudioForSnippet, 
        isCapturingAudioForLongRecording, 
        isLoading, 
        isDashboardDictationActive, 
        isRecognizingSpeech, 
        setInputText
    ]);
    // --- END: Dashboard Dictation Mic Logic ---

    // --- START: UI Helper functions for status/icons ---
    const getMicIconForCardHeader = () => {
      if (isCapturingAudioForLongRecording) return <Radio className="h-5 w-5 text-red-500 animate-pulse" />
      if (isCapturingAudioForSnippet) return <Radio className="h-5 w-5 text-red-500 animate-pulse" />
      if (isDashboardDictationActive) return <Radio className="h-5 w-5 text-red-500 animate-pulse" />;
      if (partialWakeWordDetected) return <Mic className="h-5 w-5 text-yellow-500 animate-pulse" />;
      if (isRecognizingSpeech) return <Mic className="h-5 w-5 text-primary animate-pulse" />;
      if (isListening && hasMicPermission && !isBrowserUnsupported && !isLoading) return <Mic className="h-5 w-5 text-primary" />;
      return <MicOff className="h-5 w-5 text-muted-foreground" />;
    };

    const getMicStatusText = (): React.ReactNode => {
      if (isCapturingAudioForLongRecording) return "Continuous recording active...";
      if (isCapturingAudioForSnippet) return <>Recording audio & speech for <strong>Heggles replay that</strong>...</>;
      if (isDashboardDictationActive) return "Dictating to input area...";
      if (isLoading && !isAlertDialogOpen) return "Processing..."; // Only show processing if dialog is not open (dialog handles its own loading state)
      if (!isListening) return "Voice Inactive (Voice Commands Off)";
      if (isBrowserUnsupported) return "Voice N/A (Browser Not Supported)";
      if (hasMicPermission === false) return <span className="text-destructive">Mic Access Denied</span>;
      if (hasMicPermission === null) return "Mic Awaiting Permission...";
      if (partialWakeWordDetected) return <>'<strong>Heggles</strong>' detected, awaiting command...</>;
      if (isRecognizingSpeech) return <>Listening for '<strong>Heggles</strong>' + command</>;
      if (isListening && hasMicPermission && !isBrowserUnsupported) return <>Listener active for '<strong>Heggles</strong>'</>;
      return "Voice status checking...";
    };

    const getTextareaPlaceholder = (): string => {
      if (isCapturingAudioForLongRecording) return "Continuous recording active. Transcript populates here. Click Brain icon to process.";
      if (isCapturingAudioForSnippet) return "Recording audio & speech for 'Heggles replay that'. Live transcript populates here for processing.";
      if (isDashboardDictationActive) return "Dictating your thought... Say 'Heggles end' or 'Heggles stop' to finish. Text populates here. Click Brain icon to process.";
      if (isLoading && !isAlertDialogOpen) return "Processing...";
      if (!isListening) return "Enable voice commands to use voice, or type input here. Click Brain icon to process.";
      if (partialWakeWordDetected) return "'Heggles' detected. Finish your command. Text populates here for Brain processing.";
      if (isRecognizingSpeech) return "Listening for 'Heggles' + command. Text populates here for Brain processing.";
      return "Type thought or say 'Heggles' + command. Click Brain icon to process.";
    };
    
    const dashboardMicButtonDisabled =
                                       hasMicPermission !== true ||
                                       isBrowserUnsupported ||
                                       isCapturingAudioForSnippet ||
                                       isLoading || // Disable if any general loading is happening
                                       isCapturingAudioForLongRecording ||
                                       isRecognizingSpeech; // Disable if main Heggles listener is active


    const getDashboardDictationButtonIcon = () => {
        if (isDashboardDictationActive) return <Radio className="h-5 w-5 text-red-500 animate-pulse" />;
        if (hasMicPermission !== true || isBrowserUnsupported) return <MicOff className="h-5 w-5 text-muted-foreground" />
        return <Mic className="h-5 w-5 text-primary" />;
    };
    // --- END: UI Helper functions ---


    // --- START: useEffect Cleanup for Speech Recognition Instances ---
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
         if (longRecordingSpeechRecognizerRef.current) {
          try { longRecordingSpeechRecognizerRef.current.stop(); } catch(e) {/*ignore*/}
          longRecordingSpeechRecognizerRef.current = null;
        }
        if (dashboardDictationPauseTimeoutRef.current) clearTimeout(dashboardDictationPauseTimeoutRef.current);
      };
    }, []);
    // --- END: useEffect Cleanup ---


    return (
      <>
        <Card className="w-full shadow-lg">
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle className="text-xl">Input & Recall</CardTitle>
              {hasMicPermission !== null && !isBrowserUnsupported && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground" title={typeof getMicStatusText() === 'string' ? getMicStatusText() as string : undefined}>
                  {getMicIconForCardHeader()}
                  <span>{getMicStatusText()}</span>
                </div>
              )}
            </div>
            <CardDescription>
              Use the mic for dictation or say '<strong>Heggles</strong>' + command.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {isBrowserUnsupported && (
                <Alert variant="destructive" className="mb-4">
                  <AlertTriangleIcon className="h-4 w-4" />
                  <UiAlertTitle>Browser Not Supported</UiAlertTitle>
                  <AlertDescription>Speech recognition not supported. Manual input available.</AlertDescription>
                </Alert>
              )}
              {isListening && hasMicPermission === false && !isBrowserUnsupported && ( // Show only if listening is toggled on but permission is denied
                <Alert variant="destructive" className="mb-4">
                  <AlertTriangleIcon className="h-4 w-4" />
                  <UiAlertTitle>Microphone Access Denied</UiAlertTitle>
                  <AlertDescription>Voice commands require microphone access. Manual input available.</AlertDescription>
                </Alert>
              )}

              <Textarea
                placeholder={getTextareaPlaceholder()}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                rows={4}
                disabled={isLoading || isCapturingAudioForSnippet || isCapturingAudioForLongRecording || (isRecognizingSpeech && partialWakeWordDetected && !commandProcessedSuccessfullyRef.current && utteranceTranscriptRef.current.length > 0) }
                className="resize-none"
                aria-label="Thought input area"
              />
              <div className="flex items-stretch gap-2">
                <Button
                  type="button"
                  onClick={handleProcessInputText}
                  disabled={isLoading || isCapturingAudioForSnippet || isCapturingAudioForLongRecording || !inputText.trim() || isDashboardDictationActive || (isRecognizingSpeech && partialWakeWordDetected && !commandProcessedSuccessfullyRef.current && utteranceTranscriptRef.current.length > 0) }
                  size="icon"
                  aria-label="Process text from input area with AI"
                  title="Process text from input area with AI"
                  variant="outline"
                >
                  {(isLoading && !isAlertDialogOpen && inputText.trim()) ? <Loader2 className="h-5 w-5 animate-spin" /> : <Brain className="h-5 w-5" />}
                </Button>
                <Button
                  type="button"
                  onClick={handleDashboardMicClick}
                  disabled={dashboardMicButtonDisabled}
                  variant="outline"
                  size="icon"
                  aria-label={isDashboardDictationActive ? "Stop dictation (or say 'Heggles end/stop')" : "Dictate thought into input area (ends on pause or 'Heggles end/stop')"}
                  title={isDashboardDictationActive ? "Stop dictation (or say 'Heggles end/stop')" : "Dictate thought into input area (ends on pause or 'Heggles end/stop')"}
                >
                  {getDashboardDictationButtonIcon()}
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
              if (!open) { // Dialog is closing
                if (!confirmedDialogActionRef.current && alertDialogConfig.dataToRecallOnCancel) {
                  onThoughtRecalled({ id: crypto.randomUUID(), timestamp: Date.now(), ...alertDialogConfig.dataToRecallOnCancel });
                  toast({ title: "Suggestion Declined", description: "Original thought captured in Recent Thoughts." });
                }
                // Common cleanup whether confirmed or cancelled
                confirmedDialogActionRef.current = false; 
                setAlertDialogConfig(null); 
                setIsLoading(false); // Crucial: Reset loading state
                setInputText('');    // Clear input text
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
                <AlertDialogCancel onClick={() => { /* State handled by onOpenChange */ }}>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => {
                  if (alertDialogConfig) {
                    confirmedDialogActionRef.current = true; // Mark as confirmed
                    alertDialogConfig.onConfirm();
                  }
                  // onOpenChange will handle the rest of the cleanup
                }}>Confirm</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </>
    );
  });

ThoughtInputForm.displayName = "ThoughtInputForm";
