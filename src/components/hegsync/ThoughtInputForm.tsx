
"use client";

import React, { useState, useEffect, useRef, FormEvent, useImperativeHandle, forwardRef } from 'react';
import { Brain, Loader2, Mic, MicOff, AlertTriangleIcon, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { processTextThought } from '@/lib/actions'; // processRecordedAudio is not used by dashboard dictation anymore
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
  isListening: boolean;
  onToggleListeningParent: (isListening: boolean) => void;
}

export interface ThoughtInputFormHandle {
  simulateWakeWordAndListen: () => void;
}

export const ThoughtInputForm = forwardRef<ThoughtInputFormHandle, ThoughtInputFormProps>(
  ({ onThoughtRecalled, isListening, onToggleListeningParent }, ref) => {
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  // Main command listener (HegSync wake word etc.)
  const [hasMicPermission, setHasMicPermission] = useState<boolean | null>(null);
  const [isRecognizingSpeech, setIsRecognizingSpeech] = useState(false); 
  const [isBrowserUnsupported, setIsBrowserUnsupported] = useState(false);
  const [partialWakeWordDetected, setPartialWakeWordDetected] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const utteranceTranscriptRef = useRef<string>(''); 
  const commandProcessedSuccessfullyRef = useRef<boolean>(false); 

  // Dashboard manual dictation (replaces old 10s recording)
  const [isDashboardDictationActive, setIsDashboardDictationActive] = useState(false);
  const dashboardDictationRecognitionRef = useRef<SpeechRecognition | null>(null);
  const dashboardDictationPauseTimeoutRef = useRef<NodeJS.Timeout | null>(null);


  useImperativeHandle(ref, () => ({
    simulateWakeWordAndListen: () => {
      if (!isListening || hasMicPermission !== true || isLoading || isDashboardDictationActive) {
        toast({ title: "Listener Not Ready", description: "Ensure passive listening is on and the system is ready.", variant: "default" });
        return;
      }
       if (isRecognizingSpeech && recognitionRef.current) { // If already listening for commands, just inject "hegsync"
          utteranceTranscriptRef.current = WAKE_WORDS.HEGSYNC_BASE.toLowerCase() + " ";
          setPartialWakeWordDetected(true);
          commandProcessedSuccessfullyRef.current = false; 
          toast({ title: "HegSync Activated", description: "Listening for your command...", duration: 3000 });
      } else if (!isRecognizingSpeech && !recognitionRef.current) { // If not listening, prepare state and let useEffect start it
          utteranceTranscriptRef.current = WAKE_WORDS.HEGSYNC_BASE.toLowerCase() + " ";
          setPartialWakeWordDetected(true);
          commandProcessedSuccessfullyRef.current = false;
          // The main useEffect for recognitionRef should pick this up and start recognition.
          // A toast here confirms the button press action leading to listening.
          toast({ title: "HegSync Activated", description: "Listening for your command...", duration: 3000 });
          // We don't directly start recognitionRef here to avoid race conditions with useEffect.
          // The useEffect is the single source of truth for starting/stopping recognitionRef.
      } else if (recognitionRef.current && !isRecognizingSpeech) {
         // This case implies recognition is stopped but ref still exists, try to nudge a restart via useEffect
         // or simply set state and assume useEffect will handle. Forcing stop/start can be clean.
        utteranceTranscriptRef.current = WAKE_WORDS.HEGSYNC_BASE.toLowerCase() + " ";
        setPartialWakeWordDetected(true);
        commandProcessedSuccessfullyRef.current = false; 
        try {
          recognitionRef.current.stop(); // This will trigger onend, then useEffect should restart.
        } catch(e) {
          console.warn("Error stopping recognition for simulation, will rely on useEffect.", e);
          recognitionRef.current = null; // Ensure useEffect re-initializes
        }
        toast({ title: "HegSync Activated", description: "Listening for your command...", duration: 3000 });
      }
      window.focus(); // Helpful for some browsers to pick up speech
    }
  }));


  const handleProcessTextThoughtSubmit = async (textToProcess: string) => {
    if (!textToProcess.trim()) {
      toast({ title: "Input empty", description: "Cannot process an empty thought.", variant: "destructive" });
      return;
    }
    setIsLoading(true);
    setPartialWakeWordDetected(false); // Reset this on manual submission
    try {
      const processedData = await processTextThought(textToProcess);
      const newThought: Thought = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        ...processedData,
      };
      onThoughtRecalled(newThought);
      setInputText(''); // Clear input after successful processing
      toast({ title: "Text Thought Processed", description: "AI processing complete." });
    } catch (error) {
      toast({ title: "Error Processing Text Thought", description: (error as Error).message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const addShoppingListItem = (itemText: string) => {
    if (!itemText.trim()) {
      toast({ title: "No item specified", description: <>Please say the item you want to add after '<strong>HegSync</strong>{WAKE_WORDS.ADD_TO_SHOPPING_LIST.substring(WAKE_WORDS.HEGSYNC_BASE.length)}'.</>, variant: "default" });
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

    if (!isListening || hasMicPermission === false || isLoading || isDashboardDictationActive) {
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
            utteranceTranscriptRef.current = (utteranceTranscriptRef.current + " " + finalizedSegmentThisTurn).trim();
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
            const bufferTimeValue = JSON.parse(localStorage.getItem(LOCALSTORAGE_KEYS.BUFFER_TIME) || JSON.stringify(DEFAULT_BUFFER_TIME)) as BufferTimeValue;
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
            if (recognitionRef.current) {
              try { recognitionRef.current.stop(); } catch(e) { console.warn("Error stopping recognition after main command:", e); }
            }
          } else if (finalUtterance.startsWith(WAKE_WORDS.HEGSYNC_BASE.toLowerCase())) { // HegSync spoken, but no full command matched
             toast({ title: "Command Not Recognized", description: <>Did not understand: "<q>{utteranceTranscriptRef.current}</q>". Populating input area.</>, variant: "default" });
             setInputText(utteranceTranscriptRef.current); // Populate input area
             commandProcessedSuccessfullyRef.current = true; 
             if (recognitionRef.current) {
               try { recognitionRef.current.stop(); } catch(e) { console.warn("Error stopping recognition for unrecognized HegSync command:", e); }
             }
          } else if (finalUtterance && !finalUtterance.startsWith(WAKE_WORDS.HEGSYNC_BASE.toLowerCase())) {
            // Finalized speech that doesn't start with HegSync - ignore for command processing.
            // This might happen if user speaks unrelated things.
            // We can clear utteranceTranscriptRef here if we want to ensure only HegSync commands are kept.
            // For now, let it be, as onend with commandProcessedSuccessfullyRef=false will preserve it if partialWakeWordDetected is true.
          }
        }
      };

      try {
        if (isListening && hasMicPermission === true && !isLoading && !isDashboardDictationActive && recognitionRef.current && recognitionRef.current.onstart === recognition.onstart ) {
           recognition.start();
        }
      } catch (e) {
        console.error("Failed to start main command speech recognition:", e);
        if (recognitionRef.current) { recognitionRef.current = null; } // Ensure it can be re-initialized
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

    return () => { // Cleanup for main command listener
      if (recognitionRef.current) {
        recognitionRef.current.onstart = null; recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null; recognitionRef.current.onresult = null;
        commandProcessedSuccessfullyRef.current = true; 
        try { recognitionRef.current.stop(); } catch(e) { console.warn("Error stopping main command recognition in cleanup:", e); }
        recognitionRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListening, hasMicPermission, isLoading, isDashboardDictationActive]); 


  // --- Dashboard Manual Dictation Logic ---
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
        setHasMicPermission(true); // Now proceed if permission granted
      } catch (err) {
        setHasMicPermission(false);
        toast({ title: "Microphone Access Denied", description: "Could not get microphone permission.", variant: "destructive"});
        return;
      }
    }

    if (isDashboardDictationActive) {
      if (dashboardDictationRecognitionRef.current) {
        try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
      }
      if (dashboardDictationPauseTimeoutRef.current) {
        clearTimeout(dashboardDictationPauseTimeoutRef.current);
      }
      // Processing will happen in onend if there's text
      return;
    }

    // Stop main command listener if active
    if (recognitionRef.current && isRecognizingSpeech) {
        commandProcessedSuccessfullyRef.current = true; // Ensure it cleans up fully
        try { recognitionRef.current.stop(); } catch(e) { /* ignore */ }
    }
    
    setInputText(''); // Clear textarea for new dictation
    setIsDashboardDictationActive(true);

    dashboardDictationRecognitionRef.current = new SpeechRecognitionAPI();
    const recognition = dashboardDictationRecognitionRef.current;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    let currentDictationTranscript = "";

    recognition.onstart = () => {
      // setIsDashboardDictationActive(true) is already set
    };

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
      
      const lowerTranscriptForEndCheck = (currentDictationTranscript + interim).toLowerCase();
      const endCommand = WAKE_WORDS.END_DICTATION.toLowerCase();
      const stopCommand = WAKE_WORDS.STOP_DICTATION.toLowerCase();

      if (lowerTranscriptForEndCheck.endsWith(endCommand) || lowerTranscriptForEndCheck.endsWith(stopCommand)) {
        let finalSpokenText = currentDictationTranscript;
        if (lowerTranscriptForEndCheck.endsWith(endCommand)) {
          finalSpokenText = finalSpokenText.substring(0, finalSpokenText.length - endCommand.length).trim();
        } else {
          finalSpokenText = finalSpokenText.substring(0, finalSpokenText.length - stopCommand.length).trim();
        }
        setInputText(finalSpokenText); // Update text area with cleaned text
        if (dashboardDictationRecognitionRef.current) {
          try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
        }
        // Processing will occur in onend
      } else {
        dashboardDictationPauseTimeoutRef.current = setTimeout(() => {
          if (dashboardDictationRecognitionRef.current) {
             try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
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
        setHasMicPermission(false); // Could be a global permission issue now
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
      // Process the dictated text if it's not empty
      const textToProcess = inputText.trim(); // inputText should have the final dictated text
      if (textToProcess) {
        handleProcessTextThoughtSubmit(textToProcess); // This will clear inputText on success
      } else {
        setInputText(''); // Ensure it's cleared if nothing was processed
      }
      dashboardDictationRecognitionRef.current = null;
    };
    
    recognition.start();
  };
  

  const getMicIconForCardHeader = () => {
    if (isDashboardDictationActive) return <Radio className="h-5 w-5 text-red-500 animate-pulse" />;
    if (partialWakeWordDetected) return <Mic className="h-5 w-5 text-yellow-500 animate-pulse" />;
    if (isRecognizingSpeech) return <Mic className="h-5 w-5 text-primary animate-pulse" />;
    if (isListening && hasMicPermission && !isBrowserUnsupported && !isLoading && !isDashboardDictationActive) {
      return <Mic className="h-5 w-5 text-primary" />;
    }
    return <MicOff className="h-5 w-5 text-muted-foreground" />;
  };
  
  const getMicStatusText = (): React.ReactNode => {
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
    if (isDashboardDictationActive) return "Listening... Say 'HegSync end' or 'HegSync stop' to finish dictation.";
    if (isLoading) return "Processing...";
    if (!isListening) return "Enable listening to activate voice commands or manual input.";
    if (isBrowserUnsupported) return "Voice commands not supported. Manual input available.";
    if (hasMicPermission === false) return "Microphone access denied. Manual input available.";
    if (hasMicPermission === null) return "Awaiting microphone permission...";
    if (partialWakeWordDetected) return "'HegSync' detected. Finish your command, or type for manual input.";
    if (isRecognizingSpeech) return "Listener active for 'HegSync', or type for manual input.";
    if (isListening && hasMicPermission) return "Listener active for 'HegSync', or type for manual input.";
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
            Voice: Say <q><strong>HegSync</strong>{recallCmdSuffix}</q> to process a simulated thought from your buffer.
            Other commands: <q><strong>HegSync</strong>{addShopCmdSuffix} [item]</q>, <q><strong>HegSync</strong>{setBufferCmdSuffix} [duration]</q>, <q><strong>HegSync</strong>{deleteItemSuffix} [args]</q>, <q><strong>HegSync</strong>{turnOnCmdSuffix}</q>, or <q><strong>HegSync</strong>{turnOffCmdSuffix}</q>.
            Manual: Use the <Brain className="inline-block h-3.5 w-3.5 mx-0.5"/> icon to process text from input area. Use the <Mic className="inline-block h-3.5 w-3.5 mx-0.5"/> icon for direct dictation into the input area (ends on pause or '<strong>HegSync</strong> end/stop').
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
            disabled={!isListening || isLoading || isDashboardDictationActive}
            className="resize-none"
            aria-label="Recalled thought input area for manual processing or dictation"
          />
          <div className="flex items-stretch gap-2">
            <Button
              type="button"
              onClick={() => handleProcessTextThoughtSubmit(inputText)}
              disabled={!isListening || isLoading || isDashboardDictationActive || !inputText.trim()}
              size="icon"
              className="p-2 h-auto" 
              aria-label="Process thought from text area with AI"
              title="Process thought from text area with AI"
            >
              {isLoading && inputText.trim() && !isDashboardDictationActive ? <Loader2 className="h-5 w-5 animate-spin" /> : <Brain className="h-5 w-5" />}
            </Button>
            <Button
              type="button"
              onClick={handleDashboardMicClick}
              disabled={!isListening || isLoading || (isRecognizingSpeech && !isDashboardDictationActive) || hasMicPermission === false}
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
          The <Mic className="inline-block h-3 w-3 mx-0.5"/> icon button activates direct dictation into the text area. The <Brain className="inline-block h-3 w-3 mx-0.5"/> icon button processes the current text in the input area.
        </p>
      </CardContent>
    </Card>
  );
});

ThoughtInputForm.displayName = "ThoughtInputForm";
