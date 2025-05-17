
"use client";

import React, { useState, useEffect, useRef, FormEvent } from 'react';
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
  RECORDING_DURATION_MS,
  BUFFER_TIME_OPTIONS,
  type BufferTimeValue,
  DEFAULT_BUFFER_TIME,
} from '@/lib/constants';

interface ThoughtInputFormProps {
  onThoughtRecalled: (thought: Thought) => void;
  isListening: boolean;
  onToggleListeningParent: (isListening: boolean) => void;
}

export function ThoughtInputForm({ onThoughtRecalled, isListening, onToggleListeningParent }: ThoughtInputFormProps) {
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const [hasMicPermission, setHasMicPermission] = useState<boolean | null>(null);
  const [isRecognizingSpeech, setIsRecognizingSpeech] = useState(false); // For command recognition
  const [isCapturingAudio, setIsCapturingAudio] = useState(false); // For MediaRecorder
  const [isBrowserUnsupported, setIsBrowserUnsupported] = useState(false);
  const [partialWakeWordDetected, setPartialWakeWordDetected] = useState(false);

  const recognitionRef = useRef<SpeechRecognition | null>(null); // For voice commands
  const mediaRecorderRef = useRef<MediaRecorder | null>(null); // For 10s audio blob
  const audioChunksRef = useRef<Blob[]>([]);
  
  const snippetRecognitionRef = useRef<SpeechRecognition | null>(null); // For transcribing the 10s snippet
  const snippetTranscriptRef = useRef<string>(''); // Accumulates transcript for the 10s snippet

  const utteranceTranscriptRef = useRef<string>(''); // Accumulates transcript for commands
  const commandProcessedSuccessfullyRef = useRef<boolean>(false);


  const handleProcessTextThoughtSubmit = async (textToProcess: string) => {
    if (!textToProcess.trim()) {
      toast({ title: "Input empty", description: "Cannot process an empty thought.", variant: "destructive" });
      return;
    }
    setIsLoading(true);
    setPartialWakeWordDetected(false);
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

  const handleProcessRecordedAudio = async (audioDataUrl: string, transcription: string) => {
    setIsLoading(true);
    setPartialWakeWordDetected(false);
    try {
      const processedData = await processRecordedAudio(audioDataUrl, transcription);
      const newThought: Thought = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        ...processedData,
      };
      onThoughtRecalled(newThought);
      toast({ title: "Recorded Thought Processed", description: "AI processing of recorded audio complete." });
    } catch (error) {
      toast({ title: "Error Processing Recorded Thought", description: (error as Error).message, variant: "destructive" });
    } finally {
      setIsLoading(false);
      setIsCapturingAudio(false); 
    }
  };


  const startAudioRecording = async () => {
    if (isCapturingAudio || hasMicPermission !== true) {
      toast({ title: "Recording Issue", description: isCapturingAudio ? "Already capturing audio." : "Microphone permission needed or listening is off.", variant: "default" });
      return;
    }
    
    commandProcessedSuccessfullyRef.current = true; 
    if (recognitionRef.current && isRecognizingSpeech) {
        try { recognitionRef.current.stop(); } catch(e) { console.warn("Error stopping command recognition before recording:", e); }
    }
    setPartialWakeWordDetected(false); 

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setIsCapturingAudio(true);
      audioChunksRef.current = [];
      snippetTranscriptRef.current = ''; // Reset snippet transcript

      // 1. Setup MediaRecorder for audio blob
      mediaRecorderRef.current = new MediaRecorder(stream);
      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      mediaRecorderRef.current.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const base64AudioData = reader.result as string;
          // Use the transcript captured by snippetRecognitionRef
          handleProcessRecordedAudio(base64AudioData, snippetTranscriptRef.current);
        };
        // Stop all tracks on the stream associated with MediaRecorder
        stream.getTracks().forEach(track => track.stop()); 
        audioChunksRef.current = [];
      };

      // 2. Setup SpeechRecognition for transcribing the snippet
      const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognitionAPI) {
        snippetRecognitionRef.current = new SpeechRecognitionAPI();
        const snippetRecognizer = snippetRecognitionRef.current;
        snippetRecognizer.continuous = true;
        snippetRecognizer.interimResults = true;
        snippetRecognizer.lang = 'en-US';

        snippetRecognizer.onresult = (event: SpeechRecognitionEvent) => {
          let interim = '';
          let final = '';
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              final += event.results[i][0].transcript;
            } else {
              interim += event.results[i][0].transcript;
            }
          }
          snippetTranscriptRef.current = snippetTranscriptRef.current + final; // Append final parts
          // console.log("Snippet Interim: ", interim); // For debugging
          // console.log("Snippet Accumulated Final: ", snippetTranscriptRef.current); // For debugging
        };
        snippetRecognizer.onerror = (event: SpeechRecognitionErrorEvent) => {
          console.warn('Snippet recognition error:', event.error, event.message);
          // If snippet STT fails, we'll proceed with an empty transcript
        };
        snippetRecognizer.onend = () => {
          // console.log("Snippet recognition ended. Final transcript for snippet:", snippetTranscriptRef.current);
          // The main logic for stopping and processing is in the setTimeout
        };
        
        snippetRecognizer.start();
      } else {
        console.warn("SpeechRecognition API not available for snippet transcription.");
        // Fallback: if snippet STT can't start, we'll have an empty transcript.
        // processRecordedAudio in actions.ts handles empty transcript.
      }

      toast({ title: "Recording Started", description: `Capturing audio and speech for ${RECORDING_DURATION_MS / 1000} seconds...`, duration: RECORDING_DURATION_MS });
      mediaRecorderRef.current.start();

      setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
          mediaRecorderRef.current.stop(); // This will trigger mediaRecorderRef.onstop
        }
        if (snippetRecognitionRef.current) {
          try { 
            snippetRecognitionRef.current.stop(); 
          } catch(e) { 
            console.warn("Error stopping snippet recognition:", e);
          }
        }
      }, RECORDING_DURATION_MS);

    } catch (err) {
      console.error("Error starting audio recording/snippet transcription:", err);
      toast({ title: "Recording Error", description: "Could not start audio recording. Check microphone permissions.", variant: "destructive" });
      setIsCapturingAudio(false);
      setHasMicPermission(false);
    }
  };

  const handleManualSubmit = async () => {
    await handleProcessTextThoughtSubmit(inputText);
  };

  const addShoppingListItem = (itemText: string) => {
    if (!itemText.trim()) {
      toast({ title: "No item specified", description: <>Please say the item you want to add after '<q><strong>HegSync</strong>{WAKE_WORDS.ADD_TO_SHOPPING_LIST.substring(WAKE_WORDS.HEGSYNC_BASE.length)}</q>'.</>, variant: "default" });
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


  useEffect(() => {
    const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      setIsBrowserUnsupported(true);
      setHasMicPermission(false);
      return;
    }
    setIsBrowserUnsupported(false);

    if (!isListening || hasMicPermission === false || isLoading || isCapturingAudio) {
      if (recognitionRef.current) {
        commandProcessedSuccessfullyRef.current = true; // Ensure cleanup if stopped externally
        try { recognitionRef.current.stop(); } catch (e) { console.warn("Error stopping recognition (during external stop logic):", e); }
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
        if (commandProcessedSuccessfullyRef.current || !partialWakeWordDetected) { // Clear only if command processed or no partial detected
            setPartialWakeWordDetected(false);
            utteranceTranscriptRef.current = '';
        }
        recognitionRef.current = null; // Allow re-initialization
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (event.error === 'no-speech' || event.error === 'aborted') {
          console.warn('Command recognition warning:', event.error, event.message || "(No specific message)");
        } else {
          console.error('Command recognition error:', event.error, event.message || "(No specific message)");
        }
        commandProcessedSuccessfullyRef.current = true; // Treat errors as "processed" to allow cleanup

        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          setHasMicPermission(false);
          toast({ title: "Microphone Access Issue", description: "Speech recognition service denied. Check browser settings or permissions.", variant: "destructive" });
        } else if (event.error === 'network') {
          toast({ title: "Network Error", description: "Speech recognition might require a network connection.", variant: "destructive"});
        }
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interimTranscript = '';
        let finalizedSegmentThisTurn = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const segment = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalizedSegmentThisTurn += segment;
          } else {
            interimTranscript += segment;
          }
        }

        if (finalizedSegmentThisTurn) {
            utteranceTranscriptRef.current += (utteranceTranscriptRef.current ? " " : "") + finalizedSegmentThisTurn.trim();
        }
        
        const latestInterimForPartialCheck = interimTranscript.trim().toLowerCase();
        if (!partialWakeWordDetected && latestInterimForPartialCheck.includes(WAKE_WORDS.HEGSYNC_BASE.toLowerCase())) {
          setPartialWakeWordDetected(true);
        } else if (partialWakeWordDetected && !utteranceTranscriptRef.current.toLowerCase().includes(WAKE_WORDS.HEGSYNC_BASE.toLowerCase()) && !latestInterimForPartialCheck.includes(WAKE_WORDS.HEGSYNC_BASE.toLowerCase())) {
          // This condition might need adjustment if utteranceTranscriptRef itself isn't cleared properly on pauses
          setPartialWakeWordDetected(false);
        }

        const lastResultIsFinal = event.results[event.results.length - 1].isFinal;

        if (lastResultIsFinal && utteranceTranscriptRef.current) {
          const finalUtterance = utteranceTranscriptRef.current.toLowerCase().trim();
          let commandMatchedThisTurn = false;

          if (finalUtterance === WAKE_WORDS.RECALL_THOUGHT.toLowerCase()) {
            toast({ title: <><strong>HegSync</strong> Recall Command Detected!</>, description: "Starting audio capture..." });
            startAudioRecording(); 
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
            if (recognitionRef.current) {
              try { recognitionRef.current.stop(); } catch(e) { console.warn("Error stopping recognition after command:", e); }
            }
          } else if (finalUtterance.startsWith(WAKE_WORDS.HEGSYNC_BASE.toLowerCase()) && finalUtterance.length > WAKE_WORDS.HEGSYNC_BASE.length) {
             toast({ title: "Command Not Recognized", description: <>Did not understand: "<q>{utteranceTranscriptRef.current}</q>"</>, variant: "default" });
             commandProcessedSuccessfullyRef.current = true; 
             if (recognitionRef.current) {
               try { recognitionRef.current.stop(); } catch(e) { console.warn("Error stopping recognition for unrecognized cmd:", e); }
             }
          } else if (finalUtterance.toLowerCase() === WAKE_WORDS.HEGSYNC_BASE.toLowerCase()) {
            // User only said "HegSync". Keep listening if continuous. `commandProcessedSuccessfullyRef` remains false.
          }
        }
      };

      try {
        if (isListening && hasMicPermission === true && !isLoading && !isCapturingAudio && recognitionRef.current && recognitionRef.current.onstart === recognition.onstart ) {
           recognition.start();
        }
      } catch (e) {
        console.error("Failed to start command speech recognition:", e);
        toast({title: "Speech Recognition Error", description: "Could not start voice listener.", variant: "destructive"});
        if (recognitionRef.current) { recognitionRef.current = null; }
      }
    } else if (hasMicPermission === null && !isBrowserUnsupported) { 
        navigator.mediaDevices.getUserMedia({ audio: true })
        .then(() => setHasMicPermission(true))
        .catch(err => {
          console.error("Microphone permission error:", err);
          setHasMicPermission(false);
          if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            toast({ title: "Microphone Access Denied", description: "Voice commands require microphone access. Please enable it in your browser settings.", variant: "destructive" });
          } else {
            toast({ title: "Microphone Error", description: `Could not access microphone: ${err.message}`, variant: "destructive" });
          }
        });
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.onstart = null; recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null; recognitionRef.current.onresult = null;
        commandProcessedSuccessfullyRef.current = true; 
        try { recognitionRef.current.stop(); } catch(e) { console.warn("Error stopping cmd recognition in cleanup:", e); }
        recognitionRef.current = null;
      }
      if (snippetRecognitionRef.current) {
        snippetRecognitionRef.current.onstart = null; snippetRecognitionRef.current.onend = null;
        snippetRecognitionRef.current.onerror = null; snippetRecognitionRef.current.onresult = null;
        try { snippetRecognitionRef.current.stop(); } catch(e) { console.warn("Error stopping snippet recognition in cleanup:", e); }
        snippetRecognitionRef.current = null;
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        try { mediaRecorderRef.current.stop(); } catch(e) { console.warn("Error stopping media recorder in cleanup:", e); }
        mediaRecorderRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListening, hasMicPermission, isLoading, isCapturingAudio]); 

  const getMicIconForCardHeader = () => {
    if (isCapturingAudio) return <Radio className="h-5 w-5 text-red-500 animate-pulse" />;
    if (partialWakeWordDetected) return <Mic className="h-5 w-5 text-yellow-500 animate-pulse" />;
    if (isRecognizingSpeech) return <Mic className="h-5 w-5 text-primary animate-pulse" />;
    if (isListening && hasMicPermission && !isBrowserUnsupported && !isLoading && !isCapturingAudio) {
      return <Mic className="h-5 w-5 text-primary" />;
    }
    return <MicOff className="h-5 w-5 text-muted-foreground" />;
  };
  
  const getMicStatusText = (): React.ReactNode => {
    if (isCapturingAudio) return "Recording audio & speech...";
    if (isLoading) return "Processing...";
    if (!isListening) return "Voice Inactive";
    if (isBrowserUnsupported) return "Voice N/A";
    if (hasMicPermission === false) return "Mic Denied";
    if (hasMicPermission === null) return "Mic Awaiting Permission...";
    if (partialWakeWordDetected) return <>'<strong>HegSync</strong>' detected, awaiting command...</>;
    if (isRecognizingSpeech) return <>Say '<strong>HegSync</strong>' + command</>;
    if (isListening && hasMicPermission && !isBrowserUnsupported) return <>Listener active for '<strong>HegSync</strong>'</>;
    return "Voice status checking...";
  };

  const getTextareaPlaceholder = (): string => {
    if (isCapturingAudio) return "Recording audio snippet and your speech...";
    if (isLoading) return "Processing...";
    if (!isListening) return "Enable listening to activate voice commands or manual input.";
    if (isBrowserUnsupported) return "Voice commands not supported by browser. Manual input available.";
    if (hasMicPermission === false) return "Microphone access denied. Manual input available.";
    if (hasMicPermission === null) return "Awaiting microphone permission...";
    if (partialWakeWordDetected) return "'HegSync' detected. Finish your command, or type for manual input.";
    if (isRecognizingSpeech) return "Say 'HegSync' + command, or type for manual input.";
    if (isListening && hasMicPermission) return "Listener active for 'HegSync', or type for manual input.";
    return "Enter thought or use voice commands...";
  };

  const recallCmdSuffix = WAKE_WORDS.RECALL_THOUGHT.substring(WAKE_WORDS.HEGSYNC_BASE.length);
  const addShopCmdSuffix = WAKE_WORDS.ADD_TO_SHOPPING_LIST.substring(WAKE_WORDS.HEGSYNC_BASE.length);
  const setBufferCmdSuffix = WAKE_WORDS.SET_BUFFER_TIME.substring(WAKE_WORDS.HEGSYNC_BASE.length);
  const turnOnCmdSuffix = WAKE_WORDS.TURN_LISTENING_ON.substring(WAKE_WORDS.HEGSYNC_BASE.length);
  const turnOffCmdSuffix = WAKE_WORDS.TURN_LISTENING_OFF.substring(WAKE_WORDS.HEGSYNC_BASE.length);
  const deleteItemSuffix = WAKE_WORDS.DELETE_ITEM_PREFIX.substring(WAKE_WORDS.HEGSYNC_BASE.length);

  const getRecordAudioButtonIcon = () => {
    if (isCapturingAudio) return <Radio className="h-5 w-5 text-red-500 animate-pulse" />;
    if (!isListening || hasMicPermission !== true) return <MicOff className="h-5 w-5 text-muted-foreground" />;
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
            Voice: Say <q><strong>HegSync</strong>{recallCmdSuffix}</q> to record a {RECORDING_DURATION_MS / 1000}s audio snippet & your speech for AI processing.
            Other commands: <q><strong>HegSync</strong>{addShopCmdSuffix} [item]</q>, <q><strong>HegSync</strong>{setBufferCmdSuffix} [duration]</q>, <q><strong>HegSync</strong>{deleteItemSuffix} [item/item number X] from [list type]</q>, <q><strong>HegSync</strong>{turnOnCmdSuffix}</q>, or <q><strong>HegSync</strong>{turnOffCmdSuffix}</q>.
            Manual: Use the <Brain className="inline-block h-3.5 w-3.5 mx-0.5"/> icon to process text from input area, or <Mic className="inline-block h-3.5 w-3.5 mx-0.5"/> icon to trigger audio/speech recording.
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
            disabled={!isListening || isLoading || isCapturingAudio}
            className="resize-none"
            aria-label="Recalled thought input area for manual processing"
          />
          <div className="flex items-stretch gap-2">
            <Button
              type="button"
              onClick={handleManualSubmit}
              disabled={!isListening || isLoading || isCapturingAudio || !inputText.trim()}
              size="icon"
              className="p-2 h-auto" 
              aria-label="Process thought from text area with AI"
              title="Process thought from text area with AI"
            >
              {isLoading && inputText.trim() && !isCapturingAudio ? <Loader2 className="h-5 w-5 animate-spin" /> : <Brain className="h-5 w-5" />}
            </Button>
            <Button
              type="button"
              onClick={startAudioRecording}
              disabled={!isListening || isLoading || isCapturingAudio || hasMicPermission !== true}
              size="icon"
              className="p-2 h-auto"
              aria-label={`Record ${RECORDING_DURATION_MS / 1000}s audio snippet & speech, then process`}
              title={`Record ${RECORDING_DURATION_MS / 1000}s audio snippet & speech, then process`}
            >
              {getRecordAudioButtonIcon()}
            </Button>
          </div>
        </form>
         <p className="text-xs text-muted-foreground mt-2">
          The <q><strong>HegSync</strong>{recallCmdSuffix}</q> voice command (or the <Mic className="inline-block h-3 w-3 mx-0.5"/> icon button) records a {RECORDING_DURATION_MS / 1000}-second audio snippet and live transcribes your speech during this period for AI processing.
          Other voice commands are processed directly based on your speech. The <Brain className="inline-block h-3 w-3 mx-0.5"/> icon button uses text from the input area.
        </p>
      </CardContent>
    </Card>
  );
}
