
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
  AlertDialogTitle, // Added missing import
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
    const [isRecognizingSpeech, setIsRecognizingSpeech] = useState(false);
    const [isBrowserUnsupported, setIsBrowserUnsupported] = useState(false);
    const [partialWakeWordDetected, setPartialWakeWordDetected] = useState(false);
    const recognitionRef = useRef<SpeechRecognition | null>(null);
    const utteranceTranscriptRef = useRef<string>('');
    const commandProcessedSuccessfullyRef = useRef<boolean>(false);

    const [isDashboardDictationActive, setIsDashboardDictationActive] = useState(false);
    const dashboardDictationRecognitionRef = useRef<SpeechRecognition | null>(null);
    const dashboardDictationPauseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const dashboardDictationAccumulatedTranscriptRef = useRef<string>('');

    const [isCapturingAudioForSnippet, setIsCapturingAudioForSnippet] = useState(false);
    const snippetMediaRecorderRef = useRef<MediaRecorder | null>(null);
    const snippetRecognitionRef = useRef<SpeechRecognition | null>(null);
    const snippetTranscriptRef = useRef<string>('');
    const snippetAudioChunksRef = useRef<Blob[]>([]);

    const [isCapturingAudioForLongRecording, setIsCapturingAudioForLongRecording] = useState(false);
    const longRecordingMediaRecorderRef = useRef<MediaRecorder | null>(null);
    const longRecordingSpeechRecognizerRef = useRef<SpeechRecognition | null>(null);
    const longRecordingTranscriptRef = useRef<string>('');
    const longRecordingAudioChunksRef = useRef<Blob[]>([]);

    const confirmedDialogActionRef = useRef(false);

    const [alertDialogConfig, setAlertDialogConfig] = useState<{
      title: string;
      description: React.ReactNode;
      itemText?: string;
      listKey?: string;
      listName?: string;
      dataToRecallOnCancel?: Omit<Thought, "id" | "timestamp">; // For recalling original thought if suggestion cancelled
      onConfirm: () => void;
    } | null>(null);
    const [isAlertDialogOpen, setIsAlertDialogOpen] = useState(false);


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
    }, [toast, parseSpokenBufferTime]);

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
      if (isLoading || isCapturingAudioForSnippet || isDashboardDictationActive || isCapturingAudioForLongRecording || isRecognizingSpeech ) {
        toast({ title: "System Busy", description: "Another audio process is active.", variant: "default" });
        return false;
      }

      setIsLoading(true);
      setIsCapturingAudioForSnippet(true);
      snippetTranscriptRef.current = '';
      snippetAudioChunksRef.current = [];
      toast({ title: "Recording Audio & Speech...", description: <>Capturing for {RECORDING_DURATION_MS / 1000} seconds.</> });

      if (recognitionRef.current) {
        commandProcessedSuccessfullyRef.current = true;
        try { recognitionRef.current.stop(); } catch (e) { console.warn("Error stopping main rec before snippet:", e); }
      }
      setIsRecognizingSpeech(false);

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
    }, [hasMicPermission, isLoading, isCapturingAudioForSnippet, isDashboardDictationActive, isCapturingAudioForLongRecording, isRecognizingSpeech, toast, onThoughtRecalled]);

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
          setInputText('');
          if (await startAudioRecordingForSnippet()) {
            // setIsLoading is handled by startAudioRecordingForSnippet and its async flow
          } else {
            setIsLoading(false); // Ensure loading is false if snippet recording fails to start
          }
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
          // No dataToRecallOnCancel for explicit commands
        });
        setIsAlertDialogOpen(true);
        // setIsLoading and setInputText('') will be handled by AlertDialog's onOpenChange
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
          // No dataToRecallOnCancel for explicit commands
        });
        setIsAlertDialogOpen(true);
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
      } else { 
        // General text processing
        try {
          const processedData = await processTextThought(textToProcess);
          let dialogShownForAISuggestion = false;

          // Check AI Intent Analysis for list additions
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
              dataToRecallOnCancel: processedData, // Important: pass data for recall
              onConfirm: () => {
                addListItem(listKey, action, listName);
              },
            });
            setIsAlertDialogOpen(true);
            dialogShownForAISuggestion = true;
          } 
          // Check refineThought's actionItems for list additions (if no intent suggestiondialog already shown)
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
                  dataToRecallOnCancel: processedData, // Important: pass data for recall
                  onConfirm: () => {
                    addListItem(targetListKey!, itemToAdd!, targetListName!);
                  },
                });
                setIsAlertDialogOpen(true);
                dialogShownForAISuggestion = true;
                break; 
              }
            }
          }

          // If no dialog was shown for an AI suggestion, process as a normal thought
          if (!dialogShownForAISuggestion) {
             onThoughtRecalled({ id: crypto.randomUUID(), timestamp: Date.now(), ...processedData });
             toast({ title: "Thought Processed", description: processedData.aiAnswer ? "AI answered your question." : "AI analysis complete." });
             setInputText('');
             setIsLoading(false);
          }
          // If a dialog was shown, the loading/input text state is handled by the dialog's onOpenChange
          
        } catch (error) {
          toast({ title: "Error Processing Thought", description: (error as Error).message, variant: "destructive" });
          setIsLoading(false);
        }
      }
    }, [inputText, toast, onThoughtRecalled, addListItem, deleteListItem, startAudioRecordingForSnippet]);

    const startLongRecording = useCallback((): boolean => {
        if (!isListening || hasMicPermission !== true || isLoading || isDashboardDictationActive || isCapturingAudioForSnippet || isCapturingAudioForLongRecording) {
          if (!isListening) toast({title: "Cannot Start Recording", description: "Voice Commands are disabled."});
          else if (hasMicPermission !== true) toast({title: "Cannot Start Recording", description: "Microphone permission missing."});
          else toast({title: "Cannot Start Recording", description: "System busy with another audio task."});
          return false;
        }
        
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
            setInputText(''); 

            longRecordingSpeechRecognizerRef.current = new SpeechRecognitionAPI();
            const recognizer = longRecordingSpeechRecognizerRef.current;
            recognizer.continuous = true;
            recognizer.interimResults = true;
            recognizer.lang = 'en-US';

            recognizer.onstart = () => {};

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
              setInputText(longRecordingTranscriptRef.current + (interimTranscript ? " " + interimTranscript.trim() : ""));
            };
            recognizer.onerror = (event: SpeechRecognitionErrorEvent) => {
               if (event.error === 'aborted') {
                console.info("Continuous recording speech recognition aborted (likely intentional stop):", event.message);
              } else if (event.error === 'no-speech') {
                console.warn("Continuous recording speech recognition: No speech detected.", event.message);
              } else {
                console.error("Continuous recording speech recognition error:", event.error, event.message);
              }
            };
            recognizer.onend = () => {
              longRecordingSpeechRecognizerRef.current = null;
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
              // Moved setInputText here to ensure it happens before parent is notified
              setInputText(finalTranscriptToSet); 
              setIsCapturingAudioForLongRecording(false);
              onStopLongRecordingParent(); 

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
            toast({ title: "Continuous Recording Error", description: `Could not start recording: ${(err as Error).message}`, variant: "destructive" });
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
    }, [
      isListening, hasMicPermission, isLoading, isDashboardDictationActive, isCapturingAudioForSnippet, isCapturingAudioForLongRecording,
      toast, onStopLongRecordingParent 
    ]);

    const stopLongRecordingAndProcess = useCallback(() => {
        if (!isCapturingAudioForLongRecording) return;

        if (longRecordingSpeechRecognizerRef.current) {
          try { longRecordingSpeechRecognizerRef.current.stop(); } catch(e) { /* ignore */ }
        }
        if (longRecordingMediaRecorderRef.current && longRecordingMediaRecorderRef.current.state === "recording") {
          try { longRecordingMediaRecorderRef.current.stop(); } catch(e) { /* onstop will handle the rest */ }
        } else {
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
    }, [isCapturingAudioForLongRecording, onStopLongRecordingParent, toast]);


    useImperativeHandle(ref, () => ({
      simulateWakeWordAndListen: () => {
        if (!isListening || hasMicPermission !== true || isLoading || isCapturingAudioForSnippet || isDashboardDictationActive || isCapturingAudioForLongRecording) {
            toast({ title: "Cannot Simulate Wake Word", description: "Listener is off, busy, or mic permission is missing.", variant: "default" });
            return;
        }
        toast({ title: "Heggles Activated", description: "Listening for your command...", duration: 2000});

        commandProcessedSuccessfullyRef.current = false;
        utteranceTranscriptRef.current = WAKE_WORDS.HEGGLES_BASE + " ";
        setInputText(utteranceTranscriptRef.current); // Populate input with "Heggles "
        setPartialWakeWordDetected(true);
        
        if (recognitionRef.current && isRecognizingSpeech) {
            try { recognitionRef.current.stop(); } catch (e) { console.warn("Simulate: Error stopping existing main recognition:", e); }
        }
        // The main useEffect will restart recognitionRef.current if it's null and shouldBeListening.
      },
      startLongRecording,
      stopLongRecordingAndProcess,
    }));


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
            console.warn("Microphone permission request error:", err.name, err.message);
            setHasMicPermission(false);
          });
      }
    }, [hasMicPermission]);

    useEffect(() => {
        if (isExternallyLongRecording && !isCapturingAudioForLongRecording) {
          startLongRecording();
        } else if (!isExternallyLongRecording && isCapturingAudioForLongRecording) {
           stopLongRecordingAndProcess();
        }
    }, [isExternallyLongRecording, isCapturingAudioForLongRecording, startLongRecording, stopLongRecordingAndProcess]);


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
          if (recognitionRef.current === null) {
            try {
                recognitionRef.current = new SpeechRecognitionAPI();
                const recognition = recognitionRef.current;
                recognition.continuous = true; 
                recognition.interimResults = true;
                recognition.lang = 'en-US';

                recognition.onstart = () => {
                  setIsRecognizingSpeech(true);
                  commandProcessedSuccessfullyRef.current = false;
                  // Reset utterance ONLY if not preserving from a pause where Heggles was already detected
                  if (!partialWakeWordDetected || !utteranceTranscriptRef.current.toLowerCase().startsWith(WAKE_WORDS.HEGGLES_BASE.toLowerCase())) {
                      utteranceTranscriptRef.current = '';
                      setPartialWakeWordDetected(false);
                  }
                };

                recognition.onend = () => {
                  setIsRecognizingSpeech(false);
                  if (commandProcessedSuccessfullyRef.current) {
                    utteranceTranscriptRef.current = '';
                    setPartialWakeWordDetected(false);
                  } else if (partialWakeWordDetected && utteranceTranscriptRef.current.toLowerCase() === WAKE_WORDS.HEGGLES_BASE.toLowerCase()){
                    // Only "Heggles" was said, preserve for next cycle
                  } else {
                    // Unclear ending, reset for safety
                    utteranceTranscriptRef.current = '';
                    setPartialWakeWordDetected(false);
                  }
                  recognitionRef.current = null; 
                };

                recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
                  if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
                    console.error('Main command recognition error:', event.error, event.message);
                    setHasMicPermission(false);
                    toast({ title: "Microphone Access Issue", variant: "destructive", description: "Speech recognition service denied. Check browser settings or permissions." });
                  } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
                     console.error('Main command recognition error:', event.error, event.message);
                  }
                  setPartialWakeWordDetected(false);
                  commandProcessedSuccessfullyRef.current = true; 
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
                  
                  if (!partialWakeWordDetected) {
                    const checkTextForWakeWord = (newlyFinalizedSegmentThisTurn + " " + currentInterimSegment).trim().toLowerCase();
                    if (checkTextForWakeWord.startsWith(hegglesBaseLower)) {
                      setPartialWakeWordDetected(true);
                      utteranceTranscriptRef.current = checkTextForWakeWord.substring(checkTextForWakeWord.indexOf(hegglesBaseLower));
                      setInputText(utteranceTranscriptRef.current); 
                    } else if (newlyFinalizedSegmentThisTurn) {
                      // Finalized speech that doesn't start with Heggles - ignore for this listener
                      commandProcessedSuccessfullyRef.current = true; 
                      if (recognitionRef.current) try { recognitionRef.current.stop(); } catch(e) {} 
                      return;
                    }
                  } else { // Heggles already detected
                    if (newlyFinalizedSegmentThisTurn) {
                      utteranceTranscriptRef.current = (utteranceTranscriptRef.current + " " + newlyFinalizedSegmentThisTurn).trim().replace(/^heggles\s+heggles/i, 'heggles'); // Avoid "heggles heggles"
                    }
                    setInputText(utteranceTranscriptRef.current + (currentInterimSegment ? " " + currentInterimSegment.trim() : ""));
                  }
                
                  const lastResultIsFinal = event.results[event.results.length - 1].isFinal;
                
                  if (lastResultIsFinal && utteranceTranscriptRef.current) {
                    const finalUtterance = utteranceTranscriptRef.current.trim();
                    const finalLower = finalUtterance.toLowerCase();
                
                    commandProcessedSuccessfullyRef.current = false; 
                
                    if (finalLower === WAKE_WORDS.HEGGLES_TURN_OFF.toLowerCase()) {
                      onToggleListeningParent(false);
                      commandProcessedSuccessfullyRef.current = true;
                    } else if (finalLower === WAKE_WORDS.HEGGLES_TURN_ON.toLowerCase()) {
                      onToggleListeningParent(true); 
                      commandProcessedSuccessfullyRef.current = true;
                    } else if (finalLower.startsWith(WAKE_WORDS.HEGGLES_SET_BUFFER.toLowerCase())) {
                      const spokenDuration = finalUtterance.substring(WAKE_WORDS.HEGGLES_SET_BUFFER.length).trim();
                      setBufferTimeByVoice(spokenDuration);
                      // commandProcessedSuccessfullyRef is set by setBufferTimeByVoice
                    } else if (finalLower.startsWith(hegglesBaseLower)) { 
                       // For "heggles replay that" OR any other command that populates input for Brain button
                      setInputText(finalUtterance); // Ensure final version is in inputText
                      // If it's NOT "replay that", it's a command for the brain button or an unrecognized command
                      if (finalLower !== WAKE_WORDS.HEGGLES_REPLAY_THAT.toLowerCase()) {
                        toast({ title: "Command Populated", description: "Click the Brain icon to process.", duration: 3000 });
                      }
                      // For "replay that", the Brain button click will handle the specific action.
                      // For other heggles commands, they are now in inputText for Brain button.
                      commandProcessedSuccessfullyRef.current = true;
                    } else {
                      commandProcessedSuccessfullyRef.current = true; 
                    }
                
                    if (recognitionRef.current && commandProcessedSuccessfullyRef.current) {
                      try { recognitionRef.current.stop(); } catch(e) { console.warn("Error stopping main cmd rec after final result processing:", e); }
                    } else if (recognitionRef.current && finalLower === hegglesBaseLower && !currentInterimSegment) {
                      commandProcessedSuccessfullyRef.current = false;
                    }
                  }
                };
                
                if (!isRecognizingSpeech) { // Check if not already recognizing
                    try {
                        recognitionRef.current.start();
                    } catch (e) {
                        console.error("Failed to start main command speech recognition (inner try):", e);
                        if (recognitionRef.current) { try { recognitionRef.current.abort(); } catch (se) {/*ignore*/} }
                        recognitionRef.current = null;
                        setIsRecognizingSpeech(false); 
                    }
                }
            } catch (errOuter) {
                console.error("Failed to create main command speech recognition (outer try):", errOuter);
                 if (recognitionRef.current) {
                    try { recognitionRef.current.abort(); } catch (se) {/*ignore*/}
                    recognitionRef.current = null;
                }
                setIsRecognizingSpeech(false);
            }
          }
        } else { 
          if (recognitionRef.current) {
            commandProcessedSuccessfullyRef.current = true; 
            try {
              recognitionRef.current.stop();
            } catch(e) {
              console.warn("Error stopping main command recognition (in useEffect else):", e);
            }
          }
        }

        return () => {
          if (recognitionRef.current) {
            commandProcessedSuccessfullyRef.current = true; 
            try { recognitionRef.current.stop(); } catch (e) { /* ignore */ }
            recognitionRef.current = null;
          }
        };
    }, [
        isListening,
        hasMicPermission,
        isLoading,
        isCapturingAudioForSnippet,
        isDashboardDictationActive,
        isCapturingAudioForLongRecording,
        onToggleListeningParent,
        setBufferTimeByVoice,
        toast,
        isRecognizingSpeech,
        startAudioRecordingForSnippet, // Now a dependency for the "replay that" path
    ]);

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
      if (hasMicPermission === null) {
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

      if (isDashboardDictationActive) {
        if (dashboardDictationRecognitionRef.current) {
          try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
        }
        if (dashboardDictationPauseTimeoutRef.current) clearTimeout(dashboardDictationPauseTimeoutRef.current);
        // Processing will happen via Brain button after text is populated
        return;
      }

      if (recognitionRef.current) {
        commandProcessedSuccessfullyRef.current = true; 
        try { recognitionRef.current.stop(); } catch (e) { /* ignore */ }
      }
      setIsRecognizingSpeech(false);
      setPartialWakeWordDetected(false);
      utteranceTranscriptRef.current = '';

      setIsDashboardDictationActive(true);
      dashboardDictationAccumulatedTranscriptRef.current = ''; // Start with empty for dictation
      setInputText(''); 

      dashboardDictationRecognitionRef.current = new SpeechRecognitionAPI();
      const recognition = dashboardDictationRecognitionRef.current;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {};
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

        const currentDictationTranscript = dashboardDictationAccumulatedTranscriptRef.current;
        const lowerTranscriptForEndCheck = (currentDictationTranscript + (interim ? " " + interim.trim() : "")).trim().toLowerCase();
        const endCommand = WAKE_WORDS.END_DICTATION.toLowerCase();
        const stopCommand = WAKE_WORDS.STOP_DICTATION.toLowerCase();

        if (lowerTranscriptForEndCheck.endsWith(endCommand) || lowerTranscriptForEndCheck.endsWith(stopCommand)) {
          let finalSpokenText = dashboardDictationAccumulatedTranscriptRef.current; 
          if (lowerTranscriptForEndCheck.endsWith(endCommand)) {
            const endCmdIdx = finalSpokenText.toLowerCase().lastIndexOf(endCommand);
            if (endCmdIdx !== -1) finalSpokenText = finalSpokenText.substring(0, endCmdIdx).trim();
          } else if (lowerTranscriptForEndCheck.endsWith(stopCommand)) {
            const stopCmdIdx = finalSpokenText.toLowerCase().lastIndexOf(stopCommand);
            if (stopCmdIdx !== -1) finalSpokenText = finalSpokenText.substring(0, stopCmdIdx).trim();
          }
          setInputText(finalSpokenText); 
          if (dashboardDictationRecognitionRef.current) try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
        } else {
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
        
        const finalDictatedText = dashboardDictationAccumulatedTranscriptRef.current.trim();
        setInputText(finalDictatedText); 
        if (finalDictatedText) {
          toast({ title: "Dictation Ended", description: "Click Brain icon to process.", duration: 3000 });
        }
        dashboardDictationAccumulatedTranscriptRef.current = ''; 
      };

      try {
        recognition.start();
      } catch (e) {
        console.error("Failed to start dashboard dictation:", e);
        setIsDashboardDictationActive(false);
        toast({ title: "Dictation Error", description: "Could not start dictation.", variant: "destructive" });
      }
    }, [toast, hasMicPermission, isCapturingAudioForSnippet, isCapturingAudioForLongRecording, isLoading, isDashboardDictationActive, isRecognizingSpeech, inputText]);


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
      if (isLoading && !isAlertDialogOpen) return "Processing...";
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
                                       isLoading ||
                                       isCapturingAudioForLongRecording ||
                                       isRecognizingSpeech; 


    const getDashboardDictationButtonIcon = () => {
        if (isDashboardDictationActive) return <Radio className="h-5 w-5 text-red-500 animate-pulse" />;
        if (hasMicPermission !== true || isBrowserUnsupported) return <MicOff className="h-5 w-5 text-muted-foreground" />
        return <Mic className="h-5 w-5 text-primary" />;
    };

    const recallCmdSuffix = WAKE_WORDS.HEGGLES_REPLAY_THAT.substring(WAKE_WORDS.HEGGLES_BASE.length);
    const addShopCmdSuffix = WAKE_WORDS.ADD_TO_SHOPPING_LIST_FULL_PREFIX_REGEX_PART;
    const addToDoCmdSuffix = WAKE_WORDS.ADD_TO_TODO_LIST_FULL_PREFIX_REGEX_PART;
    const setBufferCmdSuffix = WAKE_WORDS.HEGGLES_SET_BUFFER.substring(WAKE_WORDS.HEGGLES_BASE.length);
    const deleteItemSuffix = WAKE_WORDS.DELETE_ITEM_PREFIX;


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
              Say '<strong>Heggles</strong>' + command. Most commands populate text below for processing with the <Brain className="inline-block h-3.5 w-3.5 mx-0.5" /> icon.
              "Replay that" triggers live recording.
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
              {isListening && hasMicPermission === false && !isBrowserUnsupported && (
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
                disabled={isLoading || isCapturingAudioForSnippet || isCapturingAudioForLongRecording || isDashboardDictationActive || (isRecognizingSpeech && partialWakeWordDetected && !commandProcessedSuccessfullyRef.current) }
                className="resize-none"
                aria-label="Thought input area"
              />
              <div className="flex items-stretch gap-2">
                <Button
                  type="button"
                  onClick={handleProcessInputText}
                  disabled={isLoading || isCapturingAudioForSnippet || isCapturingAudioForLongRecording || !inputText.trim() || isDashboardDictationActive || (isRecognizingSpeech && partialWakeWordDetected && !commandProcessedSuccessfullyRef.current) }
                  size="icon"
                  aria-label="Process text from input area with AI"
                  title="Process text from input area with AI"
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
              <p className="text-xs text-muted-foreground pt-1">
                 The <q><strong>Heggles</strong>{recallCmdSuffix}</q> voice command (or clicking Brain icon if input has this text) triggers a {RECORDING_DURATION_MS / 1000}s live recording & transcription for AI processing.
                 Other '<strong>Heggles</strong>' commands (e.g., '<strong>Heggles</strong> {addShopCmdSuffix}[item]...', '<strong>Heggles</strong> {deleteItemSuffix} [item]...') populate the input area for submission with the <Brain className="inline-block h-3 w-3 mx-0.5" /> button.
                 The <Mic className="inline-block h-3 w-3 mx-0.5 text-red-500"/> icon button (dictate) transcribes speech directly into the text area. Click <Brain className="inline-block h-3 w-3 mx-0.5" /> to process.
                 The <PlayCircle className="inline-block h-3 w-3 mx-0.5 text-green-500" />/<StopCircle className="inline-block h-3 w-3 mx-0.5 text-red-500" /> button (header) is for continuous recording.
              </p>
            </div>
          </CardContent>
        </Card>

        {alertDialogConfig && (
          <AlertDialog
            open={isAlertDialogOpen}
            onOpenChange={(open) => {
              setIsAlertDialogOpen(open);
              if (!open && alertDialogConfig) { // Dialog is closing
                if (!confirmedDialogActionRef.current && alertDialogConfig.dataToRecallOnCancel) {
                  onThoughtRecalled({ id: crypto.randomUUID(), timestamp: Date.now(), ...alertDialogConfig.dataToRecallOnCancel });
                  toast({ title: "Suggestion Declined", description: "Original thought captured in Recent Thoughts." });
                }
                confirmedDialogActionRef.current = false; // Reset for next dialog
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
                <AlertDialogCancel
                  onClick={() => {
                    // onOpenChange will handle the logic on close
                    setIsAlertDialogOpen(false);
                  }}
                >Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    if (alertDialogConfig) {
                      alertDialogConfig.onConfirm();
                      confirmedDialogActionRef.current = true;
                    }
                    setIsAlertDialogOpen(false);
                  }}
                >Confirm</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </>
    );
  });

ThoughtInputForm.displayName = "ThoughtInputForm";


    