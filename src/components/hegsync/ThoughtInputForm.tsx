
"use client";

import React, { useState, useEffect, useRef, FormEvent, useImperativeHandle, forwardRef } from 'react';
import { Brain, Loader2, Mic, MicOff, AlertTriangleIcon, Radio } from 'lucide-react';
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
} from '@/lib/constants';

interface ThoughtInputFormProps {
  onThoughtRecalled: (thought: Thought) => void;
  isListening: boolean; // Main passive listening toggle from dashboard
  onToggleListeningParent: (isListening: boolean) => void;
  isExternallyLongRecording: boolean; // Is continuous recording active from dashboard
}

export interface ThoughtInputFormHandle {
  simulateWakeWordAndListen: () => void;
  startLongRecording: () => boolean; // Returns true if started, false if error
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
  const [isActivelyLongRecording, setIsActivelyLongRecording] = useState(false);


  useImperativeHandle(ref, () => ({
    simulateWakeWordAndListen: () => {
      if (!isListening || hasMicPermission !== true || isLoading || isDashboardDictationActive || isActivelyLongRecording) {
        toast({ title: "Listener Not Ready", description: "Ensure passive listening is on and the system is not busy.", variant: "default" });
        return;
      }
      
      utteranceTranscriptRef.current = WAKE_WORDS.HEGSYNC_BASE.toLowerCase() + " ";
      setPartialWakeWordDetected(true);
      commandProcessedSuccessfullyRef.current = false;

      toast({ title: "HegSync Activated", description: "Listening for your command...", duration: 3000 });
      
      if (recognitionRef.current && recognitionRef.current.stop) {
        try {
          recognitionRef.current.stop();
        } catch (e) {
          console.warn("Error stopping existing recognition for simulation:", e);
          recognitionRef.current = null; 
        }
      }
      window.focus(); 
    },
    startLongRecording: () => {
      if (!isListening || hasMicPermission !== true || isLoading || isDashboardDictationActive || isRecognizingSpeech || isActivelyLongRecording) {
        console.warn("Cannot start long recording, system busy or permissions missing.");
        return false;
      }
      // Stop other listeners
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
          setIsActivelyLongRecording(true);

          longRecordingAudioChunksRef.current = [];
          longRecordingTranscriptRef.current = '';

          longRecordingMediaRecorderRef.current = new MediaRecorder(stream);
          longRecordingMediaRecorderRef.current.ondataavailable = (event) => {
            longRecordingAudioChunksRef.current.push(event.data);
          };
          longRecordingMediaRecorderRef.current.start();

          longRecordingSpeechRecognizerRef.current = new SpeechRecognitionAPI();
          const recognizer = longRecordingSpeechRecognizerRef.current;
          recognizer.continuous = true;
          recognizer.interimResults = true;
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
            }
            // Optionally: display live transcript somewhere or just use final
          };
          recognizer.onerror = (event: SpeechRecognitionErrorEvent) => {
            console.error("Long recording speech recognition error:", event.error, event.message);
            toast({ title: "Recording Transcription Error", description: event.message, variant: "destructive" });
          };
          recognizer.start();

        } catch (err) {
          console.error("Error starting long recording:", err);
          toast({ title: "Recording Error", description: `Could not start recording: ${(err as Error).message}`, variant: "destructive" });
          setIsActivelyLongRecording(false);
          return false;
        }
      };
      startRecordingFlow();
      return true;
    },
    stopLongRecordingAndProcess: () => {
      if (!isActivelyLongRecording) return;

      toast({ title: "Recording Stopped", description: "Processing your thought..." });
      setIsLoading(true); // Indicate global loading

      if (longRecordingSpeechRecognizerRef.current) {
        try { longRecordingSpeechRecognizerRef.current.stop(); } catch(e) {/*ignore*/}
        longRecordingSpeechRecognizerRef.current = null;
      }
      if (longRecordingMediaRecorderRef.current && longRecordingMediaRecorderRef.current.state === "recording") {
        longRecordingMediaRecorderRef.current.onstop = async () => {
          const audioBlob = new Blob(longRecordingAudioChunksRef.current, { type: 'audio/webm' });
          longRecordingAudioChunksRef.current = [];
          
          const reader = new FileReader();
          reader.readAsDataURL(audioBlob);
          reader.onloadend = async () => {
            const base64AudioData = reader.result as string;
            const transcriptToProcess = longRecordingTranscriptRef.current.trim() || "[No speech transcribed during recording]";
            longRecordingTranscriptRef.current = ''; // Reset for next time

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
              setIsLoading(false); // Clear global loading
            }
          };
           stream.getTracks().forEach(track => track.stop()); // Release microphone from MediaRecorder stream
        };
        try { longRecordingMediaRecorderRef.current.stop(); } catch(e) {/*ignore*/}
        longRecordingMediaRecorderRef.current = null;
      } else {
         // If media recorder wasn't active or already stopped, process with whatever transcript we have
         const transcriptToProcess = longRecordingTranscriptRef.current.trim() || "[No speech transcribed, recorder not active]";
         longRecordingTranscriptRef.current = '';
         processTextThought(transcriptToProcess).then(processedData => { // Using processTextThought if no audio
            const newThought: Thought = {id: crypto.randomUUID(), timestamp: Date.now(), ...processedData };
            onThoughtRecalled(newThought);
            toast({ title: "Thought Processed (from transcript)", description: "AI processing complete." });
         }).catch(error => {
            toast({ title: "Error Processing Transcript", description: (error as Error).message, variant: "destructive" });
         }).finally(() => setIsLoading(false));
      }
      setIsActivelyLongRecording(false);
    },
  }));

  // Effect to stop long recording if main passive listening is toggled off
  useEffect(() => {
    if (!isListening && isActivelyLongRecording) {
      if (ref && 'current' in ref && ref.current) {
        ref.current.stopLongRecordingAndProcess();
      }
    }
  }, [isListening, isActivelyLongRecording, ref]);

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
        if (cleanedSpoken.startsWith(option.value) && (cleanedSpoken.includes('minute') || cleanedSpoken.includes('min'))) {
          return option.value;
        }
         if (cleanedSpoken === option.value) {
            return option.value;
        }
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
      } else {
        const indexToDelete = identifier - 1;
        if (indexToDelete >= 0 && indexToDelete < currentItems.length) {
          deletedItemText = currentItems[indexToDelete].text;
          currentItems.splice(indexToDelete, 1);
          itemDeleted = true;
        }
      }

      if (itemDeleted) {
        localStorage.setItem(listKey, JSON.stringify(currentItems));
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

    if (!isListening || hasMicPermission === false || isLoading || isDashboardDictationActive || isActivelyLongRecording) {
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
        if (commandProcessedSuccessfullyRef.current || !partialWakeWordDetected) {
            setPartialWakeWordDetected(false);
            utteranceTranscriptRef.current = '';
        }
        recognitionRef.current = null;
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
         if (event.error === 'no-speech' || event.error === 'aborted') {
          console.warn('Main command recognition warning:', event.error, event.message || "(No specific message)");
        } else {
          console.error('Main command recognition error:', event.error, event.message || "(No specific message)");
        }
        commandProcessedSuccessfullyRef.current = true;

        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          setHasMicPermission(false);
          toast({ title: "Microphone Access Issue", description: "Speech recognition service denied. Check browser settings or permissions.", variant: "destructive" });
        } else if (event.error === 'network') {
          toast({ title: "Network Error", description: "Speech recognition might require a network connection.", variant: "destructive"});
        }
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

        if (finalizedSegmentThisTurn) {
            utteranceTranscriptRef.current = (utteranceTranscriptRef.current.trim() + " " + finalizedSegmentThisTurn).trim();
        }
        
        const latestInterimForPartialCheck = interimTranscriptThisTurn.trim().toLowerCase();
        if (!partialWakeWordDetected && latestInterimForPartialCheck.includes(WAKE_WORDS.HEGSYNC_BASE.toLowerCase())) {
          setPartialWakeWordDetected(true);
        } else if (partialWakeWordDetected && !utteranceTranscriptRef.current.toLowerCase().includes(WAKE_WORDS.HEGSYNC_BASE.toLowerCase()) && !latestInterimForPartialCheck.includes(WAKE_WORDS.HEGSYNC_BASE.toLowerCase())) {
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
            const simulatedText = `Simulated recall from the ${bufferOption?.label || bufferTimeValue} buffer. Content based on recent conceptual audio.`;
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

              if (itemIdentifierString.toLowerCase().startsWith(WAKE_WORDS.ITEM_NUMBER_KEYWORD.toLowerCase())) {
                const numberStr = itemIdentifierString.substring(WAKE_WORDS.ITEM_NUMBER_KEYWORD.length).trim();
                const itemNumber = parseInt(numberStr, 10);
                if (!isNaN(itemNumber) && itemNumber > 0) {
                  deleteListItem(listKey, itemNumber, listName, itemTypeName);
                } else {
                  toast({ title: "Invalid Item Number", description: `Please say a valid number for the ${itemTypeName}.`, variant: "destructive" });
                }
              } else {
                deleteListItem(listKey, itemIdentifierString, listName, itemTypeName);
              }
            } else {
               toast({ title: "Deletion Command Unclear", description: <>Please specify the item and list clearly. E.g., <q><strong>HegSync</strong> delete apples from my shopping list</q> or <q><strong>HegSync</strong> delete item number 1 from my to do list</q>.</>, variant: "default" });
            }
            commandMatchedThisTurn = true;
          } else if (finalUtterance.startsWith(WAKE_WORDS.SET_BUFFER_TIME.toLowerCase())) {
            const spokenDuration = utteranceTranscriptRef.current.substring(WAKE_WORDS.SET_BUFFER_TIME.length).trim();
            setBufferTimeByVoice(spokenDuration);
            commandMatchedThisTurn = true;
          } else if (finalUtterance === WAKE_WORDS.TURN_LISTENING_OFF.toLowerCase()) {
            onToggleListeningParent(false);
            commandMatchedThisTurn = true;
          } else if (finalUtterance === WAKE_WORDS.TURN_LISTENING_ON.toLowerCase()) {
            onToggleListeningParent(true);
            commandMatchedThisTurn = true;
          }


          if (commandMatchedThisTurn) {
            commandProcessedSuccessfullyRef.current = true;
            if (recognitionRef.current && recognitionRef.current.stop) {
              try { recognitionRef.current.stop(); } catch(e) { console.warn("Error stopping recognition after full command:", e); }
            }
          } else if (finalUtterance.startsWith(WAKE_WORDS.HEGSYNC_BASE.toLowerCase())) {
            if (finalUtterance !== WAKE_WORDS.HEGSYNC_BASE.toLowerCase()) {
              toast({ title: "Command Not Recognized", description: <>Did not understand: "<q>{utteranceTranscriptRef.current}</q>". Populating input area.</>, variant: "default" });
              setInputText(utteranceTranscriptRef.current); // Populate input area
              commandProcessedSuccessfullyRef.current = true; 
              if (recognitionRef.current && recognitionRef.current.stop) {
                try { recognitionRef.current.stop(); } catch(e) { console.warn("Error stopping recognition for unrecognized HegSync command:", e); }
              }
            }
          }
        }
      };

      try {
        if (isListening && hasMicPermission === true && !isLoading && !isDashboardDictationActive && !isActivelyLongRecording && recognitionRef.current && recognitionRef.current.onstart === recognition.onstart ) {
           recognition.start();
        }
      } catch (e) {
        console.error("Failed to start main command speech recognition:", e);
        if (recognitionRef.current) { recognitionRef.current = null; }
      }
    } else if (hasMicPermission === null && !isBrowserUnsupported) {
        navigator.mediaDevices.getUserMedia({ audio: true })
        .then(() => setHasMicPermission(true))
        .catch(err => {
          console.error("Microphone permission error:", err);
          setHasMicPermission(false);
          toast({ title: "Microphone Access Issue", description: `Could not access microphone: ${err.message}. Voice commands require microphone access. Please enable it in your browser settings.`, variant: "destructive" });
        });
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.onstart = null; recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null; recognitionRef.current.onresult = null;
        commandProcessedSuccessfullyRef.current = true;
        try { recognitionRef.current.stop(); } catch(e) { console.warn("Error stopping main command recognition in cleanup:", e); }
        recognitionRef.current = null;
      }
      if (longRecordingSpeechRecognizerRef.current) {
        try { longRecordingSpeechRecognizerRef.current.stop(); } catch(e) {/*ignore*/}
        longRecordingSpeechRecognizerRef.current = null;
      }
      if (longRecordingMediaRecorderRef.current && longRecordingMediaRecorderRef.current.state === "recording") {
        try { longRecordingMediaRecorderRef.current.stop(); } catch(e) {/*ignore*/}
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
  }, [isListening, hasMicPermission, isLoading, isDashboardDictationActive, isActivelyLongRecording, onToggleListeningParent]);


  // --- Dashboard Manual Dictation Logic (for Textarea) ---
  const handleDashboardMicClick = async () => {
    const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      toast({ title: "Browser Not Supported", description: "Speech recognition not supported by your browser.", variant: "destructive"});
      return;
    }
    if (hasMicPermission === false) {
      toast({ title: "Microphone Access Denied", description: "Please enable microphone access for dictation.", variant: "destructive"});
      return;
    }
    if (hasMicPermission === null) {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
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
      }
      if (dashboardDictationPauseTimeoutRef.current) {
        clearTimeout(dashboardDictationPauseTimeoutRef.current);
      }
      return;
    }

    // Stop other listeners
    commandProcessedSuccessfullyRef.current = true; 
    if (recognitionRef.current && recognitionRef.current.stop) {
        try { recognitionRef.current.stop(); } catch(e) { console.warn("Error stopping main recognition for dashboard dictation", e) }
    }
    if (isActivelyLongRecording && ref && 'current' in ref && ref.current) {
      ref.current.stopLongRecordingAndProcess(); // Stop long recording if active
    }


    setInputText('');
    setIsDashboardDictationActive(true);

    dashboardDictationRecognitionRef.current = new SpeechRecognitionAPI();
    const recognition = dashboardDictationRecognitionRef.current;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    let currentDictationTranscript = "";

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
      setInputText(currentDictationTranscript + (interim ? (currentDictationTranscript ? " " : "") + interim : ""));

      const lowerTranscriptForEndCheck = (currentDictationTranscript + " " + interim).trim().toLowerCase();
      const endCommand = WAKE_WORDS.END_DICTATION.toLowerCase();
      const stopCommand = WAKE_WORDS.STOP_DICTATION.toLowerCase();

      if (lowerTranscriptForEndCheck.endsWith(endCommand) || lowerTranscriptForEndCheck.endsWith(stopCommand)) {
        let finalSpokenText = currentDictationTranscript; 
         if (lowerTranscriptForEndCheck.endsWith(endCommand)) {
          finalSpokenText = currentDictationTranscript.substring(0, currentDictationTranscript.toLowerCase().lastIndexOf(endCommand)).trim();
        } else if (lowerTranscriptForEndCheck.endsWith(stopCommand)) {
           finalSpokenText = currentDictationTranscript.substring(0, currentDictationTranscript.toLowerCase().lastIndexOf(stopCommand)).trim();
        }

        setInputText(finalSpokenText);
        if (dashboardDictationRecognitionRef.current && dashboardDictationRecognitionRef.current.stop) {
          try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
        }
      } else {
        dashboardDictationPauseTimeoutRef.current = setTimeout(() => {
          if (dashboardDictationRecognitionRef.current && dashboardDictationRecognitionRef.current.stop) {
             try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
          }
        }, 2000); 
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error('Dashboard dictation error:', event.error, event.message);
      if (dashboardDictationPauseTimeoutRef.current) {
        clearTimeout(dashboardDictationPauseTimeoutRef.current);
      }
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setHasMicPermission(false);
        toast({ title: "Microphone Access Denied", variant: "destructive" });
      } else if (event.error === 'no-speech') {
        toast({ title: "No speech detected for dictation", variant: "default" });
      } else {
        toast({ title: "Dictation Error", description: event.message || "Could not recognize speech.", variant: "destructive" });
      }
      setIsDashboardDictationActive(false);
    };

    recognition.onend = () => {
      if (dashboardDictationPauseTimeoutRef.current) {
        clearTimeout(dashboardDictationPauseTimeoutRef.current);
      }
      setIsDashboardDictationActive(false);
      const textToProcess = inputText.trim();
      if (textToProcess) {
        handleProcessTextThoughtSubmit(textToProcess); 
      } else {
        setInputText('');
      }
      dashboardDictationRecognitionRef.current = null;
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
    if (isRecognizingSpeech) return <>Listener active for '<strong>HegSync</strong>'</>;
    if (isListening && hasMicPermission && !isBrowserUnsupported) return <>Listener active for '<strong>HegSync</strong>'</>;
    return "Voice status checking...";
  };

  const getTextareaPlaceholder = (): string => {
    if (isActivelyLongRecording || isExternallyLongRecording) return "Continuous recording active. Speech will be processed when stopped.";
    if (isDashboardDictationActive) return "Listening... Say 'HegSync end' or 'HegSync stop' to finish dictation.";
    if (isLoading) return "Processing...";
    if (partialWakeWordDetected) return "'HegSync' detected. Finish your command, or type for manual input.";
    if (isRecognizingSpeech) return "Listener active for 'HegSync', or type for manual input.";
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
    if (!isListening || hasMicPermission !== true || isRecognizingSpeech || isActivelyLongRecording) return <MicOff className="h-5 w-5 text-muted-foreground" />;
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

        <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
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
              {isLoading && inputText.trim() && !isDashboardDictationActive && !isActivelyLongRecording ? <Loader2 className="h-5 w-5 animate-spin" /> : <Brain className="h-5 w-5" />}
            </Button>
             <Button
              type="button"
              onClick={handleDashboardMicClick} 
              disabled={!isListening || isLoading || isActivelyLongRecording || isExternallyLongRecording || (isRecognizingSpeech && !isDashboardDictationActive) || hasMicPermission === false}
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
