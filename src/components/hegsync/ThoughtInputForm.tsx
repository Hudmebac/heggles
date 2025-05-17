
"use client";

import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { Brain, Loader2, Mic, MicOff, AlertTriangleIcon, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { processTextThought } from '@/lib/actions'; // processRecordedAudio is no longer directly used by dashboard UI
import type { Thought, ShoppingListItem, ToDoListItem, BufferTimeValue } from '@/lib/types';
import {
  WAKE_WORDS,
  LOCALSTORAGE_KEYS,
  BUFFER_TIME_OPTIONS,
  DEFAULT_BUFFER_TIME,
} from '@/lib/constants';

interface ThoughtInputFormProps {
  onThoughtRecalled: (thought: Thought) => void;
  isListening: boolean;
  onToggleListeningParent: (isListening: boolean) => void;
  isExternallyLongRecording: boolean;
  onStopLongRecordingParent: () => void; // Callback to parent when long recording stops internally
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

  // Main command listener (HegSync wake word etc.)
  const [hasMicPermission, setHasMicPermission] = useState<boolean | null>(null);
  const [isRecognizingSpeech, setIsRecognizingSpeech] = useState(false); // For wake word listener
  const [isBrowserUnsupported, setIsBrowserUnsupported] = useState(false);
  const [partialWakeWordDetected, setPartialWakeWordDetected] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const utteranceTranscriptRef = useRef<string>('');
  const commandProcessedSuccessfullyRef = useRef<boolean>(false);

  // Dashboard manual dictation (for the text area via dedicated mic button)
  const [isDashboardDictationActive, setIsDashboardDictationActive] = useState(false);
  const dashboardDictationRecognitionRef = useRef<SpeechRecognition | null>(null);
  const dashboardDictationPauseTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Continuous "Long" Recording refs
  const longRecordingMediaRecorderRef = useRef<MediaRecorder | null>(null); // Audio data still captured for potential future use
  const longRecordingSpeechRecognizerRef = useRef<SpeechRecognition | null>(null);
  const longRecordingTranscriptRef = useRef<string>('');
  const longRecordingAudioChunksRef = useRef<Blob[]>([]);
  const [isActivelyLongRecording, setIsActivelyLongRecording] = useState(false);

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


  useImperativeHandle(ref, () => ({
    startLongRecording: () => {
      if (!isListening || hasMicPermission !== true || isLoading || isDashboardDictationActive || isRecognizingSpeech || isActivelyLongRecording || isExternallyLongRecording) {
        toast({ title: "Cannot Start Recording", description: "System is busy, passive listening is off, or microphone permission is missing.", variant: "destructive"});
        return false;
      }
      // Stop other listeners
      commandProcessedSuccessfullyRef.current = true; 
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
          setInputText("Continuous recording active. Speak your thoughts..."); // Update textarea

          longRecordingMediaRecorderRef.current = new MediaRecorder(stream);
          longRecordingMediaRecorderRef.current.ondataavailable = (event) => {
            if (event.data.size > 0) longRecordingAudioChunksRef.current.push(event.data);
          };
          longRecordingMediaRecorderRef.current.start();

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
            // Update textarea with live transcript
            setInputText(longRecordingTranscriptRef.current + (interimTranscript ? (longRecordingTranscriptRef.current ? " " : "") + interimTranscript : ""));
          };
          
          recognizer.onerror = (event: SpeechRecognitionErrorEvent) => {
            console.error("Long recording speech recognition error:", event.error, event.message);
            toast({ title: "Recording Transcription Error", description: event.message, variant: "destructive" });
          };
          recognizer.start();
          return true; 
        } catch (err) {
          console.error("Error starting long recording:", err);
          toast({ title: "Recording Error", description: `Could not start recording: ${(err as Error).message}`, variant: "destructive" });
          setIsActivelyLongRecording(false); 
          setInputText(""); // Clear textarea
          return false; 
        }
      };
      return startRecordingFlow();
    },
    stopLongRecordingAndProcess: () => {
      if (!isActivelyLongRecording && !isExternallyLongRecording) return;
    
      if (longRecordingSpeechRecognizerRef.current) {
        try { longRecordingSpeechRecognizerRef.current.stop(); } catch(e) { /* ignore */ }
        longRecordingSpeechRecognizerRef.current = null;
      }
    
      if (longRecordingMediaRecorderRef.current && longRecordingMediaRecorderRef.current.state === "recording") {
        longRecordingMediaRecorderRef.current.onstop = () => {
          // const audioBlob = new Blob(longRecordingAudioChunksRef.current, { type: 'audio/webm' });
          longRecordingAudioChunksRef.current = []; // Clear chunks
          
          // Transcript is already in longRecordingTranscriptRef.current
          // and potentially reflected in inputText via live updates.
          // We will use the final accumulated transcript.
          const finalTranscript = longRecordingTranscriptRef.current.trim() || "[No speech transcribed during recording]";
          setInputText(finalTranscript); // Ensure final transcript is in the input text for user to process
          longRecordingTranscriptRef.current = '';
    
          setIsActivelyLongRecording(false);
          onStopLongRecordingParent(); // Notify parent (page.tsx)
          // Release MediaRecorder stream tracks.
          if (longRecordingMediaRecorderRef.current?.stream) {
            longRecordingMediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
          }
          longRecordingMediaRecorderRef.current = null;
        };
        try { longRecordingMediaRecorderRef.current.stop(); } catch(e) { /* ignore */ }
      } else {
         const finalTranscript = longRecordingTranscriptRef.current.trim() || "[No speech transcribed, media recorder not active/stopped early]";
         setInputText(finalTranscript);
         longRecordingTranscriptRef.current = '';
         setIsActivelyLongRecording(false);
         onStopLongRecordingParent();
      }
    },
  }));

  useEffect(() => {
    if (!isListening && (isActivelyLongRecording || isExternallyLongRecording)) {
      if (ref && 'current' in ref && ref.current) {
        ref.current.stopLongRecordingAndProcess();
         // Toast for stopping is handled by page.tsx now
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListening, isActivelyLongRecording, isExternallyLongRecording]);


  const addListItem = (listKey: string, itemText: string, listName: string) => {
    if (!itemText.trim()) {
      toast({ title: "No item specified", description: `Please specify the item to add to ${listName}.`, variant: "default" });
      setIsAlertDialogOpen(false);
      return;
    }
    try {
      const currentItemsString = localStorage.getItem(listKey);
      let currentItems: Array<ShoppingListItem | ToDoListItem> = currentItemsString ? JSON.parse(currentItemsString) : [];
      
      if (listKey === LOCALSTORAGE_KEYS.SHOPPING_LIST) {
        const newItem: ShoppingListItem = { id: crypto.randomUUID(), text: itemText.trim(), completed: false };
        currentItems = [...currentItems, newItem] as ShoppingListItem[];
      } else if (listKey === LOCALSTORAGE_KEYS.TODO_LIST) {
        const newItem: ToDoListItem = { 
          id: crypto.randomUUID(), 
          text: itemText.trim(), 
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
      toast({ title: "Item Added", description: `"${itemText.trim()}" added to your ${listName}.` });
      setInputText(''); 
    } catch (error) {
      console.error(`Error adding to ${listName}:`, error);
      toast({ title: `Error updating ${listName}`, description: "Could not save the item.", variant: "destructive" });
    } finally {
      setIsAlertDialogOpen(false);
      setIsLoading(false);
    }
  };

  const processInputTextAndRecall = async (text: string) => {
    setIsLoading(true);
    try {
      const processedData = await processTextThought(text);
      const newThought: Thought = { id: crypto.randomUUID(), timestamp: Date.now(), ...processedData };
      onThoughtRecalled(newThought);
      setInputText(''); 
      toast({ title: "Thought Processed", description: "AI processing complete." });
    } catch (error) {
      toast({ title: "Error Processing Thought", description: (error as Error).message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleProcessInputText = async () => {
    const textToProcess = inputText.trim();
    if (!textToProcess) {
      toast({ title: "Input empty", description: "Cannot process an empty thought.", variant: "destructive" });
      return;
    }
  
    const lowerText = textToProcess.toLowerCase();
  
    if (lowerText.startsWith(WAKE_WORDS.ADD_TO_SHOPPING_LIST.toLowerCase())) {
      const item = textToProcess.substring(WAKE_WORDS.ADD_TO_SHOPPING_LIST.length).trim();
      if (item) {
        setAlertDialogConfig({
          title: "Add to Shopping List?",
          description: <>Do you want to add <strong>"{item}"</strong> to your shopping list?</>,
          itemText: item,
          listKey: LOCALSTORAGE_KEYS.SHOPPING_LIST,
          listName: "Shopping List",
          onConfirm: () => addListItem(LOCALSTORAGE_KEYS.SHOPPING_LIST, item, "Shopping List"),
        });
        setIsAlertDialogOpen(true);
      } else {
        toast({ title: "No item specified", description: "Please specify an item for the shopping list.", variant: "default" });
      }
      return; // Do not set isLoading true here, wait for dialog
    } else if (lowerText.startsWith(WAKE_WORDS.ADD_TO_TODO_LIST.toLowerCase())) {
      const task = textToProcess.substring(WAKE_WORDS.ADD_TO_TODO_LIST.length).trim();
      if (task) {
         setAlertDialogConfig({
          title: "Add to To-Do List?",
          description: <>Do you want to add <strong>"{task}"</strong> to your to-do list?</>,
          itemText: task,
          listKey: LOCALSTORAGE_KEYS.TODO_LIST,
          listName: "To-Do List",
          onConfirm: () => addListItem(LOCALSTORAGE_KEYS.TODO_LIST, task, "To-Do List"),
        });
        setIsAlertDialogOpen(true);
      } else {
        toast({ title: "No task specified", description: "Please specify a task for the to-do list.", variant: "default" });
      }
      return; // Do not set isLoading true here, wait for dialog
    } else if (lowerText === WAKE_WORDS.RECALL_THOUGHT.toLowerCase()) {
      setIsLoading(true); // Set loading for this specific case
      const bufferTimeValueString = localStorage.getItem(LOCALSTORAGE_KEYS.BUFFER_TIME);
      let bufferTimeValue: BufferTimeValue = DEFAULT_BUFFER_TIME;
      if (bufferTimeValueString) {
          try {
              const parsed = JSON.parse(bufferTimeValueString) as BufferTimeValue;
              if (BUFFER_TIME_OPTIONS.some(opt => opt.value === parsed)) bufferTimeValue = parsed;
          } catch (e) { console.error("Error parsing buffer time from LS:", e); }
      }
      const bufferOption = BUFFER_TIME_OPTIONS.find(opt => opt.value === bufferTimeValue);
      const simulatedText = `Simulated recall from the ${bufferOption?.label || bufferTimeValue} buffer.`;
      await processInputTextAndRecall(simulatedText);
    } else {
      // General thought processing
      await processInputTextAndRecall(textToProcess);
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
        try { recognitionRef.current.stop(); } catch (e) { /* ignore */ }
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
          toast({ title: "Microphone Access Issue", variant: "destructive" });
        } else if (event.error === 'network') {
          toast({ title: "Network Error", variant: "destructive"});
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
        } else if (partialWakeWordDetected && !utteranceTranscriptRef.current.toLowerCase().startsWith(WAKE_WORDS.HEGSYNC_BASE.toLowerCase()) && !latestInterimForPartialCheck.includes(WAKE_WORDS.HEGSYNC_BASE.toLowerCase())) {
          setPartialWakeWordDetected(false); 
        }
        
        const lastResultIsFinal = event.results[event.results.length - 1].isFinal;

        if (lastResultIsFinal && utteranceTranscriptRef.current) {
          const finalUtterance = utteranceTranscriptRef.current; // Keep casing for display
          const finalLower = finalUtterance.toLowerCase().trim();
          
          // Prioritize immediate control commands
          if (finalLower === WAKE_WORDS.TURN_LISTENING_OFF.toLowerCase()) {
            onToggleListeningParent(false);
            commandProcessedSuccessfullyRef.current = true;
          } else if (finalLower === WAKE_WORDS.TURN_LISTENING_ON.toLowerCase()) {
            onToggleListeningParent(true);
            commandProcessedSuccessfullyRef.current = true;
          } else if (finalLower.startsWith(WAKE_WORDS.SET_BUFFER_TIME.toLowerCase())) {
            const spokenDuration = finalUtterance.substring(WAKE_WORDS.SET_BUFFER_TIME.length).trim();
            setBufferTimeByVoice(spokenDuration);
            commandProcessedSuccessfullyRef.current = true;
          } else {
            // For all other commands, populate inputText
            setInputText(finalUtterance);
            toast({ title: "Command Captured", description: "Review in input area and click Brain icon to process." });
            commandProcessedSuccessfullyRef.current = true; // Mark as processed for this recognition cycle
          }

          if (recognitionRef.current && commandProcessedSuccessfullyRef.current) {
            try { recognitionRef.current.stop(); } catch(e) { /* ignore */ }
          }
        }
      };

      try {
        if (isListening && hasMicPermission === true && !isLoading && !isDashboardDictationActive && !isActivelyLongRecording && !isExternallyLongRecording && recognitionRef.current && recognitionRef.current.onstart === recognition.onstart ) {
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
          setHasMicPermission(false);
          toast({ title: "Microphone Access Denied", variant: "destructive" });
        });
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.onstart = null; recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null; recognitionRef.current.onresult = null;
        commandProcessedSuccessfullyRef.current = true; 
        try { recognitionRef.current.stop(); } catch(e) { /* ignore */ }
        recognitionRef.current = null;
      }
       // Cleanup for long recording if component unmounts while active
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
  }, [isListening, hasMicPermission, isLoading, isDashboardDictationActive, isActivelyLongRecording, isExternallyLongRecording]);


  const handleDashboardMicClick = async () => {
    const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      toast({ title: "Browser Not Supported", variant: "destructive"});
      return;
    }
    if (isExternallyLongRecording || isActivelyLongRecording) {
      toast({ title: "Action unavailable", description: "Stop continuous recording first.", variant: "default"});
      return;
    }
    if (hasMicPermission === false) {
      toast({ title: "Microphone Access Denied", variant: "destructive"});
      return;
    }
    if (hasMicPermission === null) {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true }).then(s => s.getTracks().forEach(t=>t.stop()));
        setHasMicPermission(true);
      } catch (err) {
        setHasMicPermission(false);
        toast({ title: "Microphone Access Denied", variant: "destructive"});
        return;
      }
    }

    if (isDashboardDictationActive) {
      if (dashboardDictationRecognitionRef.current) try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
      if (dashboardDictationPauseTimeoutRef.current) clearTimeout(dashboardDictationPauseTimeoutRef.current);
      return;
    }

    commandProcessedSuccessfullyRef.current = true; 
    if (recognitionRef.current) try { recognitionRef.current.stop(); } catch(e) { /* ignore */ }
    
    setIsDashboardDictationActive(true);
    setInputText(''); // Clear for new dictation

    dashboardDictationRecognitionRef.current = new SpeechRecognitionAPI();
    const recognition = dashboardDictationRecognitionRef.current;
    recognition.continuous = true; 
    recognition.interimResults = true; 
    recognition.lang = 'en-US';

    let currentDictationTranscript = ""; 

    recognition.onstart = () => { /* Already set */ };
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      if (dashboardDictationPauseTimeoutRef.current) clearTimeout(dashboardDictationPauseTimeoutRef.current);
      
      let interim = "";
      let finalSinceLastResult = "";
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) finalSinceLastResult += event.results[i][0].transcript + " ";
        else interim += event.results[i][0].transcript;
      }

      currentDictationTranscript = (currentDictationTranscript + finalSinceLastResult).trim();
      setInputText(currentDictationTranscript + (interim ? (currentDictationTranscript ? " " : "") + interim : ""));

      const lowerTranscriptForEndCheck = (currentDictationTranscript + " " + interim).trim().toLowerCase();
      const endCommand = WAKE_WORDS.END_DICTATION.toLowerCase();
      const stopCommand = WAKE_WORDS.STOP_DICTATION.toLowerCase();

      if (lowerTranscriptForEndCheck.endsWith(endCommand) || lowerTranscriptForEndCheck.endsWith(stopCommand)) {
        let finalSpokenText = currentDictationTranscript;
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
      console.error('Dashboard dictation error:', event.error, event.message);
      if (dashboardDictationPauseTimeoutRef.current) clearTimeout(dashboardDictationPauseTimeoutRef.current);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') setHasMicPermission(false);
      else if (event.error === 'no-speech' && !inputText.trim()) toast({ title: "No speech detected", variant: "default" });
      else toast({ title: "Dictation Error", variant: "destructive" });
      setIsDashboardDictationActive(false);
      dashboardDictationRecognitionRef.current = null;
    };
    recognition.onend = () => {
      if (dashboardDictationPauseTimeoutRef.current) clearTimeout(dashboardDictationPauseTimeoutRef.current);
      setIsDashboardDictationActive(false);
      // Text remains in inputText for user to process with Brain icon.
      // No auto-submission here.
      dashboardDictationRecognitionRef.current = null; 
    };
    recognition.start();
  };

  const setBufferTimeByVoice = (spokenDuration: string) => {
    const parsedValue = parseSpokenBufferTime(spokenDuration);
    if (parsedValue) {
      localStorage.setItem(LOCALSTORAGE_KEYS.BUFFER_TIME, JSON.stringify(parsedValue));
      window.dispatchEvent(new StorageEvent('storage', { key: LOCALSTORAGE_KEYS.BUFFER_TIME, newValue: JSON.stringify(parsedValue) }));
      const matchedOption = BUFFER_TIME_OPTIONS.find(opt => opt.value === parsedValue);
      toast({ title: "Buffer Time Set", description: <>Conceptual buffer time set to <strong>{matchedOption?.label || parsedValue}</strong>.</> });
    } else {
      const currentBufferTimeVal = localStorage.getItem(LOCALSTORAGE_KEYS.BUFFER_TIME);
      const defaultOpt = BUFFER_TIME_OPTIONS.find(opt => opt.value === (currentBufferTimeVal ? JSON.parse(currentBufferTimeVal) : DEFAULT_BUFFER_TIME));
      toast({ title: "Buffer Time Not Understood", variant: "default" });
    }
  };
  
  const parseSpokenBufferTime = (spokenDuration: string): BufferTimeValue | null => {
    const cleanedSpoken = spokenDuration.toLowerCase().trim();
    if (cleanedSpoken.includes('always on') || cleanedSpoken.includes('continuous')) return 'continuous';
    for (const option of BUFFER_TIME_OPTIONS) {
      if (option.value !== 'continuous') {
        const match = cleanedSpoken.match(new RegExp(`^${option.value}\\s*(minute|min)s?$`));
        if (match) return option.value;
        if (cleanedSpoken === option.value) return option.value;
      }
    }
    return null;
  };

  const getMicIconForCardHeader = () => {
    if (isActivelyLongRecording || isExternallyLongRecording) return <Radio className="h-5 w-5 text-red-500 animate-pulse" />
    if (isDashboardDictationActive) return <Radio className="h-5 w-5 text-red-500 animate-pulse" />;
    if (partialWakeWordDetected) return <Mic className="h-5 w-5 text-yellow-500 animate-pulse" />;
    if (isRecognizingSpeech) return <Mic className="h-5 w-5 text-primary animate-pulse" />;
    if (isListening && hasMicPermission && !isBrowserUnsupported && !isLoading) return <Mic className="h-5 w-5 text-primary" />;
    return <MicOff className="h-5 w-5 text-muted-foreground" />;
  };

  const getMicStatusText = (): React.ReactNode => {
    if (isActivelyLongRecording || isExternallyLongRecording) return "Continuous recording active...";
    if (isDashboardDictationActive) return "Dictating to input area...";
    if (isLoading && !isAlertDialogOpen) return "Processing..."; // Don't show processing if dialog is open
    if (!isListening) return "Voice Inactive";
    if (isBrowserUnsupported) return "Voice N/A";
    if (hasMicPermission === false) return "Mic Denied";
    if (hasMicPermission === null) return "Mic Awaiting Permission...";
    if (partialWakeWordDetected) return <>'<strong>HegSync</strong>' detected, awaiting command...</>;
    if (isListening && hasMicPermission && !isBrowserUnsupported) return <>Listener active for '<strong>HegSync</strong>'</>;
    return "Voice status checking...";
  };

  const getTextareaPlaceholder = (): string => {
    if (isActivelyLongRecording || isExternallyLongRecording) return "Continuous recording active. Speech will be transcribed here when stopped.";
    if (isDashboardDictationActive) return "Listening... Say 'HegSync end' or 'HegSync stop' to finish dictation.";
    if (isLoading && !isAlertDialogOpen) return "Processing...";
    if (partialWakeWordDetected) return "'HegSync' detected. Finish your command, or type for manual input.";
    if (isRecognizingSpeech) return "Listener active for 'HegSync', or type for manual input.";
    if (!isListening) return "Enable listening to activate voice commands or manual input.";
    return "Enter thought, or use voice commands to populate this area...";
  };
  
  const getDashboardDictationButtonIcon = () => { 
    if (isDashboardDictationActive) return <Radio className="h-5 w-5 text-red-500 animate-pulse" />;
    if (!isListening || hasMicPermission !== true || isRecognizingSpeech || isActivelyLongRecording || isExternallyLongRecording || isLoading) return <MicOff className="h-5 w-5 text-muted-foreground" />;
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
            Voice commands populate the text area below. Click the <Brain className="inline-block h-3.5 w-3.5 mx-0.5"/> icon to process.
            The <Mic className="inline-block h-3.5 w-3.5 mx-0.5 text-primary"/> icon button (next to Brain) is for direct dictation.
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
              disabled={!isListening || isLoading || isDashboardDictationActive || isActivelyLongRecording || isExternallyLongRecording}
              className="resize-none"
              aria-label="Thought input area"
            />
            <div className="flex items-stretch gap-2">
              <Button
                type="button" 
                onClick={handleProcessInputText}
                disabled={!isListening || isLoading || isDashboardDictationActive || isActivelyLongRecording || isExternallyLongRecording || !inputText.trim()}
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
                disabled={!isListening || isLoading || isActivelyLongRecording || isExternallyLongRecording || (isRecognizingSpeech && !isDashboardDictationActive && !partialWakeWordDetected) || hasMicPermission === false}
                size="icon"
                className="p-2 h-auto"
                aria-label="Dictate thought into text area"
                title="Dictate thought into text area (ends on pause or 'HegSync end/stop')"
              >
                {getDashboardDictationButtonIcon()}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {alertDialogConfig && (
        <AlertDialog open={isAlertDialogOpen} onOpenChange={setIsAlertDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{alertDialogConfig.title}</AlertDialogTitle>
              <AlertDialogDescription>
                {alertDialogConfig.description}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => { setIsLoadingAlertDialogOpen(false); setInputText(''); setIsLoading(false); }}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => {
                alertDialogConfig.onConfirm();
                // setIsLoading(false); // Already handled in onConfirm
              }}>Confirm</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
});

ThoughtInputForm.displayName = "ThoughtInputForm";
