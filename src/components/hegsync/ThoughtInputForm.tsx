
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
  ACTUAL_RECORDING_SIMULATED_TRANSCRIPTION
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
  const [isRecognizingSpeech, setIsRecognizingSpeech] = useState(false);
  const [isCapturingAudio, setIsCapturingAudio] = useState(false);
  const [isBrowserUnsupported, setIsBrowserUnsupported] = useState(false);
  const [partialWakeWordDetected, setPartialWakeWordDetected] = useState(false);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const utteranceTranscriptRef = useRef<string>('');


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

  const handleProcessRecordedAudio = async (audioDataUrl: string) => {
    setIsLoading(true);
    setPartialWakeWordDetected(false);
    // setIsCapturingAudio(false); // This is now set in the finally block
    try {
      const processedData = await processRecordedAudio(audioDataUrl);
      const newThought: Thought = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        ...processedData,
      };
      onThoughtRecalled(newThought);
      toast({ title: "Audio Thought Processed", description: "AI processing of recorded audio complete." });
    } catch (error) {
      toast({ title: "Error Processing Audio Thought", description: (error as Error).message, variant: "destructive" });
    } finally {
      setIsLoading(false);
      setIsCapturingAudio(false); // Ensure this is reset here
    }
  };


  const startAudioRecording = async () => {
    if (isCapturingAudio || !hasMicPermission) {
      toast({ title: "Recording Issue", description: isCapturingAudio ? "Already capturing audio." : "Microphone permission needed.", variant: "default" });
      return;
    }
    if (recognitionRef.current && isRecognizingSpeech) {
        recognitionRef.current.stop(); // This will trigger its onend
    }
    setPartialWakeWordDetected(false); // Ensure this is reset before recording

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setIsCapturingAudio(true); // Set this immediately
      audioChunksRef.current = [];
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
          handleProcessRecordedAudio(base64AudioData); // This will set isLoading and eventually reset isCapturingAudio
        };
        stream.getTracks().forEach(track => track.stop()); // Stop mic tracks after recording
        audioChunksRef.current = [];
        // setIsCapturingAudio(false); // Moved to handleProcessRecordedAudio's finally block
      };

      toast({ title: "Recording Started", description: `Capturing audio for ${RECORDING_DURATION_MS / 1000} seconds...`, duration: RECORDING_DURATION_MS });
      mediaRecorderRef.current.start();

      setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
          mediaRecorderRef.current.stop();
        }
      }, RECORDING_DURATION_MS);

    } catch (err) {
      console.error("Error starting audio recording:", err);
      toast({ title: "Recording Error", description: "Could not start audio recording. Check microphone permissions.", variant: "destructive" });
      setIsCapturingAudio(false); // Reset if start fails
      setHasMicPermission(false); // Assume permission issue if error
    }
  };

  const handleManualSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    await handleProcessTextThoughtSubmit(inputText);
  };

  const addShoppingListItem = (itemText: string) => {
    if (!itemText.trim()) {
      toast({ title: "No item specified", description: <>Please say the item you want to add after '<q><strong>HegSync</strong>{WAKE_WORDS.ADD_TO_SHOPPING_LIST.substring(WAKE_WORDS.HEGSYNC_BASE.length).substring(" add to my shopping list".length)}</q>'.</>, variant: "default" });
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
      } else { // identifier is a number
        const indexToDelete = identifier - 1; // 1-based index from user
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

    // Stop logic: If should not be listening, or mic permission denied, or busy
    if (!isListening || hasMicPermission === false || isLoading || isCapturingAudio) {
      if (recognitionRef.current) { // No need to check isRecognizingSpeech, just stop if instance exists
        try {
          recognitionRef.current.stop(); // onend will handle setting isRecognizingSpeech to false
        } catch (e) {
          console.warn("Error stopping recognition (during stop logic):", e);
        }
      }
      // utteranceTranscriptRef.current and partialWakeWordDetected are reset in onend or onstart
      return; // Early exit
    }

    // Start logic: Only if listening, mic permitted, not busy, AND no current recognition instance
    if (hasMicPermission === true && recognitionRef.current === null) {
      recognitionRef.current = new SpeechRecognitionAPI();
      const recognition = recognitionRef.current;
      // utteranceTranscriptRef.current = ''; // Cleared in onstart

      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsRecognizingSpeech(true);
        setPartialWakeWordDetected(false);
        utteranceTranscriptRef.current = '';
      };

      recognition.onend = () => {
        setIsRecognizingSpeech(false);
        setPartialWakeWordDetected(false);
        utteranceTranscriptRef.current = '';
        recognitionRef.current = null; // Critical for allowing re-initialization
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (event.error === 'no-speech' || event.error === 'aborted') {
          console.warn('Speech recognition warning:', event.error, event.message || "(No specific message)");
        } else {
          console.error('Speech recognition error:', event.error, event.message || "(No specific message)");
        }

        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          setHasMicPermission(false);
          toast({ title: "Microphone Access Issue", description: "Speech recognition service denied. Check browser settings or permissions.", variant: "destructive" });
        } else if (event.error === 'network') {
          toast({ title: "Network Error", description: "Speech recognition might require a network connection.", variant: "destructive"});
        }
        // onend will be called after most errors, handling cleanup of recognitionRef.current
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let latestInterimTranscriptForPartialCheck = '';
        let fullTranscriptForThisEventSession = '';

        for (let i = 0; i < event.results.length; ++i) {
          fullTranscriptForThisEventSession += event.results[i][0].transcript;
          if (!event.results[i].isFinal && i >= event.resultIndex) {
            latestInterimTranscriptForPartialCheck += event.results[i][0].transcript;
          }
        }
        utteranceTranscriptRef.current = fullTranscriptForThisEventSession.trim();

        const interimLower = latestInterimTranscriptForPartialCheck.toLowerCase().trim();
        if (interimLower.includes(WAKE_WORDS.HEGSYNC_BASE.toLowerCase())) {
          if (!partialWakeWordDetected) setPartialWakeWordDetected(true);
        } else if (partialWakeWordDetected && !utteranceTranscriptRef.current.toLowerCase().includes(WAKE_WORDS.HEGSYNC_BASE.toLowerCase())) {
          setPartialWakeWordDetected(false);
        }

        const lastResultIsFinal = event.results[event.results.length - 1].isFinal;

        if (lastResultIsFinal && utteranceTranscriptRef.current) {
          const finalUtterance = utteranceTranscriptRef.current.toLowerCase();
          setPartialWakeWordDetected(false); // Reset as we are processing final

          let commandProcessed = false;

          if (finalUtterance === WAKE_WORDS.RECALL_THOUGHT.toLowerCase()) {
            toast({ title: "Recall Command Detected!", description: "Starting audio capture..." });
            startAudioRecording();
            commandProcessed = true;
          } else if (finalUtterance.startsWith(WAKE_WORDS.ADD_TO_SHOPPING_LIST.toLowerCase())) {
            const itemToAdd = finalUtterance.substring(WAKE_WORDS.ADD_TO_SHOPPING_LIST.length).trim();
            addShoppingListItem(itemToAdd);
            commandProcessed = true;
          } else if (finalUtterance.startsWith(WAKE_WORDS.DELETE_ITEM_PREFIX.toLowerCase())) {
            const commandArgs = finalUtterance.substring(WAKE_WORDS.DELETE_ITEM_PREFIX.length).trim();
            let listType: 'shopping' | 'todo' | null = null;
            let itemIdentifierString = "";

            if (commandArgs.includes(WAKE_WORDS.FROM_SHOPPING_LIST_TRIGGER.toLowerCase())) {
              listType = 'shopping';
              itemIdentifierString = commandArgs.substring(0, commandArgs.indexOf(WAKE_WORDS.FROM_SHOPPING_LIST_TRIGGER.toLowerCase())).trim();
            } else if (commandArgs.includes(WAKE_WORDS.FROM_TODO_LIST_TRIGGER.toLowerCase())) {
              listType = 'todo';
              itemIdentifierString = commandArgs.substring(0, commandArgs.indexOf(WAKE_WORDS.FROM_TODO_LIST_TRIGGER.toLowerCase())).trim();
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
            commandProcessed = true;
          } else if (finalUtterance.startsWith(WAKE_WORDS.SET_BUFFER_TIME.toLowerCase())) {
            const spokenDuration = finalUtterance.substring(WAKE_WORDS.SET_BUFFER_TIME.length).trim();
            setBufferTimeByVoice(spokenDuration);
            commandProcessed = true;
          } else if (finalUtterance === WAKE_WORDS.TURN_LISTENING_OFF.toLowerCase()) {
            onToggleListeningParent(false);
            commandProcessed = true;
          } else if (finalUtterance === WAKE_WORDS.TURN_LISTENING_ON.toLowerCase()) {
            onToggleListeningParent(true);
            commandProcessed = true;
          }

          if (commandProcessed) {
            if (recognitionRef.current) {
              recognitionRef.current.stop(); // Will trigger onend for cleanup and restart
            }
          } else if (finalUtterance.startsWith(WAKE_WORDS.HEGSYNC_BASE.toLowerCase()) && finalUtterance.length > WAKE_WORDS.HEGSYNC_BASE.length) {
             toast({ title: "Command Not Recognized", description: <>Did not understand: "<q>{utteranceTranscriptRef.current}</q>"</>, variant: "default" });
             if (recognitionRef.current) {
               recognitionRef.current.stop();
             }
          }
        }
      };

      try {
        // Check conditions again right before start, as state might have changed
        if (isListening && hasMicPermission === true && !isLoading && !isCapturingAudio && recognitionRef.current && recognitionRef.current.onstart === recognition.onstart /* ensure it's our current instance */) {
           recognition.start();
        }
      } catch (e) {
        console.error("Failed to start speech recognition:", e);
        toast({title: "Speech Recognition Error", description: "Could not start voice listener.", variant: "destructive"});
        if (recognitionRef.current) { // If instance was created but start failed
          recognitionRef.current = null; // Allow re-attempt by useEffect
        }
      }
    } else if (hasMicPermission === null && !isBrowserUnsupported) { // Request permission if not yet determined
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
        recognitionRef.current.onstart = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onresult = null;
        try { 
          recognitionRef.current.stop(); 
        } catch(e) { 
          console.warn("Error stopping recognition in cleanup:", e); 
        }
        recognitionRef.current = null;
      }
      setIsRecognizingSpeech(false);
      setPartialWakeWordDetected(false);
      utteranceTranscriptRef.current = '';

      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop(); // Ensure media recorder also stops
        mediaRecorderRef.current = null;
      }
      // isCapturingAudio is reset by mediaRecorder.onstop -> handleProcessRecordedAudio -> finally
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListening, hasMicPermission, isLoading, isCapturingAudio, onToggleListeningParent]);

  const getMicIcon = () => {
    if (isCapturingAudio) return <Radio className="h-5 w-5 text-red-500 animate-pulse" />;
    if (partialWakeWordDetected) return <Mic className="h-5 w-5 text-yellow-500 animate-pulse" />;
    if (isRecognizingSpeech) return <Mic className="h-5 w-5 text-primary animate-pulse" />;
    if (isListening && hasMicPermission && !isBrowserUnsupported && !isLoading && !isCapturingAudio) {
      return <Mic className="h-5 w-5 text-primary" />;
    }
    return <MicOff className="h-5 w-5 text-muted-foreground" />;
  };
  
  const getMicStatusText = (): React.ReactNode => {
    if (isCapturingAudio) return "Recording audio...";
    if (isLoading) return "Processing...";

    if (!isListening) return "Voice Inactive";

    if (isBrowserUnsupported) return "Voice N/A";
    if (hasMicPermission === false) return "Mic Denied";
    if (hasMicPermission === null) return "Mic Awaiting Permission...";
    
    if (partialWakeWordDetected) return <>'<strong>HegSync</strong>' detected, awaiting command...</>;
    if (isRecognizingSpeech) return <>Say '<strong>HegSync</strong>' + command</>;
    
    // If isListening is true, mic is permitted, and not in other states, it's ready.
    if (isListening && hasMicPermission && !isBrowserUnsupported) {
         return <>Listener active for '<strong>HegSync</strong>'</>;
    }
    return "Voice status checking...";
  };

  const getTextareaPlaceholder = (): string => {
    if (isCapturingAudio) return "Recording audio snippet...";
    if (isLoading) return "Processing...";
    if (!isListening) return "Enable listening to activate input...";
    if (isBrowserUnsupported) return "Voice commands not supported by browser.";
    if (hasMicPermission === false) return "Microphone access denied. Enable to use voice commands, or type here for manual input.";
    if (hasMicPermission === null) return "Awaiting microphone permission...";
    if (partialWakeWordDetected) return "'HegSync' detected. Finish your command, or type here for manual input.";
    if (isRecognizingSpeech) return "Say 'HegSync' + command, or type here for manual input.";
    if (isListening && hasMicPermission) return "Listener active for 'HegSync', or type here for manual input.";
    return "Enter thought or use voice commands...";
  };

  const recallCmdSuffix = WAKE_WORDS.RECALL_THOUGHT.substring(WAKE_WORDS.HEGSYNC_BASE.length);
  const addShopCmdSuffix = WAKE_WORDS.ADD_TO_SHOPPING_LIST.substring(WAKE_WORDS.HEGSYNC_BASE.length);
  const setBufferCmdSuffix = WAKE_WORDS.SET_BUFFER_TIME.substring(WAKE_WORDS.HEGSYNC_BASE.length);
  const turnOnCmdSuffix = WAKE_WORDS.TURN_LISTENING_ON.substring(WAKE_WORDS.HEGSYNC_BASE.length);
  const turnOffCmdSuffix = WAKE_WORDS.TURN_LISTENING_OFF.substring(WAKE_WORDS.HEGSYNC_BASE.length);
  const deleteItemSuffix = WAKE_WORDS.DELETE_ITEM_PREFIX.substring(WAKE_WORDS.HEGSYNC_BASE.length);


  return (
    <Card className="w-full shadow-lg">
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle className="text-xl">Input & Recall</CardTitle>
          {isListening && hasMicPermission !== null && !isBrowserUnsupported && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground" title={typeof getMicStatusText() === 'string' ? getMicStatusText() as string : undefined}>
              {getMicIcon()}
              <span>{getMicStatusText()}</span>
            </div>
          )}
        </div>
        <CardDescription>
           {isListening
            ? (
              <>
                Voice: Say <q><strong>HegSync</strong>{recallCmdSuffix}</q>, <q><strong>HegSync</strong>{addShopCmdSuffix} [item]</q>, <q><strong>HegSync</strong>{setBufferCmdSuffix} [duration]</q>, <q><strong>HegSync</strong>{turnOnCmdSuffix}</q>, <q><strong>HegSync</strong>{turnOffCmdSuffix}</q>, or <q><strong>HegSync</strong>{deleteItemSuffix} [item/item number X] from [shopping list/to do list]</q>.
                Text: Use area below and "Process Thought (from text)" button.
              </>
            )
            : (
              <>
                Enable passive listening above (or say <q><strong>HegSync</strong>{turnOnCmdSuffix}</q> if mic is already permitted) to use voice commands or text input.
              </>
            )}
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

        <form onSubmit={handleManualSubmit} className="space-y-4">
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
              className="flex-grow"
              title="Process thought from text area with AI"
            >
              {isLoading && inputText.trim() && !isCapturingAudio ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Brain className="mr-2 h-4 w-4" />}
              Process Thought (from text)
            </Button>
             <Button
              type="button"
              onClick={handleManualSubmit}
              disabled={!isListening || isLoading || isCapturingAudio || !inputText.trim()}
              size="icon"
              className="p-2 h-auto"
              aria-label="Process thought from text area with AI"
              title="Process thought from text area with AI"
            >
              <Brain className={`h-5 w-5 ${isLoading && inputText.trim() && !isCapturingAudio ? 'animate-pulse' : ''}`} />
            </Button>
          </div>
        </form>
        <p className="text-xs text-muted-foreground mt-2">
          The <q><strong>HegSync</strong>{recallCmdSuffix}</q> voice command records a {RECORDING_DURATION_MS / 1000}-second audio snippet.
          Shopping list, to-do list, buffer time, and listening toggle commands operate based on your speech.
        </p>
      </CardContent>
    </Card>
  );
}

    