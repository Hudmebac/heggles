
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
  const [partialWakeWordDetected, setPartialWakeWordDetected] = useState(false); // True if "Heggles" detected in current utterance
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const utteranceTranscriptRef = useRef<string>(''); // Accumulates full utterance for main listener
  const commandProcessedSuccessfullyRef = useRef<boolean>(false); // Helps onend decide to clear utterance

  // Dashboard manual dictation (for the text area via dedicated mic button)
  const [isDashboardDictationActive, setIsDashboardDictationActive] = useState(false);
  const dashboardDictationRecognitionRef = useRef<SpeechRecognition | null>(null);
  const dashboardDictationPauseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const dashboardDictationAccumulatedTranscriptRef = useRef<string>(''); // For text from dashboard dictation mic

  // Continuous "Long" Recording (triggered by page.tsx's button) & "Heggles replay that" snippet
  const [isCapturingAudio, setIsCapturingAudio] = useState(false); // True if MediaRecorder is active
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const snippetRecognitionRef = useRef<SpeechRecognition | null>(null); // For transcribing the 10s snippet
  const snippetTranscriptRef = useRef<string>(''); // Transcript from the 10s snippet
  const audioChunksRef = useRef<Blob[]>([]);

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
    setInputText(''); // Clear the command from input text
    utteranceTranscriptRef.current = '';
    setPartialWakeWordDetected(false);
    commandProcessedSuccessfullyRef.current = true;
  }, [toast, parseSpokenBufferTime]);

  const startAudioRecording = useCallback(async () => {
    const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast({ title: "Browser Not Supported", description: "Audio recording or speech recognition not supported.", variant: "destructive" });
      return false;
    }
    if (hasMicPermission !== true) {
      toast({ title: "Microphone Access Denied", description: "Cannot record audio without microphone permission.", variant: "destructive" });
      return false;
    }
    if (isLoading || isCapturingAudio || isDashboardDictationActive || isExternallyLongRecording) {
        toast({ title: "System Busy", description: "Another audio process is active.", variant: "default"});
        return false;
    }

    // Stop main command listener
    if (recognitionRef.current) {
      commandProcessedSuccessfullyRef.current = true; // Ensure it cleans up
      try { recognitionRef.current.stop(); } catch (e) { console.warn("Error stopping main rec before snippet:", e); }
    }
    setIsRecognizingSpeech(false);
    setPartialWakeWordDetected(false);
    // utteranceTranscriptRef.current = ''; // Not strictly needed if commandProcessedSuccessfullyRef is true

    setIsCapturingAudio(true);
    snippetTranscriptRef.current = '';
    audioChunksRef.current = [];
    toast({ title: "Recording Audio & Speech...", description: `Capturing for ${RECORDING_DURATION_MS / 1000} seconds.` });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Initialize MediaRecorder for audio blob
      mediaRecorderRef.current = new MediaRecorder(stream);
      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      mediaRecorderRef.current.onstop = async () => {
        stream.getTracks().forEach(track => track.stop()); // Stop all tracks from this stream
        
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' }); // Or appropriate MIME type
        audioChunksRef.current = [];
        
        const base64AudioData = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.readAsDataURL(audioBlob);
          reader.onloadend = () => resolve(reader.result as string);
        });

        const liveTranscript = snippetTranscriptRef.current.trim();
        snippetTranscriptRef.current = ''; // Reset for next use

        setIsLoading(true);
        try {
          const processedData = await processRecordedAudio(base64AudioData, liveTranscript);
          onThoughtRecalled({ id: crypto.randomUUID(), timestamp: Date.now(), ...processedData });
          toast({ title: "Recorded Snippet Processed", description: "AI analysis complete." });
        } catch (error) {
          toast({ title: "Error Processing Recording", description: (error as Error).message, variant: "destructive" });
        } finally {
          setIsLoading(false);
          setIsCapturingAudio(false); 
        }
      };
      mediaRecorderRef.current.start();

      // Initialize SpeechRecognition for live transcription of the snippet
      snippetRecognitionRef.current = new SpeechRecognitionAPI();
      const snippetRecognizer = snippetRecognitionRef.current;
      snippetRecognizer.continuous = true; // Listen throughout the snippet duration
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
        // Optionally, display interim snippet transcript somewhere if needed for UX
      };
      snippetRecognizer.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.warn('Snippet transcription error:', event.error, event.message);
        // If STT fails for snippet, it will use whatever was transcribed or empty string
      };
      snippetRecognizer.onend = () => {
        // This onend is for the snippet recognizer. MediaRecorder.onstop handles processing.
      };
      snippetRecognizer.start();

      // Stop both after RECORDING_DURATION_MS
      setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
          try { mediaRecorderRef.current.stop(); } catch (e) { console.warn("Error stopping media recorder for snippet:", e); }
        }
        if (snippetRecognitionRef.current) {
          try { snippetRecognitionRef.current.stop(); } catch (e) { console.warn("Error stopping snippet recognizer:", e); }
        }
        // Note: setIsCapturingAudio(false) is now handled in MediaRecorder's onstop to ensure processing happens
      }, RECORDING_DURATION_MS);
      return true;

    } catch (err) {
      console.error("Error starting audio recording:", err);
      toast({ title: "Audio Recording Error", description: (err as Error).message, variant: "destructive" });
      setIsCapturingAudio(false);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        try { mediaRecorderRef.current.stop(); } catch(e) {/* ignore */}
      }
      if (snippetRecognitionRef.current) {
        try { snippetRecognitionRef.current.stop(); } catch(e) {/* ignore */}
      }
      return false;
    }
  }, [hasMicPermission, isLoading, isCapturingAudio, isDashboardDictationActive, isExternallyLongRecording, toast, onThoughtRecalled]);


  useImperativeHandle(ref, () => ({
    startLongRecording: () => {
      if (!isListening || hasMicPermission !== true || isLoading || isDashboardDictationActive || isCapturingAudio) {
        toast({ title: "Cannot Start Continuous Recording", description: "System is busy, passive listening is off, or microphone permission is missing.", variant: "destructive"});
        return false;
      }
      // Stop other listeners
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
          setIsCapturingAudio(true); // Use isCapturingAudio for long recording as well
          snippetTranscriptRef.current = ''; // Re-use for long recording transcript
          audioChunksRef.current = [];
          setInputText("Continuous recording active. Speech will populate here when stopped. Click Brain icon to process.");

          // For long recording, we will use the snippetRecognitionRef for live transcription
          // and mediaRecorderRef for audio capture (though audio blob isn't directly used for STT here)
          snippetRecognitionRef.current = new SpeechRecognitionAPI();
          const recognizer = snippetRecognitionRef.current;
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
              snippetTranscriptRef.current = (snippetTranscriptRef.current + finalTranscriptForThisResult).trim();
            }
            setInputText(snippetTranscriptRef.current + (interimTranscript ? (snippetTranscriptRef.current ? " " : "") + interimTranscript : ""));
          };
          recognizer.onerror = (event: SpeechRecognitionErrorEvent) => {
            console.error("Continuous recording speech recognition error:", event.error, event.message);
            toast({ title: "Continuous Recording Transcription Error", description: event.message, variant: "destructive" });
          };
          recognizer.start();

          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          mediaRecorderRef.current = new MediaRecorder(stream);
          mediaRecorderRef.current.ondataavailable = (event) => {
            if (event.data.size > 0) {
              audioChunksRef.current.push(event.data);
            }
          };
          mediaRecorderRef.current.onstop = async () => { // This is for the LONG recording's media recorder
            stream.getTracks().forEach(track => track.stop());
            audioChunksRef.current = []; // Don't need the blob for this flow's STT
            setInputText(snippetTranscriptRef.current.trim()); // Populate input with transcript
            // User then clicks Brain icon.
            snippetTranscriptRef.current = ''; // Reset for next use
            setIsCapturingAudio(false);
            onStopLongRecordingParent(); // Notify parent
          };
          mediaRecorderRef.current.start();
          return true;

        } catch (err) {
          console.error("Error starting continuous recording:", err);
          toast({ title: "Continuous Recording Error", description: `Could not start recording: ${(err as Error).message}`, variant: "destructive" });
          setIsCapturingAudio(false);
          setInputText("");
          if (snippetRecognitionRef.current) { try { snippetRecognitionRef.current.stop(); } catch(e) {/* ignore */}}
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
             try { mediaRecorderRef.current.stop(); } catch(e) {/* ignore */}
          }
          onStopLongRecordingParent();
          return false;
        }
      };
      startRecordingFlow();
      return true;
    },
    stopLongRecordingAndProcess: () => {
      if (!isCapturingAudio) return; // Ensure it's actually long recording

      if (snippetRecognitionRef.current) { // This is used for long recording transcription
        try { snippetRecognitionRef.current.stop(); } catch(e) { /* ignore */ }
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        try { mediaRecorderRef.current.stop(); } catch(e) { /* ignore */ }
      } else {
        // If mediarecorder wasn't recording but speech was, still populate input
        setInputText(snippetTranscriptRef.current.trim());
        setIsCapturingAudio(false); // Reset state
        onStopLongRecordingParent(); // Notify parent
      }
      // snippetRecognitionRef.current = null; // Handled in onstop/onerror of recorder
      // mediaRecorderRef.current = null;
    },
  }));

   useEffect(() => {
    if (isExternallyLongRecording !== isCapturingAudio) { // isCapturingAudio is now general
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
  }, [isExternallyLongRecording, isCapturingAudio, ref]);


  useEffect(() => {
    if (!isListening && (isCapturingAudio || isDashboardDictationActive)) {
      if (isCapturingAudio && ref && 'current' in ref && ref.current) { // If long recording was active
        ref.current.stopLongRecordingAndProcess();
        toast({ title: "Recording Stopped", description: "Passive listening was disabled." });
      }
      if (isDashboardDictationActive && dashboardDictationRecognitionRef.current) { // If dashboard dictation was active
         try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/* ignore */}
         toast({ title: "Dictation Stopped", description: "Passive listening was disabled." });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListening]);


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

    // Pattern for "Heggles add X to shopping list"
    const shoppingListPattern = new RegExp(`^${WAKE_WORDS.HEGGLES_BASE.toLowerCase()}\\s+add\\s+(.+?)\\s+to\\s+(?:my\\s+|the\\s+)?shopping\\s+list$`);
    const shoppingListMatch = lowerText.match(shoppingListPattern);

    // Pattern for "Heggles add X to to do list"
    const todoListPattern = new RegExp(`^${WAKE_WORDS.HEGGLES_BASE.toLowerCase()}\\s+add\\s+(.+?)\\s+to\\s+(?:my\\s+|the\\s+)?to\\s+do\\s+list$`);
    const todoListMatch = lowerText.match(todoListPattern);
    
    // Pattern for "Heggles delete X from Y list"
    const deleteListPattern = new RegExp(`^${WAKE_WORDS.HEGGLES_BASE.toLowerCase()}\\s+delete\\s+(.*?)(?:\\s+${WAKE_WORDS.FROM_SHOPPING_LIST_TRIGGER.toLowerCase()}|\\s+${WAKE_WORDS.FROM_TODO_LIST_TRIGGER.toLowerCase()})$`);
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
      // setIsLoading will be handled by addListItem or dialog cancel
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
      // setIsLoading will be handled by addListItem or dialog cancel
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
        // setIsLoading(false) and setInputText('') are handled by deleteListItem
    }
    // "Heggles replay that" is handled by voice command directly calling startAudioRecording.
    // If "Heggles replay that" is typed and Brain is clicked, it's processed as general text.
    else { // General text processing (including typed "Heggles replay that" or unrecognized "Heggles..." commands)
      try {
        const processedData = await processTextThought(textToProcess);
        let thoughtHandledByIntent = false;

        if (processedData.intentAnalysis?.isQuestion && processedData.intentAnalysis.extractedQuestion && processedData.aiAnswer) {
            onThoughtRecalled({ id: crypto.randomUUID(), timestamp: Date.now(), ...processedData });
            toast({ title: "Thought Processed & Question Answered", description: "AI has provided an answer." });
            thoughtHandledByIntent = true;
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
            setIsAlertDialogOpen(true); // setIsLoading(false) will be handled by addListItem or dialog close
            thoughtHandledByIntent = true; // This counts as handled, even if user cancels dialog
        } else if (processedData.actionItems && processedData.actionItems.length > 0 && !thoughtHandledByIntent) {
          // Fallback to actionItems from refineThought if no stronger intent was found and handled
          for (const action of processedData.actionItems) {
            const lowerAction = action.toLowerCase();
            let itemToAdd: string | null = null;
            let targetListKey: string | null = null;
            let targetListName: string | null = null;

            const shoppingMatch = lowerAction.match(/add(?:\s+'|s\s)(.*?)(?:\s+'|\s)to\s+(?:my\s+|the\s+)?shopping\s+list/);
            if (shoppingMatch && shoppingMatch[1]) {
              itemToAdd = shoppingMatch[1].trim().replace(/^['"]|['"]$/g, '');
              targetListKey = LOCALSTORAGE_KEYS.SHOPPING_LIST;
              targetListName = "Shopping List";
            } else {
              const todoMatch = lowerAction.match(/add(?:\s+'|s\s)(.*?)(?:\s+'|\s)to\s+(?:my\s+|the\s+)?to-do\s+list/);
              if (todoMatch && todoMatch[1]) {
                itemToAdd = todoMatch[1].trim().replace(/^['"]|['"]$/g, '');
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
              thoughtHandledByIntent = true; // This counts as handled
              break; 
            }
          }
        }

        if (!thoughtHandledByIntent) { // If no specific question or action was handled by dialogs
          onThoughtRecalled({ id: crypto.randomUUID(), timestamp: Date.now(), ...processedData });
          toast({ title: "Thought Processed", description: "AI analysis complete." });
        }
        
        if (!isAlertDialogOpen) { // Clear input only if no dialog is open (meaning it wasn't a list add)
            setInputText('');
        }
      } catch (error) {
        toast({ title: "Error Processing Thought", description: (error as Error).message, variant: "destructive" });
      } finally {
        if (!isAlertDialogOpen) setIsLoading(false);
      }
    }
  };

  // Main command listener (Heggles wake word etc.)
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
                              !isCapturingAudio && // Not during 10s snippet or long recording
                              !isDashboardDictationActive;

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
          // Paused mid-command (e.g. after "Heggles"), keep utterance for next cycle.
        } else {
          setPartialWakeWordDetected(false);
          utteranceTranscriptRef.current = '';
        }
        recognitionRef.current = null;
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (event.error === 'no-speech' || event.error === 'aborted') {
          // console.warn('Main command recognition warning:', event.error, event.message);
        } else {
           console.error('Main command recognition error:', event.error, event.message);
        }
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            setHasMicPermission(false);
            toast({ title: "Microphone Access Issue", variant: "destructive", description: "Speech recognition service denied. Check browser settings or permissions." });
        } else if (event.error === 'network') {
            toast({ title: "Network Error", variant: "destructive", description: "A network error occurred with the speech recognition service."});
        }
        commandProcessedSuccessfullyRef.current = true; // Consider this attempt over
        setPartialWakeWordDetected(false); 
        utteranceTranscriptRef.current = '';
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

        if (newlyFinalizedSegmentThisTurn) {
            utteranceTranscriptRef.current = (utteranceTranscriptRef.current + (utteranceTranscriptRef.current ? " " : "") + newlyFinalizedSegmentThisTurn).trim();
        }
        
        const fullUtteranceForDisplay = (utteranceTranscriptRef.current ? utteranceTranscriptRef.current + " " : "") + currentInterimSegment.trim();

        if (!partialWakeWordDetected && currentInterimSegment.toLowerCase().includes(WAKE_WORDS.HEGGLES_BASE.toLowerCase())) {
            setPartialWakeWordDetected(true);
            // Start utteranceTranscript with Heggles if it's the first detection
            if (!utteranceTranscriptRef.current.toLowerCase().startsWith(WAKE_WORDS.HEGGLES_BASE.toLowerCase())) {
                 utteranceTranscriptRef.current = WAKE_WORDS.HEGGLES_BASE + " ";
            }
        }
        
        // Only update inputText if wake word has been partially detected
        if (partialWakeWordDetected) {
            setInputText(fullUtteranceForDisplay);
        }

        const lastResultIsFinal = event.results[event.results.length - 1].isFinal;

        if (lastResultIsFinal && utteranceTranscriptRef.current) {
            const finalUtterance = utteranceTranscriptRef.current.trim();
            const finalLower = finalUtterance.toLowerCase();
            commandProcessedSuccessfullyRef.current = false; // Default to not processed

            if (!finalLower.startsWith(WAKE_WORDS.HEGGLES_BASE.toLowerCase())) {
                // Speech detected but didn't start with Heggles. Ignore for inputText.
                commandProcessedSuccessfullyRef.current = true; // This "unrelated" speech session is over.
                if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch (e) { /*ignore*/ } }
                return; // Don't process further if it doesn't start with Heggles
            }

            // At this point, we know it starts with "Heggles"
            if (finalLower === WAKE_WORDS.HEGGLES_REPLAY_THAT.toLowerCase()) {
                commandProcessedSuccessfullyRef.current = true;
                startAudioRecording(); // This handles its own toasts, loading states, etc.
                setInputText(''); // Clear "Heggles replay that" from input
            } else if (finalLower === WAKE_WORDS.HEGGLES_TURN_OFF.toLowerCase()) {
                commandProcessedSuccessfullyRef.current = true;
                onToggleListeningParent(false);
                setInputText('');
            } else if (finalLower === WAKE_WORDS.HEGGLES_TURN_ON.toLowerCase()) {
                commandProcessedSuccessfullyRef.current = true;
                onToggleListeningParent(true);
                setInputText('');
            } else if (finalLower.startsWith(WAKE_WORDS.HEGGLES_SET_BUFFER.toLowerCase())) {
                commandProcessedSuccessfullyRef.current = true; // setBufferTimeByVoice handles its own success flag
                const spokenDuration = finalUtterance.substring(WAKE_WORDS.HEGGLES_SET_BUFFER.length).trim();
                setBufferTimeByVoice(spokenDuration);
            } else if (finalLower === WAKE_WORDS.HEGGLES_BASE.toLowerCase()) {
                // Just "Heggles" was said. Keep listening.
                commandProcessedSuccessfullyRef.current = false; // NOT processed yet, preserve utterance.
                setInputText(finalUtterance + " "); // Show "Heggles " in input
            } else {
                // It started with "Heggles" but wasn't a direct action command.
                // The full command (e.g., "Heggles add X to list", "Heggles delete Y", "Heggles unrecognized text")
                // is already in inputText (due to partialWakeWordDetected being true).
                // User will click Brain icon to process this.
                commandProcessedSuccessfullyRef.current = true; // This speech session is over.
                // Toast for unrecognized "Heggles..." command will be shown by Brain if not matched there
            }

            if (recognitionRef.current && commandProcessedSuccessfullyRef.current) {
                try { recognitionRef.current.stop(); } catch (e) { console.warn("Error stopping main cmd rec after final result:", e); }
            }
        }
      };
      
      try {
        if (recognitionRef.current && typeof recognitionRef.current.start === 'function') {
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
       // onend will set recognitionRef.current to null
    }

    return () => { // Cleanup
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
      // Cleanup for snippet/long recording refs if necessary, though usually handled by their own logic
      if (snippetRecognitionRef.current) {
        try { snippetRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
        snippetRecognitionRef.current = null;
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        try { mediaRecorderRef.current.stop(); } catch(e) {/*ignore*/}
        mediaRecorderRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListening, hasMicPermission, isLoading, isCapturingAudio, isDashboardDictationActive, onToggleListeningParent, setBufferTimeByVoice, startAudioRecording]);


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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMicPermission]);


  const handleDashboardMicClick = async () => {
    const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      toast({ title: "Browser Not Supported", variant: "destructive", description: "Speech recognition for dictation not available."});
      return;
    }
    if (isCapturingAudio) { // If "Heggles replay that" or long recording is active
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
        // Fall through to start dictation after permission granted in this click
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
      // onend will handle setting isDashboardDictationActive to false
      // User then clicks Brain icon.
      return;
    }

    // Stop main command listener if it's running
    if (recognitionRef.current) { 
      commandProcessedSuccessfullyRef.current = true; 
      try { recognitionRef.current.stop(); } catch(e) { /* ignore */ }
    }
    setIsRecognizingSpeech(false); 
    setPartialWakeWordDetected(false);

    setIsDashboardDictationActive(true);
    dashboardDictationAccumulatedTranscriptRef.current = inputText; // Start with current input text
    // setInputText("Dictating your thought..."); // Feedback

    dashboardDictationRecognitionRef.current = new SpeechRecognitionAPI();
    const recognition = dashboardDictationRecognitionRef.current;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      // setIsRecognizingSpeech(false); already done
    };
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
      
      const currentDictationTranscript = dashboardDictationAccumulatedTranscriptRef.current;
      const textToShowInInput = currentDictationTranscript + (interim ? (currentDictationTranscript ? " " : "") + interim.trim() : "");
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
      else if (event.error === 'no-speech' && !dashboardDictationAccumulatedTranscriptRef.current.trim()) {
         // Don't toast if no speech and input was empty
      }
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
      // dashboardDictationAccumulatedTranscriptRef.current = ''; // User processes what's in inputText
    };
    recognition.start();
  };


  const getMicIconForCardHeader = () => {
    if (isExternallyLongRecording || (isCapturingAudio && mediaRecorderRef.current?.context?.state === "recording" && snippetRecognitionRef.current)) return <Radio className="h-5 w-5 text-red-500 animate-pulse" /> // Long recording
    if (isCapturingAudio) return <Radio className="h-5 w-5 text-red-500 animate-pulse" /> // "Heggles replay that" recording
    if (isDashboardDictationActive) return <Radio className="h-5 w-5 text-red-500 animate-pulse" />;
    if (partialWakeWordDetected) return <Mic className="h-5 w-5 text-yellow-500 animate-pulse" />;
    if (isRecognizingSpeech) return <Mic className="h-5 w-5 text-primary animate-pulse" />;
    if (isListening && hasMicPermission && !isBrowserUnsupported && !isLoading) return <Mic className="h-5 w-5 text-primary" />;
    return <MicOff className="h-5 w-5 text-muted-foreground" />;
  };

  const getMicStatusText = (): React.ReactNode => {
    if (isExternallyLongRecording || (isCapturingAudio && mediaRecorderRef.current?.context?.state === "recording" && snippetRecognitionRef.current)) return "Continuous recording active...";
    if (isCapturingAudio) return "Recording 10s audio & speech...";
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
    if (isExternallyLongRecording) return "Continuous recording active. Speech will populate here when stopped. Click Brain icon to process.";
    if (isCapturingAudio) return "Recording 10s audio & speech for 'Heggles replay that'. Processed automatically.";
    if (isDashboardDictationActive) return "Dictating your thought... Say 'Heggles end' or 'Heggles stop' to finish. Text will populate here for Brain processing.";
    if (isLoading && !isAlertDialogOpen) return "Processing...";
    if (!isListening) return "Enable passive listening to use voice or type input here.";
    if (partialWakeWordDetected) return "'Heggles' detected. Finish your command. Text will appear here. Click Brain icon to process.";
    if (isRecognizingSpeech) return "Listener active. Say 'Heggles' followed by your command. Text will appear here for Brain processing.";
    return "Type thought or say 'Heggles' + command. Click Brain icon to process.";
  };

  const getDashboardDictationButtonIcon = () => { // For the mic button in the card
    if (isDashboardDictationActive) return <Radio className="h-5 w-5 text-red-500 animate-pulse" />;
    // Disable if main listener active, or long/snippet recording, or loading
    if (!isListening || hasMicPermission !== true || isRecognizingSpeech || isCapturingAudio || isLoading) return <MicOff className="h-5 w-5 text-muted-foreground" />;
    return <Mic className="h-5 w-5 text-primary" />;
  };
  
  const dashboardMicButtonDisabled = !isListening || hasMicPermission !== true || isRecognizingSpeech || isCapturingAudio || isLoading || isExternallyLongRecording;


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
              disabled={isLoading || isCapturingAudio}
              className="resize-none"
              aria-label="Thought input area"
            />
            <div className="flex items-stretch gap-2">
               <Button
                type="button"
                onClick={handleProcessInputText}
                disabled={isLoading || isCapturingAudio || !inputText.trim()}
                size="icon"
                className="p-2 h-auto"
                aria-label="Process text from input area with AI"
                title="Process text from input area with AI"
              >
                {(isLoading && !isAlertDialogOpen && inputText.trim()) ? <Loader2 className="h-5 w-5 animate-spin" /> : <Brain className="h-5 w-5" />}
              </Button>
              <Button
                type="button"
                onClick={handleDashboardMicClick}
                disabled={dashboardMicButtonDisabled}
                size="icon"
                className="p-2 h-auto"
                aria-label="Dictate thought into text area"
                title="Dictate directly into input area (ends on pause or 'Heggles end/stop')"
              >
                {getDashboardDictationButtonIcon()}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground pt-1">
                Say '<strong>Heggles replay that</strong>' to record a 10s audio snippet for AI processing.
                Other '<strong>Heggles</strong>' commands (e.g., 'add to list') populate this area for processing with the <Brain className="inline-block h-3 w-3 mx-0.5"/> button.
                The <Mic className="inline-block h-3 w-3 mx-0.5"/> icon button (dictate) transcribes speech directly into this area.
                The <PlayCircle className="inline-block h-3 w-3 mx-0.5 text-green-500"/> / <StopCircle className="inline-block h-3 w-3 mx-0.5 text-red-500"/> button (header) is for continuous recording.
            </p>
          </div>
        </CardContent>
      </Card>

      {alertDialogConfig && (
        <AlertDialog open={isAlertDialogOpen} onOpenChange={(open) => {
            setIsAlertDialogOpen(open);
            if (!open) {
                setIsLoading(false); 
                // Don't clear inputText on cancel, user might want to edit.
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
              <AlertDialogCancel onClick={() => { setIsLoading(false); /* setInputText(''); */ }}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => {
                alertDialogConfig.onConfirm();
                // setIsLoading(false) and setInputText('') are handled by addListItem or after general processing
              }}>Confirm</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
});

ThoughtInputForm.displayName = "ThoughtInputForm";
