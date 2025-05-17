
"use client";

import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from 'react';
import { Brain, Loader2, Mic, MicOff, AlertTriangleIcon, Radio, PlayCircle, StopCircle } from 'lucide-react';
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
  AlertDialogFooter,
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
  onToggleListeningParent: (isListening: boolean) => void; // To control parent's listening state
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

    // For main "Heggles" command listener
    const [hasMicPermission, setHasMicPermission] = useState<boolean | null>(null);
    const [isRecognizingSpeech, setIsRecognizingSpeech] = useState(false); // True when main command listener is active
    const [isBrowserUnsupported, setIsBrowserUnsupported] = useState(false);
    const [partialWakeWordDetected, setPartialWakeWordDetected] = useState(false);
    const recognitionRef = useRef<SpeechRecognition | null>(null);
    const utteranceTranscriptRef = useRef<string>(''); 
    const commandProcessedSuccessfullyRef = useRef<boolean>(false);

    // For dashboard direct dictation mic button
    const [isDashboardDictationActive, setIsDashboardDictationActive] = useState(false);
    const dashboardDictationRecognitionRef = useRef<SpeechRecognition | null>(null);
    const dashboardDictationPauseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const dashboardDictationAccumulatedTranscriptRef = useRef<string>('');

    // For 10-second "Heggles replay that" recording (triggered by voice or button)
    const [isCapturingAudioForSnippet, setIsCapturingAudioForSnippet] = useState(false);
    const snippetMediaRecorderRef = useRef<MediaRecorder | null>(null);
    const snippetRecognitionRef = useRef<SpeechRecognition | null>(null);
    const snippetTranscriptRef = useRef<string>('');
    const snippetAudioChunksRef = useRef<Blob[]>([]);

    // For continuous recording (from header button)
    const [isCapturingAudioForLongRecording, setIsCapturingAudioForLongRecording] = useState(false);
    const longRecordingMediaRecorderRef = useRef<MediaRecorder | null>(null);
    const longRecordingSpeechRecognizerRef = useRef<SpeechRecognition | null>(null);
    const longRecordingTranscriptRef = useRef<string>('');
    const longRecordingAudioChunksRef = useRef<Blob[]>([]);

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
      setPartialWakeWordDetected(false);
      utteranceTranscriptRef.current = '';
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
        toast({ title: "System Busy", description: "Another audio process is active.", variant: "default" });
        return false;
      }

      commandProcessedSuccessfullyRef.current = true; 
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch (e) { console.warn("Error stopping main rec before snippet:", e); }
      }
      setIsRecognizingSpeech(false);
      setPartialWakeWordDetected(false);
      utteranceTranscriptRef.current = '';

      setIsCapturingAudioForSnippet(true);
      snippetTranscriptRef.current = '';
      snippetAudioChunksRef.current = [];
      toast({ title: "Recording Audio & Speech...", description: <>Capturing for {RECORDING_DURATION_MS / 1000} seconds for <strong>Heggles replay that</strong> command.</> });

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
            toast({ title: "Recorded Snippet Processed", description: "AI analysis of live recording complete." });
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
            toast({ title: "Cannot Simulate Wake Word", description: "Listener is off, busy, or mic permission is missing.", variant: "default" });
            return;
        }
        toast({ title: "Heggles Activated", description: "Listening for your command...", duration: 2000});

        utteranceTranscriptRef.current = WAKE_WORDS.HEGGLES_BASE + " ";
        setPartialWakeWordDetected(true);
        commandProcessedSuccessfullyRef.current = false;

        if (recognitionRef.current) {
            try { recognitionRef.current.stop(); } catch (e) { console.warn("Simulate: Error stopping existing main recognition:", e); }
            // onend will set recognitionRef.current to null, allowing useEffect to restart
        } else {
            // If no recognition was active, force useEffect to re-evaluate by toggling a dummy state or directly triggering it
            // For now, we rely on the onend of a stopped instance or the initial load to set it up.
            // This part could be made more robust if needed, e.g., by calling a local start function if recognitionRef is null.
            // For simplicity, if no recognition is running, we assume useEffect will pick it up.
            // Force a state change to ensure useEffect re-runs if it's already idle.
            setIsRecognizingSpeech(false); // This will trigger the useEffect if it's already idle
            setIsRecognizingSpeech(isRecognizingSpeech => !isRecognizingSpeech); // A quick toggle
            setTimeout(() => setIsRecognizingSpeech(isRecognizingSpeech => !isRecognizingSpeech), 0);

        }
        setInputText(utteranceTranscriptRef.current);
      },
      startLongRecording: () => {
        if (!isListening || hasMicPermission !== true || isLoading || isDashboardDictationActive || isCapturingAudioForSnippet || isCapturingAudioForLongRecording) {
          if (!isListening) toast({title: "Cannot Start Recording", description: "Passive Listening is disabled."});
          else if (hasMicPermission !== true) toast({title: "Cannot Start Recording", description: "Microphone permission missing."});
          else toast({title: "Cannot Start Recording", description: "System busy with another audio task."});
          return false;
        }
        
        commandProcessedSuccessfullyRef.current = true; 
        if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch(e) {/*ignore*/} }
        if (dashboardDictationRecognitionRef.current) { try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/} }
        setIsRecognizingSpeech(false);
        setPartialWakeWordDetected(false);
        setIsDashboardDictationActive(false);
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
            setInputText(""); 

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
              setInputText(longRecordingTranscriptRef.current + (interimTranscript ? " " + interimTranscript.trim() : ""));
            };
            recognizer.onerror = (event: SpeechRecognitionErrorEvent) => {
              if (event.error === 'aborted') {
                console.info("Continuous recording speech recognition aborted (likely intentional stop):", event.message);
              } else if (event.error === 'no-speech') {
                console.warn("Continuous recording speech recognition: No speech detected.", event.message);
              } else {
                console.error("Continuous recording speech recognition error:", event.error, event.message);
                toast({ title: "Continuous Recording Transcription Error", description: event.message || "An error occurred.", variant: "destructive" });
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
              longRecordingAudioChunksRef.current = []; 
              
              setInputText(longRecordingTranscriptRef.current.trim()); 
              
              setIsCapturingAudioForLongRecording(false);
              onStopLongRecordingParent(); 
              toast({ title: "Recording Stopped", description: "Transcript populated. Click Brain icon to process." });
            };
            longRecordingMediaRecorderRef.current.start();
            return true;

          } catch (err) {
            console.error("Error starting continuous recording:", err);
            toast({ title: "Continuous Recording Error", description: `Could not start recording: ${(err as Error).message}`, variant: "destructive" });
            setIsCapturingAudioForLongRecording(false);
            setInputText(""); 
            if (longRecordingSpeechRecognizerRef.current) { try { longRecordingSpeechRecognizerRef.current.stop(); } catch (e) {/* ignore */}}
            if (longRecordingMediaRecorderRef.current && longRecordingMediaRecorderRef.current.state === "recording") {
              try { longRecordingMediaRecorderRef.current.stop(); } catch (e) {/* ignore */}
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
          try { longRecordingMediaRecorderRef.current.stop(); } catch(e) { /* onstop will handle the rest */ }
        } else {
          setInputText(longRecordingTranscriptRef.current.trim()); 
          setIsCapturingAudioForLongRecording(false);
          onStopLongRecordingParent();
        }
      },
    }));

    // Initial microphone permission check and browser support
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

    // Effect to stop long recording if main listening toggle is turned off
    useEffect(() => {
      if (!isListening && isCapturingAudioForLongRecording && ref && typeof ref !== 'function' && ref.current) {
          ref.current.stopLongRecordingAndProcess();
      }
    }, [isListening, isCapturingAudioForLongRecording, ref]);

    // Effect to sync long recording state with external prop
     useEffect(() => {
        if (isExternallyLongRecording !== isCapturingAudioForLongRecording) {
            if (isExternallyLongRecording) {
                if (ref && typeof ref !== 'function' && ref.current) {
                    ref.current.startLongRecording();
                }
            } else {
                if (ref && typeof ref !== 'function' && ref.current) {
                    ref.current.stopLongRecordingAndProcess();
                }
            }
        }
    }, [isExternallyLongRecording, isCapturingAudioForLongRecording, ref]);

    const addListItem = useCallback((listKey: string, itemTextToAdd: string, listName: string) => {
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
    }, [toast]);

    const deleteListItem = useCallback((listKey: string, identifier: string | number, listName: string) => {
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
      } finally {
        setIsLoading(false); 
        setInputText(''); 
      }
    }, [toast]);

    const handleProcessInputText = useCallback(async () => {
      const textToProcess = inputText.trim();
      if (!textToProcess) {
        toast({ title: "Input empty", description: "Cannot process an empty thought.", variant: "destructive" });
        return;
      }
      setIsLoading(true);
      const lowerText = textToProcess.toLowerCase();
      const hegglesBaseLower = WAKE_WORDS.HEGGLES_BASE.toLowerCase();

      const shoppingListAddPattern = new RegExp(`^${hegglesBaseLower}\\s+${WAKE_WORDS.ADD_TO_SHOPPING_LIST_FULL_PREFIX_REGEX_PART.toLowerCase()}\\s+(.+?)(?:\\s+${WAKE_WORDS.TO_SHOPPING_LIST_SUFFIX_REGEX_PART.toLowerCase()})?$`);
      const shoppingListAddMatch = lowerText.match(shoppingListAddPattern);
      
      const todoListAddPattern = new RegExp(`^${hegglesBaseLower}\\s+${WAKE_WORDS.ADD_TO_TODO_LIST_FULL_PREFIX_REGEX_PART.toLowerCase()}\\s+(.+?)(?:\\s+${WAKE_WORDS.TO_TODO_LIST_SUFFIX_REGEX_PART.toLowerCase()})?$`);
      const todoListAddMatch = lowerText.match(todoListAddPattern);

      const deleteListPattern = new RegExp(`^${hegglesBaseLower}\\s+${WAKE_WORDS.DELETE_ITEM_PREFIX_BASE.toLowerCase()}\\s+(.*?)(?:\\s+${WAKE_WORDS.FROM_SHOPPING_LIST_TRIGGER.toLowerCase()}|\\s+${WAKE_WORDS.FROM_TODO_LIST_TRIGGER.toLowerCase()})$`);
      const deleteListMatch = lowerText.match(deleteListPattern);

      if (lowerText === WAKE_WORDS.HEGGLES_REPLAY_THAT.toLowerCase()) {
        // This "replay that" from text input now triggers live recording, just like voice command.
        // The previous conceptual buffer logic for text input of "replay that" is removed.
        // This behavior is now consistent with the voice command.
        startAudioRecordingForSnippet(); // This will handle everything and setInputText('') when done.
        setIsLoading(false); // startAudioRecordingForSnippet will manage its own loading state internally.
        return; 
      } else if (shoppingListAddMatch && shoppingListAddMatch[1]) {
        const item = shoppingListAddMatch[1].trim();
        setAlertDialogConfig({
          title: "Add to Shopping List?",
          description: <>Do you want to add <strong>"{item}"</strong> to your shopping list?</>,
          itemText: item,
          listKey: LOCALSTORAGE_KEYS.SHOPPING_LIST,
          listName: "Shopping List",
          onConfirm: () => addListItem(LOCALSTORAGE_KEYS.SHOPPING_LIST, item, "Shopping List"),
        });
        setIsAlertDialogOpen(true);
      } else if (todoListAddMatch && todoListAddMatch[1]) {
        const task = todoListAddMatch[1].trim();
        setAlertDialogConfig({
          title: "Add to To-Do List?",
          description: <>Do you want to add <strong>"{task}"</strong> to your to-do list?</>,
          itemText: task,
          listKey: LOCALSTORAGE_KEYS.TODO_LIST,
          listName: "To-Do List",
          onConfirm: () => addListItem(LOCALSTORAGE_KEYS.TODO_LIST, task, "To-Do List"),
        });
        setIsAlertDialogOpen(true);
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
              setIsLoading(false); setInputText('');
            }
          } else {
            deleteListItem(listKey, itemIdentifierStr, listName); 
          }
        } else {
          toast({ title: "Deletion Command Incomplete", description: "Specify item and list (e.g., '...from my shopping list').", variant: "default" });
          setIsLoading(false); setInputText('');
        }
      } else { 
        try {
          const processedData = await processTextThought(textToProcess);
          let thoughtHandledByIntentOrAction = false;

          if (processedData.intentAnalysis?.isAction && 
              processedData.intentAnalysis.extractedAction && 
              processedData.intentAnalysis.suggestedList && 
              processedData.intentAnalysis.suggestedList !== 'none') {
            
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
          } 
          else if (processedData.actionItems && processedData.actionItems.length > 0 && !thoughtHandledByIntentOrAction) {
            for (const action of processedData.actionItems) { 
              const lowerAction = action.toLowerCase();
              let itemToAdd: string | null = null;
              let targetListKey: string | null = null;
              let targetListName: string | null = null;

              const shoppingPatternRefined = new RegExp(`(?:add|buy|get|purchase)\\s+(?:['"]?)(.+?)(?:['"]?)(?:\\s+to\\s+(?:my\\s+|the\\s+)?shopping\\s+list)?`);
              const todoPatternRefined = new RegExp(`(?:add|schedule|create|complete|do|finish|call|email|text|set up|organize)\\s+(?:['"]?)(.+?)(?:['"]?)(?:\\s+to\\s+(?:my\\s+|the\\s+)?(?:to\\s*do|todo)\\s+list)?`);
              
              const shoppingMatchRefined = lowerAction.match(shoppingPatternRefined);
              if (shoppingMatchRefined && shoppingMatchRefined[1]) {
                itemToAdd = shoppingMatchRefined[1].trim();
                targetListKey = LOCALSTORAGE_KEYS.SHOPPING_LIST;
                targetListName = "Shopping List";
              } else {
                const todoMatchRefined = lowerAction.match(todoPatternRefined);
                if (todoMatchRefined && todoMatchRefined[1]) {
                  itemToAdd = todoMatchRefined[1].trim();
                  targetListKey = LOCALSTORAGE_KEYS.TODO_LIST;
                  targetListName = "To-Do List";
                }
              }

              if (itemToAdd && targetListKey && targetListName) {
                setAlertDialogConfig({
                  title: `AI Suggestion: Add to ${targetListName}?`,
                  description: <>The AI identified an action: "<strong>{action}</strong>". Add "<strong>{itemToAdd}</strong>" to your {targetListName}?</>,
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
            toast({ title: "Thought Processed", description: processedData.aiAnswer ? "AI answered your question." : "AI analysis complete." });
            setInputText(''); 
            setIsLoading(false);
          } else if (!isAlertDialogOpen && thoughtHandledByIntentOrAction) {
             setInputText('');
             setIsLoading(false);
          }

        } catch (error) {
          toast({ title: "Error Processing Thought", description: (error as Error).message, variant: "destructive" });
          setIsLoading(false); 
        }
      }
    }, [inputText, toast, onThoughtRecalled, addListItem, deleteListItem, startAudioRecordingForSnippet]);
    
    // Effect for main "Heggles" command listener
    useEffect(() => {
      const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognitionAPI) {
        return;
      }

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
          if (commandProcessedSuccessfullyRef.current) { 
            setPartialWakeWordDetected(false);
            utteranceTranscriptRef.current = '';
          } else if (!partialWakeWordDetected) {
             utteranceTranscriptRef.current = '';
          }
          recognitionRef.current = null;
        };

        recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
          if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            console.error('Main command recognition error:', event.error, event.message);
            setHasMicPermission(false);
            toast({ title: "Microphone Access Issue", variant: "destructive", description: "Speech recognition service denied. Check browser settings or permissions." });
          } else if (!(event.error === 'no-speech' || event.error === 'aborted')) {
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
            if (newlyFinalizedSegmentThisTurn.toLowerCase().startsWith(hegglesBaseLower) || currentInterimSegment.toLowerCase().startsWith(hegglesBaseLower)) {
              setPartialWakeWordDetected(true);
              utteranceTranscriptRef.current = newlyFinalizedSegmentThisTurn || currentInterimSegment;
              setInputText(utteranceTranscriptRef.current);
            } else if (newlyFinalizedSegmentThisTurn) { // Finalized speech that doesn't start with Heggles
                commandProcessedSuccessfullyRef.current = true;
                 if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch(e) { /* ignore */ } }
                return;
            }
          } else { 
            if (newlyFinalizedSegmentThisTurn) {
              utteranceTranscriptRef.current = (utteranceTranscriptRef.current + " " + newlyFinalizedSegmentThisTurn).trim();
            }
            setInputText(utteranceTranscriptRef.current + (currentInterimSegment ? " " + currentInterimSegment.trim() : ""));
          }
        
          const lastResultIsFinal = event.results[event.results.length - 1].isFinal;
        
          if (lastResultIsFinal && utteranceTranscriptRef.current) {
            const finalUtterance = utteranceTranscriptRef.current.trim();
            const finalLower = finalUtterance.toLowerCase();
            commandProcessedSuccessfullyRef.current = true; // Assume processing or populating input text means this cycle is done

            if (!finalLower.startsWith(hegglesBaseLower)) {
              if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch(e) { /* ignore */ } }
              return;
            }
        
            if (finalLower === WAKE_WORDS.HEGGLES_TURN_OFF.toLowerCase()) {
              onToggleListeningParent(false);
              setInputText(''); 
            } else if (finalLower === WAKE_WORDS.HEGGLES_TURN_ON.toLowerCase()) {
              onToggleListeningParent(true);
              setInputText(''); 
            } else if (finalLower.startsWith(WAKE_WORDS.HEGGLES_SET_BUFFER.toLowerCase())) {
              const spokenDuration = finalUtterance.substring(WAKE_WORDS.HEGGLES_SET_BUFFER.length).trim();
              setBufferTimeByVoice(spokenDuration); 
            } else if (finalLower === WAKE_WORDS.HEGGLES_REPLAY_THAT.toLowerCase()) {
                startAudioRecordingForSnippet();
                setInputText('');
            } else if (finalLower === hegglesBaseLower && !currentInterimSegment) { 
              setInputText(finalUtterance + " "); 
              commandProcessedSuccessfullyRef.current = false; // Not a complete command, keep listening
              return; 
            } else {
              // For all other commands starting with "Heggles", text is already in inputText
              // This cycle of recognition is complete. User will click Brain or it was an unrecognized command.
              // No toast here for unrecognized as text is populated.
            }
            
            if (recognitionRef.current) {
              try { recognitionRef.current.stop(); } catch(e) { console.warn("Error stopping main cmd rec after final result processing:", e); }
            }
          }
        };
        
        try {
          if (recognitionRef.current && isListening && !isLoading && !isCapturingAudioForSnippet && !isDashboardDictationActive && !isCapturingAudioForLongRecording && !isRecognizingSpeech) {
            commandProcessedSuccessfullyRef.current = false; 
            recognitionRef.current.start();
          } else if (!recognitionRef.current && isListening && hasMicPermission === true && !isLoading && !isCapturingAudioForSnippet && !isDashboardDictationActive && !isCapturingAudioForLongRecording) {
            // This branch should ideally not be needed if onend correctly nulls the ref.
            // It indicates the effect ran but recognitionRef.current was already non-null but not started.
            // Forcing a new instance if conditions are truly met.
             console.warn("Re-initializing main recognition due to unexpected state.");
          }
        } catch (e) {
          console.error("Failed to start main command speech recognition:", e);
          if (recognitionRef.current) {
            recognitionRef.current = null; 
          }
        }
      } else if (!shouldBeListening && recognitionRef.current) {
        commandProcessedSuccessfullyRef.current = true; 
        try {
          recognitionRef.current.stop();
        } catch(e) {
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
        toast, 
        onThoughtRecalled,       
        addListItem,             
        deleteListItem,          
        isRecognizingSpeech      
    ]);
    
    const handleDashboardMicClick = useCallback(async () => {
      const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognitionAPI) {
        toast({ title: "Browser Not Supported", variant: "destructive", description: "Speech recognition for dictation not available." });
        return;
      }
       if (isCapturingAudioForSnippet || isCapturingAudioForLongRecording || isLoading) {
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
        return;
      }

      commandProcessedSuccessfullyRef.current = true; 
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch (e) { /* ignore */ }
      }
      setIsRecognizingSpeech(false);
      setPartialWakeWordDetected(false);
      utteranceTranscriptRef.current = '';

      setIsDashboardDictationActive(true);
      dashboardDictationAccumulatedTranscriptRef.current = inputText; 

      dashboardDictationRecognitionRef.current = new SpeechRecognitionAPI();
      const recognition = dashboardDictationRecognitionRef.current;
      recognition.continuous = true; 
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        // setInputText(""); // Clearing input on start can be disruptive if user wants to append
      };
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

        const lowerTranscriptForEndCheck = (dashboardDictationAccumulatedTranscriptRef.current + " " + interim).trim().toLowerCase();
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
          console.warn('Dashboard dictation: No speech detected.');
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
        
        // Auto-submit after dictation ends
        if(finalDictatedText){
          handleProcessInputText(); // Process the dictated text
        }
        dashboardDictationAccumulatedTranscriptRef.current = ''; 
      };
      
      try {
        dashboardDictationAccumulatedTranscriptRef.current = ''; // Clear previous dictation
        setInputText(''); // Clear text area for new dictation
        recognition.start();
      } catch (e) {
        console.error("Failed to start dashboard dictation:", e);
        setIsDashboardDictationActive(false);
        toast({ title: "Dictation Error", description: "Could not start dictation.", variant: "destructive" });
      }
    }, [toast, hasMicPermission, isCapturingAudioForSnippet, isCapturingAudioForLongRecording, isLoading, isDashboardDictationActive, inputText, handleProcessInputText]);


    // UI Helper functions
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
      if (isCapturingAudioForSnippet) return <>Recording audio & speech (10s) for <strong>Heggles replay that</strong>...</>;
      if (isDashboardDictationActive) return "Dictating to input area...";
      if (isLoading && !isAlertDialogOpen) return "Processing..."; 
      if (!isListening) return "Voice Inactive (Passive Listening Off)";
      if (isBrowserUnsupported) return "Voice N/A (Browser Not Supported)";
      if (hasMicPermission === false) return <span className="text-destructive">Mic Access Denied</span>;
      if (hasMicPermission === null) return "Mic Awaiting Permission...";
      if (partialWakeWordDetected) return <>'<strong>Heggles</strong>' detected, awaiting command...</>;
      if (isRecognizingSpeech) return <>Listener active for '<strong>Heggles</strong>'</>;
      if (isListening && hasMicPermission && !isBrowserUnsupported) return <>Listener active for '<strong>Heggles</strong>'</>;
      return "Voice status checking...";
    };

    const getTextareaPlaceholder = (): string => {
      if (isCapturingAudioForLongRecording) return "Continuous recording active. Transcript populates here. Click Brain icon to process.";
      if (isCapturingAudioForSnippet) return "Recording audio & speech for 'Heggles replay that'. Transcript will appear here for processing.";
      if (isDashboardDictationActive) return "Dictating your thought... Say 'Heggles end' or 'Heggles stop' to finish. Text populates here and will be processed.";
      if (isLoading && !isAlertDialogOpen) return "Processing...";
      if (!isListening) return "Enable voice commands to use voice, or type input here. Click Brain icon to process.";
      if (partialWakeWordDetected) return "'Heggles' detected. Finish your command. Text appears here. Click Brain icon to process.";
      if (isRecognizingSpeech) return "Listener active. Say 'Heggles' followed by your command. Text appears here for Brain processing.";
      return "Type thought or say 'Heggles' + command. Click Brain icon to process.";
    };
    
    const dashboardMicButtonDisabled = 
                                       hasMicPermission !== true ||
                                       isRecognizingSpeech || 
                                       isCapturingAudioForSnippet ||
                                       isLoading ||
                                       isCapturingAudioForLongRecording;


    const getDashboardDictationButtonIcon = () => {
        if (isDashboardDictationActive) return <Radio className="h-5 w-5 text-red-500 animate-pulse" />;
        if (!isListening || hasMicPermission !== true || isBrowserUnsupported) return <MicOff className="h-5 w-5 text-muted-foreground" />
        return <Mic className="h-5 w-5 text-primary" />;
    };
    
    const recallCmdSuffix = WAKE_WORDS.HEGGLES_REPLAY_THAT.substring(WAKE_WORDS.HEGGLES_BASE.length);
    const addShopCmdSuffix = WAKE_WORDS.ADD_TO_SHOPPING_LIST_FULL_PREFIX_REGEX_PART; 
    const addToDoCmdSuffix = WAKE_WORDS.ADD_TO_TODO_LIST_FULL_PREFIX_REGEX_PART; 
    const setBufferCmdSuffix = WAKE_WORDS.HEGGLES_SET_BUFFER.substring(WAKE_WORDS.HEGGLES_BASE.length);
    const deleteItemSuffix = WAKE_WORDS.DELETE_ITEM_PREFIX_BASE; 


    return (
      <>
        <Card className="w-full shadow-lg">
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle className="text-xl">Input & Recall</CardTitle>
              {hasMicPermission !== null && !isBrowserUnsupported && ( // Show status only after permission check and if supported
                <div className="flex items-center gap-2 text-sm text-muted-foreground" title={typeof getMicStatusText() === 'string' ? getMicStatusText() as string : undefined}>
                  {getMicIconForCardHeader()}
                  <span>{getMicStatusText()}</span>
                </div>
              )}
            </div>
            <CardDescription>
              Say '<strong>Heggles</strong>' + your command. Most commands populate text below for processing with the <Brain className="inline-block h-3.5 w-3.5 mx-0.5" /> icon. {' '}
              The "<strong>Heggles</strong>{recallCmdSuffix}" voice command triggers a 10s live audio recording for processing.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
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
                  disabled={isLoading || isCapturingAudioForSnippet || isCapturingAudioForLongRecording || !inputText.trim() || isDashboardDictationActive }
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
                The "<strong>Heggles</strong>{recallCmdSuffix}" voice command triggers a 10s live audio recording & transcription, then processes.
                Other "<strong>Heggles</strong>" commands (e.g., "<strong>Heggles</strong> {addShopCmdSuffix} [item]...", "<strong>Heggles</strong> {deleteItemSuffix} [item]...") populate the input area for manual submission with the <Brain className="inline-block h-3 w-3 mx-0.5" /> button.
                The <Mic className="inline-block h-3 w-3 mx-0.5 text-primary" /> icon button (dictate) transcribes speech directly into this area (stops on pause or "<strong>Heggles</strong> end/stop"), then automatically processes.
                The <PlayCircle className="inline-block h-3 w-3 mx-0.5 text-green-500" />/<StopCircle className="inline-block h-3 w-3 mx-0.5 text-red-500" /> button (header) is for continuous recording; its transcript populates here when stopped, then use <Brain className="inline-block h-3 w-3 mx-0.5" /> to process.
              </p>
            </div>
          </CardContent>
        </Card>

        {alertDialogConfig && (
          <AlertDialog open={isAlertDialogOpen} onOpenChange={(open) => {
            setIsAlertDialogOpen(open);
            if (!open) { 
              setIsLoading(false); 
              if (alertDialogConfig.listKey) setInputText(''); // Clear input only if it was a list action
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
                <AlertDialogCancel onClick={() => { setInputText(inputText); }}>Cancel</AlertDialogCancel>
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
