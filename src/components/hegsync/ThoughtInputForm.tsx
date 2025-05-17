
"use client";

import { useState, useEffect, useRef } from 'react';
import { Brain, Loader2, Mic, MicOff, AlertTriangleIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { processRecalledAudio } from '@/lib/actions';
import type { Thought } from '@/lib/types';

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
  const [isBrowserUnsupported, setIsBrowserUnsupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const wakeWordDetectedRef = useRef(false);


  const processThoughtInput = async () => {
    if (!inputText.trim()) {
      toast({ title: "Input empty", description: "Please provide some text to recall.", variant: "destructive" });
      return;
    }
    // For manual button submit, ensure global listening is active.
    // For wake word, isListening prop would have already been true to start recognition.
    if (!isListening && !wakeWordDetectedRef.current) {
      toast({ title: "Listening Inactive", description: "Please enable passive listening to recall a thought.", variant: "destructive" });
      return;
    }

    if (recognitionRef.current && isRecognizingSpeech) {
      recognitionRef.current.stop(); // Stop listening while processing
    }
    // wakeWordDetectedRef.current is reset in handleManualSubmit or if wake word path taken

    setIsLoading(true);
    try {
      const processedData = await processRecalledAudio(inputText);
      const newThought: Thought = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        ...processedData,
      };
      onThoughtRecalled(newThought);
      setInputText('');
      toast({ title: "Thought Recalled", description: "AI processing complete." });
    } catch (error) {
      toast({ title: "Error Recalling Thought", description: (error as Error).message, variant: "destructive" });
    } finally {
      setIsLoading(false);
      // Speech recognition restart is handled by its 'onend' logic if isListening is still true.
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    wakeWordDetectedRef.current = false; // Explicitly reset for manual submissions
    await processThoughtInput();
  };

  useEffect(() => {
    const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      setIsBrowserUnsupported(true);
      setHasMicPermission(false);
      return;
    }
    setIsBrowserUnsupported(false);

    if (!isListening) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsRecognizingSpeech(false);
      return;
    }

    // If already recognizing, or permission explicitly denied, or form is loading, don't re-init
    if (isRecognizingSpeech || hasMicPermission === false || isLoading) {
      return;
    }
    
    // Try to get permission first explicitly if not determined
    if (hasMicPermission === null) {
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then(() => {
          setHasMicPermission(true);
          // Now that permission is confirmed, the effect will re-run and setup recognition.
        })
        .catch(err => {
          console.error("Microphone permission error:", err);
          setHasMicPermission(false);
          toast({ title: "Microphone Access Denied", description: "Voice commands require microphone access. Please enable it in your browser settings.", variant: "destructive" });
        });
      return; // Wait for permission state to update and effect to re-run
    }


    recognitionRef.current = new SpeechRecognitionAPI();
    const recognition = recognitionRef.current;

    recognition.continuous = true;
    recognition.interimResults = false; // Only final results for wake word
    recognition.lang = 'en-US';

    let restartTimer: NodeJS.Timeout | null = null;

    recognition.onstart = () => {
      setIsRecognizingSpeech(true);
      // setHasMicPermission(true); // Permission must have been true to reach here
    };

    recognition.onend = () => {
      setIsRecognizingSpeech(false);
      if (isListening && hasMicPermission && !isLoading && recognitionRef.current && !wakeWordDetectedRef.current) {
        if (restartTimer) clearTimeout(restartTimer);
        restartTimer = setTimeout(() => {
          if (isListening && hasMicPermission && !isLoading && recognitionRef.current) { // Check conditions again
            try {
              if (!isRecognizingSpeech) recognitionRef.current.start(); // Check if already started to avoid error
            } catch (e) {
              console.warn("Recognition restart prevented or failed:", e);
            }
          }
        }, 300); 
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error('Speech recognition error:', event.error, event.message);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setHasMicPermission(false);
        toast({ title: "Microphone Access Denied", description: "Please enable microphone access in browser settings for voice commands.", variant: "destructive" });
      } else if (event.error === 'no-speech') {
        // This is normal, onend will handle restart if conditions are met
      } else if (event.error === 'network') {
        toast({ title: "Network Error", description: "Speech recognition might require a network connection.", variant: "destructive"});
      } else if (event.error === 'aborted') {
        // Usually means stop() was called, which is fine.
      } else {
        toast({ title: "Speech Error", description: `Voice recognition faced an issue: ${event.error}`, variant: "destructive"});
      }
      // recognition.stop() might be called implicitly by the browser after an error, onend will handle it.
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        }
      }
      const command = finalTranscript.trim().toLowerCase();

      if (command.includes('hegsync replay that')) {
        toast({ title: "Wake Word Detected!", description: "Processing your thought..." });
        if (inputText.trim()) {
          wakeWordDetectedRef.current = true; // Set flag to indicate wake word triggered this
          processThoughtInput(); // Call the shared processing logic
        } else {
          toast({ title: "Input Empty", description: "Please type or paste the thought to process before using the wake word.", variant: "default" });
          wakeWordDetectedRef.current = false; // Reset if input was empty
        }
      }
    };

    try {
      if(!isRecognizingSpeech) recognition.start();
    } catch (e) {
      console.error("Failed to start speech recognition:", e);
      setHasMicPermission(false); 
      toast({ title: "Mic Init Failed", description: "Could not start voice recognition. Check mic & browser permissions.", variant: "destructive" });
    }

    return () => {
      if (restartTimer) clearTimeout(restartTimer);
      if (recognitionRef.current) {
        recognitionRef.current.onstart = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onresult = null;
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
      setIsRecognizingSpeech(false);
    };
  }, [isListening, toast, inputText, isLoading, hasMicPermission, onThoughtRecalled]); // processThoughtInput was removed from deps as it causes re-renders and re-init of speech rec

  return (
    <Card className="w-full shadow-lg">
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle className="text-xl">Recall Thought</CardTitle>
          {isListening && hasMicPermission && !isBrowserUnsupported && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground" title={isRecognizingSpeech ? "Listening for 'Hegsync replay that'" : "Voice commands inactive"}>
              {isRecognizingSpeech ? <Mic className="h-5 w-5 text-primary animate-pulse" /> : <MicOff className="h-5 w-5" />}
              <span>{isRecognizingSpeech ? "Listening..." : "Voice Paused"}</span>
            </div>
          )}
        </div>
        <CardDescription>
          {isListening
            ? "The (simulated) audio buffer is ready. Paste or type content below to process it, or say \"Hegsync replay that\"."
            : "Enable passive listening above to recall the current audio buffer."}
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
              Voice commands require microphone access. Please enable it in your browser settings and refresh. Manual input is still available.
            </AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleManualSubmit} className="space-y-4">
          <Textarea
            placeholder={isListening ? "Paste or type your recalled thought here... (simulated audio buffer)" : "Enable listening to activate input..."}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            rows={4}
            disabled={!isListening || isLoading}
            className="resize-none"
            aria-label="Recalled thought input area"
          />
          <div className="flex items-stretch gap-2">
            <Button 
              type="submit" 
              disabled={!isListening || isLoading || !inputText.trim()} 
              className="flex-grow"
              aria-label="Process thought with AI"
            >
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Brain className="mr-2 h-4 w-4" />}
              Process with AI
            </Button>
            <Button
              type="submit"
              disabled={!isListening || isLoading || !inputText.trim()}
              size="icon"
              className="p-2 h-auto" 
              aria-label="Recall thought with Brain icon"
              title="Recall with Brain"
            >
              <Brain className={`h-5 w-5 ${isLoading ? 'animate-pulse' : ''}`} />
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

    