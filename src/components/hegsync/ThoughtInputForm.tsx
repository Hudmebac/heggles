
"use client";

import React, { useState, useEffect, useRef, FormEvent, useImperativeHandle, forwardRef } from 'react';
import { Brain, Loader2, Mic, MicOff, AlertTriangleIcon, Radio, PlayCircle, StopCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { processTextThought, processRecordedAudio } from '@/lib/actions';
import type { Thought, ShoppingListItem, ToDoListItem } from '@/lib/types';
import {
  WAKE_WORDS,
  LOCALSTORAGE_KEYS,
  BUFFER_TIME_OPTIONS,
  type BufferTimeValue,
  DEFAULT_BUFFER_TIME,
  RECORDING_DURATION_MS,
} from '@/lib/constants';

interface ThoughtInputFormProps {
  onThoughtRecalled: (thought: Thought) => void;
  isListening: boolean; // Main passive listening toggle from dashboard
  onToggleListeningParent: (isListening: boolean) => void;
  isExternallyLongRecording: boolean; // Is continuous recording active from dashboard
}

export interface ThoughtInputFormHandle {
  simulateWakeWordAndListen: () => void;
  startLongRecording: () => boolean;
  stopLongRecordingAndProcess: () => void;
}

export const ThoughtInputForm = forwardRef<ThoughtInputFormHandle, ThoughtInputFormProps>(
  ({ onThoughtRecalled, isListening, onToggleListeningParent, isExternallyLongRecording }, ref) => {
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  // Main command listener (HegSync wake word etc.)
  const [hasMicPermission, setHasMicPermission] = useState<boolean | null>(null);
  const [isRecognizingSpeech, setIsRecognizingSpeech] = useState(false); // For wake word listener
  const [isBrowserUnsupported, setIsBrowserUnsupported] = useState(false);
  const [partialWakeWordDetected, setPartialWakeWordDetected] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const utteranceTranscriptRef = useRef<string>('');
  const commandProcessedSuccessfullyRef = useRef<boolean>(false);


  // Dashboard manual dictation (for the text area)
  const [isDashboardDictationActive, setIsDashboardDictationActive] = useState(false);
  const dashboardDictationRecognitionRef = useRef<SpeechRecognition | null>(null);
  const dashboardDictationPauseTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Continuous "Long" Recording refs
  const longRecordingMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const longRecordingSpeechRecognizerRef = useRef<SpeechRecognition | null>(null);
  const longRecordingTranscriptRef = useRef<string>('');
  const longRecordingAudioChunksRef = useRef<Blob[]>([]);
  const [isActivelyLongRecording, setIsActivelyLongRecording] = useState(false); // Internal state for this component


  useImperativeHandle(ref, () => ({
    simulateWakeWordAndListen: () => {
      if (!isListening || hasMicPermission !== true || isLoading || isDashboardDictationActive || isActivelyLongRecording || isExternallyLongRecording) {
        toast({ title: "Listener Not Ready", description: "Ensure passive listening is on and the system is not busy.", variant: "default" });
        return;
      }
      
      utteranceTranscriptRef.current = WAKE_WORDS.HEGSYNC_BASE.toLowerCase() + " ";
      setPartialWakeWordDetected(true);
      commandProcessedSuccessfullyRef.current = false; // Expecting a command

      toast({ title: "HegSync Activated", description: "Listening for your command...", duration: 3000 });
      
      // Stop and restart recognition to ensure it picks up the pre-filled utterance
      if (recognitionRef.current && recognitionRef.current.stop) {
        try {
          recognitionRef.current.stop(); // onend will set it to null, effect will restart
        } catch (e) {
          console.warn("Error stopping existing recognition for simulation:", e);
          recognitionRef.current = null; // Force re-init if stop fails
        }
      }
       window.focus(); // Attempt to bring window to focus for better speech rec behavior
    },
    startLongRecording: () => {
      if (!isListening || hasMicPermission !== true || isLoading || isDashboardDictationActive || isRecognizingSpeech || isActivelyLongRecording || isExternallyLongRecording) {
        console.warn("Cannot start long recording, system busy or permissions missing.");
        toast({ title: "Cannot Start Recording", description: "System is busy, passive listening is off, or microphone permission is missing.", variant: "destructive"});
        return false;
      }
      // Stop other listeners
      commandProcessedSuccessfullyRef.current = true; // Prevent wake word listener from misinterpreting
      if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch(e) {/*ignore*/} }
      if (dashboardDictationRecognitionRef.current) { try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/} }
      setIsRecognizingSpeech(false);
      setPartialWakeWordDetected(false);
      setIsDashboardDictationActive(false);
      
      const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognitionAPI) {
        toast({ title: "Browser Not Supported", description: "Speech recognition for recording not supported.", variant: "destructive" });
        return false;
      }

      const startRecordingFlow = async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          setIsActivelyLongRecording(true); // Set internal state

          longRecordingAudioChunksRef.current = [];
          longRecordingTranscriptRef.current = '';

          // Initialize MediaRecorder for audio capture
          longRecordingMediaRecorderRef.current = new MediaRecorder(stream);
          longRecordingMediaRecorderRef.current.ondataavailable = (event) => {
            if (event.data.size > 0) {
              longRecordingAudioChunksRef.current.push(event.data);
            }
          };
          longRecordingMediaRecorderRef.current.start();

          // Initialize SpeechRecognition for live transcription during long recording
          longRecordingSpeechRecognizerRef.current = new SpeechRecognitionAPI();
          const recognizer = longRecordingSpeechRecognizerRef.current;
          recognizer.continuous = true;
          recognizer.interimResults = true; // Get interim results for potential live display
          recognizer.lang = 'en-US';
          
          recognizer.onresult = (event: SpeechRecognitionEvent) => {
            let finalTranscriptForThisResult = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
              if (event.results[i].isFinal) {
                finalTranscriptForThisResult += event.results[i][0].transcript + ' ';
              }
            }
            if (finalTranscriptForThisResult) {
              longRecordingTranscriptRef.current = (longRecordingTranscriptRef.current + finalTranscriptForThisResult).trim();
              // Optionally: display live transcript if a UI element is designated
            }
          };
          
          recognizer.onerror = (event: SpeechRecognitionErrorEvent) => {
            console.error("Long recording speech recognition error:", event.error, event.message);
            toast({ title: "Recording Transcription Error", description: event.message, variant: "destructive" });
            // Don't stop the MediaRecorder here, let it finish if possible
          };
          recognizer.start();
          return true; // Successfully started
        } catch (err) {
          console.error("Error starting long recording:", err);
          toast({ title: "Recording Error", description: `Could not start recording: ${(err as Error).message}`, variant: "destructive" });
          setIsActivelyLongRecording(false); // Reset internal state
          return false; // Failed to start
        }
      };
      return startRecordingFlow();
    },
    stopLongRecordingAndProcess: () => {
      if (!isActivelyLongRecording && !isExternallyLongRecording) { // Check both internal and external flags
        console.warn("Stop long recording called but not actively recording.");
        return;
      }
    
      setIsLoading(true); // Indicate global loading for processing
    
      // Stop speech recognizer first
      if (longRecordingSpeechRecognizerRef.current) {
        try { 
          longRecordingSpeechRecognizerRef.current.stop(); 
        } catch(e) {
          console.warn("Error stopping long recording speech recognizer:", e);
        }
        longRecordingSpeechRecognizerRef.current = null;
      }
    
      // Then stop media recorder
      if (longRecordingMediaRecorderRef.current && longRecordingMediaRecorderRef.current.state === "recording") {
        longRecordingMediaRecorderRef.current.onstop = async () => {
          const audioBlob = new Blob(longRecordingAudioChunksRef.current, { type: 'audio/webm' }); // Or appropriate MIME type
          longRecordingAudioChunksRef.current = [];
          
          const reader = new FileReader();
          reader.readAsDataURL(audioBlob);
          reader.onloadend = async () => {
            const base64AudioData = reader.result as string;
            const transcriptToProcess = longRecordingTranscriptRef.current.trim() || "[No speech transcribed during recording]";
            longRecordingTranscriptRef.current = '';
    
            try {
              const processedData = await processRecordedAudio(base64AudioData, transcriptToProcess);
              const newThought: Thought = {
                id: crypto.randomUUID(),
                timestamp: Date.now(),
                ...processedData,
              };
              onThoughtRecalled(newThought);
              toast({ title: "Recorded Thought Processed", description: "AI processing complete." });
            } catch (error) {
              toast({ title: "Error Processing Recorded Thought", description: (error as Error).message, variant: "destructive" });
            } finally {
              setIsLoading(false);
              setIsActivelyLongRecording(false); // Reset internal state
              // Release MediaRecorder stream tracks AFTER processing.
              if (longRecordingMediaRecorderRef.current?.stream) {
                longRecordingMediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
              }
              longRecordingMediaRecorderRef.current = null;
            }
          };
        };
        try { 
          longRecordingMediaRecorderRef.current.stop(); 
        } catch(e) {
          console.warn("Error stopping long recording media recorder:", e);
           // If stop fails, manually trigger cleanup and processing if possible
           setIsLoading(false);
           setIsActivelyLongRecording(false);
           if (longRecordingMediaRecorderRef.current?.stream) {
             longRecordingMediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
           }
           longRecordingMediaRecorderRef.current = null;
        }
      } else {
         // If media recorder wasn't active or already stopped, or stop failed but we have transcript
         const transcriptToProcess = longRecordingTranscriptRef.current.trim() || "[No speech transcribed, media recorder not active/stopped early]";
         longRecordingTranscriptRef.current = '';
         console.warn("MediaRecorder was not active or failed to stop, processing with transcript only:", transcriptToProcess);
         processTextThought(transcriptToProcess).then(processedData => { 
            const newThought: Thought = {id: crypto.randomUUID(), timestamp: Date.now(), ...processedData };
            onThoughtRecalled(newThought);
            toast({ title: "Thought Processed (from transcript)", description: "AI processing complete." });
         }).catch(error => {
            toast({ title: "Error Processing Transcript", description: (error as Error).message, variant: "destructive" });
         }).finally(() => {
            setIsLoading(false);
            setIsActivelyLongRecording(false); // Reset internal state
         });
      }
    },
  }));

  // Effect to stop long recording if main passive listening is toggled off
  useEffect(() => {
    if (!isListening && (isActivelyLongRecording || isExternallyLongRecording)) {
      if (ref && 'current' in ref && ref.current) {
        toast({ title: "Recording Stopped", description: "Passive listening was disabled."});
        ref.current.stopLongRecordingAndProcess();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListening, isActivelyLongRecording, isExternallyLongRecording]); // ref is stable

  const handleProcessTextThoughtSubmit = async (textToProcess: string) => {
    if (!textToProcess.trim()) {
      toast({ title: "Input empty", description: "Cannot process an empty thought.", variant: "destructive" });
      return;
    }
    setIsLoading(true);
    try {
      const processedData = await processTextThought(textToProcess);
      const newThought: Thought = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        ...processedData,
      };
      onThoughtRecalled(newThought);
      setInputText('');
      toast({ title: "Text Thought Processed", description: "AI processing complete." });
    } catch (error) {
      toast({ title: "Error Processing Text Thought", description: (error as Error).message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const addShoppingListItem = (itemText: string) => {
    if (!itemText.trim()) {
      toast({ title: "No item specified", description: <>Please say the item to add after '<strong>HegSync</strong>{WAKE_WORDS.ADD_TO_SHOPPING_LIST.substring(WAKE_WORDS.HEGSYNC_BASE.length)}'.</>, variant: "default" });
      return;
    }
    try {
      const currentItemsString = localStorage.getItem(LOCALSTORAGE_KEYS.SHOPPING_LIST);
      const currentItems: ShoppingListItem[] = currentItemsString ? JSON.parse(currentItemsString) : [];
      const newItem: ShoppingListItem = {
        id: crypto.randomUUID(),
        text: itemText.trim(),
        completed: false,
      };
      const updatedItems = [...currentItems, newItem];
      localStorage.setItem(LOCALSTORAGE_KEYS.SHOPPING_LIST, JSON.stringify(updatedItems));
      window.dispatchEvent(new StorageEvent('storage', { key: LOCALSTORAGE_KEYS.SHOPPING_LIST, newValue: JSON.stringify(updatedItems) }));
      toast({ title: "Item Added to Shopping List", description: `"${itemText.trim()}" added.` });
    } catch (error) {
      console.error("Error adding to shopping list:", error);
      toast({ title: "Error updating Shopping List", description: "Could not save the item.", variant: "destructive" });
    }
  };

  const parseSpokenBufferTime = (spokenDuration: string): BufferTimeValue | null => {
    const cleanedSpoken = spokenDuration.toLowerCase().trim();
    if (cleanedSpoken.includes('always on') || cleanedSpoken.includes('continuous')) {
      return 'continuous';
    }
    for (const option of BUFFER_TIME_OPTIONS) {
      if (option.value !== 'continuous') {
        // Check for "X minute(s)" pattern
        const match = cleanedSpoken.match(new RegExp(`^${option.value}\\s*(minute|min)s?$`));
        if (match) return option.value;
        // Check for just "X" if it's a value and not a label part
         if (cleanedSpoken === option.value) return option.value;
      }
    }
    return null;
  };

  const setBufferTimeByVoice = (spokenDuration: string) => {
    const parsedValue = parseSpokenBufferTime(spokenDuration);
    if (parsedValue) {
      localStorage.setItem(LOCALSTORAGE_KEYS.BUFFER_TIME, JSON.stringify(parsedValue));
      window.dispatchEvent(new StorageEvent('storage', { key: LOCALSTORAGE_KEYS.BUFFER_TIME, newValue: JSON.stringify(parsedValue) }));
      const matchedOption = BUFFER_TIME_OPTIONS.find(opt => opt.value === parsedValue);
      toast({ title: "Buffer Time Set", description: <>Conceptual buffer time set to <strong>{matchedOption?.label || parsedValue}</strong>.</> });
    } else {
      const currentBufferTime = localStorage.getItem(LOCALSTORAGE_KEYS.BUFFER_TIME);
      const defaultOption = BUFFER_TIME_OPTIONS.find(opt => opt.value === (currentBufferTime ? JSON.parse(currentBufferTime) : DEFAULT_BUFFER_TIME));
      toast({ title: "Buffer Time Not Understood", description: <>Could not parse "<q>{spokenDuration}</q>". Please try e.g., "<q>1 minute</q>", "<q>always on</q>". Current is <strong>{defaultOption?.label}</strong>.</>, variant: "default" });
    }
  };

  const deleteListItem = (
    listKey: string,
    identifier: string | number,
    listName: string,
    itemType: 'item' | 'task'
  ) => {
    try {
      const currentItemsString = localStorage.getItem(listKey);
      let currentItems: Array<ShoppingListItem | ToDoListItem> = currentItemsString ? JSON.parse(currentItemsString) : [];
      let itemDeleted = false;
      let deletedItemText = "";

      if (typeof identifier === 'string') {
        const originalLength = currentItems.length;
        const searchName = identifier.trim().toLowerCase();
        const itemFound = currentItems.find(item => item.text.toLowerCase() === searchName);
        if (itemFound) {
          deletedItemText = itemFound.text;
          currentItems = currentItems.filter(item => item.text.toLowerCase() !== searchName);
          itemDeleted = currentItems.length < originalLength;
        }
      } else { // identifier is a number
        const indexToDelete = identifier - 1; // 1-based to 0-based
        if (indexToDelete >= 0 && indexToDelete < currentItems.length) {
          deletedItemText = currentItems[indexToDelete].text;
          currentItems.splice(indexToDelete, 1);
          itemDeleted = true;
        }
      }

      if (itemDeleted) {
        localStorage.setItem(listKey, JSON.stringify(currentItems));
        // Manually dispatch storage event for other tabs/components using the same localStorage key
        window.dispatchEvent(new StorageEvent('storage', { key: listKey, newValue: JSON.stringify(currentItems) }));
        const description = typeof identifier === 'string'
          ? `"${deletedItemText}" deleted from your ${listName}.`
          : `${itemType.charAt(0).toUpperCase() + itemType.slice(1)} #${identifier} ("${deletedItemText}") deleted from your ${listName}.`;
        toast({ title: `${itemType.charAt(0).toUpperCase() + itemType.slice(1)} Deleted`, description });
      } else {
        const description = typeof identifier === 'string'
          ? `"${identifier}" not found in your ${listName}.`
          : `Invalid ${itemType} number #${identifier} for your ${listName}.`;
        toast({ title: "Deletion Failed", description, variant: "destructive" });
      }
    } catch (error) {
      console.error(`Error deleting from ${listName}:`, error);
      toast({ title: `Error updating ${listName}`, description: "Could not modify the list.", variant: "destructive" });
    }
  };

  // Main useEffect for "HegSync" wake word and command recognition
  useEffect(() => {
    const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      setIsBrowserUnsupported(true);
      setHasMicPermission(false);
      return;
    }
    setIsBrowserUnsupported(false);

    if (!isListening || hasMicPermission === false || isLoading || isDashboardDictationActive || isActivelyLongRecording || isExternallyLongRecording) {
      if (recognitionRef.current) {
        commandProcessedSuccessfullyRef.current = true; 
        try { recognitionRef.current.stop(); } catch (e) { console.warn("Error stopping main command recognition (external stop):", e); }
      }
      return;
    }

    if (hasMicPermission === true && recognitionRef.current === null) {
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
        // Only clear transcript and partial detection if a command was fully processed OR if no partial wake word was ever detected.
        // This allows preserving "HegSync " if recognition stops due to a pause before command completion.
        if (commandProcessedSuccessfullyRef.current || !partialWakeWordDetected) {
            setPartialWakeWordDetected(false);
            utteranceTranscriptRef.current = '';
        }
        recognitionRef.current = null; // Ensure it's re-initialized by this effect if needed
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
         if (event.error === 'no-speech' || event.error === 'aborted') {
          console.warn('Main command recognition warning:', event.error, event.message || "(No specific message)");
        } else {
          console.error('Main command recognition error:', event.error, event.message || "(No specific message)");
        }
        commandProcessedSuccessfullyRef.current = true; // Treat errors as end of command attempt

        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          setHasMicPermission(false);
          toast({ title: "Microphone Access Issue", description: "Speech recognition service denied. Check browser settings or permissions.", variant: "destructive" });
        } else if (event.error === 'network') {
          toast({ title: "Network Error", description: "Speech recognition might require a network connection.", variant: "destructive"});
        }
        // `onend` will be called after `onerror`, so it will handle setting recognitionRef.current to null.
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interimTranscriptThisTurn = '';
        let finalizedSegmentThisTurn = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const segment = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalizedSegmentThisTurn += (finalizedSegmentThisTurn ? " " : "") + segment.trim();
          } else {
            interimTranscriptThisTurn += segment;
          }
        }

        // Append only newly finalized segments to the persistent utterance transcript
        if (finalizedSegmentThisTurn) {
            utteranceTranscriptRef.current = (utteranceTranscriptRef.current.trim() + " " + finalizedSegmentThisTurn).trim();
        }
        
        const latestInterimForPartialCheck = interimTranscriptThisTurn.trim().toLowerCase();
        // Set partialWakeWordDetected based on the newest interim part
        if (!partialWakeWordDetected && latestInterimForPartialCheck.includes(WAKE_WORDS.HEGSYNC_BASE.toLowerCase())) {
          setPartialWakeWordDetected(true);
        } else if (partialWakeWordDetected && !utteranceTranscriptRef.current.toLowerCase().startsWith(WAKE_WORDS.HEGSYNC_BASE.toLowerCase()) && !latestInterimForPartialCheck.includes(WAKE_WORDS.HEGSYNC_BASE.toLowerCase())) {
          // If "hegsync" was detected but then the utterance changed and no longer starts with it (e.g. misrecognition)
          setPartialWakeWordDetected(false); 
        }
        
        const lastResultIsFinal = event.results[event.results.length - 1].isFinal;

        if (lastResultIsFinal && utteranceTranscriptRef.current) {
          const finalUtterance = utteranceTranscriptRef.current.toLowerCase().trim();
          let commandMatchedThisTurn = false;

          if (finalUtterance === WAKE_WORDS.RECALL_THOUGHT.toLowerCase()) {
            const bufferTimeValueString = localStorage.getItem(LOCALSTORAGE_KEYS.BUFFER_TIME);
            let bufferTimeValue: BufferTimeValue = DEFAULT_BUFFER_TIME;
            if (bufferTimeValueString) {
                try {
                    const parsed = JSON.parse(bufferTimeValueString) as BufferTimeValue;
                    if (BUFFER_TIME_OPTIONS.some(opt => opt.value === parsed)) {
                        bufferTimeValue = parsed;
                    }
                } catch (e) { console.error("Error parsing buffer time from LS:", e); }
            }
            const bufferOption = BUFFER_TIME_OPTIONS.find(opt => opt.value === bufferTimeValue);
            const simulatedText = `Simulated recall from the ${bufferOption?.label || bufferTimeValue} buffer.`;
            toast({ title: <><strong>HegSync</strong> Recall Command Detected!</>, description: `Processing simulated thought from ${bufferOption?.label || bufferTimeValue} buffer.` });
            handleProcessTextThoughtSubmit(simulatedText);
            commandMatchedThisTurn = true;
          } else if (finalUtterance.startsWith(WAKE_WORDS.ADD_TO_SHOPPING_LIST.toLowerCase())) {
            const itemToAdd = utteranceTranscriptRef.current.substring(WAKE_WORDS.ADD_TO_SHOPPING_LIST.length).trim();
            addShoppingListItem(itemToAdd);
            commandMatchedThisTurn = true;
          } else if (finalUtterance.startsWith(WAKE_WORDS.DELETE_ITEM_PREFIX.toLowerCase())) {
            const commandArgs = utteranceTranscriptRef.current.substring(WAKE_WORDS.DELETE_ITEM_PREFIX.length).trim();
            let listType: 'shopping' | 'todo' | null = null;
            let itemIdentifierString = "";

            if (commandArgs.toLowerCase().includes(WAKE_WORDS.FROM_SHOPPING_LIST_TRIGGER.toLowerCase())) {
              listType = 'shopping';
              itemIdentifierString = commandArgs.substring(0, commandArgs.toLowerCase().indexOf(WAKE_WORDS.FROM_SHOPPING_LIST_TRIGGER.toLowerCase())).trim();
            } else if (commandArgs.toLowerCase().includes(WAKE_WORDS.FROM_TODO_LIST_TRIGGER.toLowerCase())) {
              listType = 'todo';
              itemIdentifierString = commandArgs.substring(0, commandArgs.toLowerCase().indexOf(WAKE_WORDS.FROM_TODO_LIST_TRIGGER.toLowerCase())).trim();
            }

            if (listType && itemIdentifierString) {
              const listKey = listType === 'shopping' ? LOCALSTORAGE_KEYS.SHOPPING_LIST : LOCALSTORAGE_KEYS.TODO_LIST;
              const listName = listType === 'shopping' ? "Shopping List" : "To-Do List";
              const itemTypeName = listType === 'shopping' ? "item" : "task";

              // Check if deletion is by number
              if (itemIdentifierString.toLowerCase().startsWith(WAKE_WORDS.ITEM_NUMBER_KEYWORD.toLowerCase())) {
                const numberStr = itemIdentifierString.substring(WAKE_WORDS.ITEM_NUMBER_KEYWORD.length).trim();
                const itemNumber = parseInt(numberStr, 10);
                if (!isNaN(itemNumber) && itemNumber > 0) {
                  deleteListItem(listKey, itemNumber, listName, itemTypeName);
                } else {
                  toast({ title: "Invalid Item Number", description: `Please say a valid number for the ${itemTypeName}.`, variant: "destructive" });
                }
              } else { // Deletion by name
                deleteListItem(listKey, itemIdentifierString, listName, itemTypeName);
              }
            } else {
               toast({ title: "Deletion Command Unclear", description: <>Please specify the item/task and list clearly. E.g., <q><strong>HegSync</strong> delete apples from my shopping list</q> or <q><strong>HegSync</strong> delete item number 1 from my to do list</q>.</>, variant: "default" });
            }
            commandMatchedThisTurn = true;
          } else if (finalUtterance.startsWith(WAKE_WORDS.SET_BUFFER_TIME.toLowerCase())) {
            const spokenDuration = utteranceTranscriptRef.current.substring(WAKE_WORDS.SET_BUFFER_TIME.length).trim();
            setBufferTimeByVoice(spokenDuration);
            commandMatchedThisTurn = true;
          } else if (finalUtterance === WAKE_WORDS.TURN_LISTENING_OFF.toLowerCase()) {
            onToggleListeningParent(false); // This will cause this useEffect to re-run and stop recognition
            commandMatchedThisTurn = true;
          } else if (finalUtterance === WAKE_WORDS.TURN_LISTENING_ON.toLowerCase()) {
            onToggleListeningParent(true); // This will cause this useEffect to re-run and start recognition
            commandMatchedThisTurn = true;
          }


          if (commandMatchedThisTurn) {
            commandProcessedSuccessfullyRef.current = true; // Signal that the command was handled
            if (recognitionRef.current && recognitionRef.current.stop) {
              try { recognitionRef.current.stop(); } catch(e) { console.warn("Error stopping recognition after full command:", e); }
            }
          } else if (finalUtterance.startsWith(WAKE_WORDS.HEGSYNC_BASE.toLowerCase())) {
            // Starts with "hegsync" but isn't a known full command and isn't just "hegsync"
            if (finalUtterance !== WAKE_WORDS.HEGSYNC_BASE.toLowerCase()) {
              toast({ title: "Command Not Recognized", description: <>Did not understand: "<q>{utteranceTranscriptRef.current}</q>". Populating input area.</>, variant: "default" });
              setInputText(utteranceTranscriptRef.current); // Populate input area with the full failed command
              commandProcessedSuccessfullyRef.current = true; // Signal that this attempt is over
              if (recognitionRef.current && recognitionRef.current.stop) {
                try { recognitionRef.current.stop(); } catch(e) { console.warn("Error stopping recognition for unrecognized HegSync command:", e); }
              }
            }
            // If it IS just "hegsync", do nothing here; continuous listening will keep going,
            // and commandProcessedSuccessfullyRef.current remains false, so onend won't clear the transcript.
          }
        }
      };

      try {
        // Double check conditions before starting, as state might have changed
        if (isListening && hasMicPermission === true && !isLoading && !isDashboardDictationActive && !isActivelyLongRecording && !isExternallyLongRecording && recognitionRef.current && recognitionRef.current.onstart === recognition.onstart ) {
           recognition.start();
        }
      } catch (e) {
        console.error("Failed to start main command speech recognition:", e);
        if (recognitionRef.current) { recognitionRef.current = null; } // Nullify on error to allow re-init
      }
    } else if (hasMicPermission === null && !isBrowserUnsupported) {
        // Request permission if it's currently 'null' (prompt)
        navigator.mediaDevices.getUserMedia({ audio: true })
        .then(() => setHasMicPermission(true))
        .catch(err => {
          console.error("Microphone permission error:", err);
          setHasMicPermission(false);
          toast({ title: "Microphone Access Issue", description: `Could not access microphone: ${err.message}. Voice commands require microphone access. Please enable it in your browser settings.`, variant: "destructive" });
        });
    }

    // Cleanup function
    return () => {
      if (recognitionRef.current) {
        // Detach all event handlers to prevent memory leaks or calls on unmounted component
        recognitionRef.current.onstart = null; recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null; recognitionRef.current.onresult = null;
        commandProcessedSuccessfullyRef.current = true; // Ensure any pending state is considered "processed"
        try { recognitionRef.current.stop(); } catch(e) { console.warn("Error stopping main command recognition in cleanup:", e); }
        recognitionRef.current = null;
      }
      if (longRecordingSpeechRecognizerRef.current) {
        try { longRecordingSpeechRecognizerRef.current.stop(); } catch(e) {/*ignore*/}
        longRecordingSpeechRecognizerRef.current = null;
      }
      if (longRecordingMediaRecorderRef.current && longRecordingMediaRecorderRef.current.state === "recording") {
        try { longRecordingMediaRecorderRef.current.stop(); } catch(e) {/*ignore*/}
        if (longRecordingMediaRecorderRef.current?.stream) {
          longRecordingMediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
        }
        longRecordingMediaRecorderRef.current = null;
      }
       if (dashboardDictationRecognitionRef.current) {
        try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
        dashboardDictationRecognitionRef.current = null;
      }
      if (dashboardDictationPauseTimeoutRef.current) {
        clearTimeout(dashboardDictationPauseTimeoutRef.current);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListening, hasMicPermission, isLoading, isDashboardDictationActive, isActivelyLongRecording, isExternallyLongRecording, onToggleListeningParent]); // Dependencies carefully chosen


  // --- Dashboard Manual Dictation Logic (for Textarea) ---
  const handleDashboardMicClick = async () => {
    const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      toast({ title: "Browser Not Supported", description: "Speech recognition not supported by your browser.", variant: "destructive"});
      return;
    }
    if (isExternallyLongRecording || isActivelyLongRecording) {
      toast({ title: "Action unavailable", description: "Stop continuous recording first.", variant: "default"});
      return;
    }
    if (hasMicPermission === false) {
      toast({ title: "Microphone Access Denied", description: "Please enable microphone access for dictation.", variant: "destructive"});
      return;
    }
    if (hasMicPermission === null) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop()); // Release the stream immediately
        setHasMicPermission(true);
      } catch (err) {
        setHasMicPermission(false);
        toast({ title: "Microphone Access Denied", description: "Could not get microphone permission.", variant: "destructive"});
        return;
      }
    }

    if (isDashboardDictationActive) {
      if (dashboardDictationRecognitionRef.current && dashboardDictationRecognitionRef.current.stop) {
        try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
        // onend will handle processing
      }
      if (dashboardDictationPauseTimeoutRef.current) {
        clearTimeout(dashboardDictationPauseTimeoutRef.current);
      }
      return;
    }

    // Stop other listeners
    commandProcessedSuccessfullyRef.current = true; // Prevent wake word listener actions
    if (recognitionRef.current && recognitionRef.current.stop) {
        try { recognitionRef.current.stop(); } catch(e) { console.warn("Error stopping main recognition for dashboard dictation", e) }
    }
    // No need to stop long recording here as it's handled by the isExternallyLongRecording check above

    setInputText(''); // Clear text area for new dictation
    setIsDashboardDictationActive(true);

    dashboardDictationRecognitionRef.current = new SpeechRecognitionAPI();
    const recognition = dashboardDictationRecognitionRef.current;
    recognition.continuous = true; // Listen continuously for dictation
    recognition.interimResults = true; // Show text as it's being dictated
    recognition.lang = 'en-US';

    let currentDictationTranscript = ""; // Accumulates final parts of dictation

    recognition.onstart = () => { /* setIsDashboardDictationActive(true) is already set */ };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      if (dashboardDictationPauseTimeoutRef.current) {
        clearTimeout(dashboardDictationPauseTimeoutRef.current);
      }
      let interim = "";
      let finalSinceLastResult = "";
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalSinceLastResult += event.results[i][0].transcript + " ";
        } else {
          interim += event.results[i][0].transcript;
        }
      }

      currentDictationTranscript = (currentDictationTranscript + finalSinceLastResult).trim();
      // Display combined final and current interim for live feedback
      setInputText(currentDictationTranscript + (interim ? (currentDictationTranscript ? " " : "") + interim : ""));

      // Check for end commands
      const lowerTranscriptForEndCheck = (currentDictationTranscript + " " + interim).trim().toLowerCase();
      const endCommand = WAKE_WORDS.END_DICTATION.toLowerCase();
      const stopCommand = WAKE_WORDS.STOP_DICTATION.toLowerCase();

      if (lowerTranscriptForEndCheck.endsWith(endCommand) || lowerTranscriptForEndCheck.endsWith(stopCommand)) {
        let finalSpokenText = currentDictationTranscript; // Use accumulated final parts
         if (lowerTranscriptForEndCheck.endsWith(endCommand)) {
          // Remove "hegsync end" from the final accumulated string
          const endCommandIndex = finalSpokenText.toLowerCase().lastIndexOf(endCommand);
          if (endCommandIndex !== -1) finalSpokenText = finalSpokenText.substring(0, endCommandIndex).trim();
        } else if (lowerTranscriptForEndCheck.endsWith(stopCommand)) {
           const stopCommandIndex = finalSpokenText.toLowerCase().lastIndexOf(stopCommand);
           if (stopCommandIndex !== -1) finalSpokenText = finalSpokenText.substring(0, stopCommandIndex).trim();
        }

        setInputText(finalSpokenText); // Update textarea with cleaned final text
        if (dashboardDictationRecognitionRef.current && dashboardDictationRecognitionRef.current.stop) {
          try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
          // onend will trigger processing
        }
      } else {
        // Reset pause timeout if speech continues
        dashboardDictationPauseTimeoutRef.current = setTimeout(() => {
          if (dashboardDictationRecognitionRef.current && dashboardDictationRecognitionRef.current.stop) {
             try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
             // onend will trigger processing
          }
        }, 2000); // 2-second pause
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error('Dashboard dictation error:', event.error, event.message);
      if (dashboardDictationPauseTimeoutRef.current) {
        clearTimeout(dashboardDictationPauseTimeoutRef.current);
      }
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setHasMicPermission(false); // Re-check permission
        toast({ title: "Microphone Access Denied", variant: "destructive" });
      } else if (event.error === 'no-speech') {
        // If no speech was ever detected, we might not want to process.
        // If some speech was there and then a pause, onend will handle it.
        if (!inputText.trim()) { // Check if inputText (which reflects dictation) is empty
          toast({ title: "No speech detected for dictation", variant: "default" });
        }
      } else {
        toast({ title: "Dictation Error", description: event.message || "Could not recognize speech.", variant: "destructive" });
      }
      setIsDashboardDictationActive(false);
      dashboardDictationRecognitionRef.current = null;
    };

    recognition.onend = () => {
      if (dashboardDictationPauseTimeoutRef.current) {
        clearTimeout(dashboardDictationPauseTimeoutRef.current);
      }
      setIsDashboardDictationActive(false);
      const textToProcess = inputText.trim(); // inputText has been updated by onresult
      if (textToProcess) {
        handleProcessTextThoughtSubmit(textToProcess); 
        // setInputText(''); // Cleared after successful submission by handleProcessTextThoughtSubmit
      } else {
        // If dictation ended with no text (e.g., immediate error or no speech)
        setInputText(''); // Ensure it's clear
      }
      dashboardDictationRecognitionRef.current = null; // Allow re-initialization
    };

    recognition.start();
  };


  const getMicIconForCardHeader = () => {
    if (isActivelyLongRecording || isExternallyLongRecording) return <Radio className="h-5 w-5 text-red-500 animate-pulse" />
    if (isDashboardDictationActive) return <Radio className="h-5 w-5 text-red-500 animate-pulse" />;
    if (partialWakeWordDetected) return <Mic className="h-5 w-5 text-yellow-500 animate-pulse" />;
    if (isRecognizingSpeech) return <Mic className="h-5 w-5 text-primary animate-pulse" />;
    if (isListening && hasMicPermission && !isBrowserUnsupported && !isLoading) {
      return <Mic className="h-5 w-5 text-primary" />;
    }
    return <MicOff className="h-5 w-5 text-muted-foreground" />;
  };

  const getMicStatusText = (): React.ReactNode => {
    if (isActivelyLongRecording || isExternallyLongRecording) return "Continuous recording active...";
    if (isDashboardDictationActive) return "Dictating to input area...";
    if (isLoading) return "Processing...";
    if (!isListening) return "Voice Inactive";
    if (isBrowserUnsupported) return "Voice N/A";
    if (hasMicPermission === false) return "Mic Denied";
    if (hasMicPermission === null) return "Mic Awaiting Permission...";
    if (partialWakeWordDetected) return <>'<strong>HegSync</strong>' detected, awaiting command...</>;
    // if (isRecognizingSpeech) return <>Say '<strong>HegSync</strong>' + command</>; // This can be brief, maybe just the one below is enough
    if (isListening && hasMicPermission && !isBrowserUnsupported) return <>Listener active for '<strong>HegSync</strong>'</>;
    return "Voice status checking...";
  };

  const getTextareaPlaceholder = (): string => {
    if (isActivelyLongRecording || isExternallyLongRecording) return "Continuous recording active. Speech will be processed when stopped.";
    if (isDashboardDictationActive) return "Listening... Say 'HegSync end' or 'HegSync stop' to finish dictation.";
    if (isLoading) return "Processing...";
    if (partialWakeWordDetected) return "'HegSync' detected. Finish your command, or type for manual input.";
    if (isRecognizingSpeech) return "Listener active for 'HegSync', or type for manual input."; // Or simply "Say 'HegSync' + command..."
    if (!isListening) return "Enable listening to activate voice commands or manual input.";
    if (isBrowserUnsupported) return "Voice commands not supported. Manual input available.";
    if (hasMicPermission === false) return "Microphone access denied. Manual input available.";
    if (hasMicPermission === null) return "Awaiting microphone permission...";
    return "Enter thought or use voice commands...";
  };

  const recallCmdSuffix = WAKE_WORDS.RECALL_THOUGHT.substring(WAKE_WORDS.HEGSYNC_BASE.length);
  const addShopCmdSuffix = WAKE_WORDS.ADD_TO_SHOPPING_LIST.substring(WAKE_WORDS.HEGSYNC_BASE.length);
  const setBufferCmdSuffix = WAKE_WORDS.SET_BUFFER_TIME.substring(WAKE_WORDS.HEGSYNC_BASE.length);
  const turnOnCmdSuffix = WAKE_WORDS.TURN_LISTENING_ON.substring(WAKE_WORDS.HEGSYNC_BASE.length);
  const turnOffCmdSuffix = WAKE_WORDS.TURN_LISTENING_OFF.substring(WAKE_WORDS.HEGSYNC_BASE.length);
  const deleteItemSuffix = WAKE_WORDS.DELETE_ITEM_PREFIX.substring(WAKE_WORDS.HEGSYNC_BASE.length);

  const getDashboardDictationButtonIcon = () => { 
    if (isDashboardDictationActive) return <Radio className="h-5 w-5 text-red-500 animate-pulse" />;
    if (!isListening || hasMicPermission !== true || isRecognizingSpeech || isActivelyLongRecording || isExternallyLongRecording) return <MicOff className="h-5 w-5 text-muted-foreground" />;
    return <Mic className="h-5 w-5 text-primary" />;
  };


  return (
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
          <>
            Voice: Say <q><strong>HegSync</strong>{recallCmdSuffix}</q> for simulated buffer recall.
            Other commands: <q><strong>HegSync</strong>{addShopCmdSuffix} [item]</q>, <q><strong>HegSync</strong>{setBufferCmdSuffix} [duration]</q>, <q><strong>HegSync</strong>{deleteItemSuffix} [args]</q>, <q><strong>HegSync</strong>{turnOnCmdSuffix}</q>, or <q><strong>HegSync</strong>{turnOffCmdSuffix}</q>.
            <br/>
            Manual: Use the <Brain className="inline-block h-3.5 w-3.5 mx-0.5"/> icon to process text from input area.
            Use the <Mic className="inline-block h-3.5 w-3.5 mx-0.5 text-red-500"/> icon (below input) for direct dictation into the input area (ends on pause or '<strong>HegSync</strong> end/stop').
          </>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isBrowserUnsupported && (
          <Alert variant="destructive" className="mb-4">
            <AlertTriangleIcon className="h-4 w-4" />
            <AlertTitle>Browser Not Supported</AlertTitle>
            <AlertDescription>
              Speech recognition for voice commands is not supported by your browser. Manual input is still available.
            </AlertDescription>
          </Alert>
        )}
        {isListening && hasMicPermission === false && !isBrowserUnsupported && (
          <Alert variant="destructive" className="mb-4">
            <AlertTriangleIcon className="h-4 w-4" />
            <AlertTitle>Microphone Access Denied</AlertTitle>
            <AlertDescription>
              Voice commands and audio recording require microphone access. Please enable it in your browser settings. Manual input for thoughts is still available.
            </AlertDescription>
          </Alert>
        )}

        <form onSubmit={(e) => {e.preventDefault(); if (inputText.trim()) handleProcessTextThoughtSubmit(inputText);}} className="space-y-4">
          <Textarea
            placeholder={getTextareaPlaceholder()}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            rows={4}
            disabled={!isListening || isLoading || isDashboardDictationActive || isActivelyLongRecording || isExternallyLongRecording}
            className="resize-none"
            aria-label="Recalled thought input area for manual processing or dictation"
          />
          <div className="flex items-stretch gap-2">
             <Button
              type="button" 
              onClick={() => handleProcessTextThoughtSubmit(inputText)}
              disabled={!isListening || isLoading || isDashboardDictationActive || isActivelyLongRecording || isExternallyLongRecording || !inputText.trim()}
              size="icon"
              className="p-2 h-auto"
              aria-label="Process thought from text area with AI"
              title="Process thought from text area with AI"
            >
              {isLoading && inputText.trim() && !isDashboardDictationActive && !(isActivelyLongRecording || isExternallyLongRecording) ? <Loader2 className="h-5 w-5 animate-spin" /> : <Brain className="h-5 w-5" />}
            </Button>
             <Button
              type="button"
              onClick={handleDashboardMicClick} 
              disabled={!isListening || isLoading || isActivelyLongRecording || isExternallyLongRecording || (isRecognizingSpeech && !isDashboardDictationActive && !partialWakeWordDetected) || hasMicPermission === false}
              size="icon"
              className="p-2 h-auto"
              aria-label="Dictate thought into text area (ends on pause or 'HegSync end/stop')"
              title="Dictate thought into text area (ends on pause or 'HegSync end/stop')"
            >
              {getDashboardDictationButtonIcon()}
            </Button>
          </div>
        </form>
         <p className="text-xs text-muted-foreground mt-2">
          The <q><strong>HegSync</strong>{recallCmdSuffix}</q> voice command processes a simulated thought from your buffer.
          The <Mic className="inline-block h-3 w-3 mx-0.5 text-red-500"/> icon button (dictate) transcribes speech directly into the text area for manual submission with the <Brain className="inline-block h-3 w-3 mx-0.5"/> button.
          The <PlayCircle className="inline-block h-3 w-3 mx-0.5 text-green-500"/> / <StopCircle className="inline-block h-3 w-3 mx-0.5 text-red-500"/> button (header) is for continuous recording.
        </p>
      </CardContent>
    </Card>
  );
});

ThoughtInputForm.displayName = "ThoughtInputForm";

