
"use client";

import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from 'react';
import { Brain, Loader2, Mic, MicOff, AlertTriangleIcon, Radio, StopCircle, PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogFooter
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { processTextThought, processRecordedAudio } from '@/lib/actions';
import type { Thought, ShoppingListItem, ToDoListItem, BufferTimeValue } from '@/lib/types';
import {
  WAKE_WORDS,
  LOCALSTORAGE_KEYS,
  BUFFER_TIME_OPTIONS,
  DEFAULT_BUFFER_TIME,
  RECORDING_DURATION_MS,
} from '@/lib/constants';

interface ThoughtInputFormProps {
  onThoughtRecalled: (thought: Thought) => void;
  isListening: boolean; // Main passive listening toggle from parent
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

  // Main command listener (Heggles wake word etc.)
  const [hasMicPermission, setHasMicPermission] = useState<boolean | null>(null);
  const [isRecognizingSpeech, setIsRecognizingSpeech] = useState(false); // For UI feedback of main listener
  const [isBrowserUnsupported, setIsBrowserUnsupported] = useState(false);
  const [partialWakeWordDetected, setPartialWakeWordDetected] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const utteranceTranscriptRef = useRef<string>('');
  const commandProcessedSuccessfullyRef = useRef<boolean>(false);

  // Dashboard manual dictation (for the text area via dedicated mic button)
  const [isDashboardDictationActive, setIsDashboardDictationActive] = useState(false);
  const dashboardDictationRecognitionRef = useRef<SpeechRecognition | null>(null);
  const dashboardDictationPauseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const dashboardDictationAccumulatedTranscriptRef = useRef<string>('');

  // Continuous "Long" Recording (triggered by page.tsx's button)
  const [isCapturingAudioForLongRecording, setIsCapturingAudioForLongRecording] = useState(false); // Renamed from isCapturingAudio
  const longRecordingMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const longRecordingSpeechRecognizerRef = useRef<SpeechRecognition | null>(null);
  const longRecordingTranscriptRef = useRef<string>('');
  const longRecordingAudioChunksRef = useRef<Blob[]>([]);

  // Snippet recording for "Heggles replay that"
  const [isCapturingAudioForSnippet, setIsCapturingAudioForSnippet] = useState(false);
  const snippetMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const snippetRecognitionRef = useRef<SpeechRecognition | null>(null);
  const snippetTranscriptRef = useRef<string>('');
  const snippetAudioChunksRef = useRef<Blob[]>([]);


  // AlertDialog state
  const [isAlertDialogOpen, setIsAlertDialogOpen] = useState(false);
  const [alertDialogConfig, setAlertDialogConfig] = useState<{
    title: string;
    description: React.ReactNode;
    itemText?: string;
    listKey?: string;
    listName?: string;
    onConfirm: () => void;
  } | null>(null);

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
    utteranceTranscriptRef.current = '';
    setPartialWakeWordDetected(false);
    commandProcessedSuccessfullyRef.current = true;
  }, [toast, parseSpokenBufferTime]);


  const startAudioRecordingForSnippet = useCallback(async () => {
    const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast({ title: "Browser Not Supported", description: "Audio recording or speech recognition not supported.", variant: "destructive" });
      return false;
    }
    if (hasMicPermission !== true) {
      toast({ title: "Microphone Access Denied", description: "Cannot record audio without microphone permission.", variant: "destructive" });
      return false;
    }
    if (isLoading || isCapturingAudioForSnippet || isDashboardDictationActive || isCapturingAudioForLongRecording) {
        toast({ title: "System Busy", description: "Another audio process is active.", variant: "default"});
        return false;
    }

    if (recognitionRef.current) {
      commandProcessedSuccessfullyRef.current = true;
      try { recognitionRef.current.stop(); } catch (e) { console.warn("Error stopping main rec before snippet:", e); }
    }
    setIsRecognizingSpeech(false);
    setPartialWakeWordDetected(false);
    utteranceTranscriptRef.current = '';

    setIsCapturingAudioForSnippet(true);
    snippetTranscriptRef.current = '';
    snippetAudioChunksRef.current = [];
    toast({ title: "Recording Audio & Speech...", description: `Capturing for ${RECORDING_DURATION_MS / 1000} seconds for 'Heggles replay that'.` });

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

        setIsLoading(true);
        try {
          const processedData = await processRecordedAudio(base64AudioData, liveTranscript);
          onThoughtRecalled({ id: crypto.randomUUID(), timestamp: Date.now(), ...processedData });
          toast({ title: "Recorded Snippet Processed", description: "AI analysis complete for 'Heggles replay that'." });
        } catch (error) {
          toast({ title: "Error Processing Snippet", description: (error as Error).message, variant: "destructive" });
        } finally {
          setIsLoading(false);
          setIsCapturingAudioForSnippet(false); 
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
        console.warn('Snippet transcription error:', event.error, event.message);
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
      if (snippetMediaRecorderRef.current && snippetMediaRecorderRef.current.state === "recording") {
        try { snippetMediaRecorderRef.current.stop(); } catch(e) {/* ignore */}
      }
      if (snippetRecognitionRef.current) {
        try { snippetRecognitionRef.current.stop(); } catch(e) {/* ignore */}
      }
      return false;
    }
  }, [hasMicPermission, isLoading, isCapturingAudioForSnippet, isDashboardDictationActive, isCapturingAudioForLongRecording, toast, onThoughtRecalled]);


  useImperativeHandle(ref, () => ({
    simulateWakeWordAndListen: () => {
      if (!isListening || hasMicPermission !== true || isLoading || isCapturingAudioForSnippet || isDashboardDictationActive || isCapturingAudioForLongRecording) {
        toast({ title: "Cannot Simulate Wake Word", description: "System busy, passive listening off, or microphone permission missing.", variant: "default"});
        return;
      }
      utteranceTranscriptRef.current = WAKE_WORDS.HEGGLES_BASE.toLowerCase() + " ";
      setInputText(utteranceTranscriptRef.current);
      setPartialWakeWordDetected(true);
      commandProcessedSuccessfullyRef.current = false; 

      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch(e) { /* onend will handle restart if necessary */ }
      } else {
        // If no recognizer, useEffect should pick it up if conditions are met.
        // This direct call is a failsafe if the effect doesn't re-trigger immediately.
        // This part may need to be removed if it causes double start.
        // The main useEffect should handle starting a new instance if recognitionRef.current is null.
      }
      toast({ title: "Heggles Activated", description: "Listening for your command..." });
    },
    startLongRecording: () => {
      if (!isListening || hasMicPermission !== true || isLoading || isDashboardDictationActive || isCapturingAudioForSnippet || isCapturingAudioForLongRecording) {
        toast({ title: "Cannot Start Continuous Recording", description: "System is busy, passive listening is off, or microphone permission is missing.", variant: "destructive"});
        return false;
      }
      if (recognitionRef.current) { commandProcessedSuccessfullyRef.current = true; try { recognitionRef.current.stop(); } catch(e) {/*ignore*/} }
      if (dashboardDictationRecognitionRef.current) { try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/} }
      setIsRecognizingSpeech(false);
      setPartialWakeWordDetected(false);
      setIsDashboardDictationActive(false);

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
          setInputText("Continuous recording active. Speech will populate here when stopped. Click Brain icon to process.");

          longRecordingSpeechRecognizerRef.current = new SpeechRecognitionAPI();
          const recognizer = longRecordingSpeechRecognizerRef.current;
          recognizer.continuous = true;
          recognizer.interimResults = true;
          recognizer.lang = 'en-US';
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
            setInputText(longRecordingTranscriptRef.current + (interimTranscript ? (longRecordingTranscriptRef.current ? " " : "") + interimTranscript : ""));
          };
          recognizer.onerror = (event: SpeechRecognitionErrorEvent) => {
            console.error("Continuous recording speech recognition error:", event.error, event.message);
            toast({ title: "Continuous Recording Transcription Error", description: event.message, variant: "destructive" });
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
            longRecordingAudioChunksRef.current = [];
            setInputText(longRecordingTranscriptRef.current.trim());
            longRecordingTranscriptRef.current = '';
            setIsCapturingAudioForLongRecording(false);
            onStopLongRecordingParent();
          };
          longRecordingMediaRecorderRef.current.start();
          return true;

        } catch (err) {
          console.error("Error starting continuous recording:", err);
          toast({ title: "Continuous Recording Error", description: `Could not start recording: ${(err as Error).message}`, variant: "destructive" });
          setIsCapturingAudioForLongRecording(false);
          setInputText("");
          if (longRecordingSpeechRecognizerRef.current) { try { longRecordingSpeechRecognizerRef.current.stop(); } catch(e) {/* ignore */}}
          if (longRecordingMediaRecorderRef.current && longRecordingMediaRecorderRef.current.state === "recording") {
             try { longRecordingMediaRecorderRef.current.stop(); } catch(e) {/* ignore */}
          }
          onStopLongRecordingParent();
          return false;
        }
      };
      startRecordingFlow();
      return true;
    },
    stopLongRecordingAndProcess: () => {
      if (!isCapturingAudioForLongRecording) return;

      if (longRecordingSpeechRecognizerRef.current) {
        try { longRecordingSpeechRecognizerRef.current.stop(); } catch(e) { /* ignore */ }
      }
      if (longRecordingMediaRecorderRef.current && longRecordingMediaRecorderRef.current.state === "recording") {
        try { longRecordingMediaRecorderRef.current.stop(); } catch(e) { /* ignore */ }
      } else {
        setInputText(longRecordingTranscriptRef.current.trim());
        setIsCapturingAudioForLongRecording(false);
        onStopLongRecordingParent();
      }
    },
  }));

   useEffect(() => {
    if (isExternallyLongRecording !== isCapturingAudioForLongRecording) {
        if (isExternallyLongRecording) {
             if (ref && 'current' in ref && ref.current) {
                ref.current.startLongRecording();
            }
        } else {
            if (ref && 'current' in ref && ref.current) {
              ref.current.stopLongRecordingAndProcess();
            }
        }
    }
  }, [isExternallyLongRecording, isCapturingAudioForLongRecording, ref]);


  useEffect(() => {
    if (!isListening) {
      if (isCapturingAudioForLongRecording && ref && 'current' in ref && ref.current) {
        ref.current.stopLongRecordingAndProcess();
        toast({ title: "Recording Stopped", description: "Passive listening was disabled." });
      }
      if (isDashboardDictationActive && dashboardDictationRecognitionRef.current) {
         try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/* ignore */}
         toast({ title: "Dictation Stopped", description: "Passive listening was disabled." });
      }
    }
  }, [isListening, isCapturingAudioForLongRecording, isDashboardDictationActive, ref, toast]);


  const addListItem = (listKey: string, itemTextToAdd: string, listName: string) => {
    const item = itemTextToAdd.trim();
    if (!item) {
      toast({ title: "No item specified", description: `Please specify the item to add to ${listName}.`, variant: "default" });
      setIsAlertDialogOpen(false);
      setIsLoading(false);
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
    } finally {
      setIsAlertDialogOpen(false);
      setIsLoading(false);
      setInputText('');
    }
  };

  const deleteListItem = (listKey: string, identifier: string | number, listName: string) => {
    try {
      const currentItemsString = localStorage.getItem(listKey);
      if (!currentItemsString) {
        toast({ title: "List not found", description: `The ${listName} is empty.`, variant: "default" });
        setIsLoading(false);
        setInputText('');
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
        const initialLength = currentItems.length;
        const itemFound = currentItems.find(item => item.text.toLowerCase() === lowerIdentifier);
        if (itemFound) deletedItemText = itemFound.text;

        currentItems = currentItems.filter(item => item.text.toLowerCase() !== lowerIdentifier);
        if (currentItems.length < initialLength) {
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
    } finally {
        setIsLoading(false);
        setInputText('');
    }
  };


  const handleProcessInputText = async () => {
    const textToProcess = inputText.trim();
    if (!textToProcess) {
      toast({ title: "Input empty", description: "Cannot process an empty thought.", variant: "destructive" });
      return;
    }
    setIsLoading(true);
    const lowerText = textToProcess.toLowerCase();

    const hegglesBaseLower = WAKE_WORDS.HEGGLES_BASE.toLowerCase();
    const shoppingListPattern = new RegExp(`^${hegglesBaseLower}\\s+add\\s+(.+?)\\s+to\\s+(?:my\\s+|the\\s+)?shopping\\s+list$`);
    const shoppingListMatch = lowerText.match(shoppingListPattern);

    const todoListPattern = new RegExp(`^${hegglesBaseLower}\\s+add\\s+(.+?)\\s+to\\s+(?:my\\s+|the\\s+)?to\\s+do\\s+list$`);
    const todoListMatch = lowerText.match(todoListPattern);
    
    const deleteListPattern = new RegExp(`^${hegglesBaseLower}\\s+delete\\s+(.*?)(?:\\s+${WAKE_WORDS.FROM_SHOPPING_LIST_TRIGGER.toLowerCase()}|\\s+${WAKE_WORDS.FROM_TODO_LIST_TRIGGER.toLowerCase()})$`);
    const deleteListMatchResult = lowerText.match(deleteListPattern);


    if (shoppingListMatch && shoppingListMatch[1]) {
      const item = shoppingListMatch[1].trim();
      setAlertDialogConfig({
        title: "Add to Shopping List?",
        description: <>Do you want to add <strong>"{item}"</strong> to your shopping list?</>,
        itemText: item,
        listKey: LOCALSTORAGE_KEYS.SHOPPING_LIST,
        listName: "Shopping List",
        onConfirm: () => addListItem(LOCALSTORAGE_KEYS.SHOPPING_LIST, item, "Shopping List"),
      });
      setIsAlertDialogOpen(true);
    } else if (todoListMatch && todoListMatch[1]) {
      const task = todoListMatch[1].trim();
       setAlertDialogConfig({
        title: "Add to To-Do List?",
        description: <>Do you want to add <strong>"{task}"</strong> to your to-do list?</>,
        itemText: task,
        listKey: LOCALSTORAGE_KEYS.TODO_LIST,
        listName: "To-Do List",
        onConfirm: () => addListItem(LOCALSTORAGE_KEYS.TODO_LIST, task, "To-Do List"),
      });
      setIsAlertDialogOpen(true);
    } else if (deleteListMatchResult && deleteListMatchResult[1]) {
        const itemIdentifierStr = deleteListMatchResult[1].trim();
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
                    setIsLoading(false); setInputText('');
                }
            } else {
                deleteListItem(listKey, itemIdentifierStr, listName);
            }
        } else {
            toast({ title: "Deletion Command Incomplete", description: "Specify item and list (e.g., 'delete apples from shopping list').", variant: "default" });
            setIsLoading(false); setInputText('');
        }
    } else if (lowerText === WAKE_WORDS.HEGGLES_REPLAY_THAT.toLowerCase()) {
      // This branch should ideally not be hit if "Heggles replay that" is handled directly by voice.
      // If it does make it here (e.g. typed manually), it would be an error in flow.
      // For safety, treat as general thought, or could show a more specific error.
      // For now, let's let it fall through to general processing, which is likely not desired.
      // The user wants the 10s recording.
      // Let's assume the voice command handles it, and this manual typing is unlikely / not primary path.
      // If we reach here, it implies startAudioRecordingForSnippet wasn't called.
      // We can make this an explicit call to the snippet recording if typed:
      startAudioRecordingForSnippet(); // This will show toast, set loading, etc.
      setInputText(''); // Clear "heggles replay that" from input text
      setIsLoading(false); // startAudioRecordingForSnippet manages its own loading state.
    }
    else {
      try {
        const processedData = await processTextThought(textToProcess);
        let thoughtHandledByIntentOrAction = false;

        if (processedData.intentAnalysis?.isQuestion && processedData.intentAnalysis.extractedQuestion && processedData.aiAnswer) {
            onThoughtRecalled({ id: crypto.randomUUID(), timestamp: Date.now(), ...processedData });
            toast({ title: "Thought Processed & Question Answered", description: "AI has provided an answer." });
            thoughtHandledByIntentOrAction = true;
        } else if (processedData.intentAnalysis?.isAction && processedData.intentAnalysis.extractedAction && processedData.intentAnalysis.suggestedList && processedData.intentAnalysis.suggestedList !== 'none') {
            const action = processedData.intentAnalysis.extractedAction;
            const listKey = processedData.intentAnalysis.suggestedList === 'shopping' ? LOCALSTORAGE_KEYS.SHOPPING_LIST : LOCALSTORAGE_KEYS.TODO_LIST;
            const listName = processedData.intentAnalysis.suggestedList === 'shopping' ? "Shopping List" : "To-Do List";
             setAlertDialogConfig({
                title: `AI Suggestion: Action for ${listName}`,
                description: <>The AI suggests adding "<strong>{action}</strong>" to your {listName}. Add it?</>,
                itemText: action,
                listKey: listKey,
                listName: listName,
                onConfirm: () => addListItem(listKey, action, listName),
            });
            setIsAlertDialogOpen(true);
            thoughtHandledByIntentOrAction = true;
        } else if (processedData.actionItems && processedData.actionItems.length > 0 && !thoughtHandledByIntentOrAction) {
          for (const action of processedData.actionItems) {
            const lowerAction = action.toLowerCase();
            let itemToAdd: string | null = null;
            let targetListKey: string | null = null;
            let targetListName: string | null = null;

            const shoppingPattern = new RegExp(`add\\s+(?:['"]?)(.+?)(?:['"]?)\\s+to\\s+(?:my\\s+|the\\s+)?shopping\\s+list`);
            const todoPattern = new RegExp(`add\\s+(?:['"]?)(.+?)(?:['"]?)\\s+to\\s+(?:my\\s+|the\\s+)?(?:to\\s*do|todo)\\s+list`);

            const shoppingMatch = lowerAction.match(shoppingPattern);
            if (shoppingMatch && shoppingMatch[1]) {
              itemToAdd = shoppingMatch[1].trim();
              targetListKey = LOCALSTORAGE_KEYS.SHOPPING_LIST;
              targetListName = "Shopping List";
            } else {
              const todoMatch = lowerAction.match(todoPattern);
              if (todoMatch && todoMatch[1]) {
                itemToAdd = todoMatch[1].trim();
                targetListKey = LOCALSTORAGE_KEYS.TODO_LIST;
                targetListName = "To-Do List";
              }
            }
            if (itemToAdd && targetListKey && targetListName) {
              setAlertDialogConfig({
                title: `AI Suggestion: Add to ${targetListName}?`,
                description: <>The AI suggests adding <strong>"{itemToAdd}"</strong> to your {targetListName}. Add it?</>,
                itemText: itemToAdd,
                listKey: targetListKey,
                listName: targetListName,
                onConfirm: () => addListItem(targetListKey!, itemToAdd!, targetListName!),
              });
              setIsAlertDialogOpen(true);
              thoughtHandledByIntentOrAction = true;
              break; 
            }
          }
        }

        if (!thoughtHandledByIntentOrAction) {
          onThoughtRecalled({ id: crypto.randomUUID(), timestamp: Date.now(), ...processedData });
          toast({ title: "Thought Processed", description: "AI analysis complete." });
        }
        
        if (!isAlertDialogOpen) {
            setInputText('');
        }
      } catch (error) {
        toast({ title: "Error Processing Thought", description: (error as Error).message, variant: "destructive" });
      } finally {
        if (!isAlertDialogOpen) setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      setIsBrowserUnsupported(true);
      setHasMicPermission(false);
      return;
    }
    setIsBrowserUnsupported(false);

    const shouldBeListening = isListening &&
                              hasMicPermission === true &&
                              !isLoading &&
                              !isCapturingAudioForSnippet &&
                              !isDashboardDictationActive &&
                              !isCapturingAudioForLongRecording;

    if (shouldBeListening && recognitionRef.current === null) {
      recognitionRef.current = new SpeechRecognitionAPI();
      const recognition = recognitionRef.current;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsRecognizingSpeech(true);
        commandProcessedSuccessfullyRef.current = false;
      };

      recognition.onend = () => {
        setIsRecognizingSpeech(false);
        if (!commandProcessedSuccessfullyRef.current && partialWakeWordDetected) {
          // Preserve utterance if ended due to pause after "Heggles"
        } else {
          setPartialWakeWordDetected(false);
          utteranceTranscriptRef.current = '';
        }
        recognitionRef.current = null;
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (event.error === 'no-speech' || event.error === 'aborted') {
           // console.warn('Main command recognition: no-speech or aborted'); // Removed to clean console
        } else {
           console.error('Main command recognition error:', event.error, event.message);
        }
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            setHasMicPermission(false);
            toast({ title: "Microphone Access Issue", variant: "destructive", description: "Speech recognition service denied. Check browser settings or permissions." });
        } else if (event.error === 'network') {
            toast({ title: "Network Error", variant: "destructive", description: "A network error occurred with the speech recognition service."});
        }
        commandProcessedSuccessfullyRef.current = true;
        setPartialWakeWordDetected(false); 
        utteranceTranscriptRef.current = '';
        // recognitionRef.current = null; // onend will handle this
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let newlyFinalizedSegmentThisTurn = "";
        let currentInterimSegment = "";
        commandProcessedSuccessfullyRef.current = false; // Reset for this result

        for (let i = event.resultIndex; i < event.results.length; ++i) {
            const segment = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                newlyFinalizedSegmentThisTurn += (newlyFinalizedSegmentThisTurn ? " " : "") + segment.trim();
            } else {
                currentInterimSegment += segment;
            }
        }
        
        const hegglesBaseLower = WAKE_WORDS.HEGGLES_BASE.toLowerCase();

        if (newlyFinalizedSegmentThisTurn) {
            if (partialWakeWordDetected) { // If already detected Heggles, append new speech
                utteranceTranscriptRef.current = (utteranceTranscriptRef.current + " " + newlyFinalizedSegmentThisTurn).trim();
            } else if (newlyFinalizedSegmentThisTurn.toLowerCase().startsWith(hegglesBaseLower)) {
                // If Heggles is detected in this new final segment
                utteranceTranscriptRef.current = newlyFinalizedSegmentThisTurn.trim();
                setPartialWakeWordDetected(true);
            } else {
                // Finalized speech, but no Heggles detected yet - ignore for main command processing
                // This speech segment isn't part of a Heggles command
            }
        }
        
        const fullUtteranceForDisplay = partialWakeWordDetected ? 
            (utteranceTranscriptRef.current ? utteranceTranscriptRef.current + " " : "") + currentInterimSegment.trim()
            : currentInterimSegment.trim();


        if (!partialWakeWordDetected && currentInterimSegment.toLowerCase().includes(hegglesBaseLower)) {
            setPartialWakeWordDetected(true);
            // Start utteranceTranscriptRef with the interim segment if it contains Heggles
            // to ensure Heggles is captured even if the first final segment doesn't include it.
            if (!utteranceTranscriptRef.current.toLowerCase().startsWith(hegglesBaseLower)) {
                 utteranceTranscriptRef.current = currentInterimSegment.trim();
            }
        }
        
        if (partialWakeWordDetected) {
            setInputText(fullUtteranceForDisplay);
        }

        const lastResultIsFinal = event.results[event.results.length - 1].isFinal;

        if (lastResultIsFinal && utteranceTranscriptRef.current) {
            const finalUtterance = utteranceTranscriptRef.current.trim();
            const finalLower = finalUtterance.toLowerCase();

            if (!finalLower.startsWith(hegglesBaseLower)) {
                commandProcessedSuccessfullyRef.current = true; 
                // If it doesn't start with Heggles, this speech session is over for command processing
                if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch (e) { /*ignore*/ } }
                return;
            }
            
            // At this point, it starts with Heggles
            if (finalLower === WAKE_WORDS.HEGGLES_REPLAY_THAT.toLowerCase()) {
                setInputText(''); // Clear before starting recording
                utteranceTranscriptRef.current = '';
                setPartialWakeWordDetected(false);
                commandProcessedSuccessfullyRef.current = true;
                startAudioRecordingForSnippet();
            } else if (finalLower === WAKE_WORDS.HEGGLES_TURN_OFF.toLowerCase()) {
                commandProcessedSuccessfullyRef.current = true;
                onToggleListeningParent(false);
                setInputText('');
            } else if (finalLower === WAKE_WORDS.HEGGLES_TURN_ON.toLowerCase()) {
                commandProcessedSuccessfullyRef.current = true;
                onToggleListeningParent(true);
                setInputText('');
            } else if (finalLower.startsWith(WAKE_WORDS.HEGGLES_SET_BUFFER.toLowerCase())) {
                const spokenDuration = finalUtterance.substring(WAKE_WORDS.HEGGLES_SET_BUFFER.length).trim();
                // setBufferTimeByVoice already sets commandProcessedSuccessfullyRef = true and clears input
                setBufferTimeByVoice(spokenDuration); 
            } else if (finalLower === hegglesBaseLower) {
                // Just "Heggles" was said. Keep listening.
                commandProcessedSuccessfullyRef.current = false; // NOT processed yet
                setInputText(finalUtterance + " "); // Show "Heggles "
            } else {
                // It started with "Heggles" but wasn't a direct action or "replay that".
                // Text is already in inputText from partialWakeWordDetected logic.
                // User will click Brain icon. This utterance session is over.
                toast({ title: "Command Ready for Processing", description: "Click the Brain icon to process your Heggles command." });
                commandProcessedSuccessfullyRef.current = true;
            }

            if (recognitionRef.current && commandProcessedSuccessfullyRef.current) {
                try { recognitionRef.current.stop(); } catch (e) { console.warn("Error stopping main cmd rec after final result:", e); }
            }
        }
      };
      
      try {
        if (recognitionRef.current && typeof recognitionRef.current.start === 'function') {
            commandProcessedSuccessfullyRef.current = false; // Reset before starting
            recognitionRef.current.start();
        }
      } catch (e) {
        console.error("Failed to start main command speech recognition:", e);
        if (recognitionRef.current === recognition) { 
          recognitionRef.current = null;
        }
      }
    } else if (!shouldBeListening && recognitionRef.current) {
      commandProcessedSuccessfullyRef.current = true; 
      try {
        recognitionRef.current.stop();
      } catch (e) {
        console.warn("Error stopping main command recognition (in useEffect else):", e);
      }
    }
    
    return () => {
      if (recognitionRef.current) {
        commandProcessedSuccessfullyRef.current = true;
        try { recognitionRef.current.stop(); } catch (e) { /* ignore */ }
        recognitionRef.current = null;
      }
      if (dashboardDictationRecognitionRef.current) {
        try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
        dashboardDictationRecognitionRef.current = null;
      }
      if (dashboardDictationPauseTimeoutRef.current) {
        clearTimeout(dashboardDictationPauseTimeoutRef.current);
      }
      if (snippetRecognitionRef.current) {
        try { snippetRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
        snippetRecognitionRef.current = null;
      }
      if (snippetMediaRecorderRef.current && snippetMediaRecorderRef.current.state === "recording") {
        try { snippetMediaRecorderRef.current.stop(); } catch(e) {/*ignore*/}
        snippetMediaRecorderRef.current = null;
      }
      if (longRecordingSpeechRecognizerRef.current) {
        try { longRecordingSpeechRecognizerRef.current.stop(); } catch(e) {/*ignore*/}
        longRecordingSpeechRecognizerRef.current = null;
      }
      if (longRecordingMediaRecorderRef.current && longRecordingMediaRecorderRef.current.state === "recording") {
        try { longRecordingMediaRecorderRef.current.stop(); } catch(e) {/*ignore*/}
        longRecordingMediaRecorderRef.current = null;
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
    startAudioRecordingForSnippet, 
    isExternallyLongRecording, // Added as it affects shouldBeListening implicitly
    toast // To prevent ESLint warning, though its direct effect on recognition lifecycle is minimal
  ]);


  useEffect(() => {
    const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      setIsBrowserUnsupported(true);
      setHasMicPermission(false);
      return;
    }
    if (hasMicPermission === null) {
        navigator.mediaDevices.getUserMedia({ audio: true })
        .then((stream) => {
          stream.getTracks().forEach(track => track.stop());
          setHasMicPermission(true);
        })
        .catch(err => {
          console.warn("Microphone permission request error:", err.name, err.message);
          setHasMicPermission(false);
          if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            toast({ title: "Microphone Access Denied", variant: "destructive", description:"Heggles needs microphone access for voice commands." });
          }
        });
    }
  }, [hasMicPermission, toast]);


  const handleDashboardMicClick = async () => {
    const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      toast({ title: "Browser Not Supported", variant: "destructive", description: "Speech recognition for dictation not available."});
      return;
    }
    if (isCapturingAudioForSnippet || isCapturingAudioForLongRecording) {
      toast({ title: "Action unavailable", description: "Recording/Processing is already in progress.", variant: "default"});
      return;
    }
    if (hasMicPermission === false) {
      toast({ title: "Microphone Access Denied", variant: "destructive"});
      return;
    }
     if (hasMicPermission === null) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t=>t.stop());
        setHasMicPermission(true);
      } catch (err) {
        setHasMicPermission(false);
        toast({ title: "Microphone Access Denied", variant: "destructive"});
        return;
      }
    }

    if (isDashboardDictationActive) {
      if (dashboardDictationRecognitionRef.current) {
        try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
      }
      if (dashboardDictationPauseTimeoutRef.current) clearTimeout(dashboardDictationPauseTimeoutRef.current);
      return;
    }

    if (recognitionRef.current) { 
      commandProcessedSuccessfullyRef.current = true; 
      try { recognitionRef.current.stop(); } catch(e) { /* ignore */ }
    }
    setIsRecognizingSpeech(false); 
    setPartialWakeWordDetected(false);

    setIsDashboardDictationActive(true);
    dashboardDictationAccumulatedTranscriptRef.current = inputText;
    setInputText("Dictating your thought..."); // Initial feedback

    dashboardDictationRecognitionRef.current = new SpeechRecognitionAPI();
    const recognition = dashboardDictationRecognitionRef.current;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {};
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      if (dashboardDictationPauseTimeoutRef.current) clearTimeout(dashboardDictationPauseTimeoutRef.current);

      let interim = "";
      let currentFinalizedDictationSegment = "";

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const segment = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
           currentFinalizedDictationSegment += (currentFinalizedDictationSegment ? " " : "") + segment.trim();
        } else {
          interim += segment;
        }
      }
      if (currentFinalizedDictationSegment) {
        dashboardDictationAccumulatedTranscriptRef.current = (dashboardDictationAccumulatedTranscriptRef.current + (dashboardDictationAccumulatedTranscriptRef.current ? " " : "") + currentFinalizedDictationSegment).trim();
      }
      
      const textToShowInInput = dashboardDictationAccumulatedTranscriptRef.current + (interim ? (dashboardDictationAccumulatedTranscriptRef.current ? " " : "") + interim.trim() : "");
      setInputText(textToShowInInput);

      const lowerTranscriptForEndCheck = textToShowInInput.trim().toLowerCase();
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
        dashboardDictationAccumulatedTranscriptRef.current = finalSpokenText;
        if (dashboardDictationRecognitionRef.current) try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
      } else {
        dashboardDictationPauseTimeoutRef.current = setTimeout(() => {
          if (dashboardDictationRecognitionRef.current) try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
        }, 2000);
      }
    };
    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error('Dashboard dictation error:', event.error, event.message);
      if (dashboardDictationPauseTimeoutRef.current) clearTimeout(dashboardDictationPauseTimeoutRef.current);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') setHasMicPermission(false);
      else if (event.error === 'no-speech' && !dashboardDictationAccumulatedTranscriptRef.current.trim()) {}
      else if (event.error === 'no-speech') {
        toast({ title: "No speech detected for dictation", variant: "default" });
      } else {
         toast({ title: "Dictation Error", description: event.message || "Could not recognize speech.", variant: "destructive" });
      }
      setIsDashboardDictationActive(false);
      setInputText(dashboardDictationAccumulatedTranscriptRef.current.trim());
    };
    recognition.onend = () => {
      if (dashboardDictationPauseTimeoutRef.current) clearTimeout(dashboardDictationPauseTimeoutRef.current);
      setIsDashboardDictationActive(false);
      dashboardDictationRecognitionRef.current = null;
      
      const finalDictatedText = dashboardDictationAccumulatedTranscriptRef.current.trim();
      setInputText(finalDictatedText);
      if (finalDictatedText) {
        toast({title: "Dictation Ended", description: "Review text and click Brain icon to process."});
      }
    };
    try {
       recognition.start();
    } catch(e) {
        console.error("Failed to start dashboard dictation:", e);
        setIsDashboardDictationActive(false);
        toast({title: "Dictation Error", description: "Could not start dictation.", variant: "destructive"});
    }
  };


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
    if (isCapturingAudioForSnippet) return "Recording 10s audio & speech...";
    if (isDashboardDictationActive) return "Dictating to input area...";
    if (isLoading && !isAlertDialogOpen) return "Processing...";
    if (!isListening) return "Voice Inactive (Passive Listening Off)";
    if (isBrowserUnsupported) return "Voice N/A (Browser Not Supported)";
    if (hasMicPermission === false) return "Mic Denied";
    if (hasMicPermission === null) return "Mic Awaiting Permission...";
    if (partialWakeWordDetected) return <>'<strong>Heggles</strong>' detected, awaiting command...</>;
    if (isRecognizingSpeech) return <>Say '<strong>Heggles</strong>' + command</>;
    if (isListening && hasMicPermission && !isBrowserUnsupported) return <>Listener active for '<strong>Heggles</strong>'</>;
    return "Voice status checking...";
  };

  const getTextareaPlaceholder = (): string => {
    if (isCapturingAudioForLongRecording) return "Continuous recording active. Speech will populate here when stopped. Click Brain icon to process.";
    if (isCapturingAudioForSnippet) return "Recording 10s audio & speech for 'Heggles replay that'. Processed automatically.";
    if (isDashboardDictationActive) return "Dictating your thought... Say 'Heggles end' or 'Heggles stop' to finish. Text will populate here for Brain processing.";
    if (isLoading && !isAlertDialogOpen) return "Processing...";
    if (!isListening) return "Enable passive listening to use voice or type input here.";
    if (partialWakeWordDetected) return "'Heggles' detected. Finish your command. Text will appear here. Click Brain icon to process.";
    if (isRecognizingSpeech) return "Listener active. Say 'Heggles' followed by your command. Text will appear here for Brain processing.";
    return "Type thought or say 'Heggles' + command. Click Brain icon to process.";
  };
  
  const dashboardMicButtonDisabled = !isListening || hasMicPermission !== true || isRecognizingSpeech || isCapturingAudioForSnippet || isLoading || isCapturingAudioForLongRecording;

  const getDashboardDictationButtonIcon = () => {
    if (isDashboardDictationActive) return <Radio className="h-5 w-5 text-red-500 animate-pulse" />;
    if (dashboardMicButtonDisabled) return <MicOff className="h-5 w-5 text-muted-foreground" />;
    return <Mic className="h-5 w-5 text-primary" />;
  };
  

  return (
    <>
      <Card className="w-full shadow-lg">
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="text-xl">Input & Recall</CardTitle>
            {isListening && hasMicPermission !== null && !isBrowserUnsupported && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground" title={typeof getMicStatusText() === 'string' ? getMicStatusText() as string : undefined}>
                {getMicIconForCardHeader()}
                <span>{getMicStatusText()}</span>
              </div>
            )}
          </div>
          <CardDescription>
            Use voice commands starting with '<strong>Heggles</strong>' or type directly. Then click the <Brain className="inline-block h-3.5 w-3.5 mx-0.5"/> icon to process.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isBrowserUnsupported && (
            <Alert variant="destructive" className="mb-4">
              <AlertTriangleIcon className="h-4 w-4" />
              <AlertTitle>Browser Not Supported</AlertTitle>
              <AlertDescription>Speech recognition not supported. Manual input available.</AlertDescription>
            </Alert>
          )}
          {isListening && hasMicPermission === false && !isBrowserUnsupported && (
            <Alert variant="destructive" className="mb-4">
              <AlertTriangleIcon className="h-4 w-4" />
              <AlertTitle>Microphone Access Denied</AlertTitle>
              <AlertDescription>Voice commands require microphone access. Manual input available.</AlertDescription>
            </Alert>
          )}

          <div className="space-y-4">
            <Textarea
              placeholder={getTextareaPlaceholder()}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              rows={4}
              disabled={isLoading || isCapturingAudioForSnippet || isCapturingAudioForLongRecording || isDashboardDictationActive}
              className="resize-none"
              aria-label="Thought input area"
            />
            <div className="flex items-stretch gap-2">
               <Button
                type="button"
                onClick={handleProcessInputText}
                disabled={isLoading || isCapturingAudioForSnippet || isCapturingAudioForLongRecording || !inputText.trim() || isDashboardDictationActive}
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
                aria-label="Dictate thought into text area"
                title={isDashboardDictationActive ? "Stop dictation (or say 'Heggles end/stop')" : "Dictate directly into input area (ends on pause or 'Heggles end/stop')"}
              >
                {getDashboardDictationButtonIcon()}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground pt-1">
                Say '<strong>Heggles replay that</strong>' to record &amp; transcribe a 10s audio snippet for AI processing.
                Other '<strong>Heggles</strong>' commands (e.g., 'add to list') populate this area for processing with the <Brain className="inline-block h-3 w-3 mx-0.5"/> button.
                The <Mic className="inline-block h-3 w-3 mx-0.5"/> icon button (dictate) transcribes speech directly into this area.
                The <PlayCircle className="inline-block h-3 w-3 mx-0.5 text-green-500"/> / <StopCircle className="inline-block h-3 w-3 mx-0.5 text-red-500"/> button (header) is for continuous recording that populates this area when stopped.
            </p>
          </div>
        </CardContent>
      </Card>

      {alertDialogConfig && (
        <AlertDialog open={isAlertDialogOpen} onOpenChange={(open) => {
            setIsAlertDialogOpen(open);
            if (!open) {
                setIsLoading(false);
                // Do not clear inputText on cancel so user can edit if they wish.
                // InputText will be cleared on successful confirm by addListItem or after general processing.
            }
        }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{alertDialogConfig.title}</AlertDialogTitle>
              <AlertDialogDescription>
                {alertDialogConfig.description}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => { setIsLoading(false); /* setInputText(''); // Don't clear here */ }}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => {
                alertDialogConfig.onConfirm();
              }}>Confirm</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
});

ThoughtInputForm.displayName = "ThoughtInputForm";

