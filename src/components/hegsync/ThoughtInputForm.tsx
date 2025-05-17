
"use client";

import { useState, useEffect, useRef, FormEvent } from 'react';
import { Brain, Loader2, Mic, MicOff, AlertTriangleIcon, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { processTextThought, processRecordedAudio } from '@/lib/actions';
import type { Thought, ShoppingListItem } from '@/lib/types';
import { 
  WAKE_WORDS, 
  LOCALSTORAGE_KEYS,
  RECORDING_DURATION_MS,
} from '@/lib/constants';

interface ThoughtInputFormProps {
  onThoughtRecalled: (thought: Thought) => void;
  isListening: boolean; // Global passive listening state from parent
}

export function ThoughtInputForm({ onThoughtRecalled, isListening }: ThoughtInputFormProps) {
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
  
  const handleProcessTextThought = async (textToProcess: string) => {
    if (!textToProcess.trim()) {
      toast({ title: "Input empty", description: "Cannot process an empty thought.", variant: "destructive" });
      return;
    }
    setIsLoading(true);
    setPartialWakeWordDetected(false); // Ensure this is reset
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
    setPartialWakeWordDetected(false); // Ensure this is reset
    setIsCapturingAudio(false); 
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
    }
  };

  const startAudioRecording = async () => {
    if (isCapturingAudio || !hasMicPermission) {
      toast({ title: "Recording Issue", description: isCapturingAudio ? "Already capturing audio." : "Microphone permission needed.", variant: "default" });
      return;
    }
    setPartialWakeWordDetected(false); // Stop showing partial detection message

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setIsCapturingAudio(true);
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
          handleProcessRecordedAudio(base64AudioData);
        };
        
        stream.getTracks().forEach(track => track.stop()); 
        // setIsCapturingAudio(false); // Moved to handleProcessRecordedAudio finally block implicitly
        audioChunksRef.current = [];
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
      setIsCapturingAudio(false);
      setHasMicPermission(false); 
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await handleProcessTextThought(inputText);
  };

  const addShoppingListItem = (itemText: string) => {
    if (!itemText.trim()) {
      toast({ title: "No item specified", description: `Please say the item you want to add after '${WAKE_WORDS.ADD_TO_SHOPPING_LIST}'.`, variant: "default" });
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
      toast({ title: "Item Added to Shopping List", description: `"${itemText.trim()}" added.` });
    } catch (error) {
      console.error("Error adding to shopping list:", error);
      toast({ title: "Error updating Shopping List", description: "Could not save the item.", variant: "destructive" });
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
      if (recognitionRef.current && isRecognizingSpeech) {
        recognitionRef.current.stop();
      }
      setPartialWakeWordDetected(false); // Ensure reset if conditions not met
      return;
    }
    
    if (hasMicPermission === null) {
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
      return; 
    }

    if (!recognitionRef.current && hasMicPermission === true && !isRecognizingSpeech && !isCapturingAudio) {
      recognitionRef.current = new SpeechRecognitionAPI();
      const recognition = recognitionRef.current;

      recognition.continuous = true; 
      recognition.interimResults = true; // Enable interim results
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsRecognizingSpeech(true);
        setPartialWakeWordDetected(false); // Reset on start
      };

      recognition.onend = () => {
        setIsRecognizingSpeech(false);
        setPartialWakeWordDetected(false); // Reset on end
        recognitionRef.current = null; 
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (event.error === 'no-speech' || event.error === 'aborted') {
          console.warn('Speech recognition warning:', event.error, event.message || "(No specific message)");
        } else {
          console.error('Speech recognition error:', event.error, event.message);
        }
        
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          setHasMicPermission(false); 
          toast({ title: "Microphone Access Issue", description: "Speech recognition service denied. Check browser settings or permissions.", variant: "destructive" });
        } else if (event.error === 'network') {
          toast({ title: "Network Error", description: "Speech recognition might require a network connection.", variant: "destructive"});
        } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
          toast({ title: "Speech Error", description: `Voice recognition faced an issue: ${event.error}`, variant: "destructive"});
        }
        setPartialWakeWordDetected(false); // Reset on error too
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let combinedInterimTranscript = '';
        let combinedFinalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const transcriptPart = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            combinedFinalTranscript += transcriptPart;
          } else {
            combinedInterimTranscript += transcriptPart;
          }
        }

        const interimLower = combinedInterimTranscript.toLowerCase();
        const finalLower = combinedFinalTranscript.trim().toLowerCase();

        if (finalLower) { // If there's any final transcript, we are done with partial detection
          setPartialWakeWordDetected(false);
          if (finalLower.startsWith(WAKE_WORDS.ADD_TO_SHOPPING_LIST.toLowerCase())) {
            if (recognitionRef.current) recognitionRef.current.stop(); 
            const itemToAdd = finalLower.substring(WAKE_WORDS.ADD_TO_SHOPPING_LIST.length).trim();
            addShoppingListItem(itemToAdd);
          } else if (finalLower.includes(WAKE_WORDS.RECALL_THOUGHT.toLowerCase())) { 
            if (recognitionRef.current) recognitionRef.current.stop(); 
            toast({ title: "Recall Command Detected!", description: "Starting audio capture..." });
            startAudioRecording();
          }
          // If final transcript is just "hegsync" or something not a command, it will do nothing and restart.
        } else if (interimLower.includes("hegsync")) {
          setPartialWakeWordDetected(true);
        } else {
          // If interim doesn't contain "hegsync" anymore, and we were in partial state, reset.
          // This handles cases where "hegsync" was misrecognized and then corrected.
          if(partialWakeWordDetected) {
            setPartialWakeWordDetected(false);
          }
        }
      };
      
      try {
        if (isListening && hasMicPermission && !isLoading && !isCapturingAudio) { 
          recognition.start();
        }
      } catch (e) {
        console.error("Failed to start speech recognition:", e);
        toast({title: "Speech Recognition Error", description: "Could not start voice listener.", variant: "destructive"});
      }
    }
    
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.onstart = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onresult = null;
        if (isRecognizingSpeech) {
            try { recognitionRef.current.stop(); } catch(e) { console.warn("Error stopping recognition in cleanup:", e); }
        }
        recognitionRef.current = null;
      }
      setIsRecognizingSpeech(false);
      setPartialWakeWordDetected(false);

      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current = null;
      }
      setIsCapturingAudio(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps 
  }, [isListening, hasMicPermission, isLoading, isCapturingAudio]); 

  const getMicIcon = () => {
    if (isCapturingAudio) return <Radio className="h-5 w-5 text-red-500 animate-pulse" />;
    if (partialWakeWordDetected) return <Mic className="h-5 w-5 text-yellow-500 animate-pulse" />; // Indicate "Hegsync" heard
    if (isRecognizingSpeech) return <Mic className="h-5 w-5 text-primary animate-pulse" />;
    return <MicOff className="h-5 w-5" />;
  };

  const getMicStatusText = () => {
    if (isCapturingAudio) return "Recording audio...";
    if (isLoading) return "Processing...";

    if (!isListening) return "Voice Inactive";

    if (isBrowserUnsupported) return "Voice N/A";
    if (hasMicPermission === false) return "Mic Denied";
    if (hasMicPermission === null) return "Mic Awaiting Permission...";
    
    if (partialWakeWordDetected) return "'Hegsync' detected, awaiting command...";
    if (isRecognizingSpeech) return "Say 'Hegsync' + command";
    
    return "Voice Ready";
  };

  return (
    <Card className="w-full shadow-lg">
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle className="text-xl">Input & Recall</CardTitle>
          {isListening && hasMicPermission !== null && !isBrowserUnsupported && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground" title={getMicStatusText()}>
              {getMicIcon()}
              <span>{getMicStatusText()}</span>
            </div>
          )}
        </div>
        <CardDescription>
           {isListening
            ? `Voice: Say "${WAKE_WORDS.RECALL_THOUGHT}" (records live audio) or "${WAKE_WORDS.ADD_TO_SHOPPING_LIST} [item]".
               Text: Use area below and "Process Thought (from text)" button.`
            : "Enable passive listening above to use voice commands or text input."}
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
            placeholder={
              isListening 
                ? isCapturingAudio 
                  ? "Recording audio snippet..." 
                  : partialWakeWordDetected
                    ? "'Hegsync' detected. Finish your command..."
                    : "Type or paste text for manual processing, or use voice commands..." 
                : "Enable listening to activate input..."
            }
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            rows={4}
            disabled={!isListening || isLoading || isCapturingAudio}
            className="resize-none"
            aria-label="Recalled thought input area for manual processing"
          />
          <div className="flex items-stretch gap-2">
            <Button 
              type="button" // Changed to button to prevent form submit if not desired
              onClick={handleManualSubmit} // Kept explicit handler
              disabled={!isListening || isLoading || isCapturingAudio || !inputText.trim()} 
              className="flex-grow"
              title="Process thought from text area with AI"
            >
              {isLoading && inputText.trim() && !isCapturingAudio ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Brain className="mr-2 h-4 w-4" />}
              Process Thought (from text)
            </Button>
             <Button
              type="button" // Changed to button
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
          The "{WAKE_WORDS.RECALL_THOUGHT}" voice command records a {RECORDING_DURATION_MS / 1000}-second audio snippet for processing.
          The shopping list voice command operates independently.
        </p>
      </CardContent>
    </Card>
  );
}
    
