
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
  isListening: boolean;
  onToggleListeningParent: (isListening: boolean) => void;
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

    const [hasMicPermission, setHasMicPermission] = useState<boolean | null>(null);
    const [isRecognizingSpeech, setIsRecognizingSpeech] = useState(false);
    const [isBrowserUnsupported, setIsBrowserUnsupported] = useState(false);
    const [partialWakeWordDetected, setPartialWakeWordDetected] = useState(false);
    const recognitionRef = useRef<SpeechRecognition | null>(null);
    const utteranceTranscriptRef = useRef<string>('');
    const commandProcessedSuccessfullyRef = useRef<boolean>(false); // True if a command finishes and listener should reset state
    
    // States for dashboard direct dictation mic button
    const [isDashboardDictationActive, setIsDashboardDictationActive] = useState(false);
    const dashboardDictationRecognitionRef = useRef<SpeechRecognition | null>(null);
    const dashboardDictationPauseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const dashboardDictationAccumulatedTranscriptRef = useRef<string>(''); // Accumulates final transcript for dashboard dictation

    // States for 10-second "Heggles replay that" recording
    const [isCapturingAudioForSnippet, setIsCapturingAudioForSnippet] = useState(false);
    const snippetMediaRecorderRef = useRef<MediaRecorder | null>(null);
    const snippetRecognitionRef = useRef<SpeechRecognition | null>(null);
    const snippetTranscriptRef = useRef<string>('');
    const snippetAudioChunksRef = useRef<Blob[]>([]);

    // States for continuous recording (from header button)
    const [isCapturingAudioForLongRecording, setIsCapturingAudioForLongRecording] = useState(false);
    const longRecordingMediaRecorderRef = useRef<MediaRecorder | null>(null);
    const longRecordingSpeechRecognizerRef = useRef<SpeechRecognition | null>(null);
    const longRecordingTranscriptRef = useRef<string>('');
    const longRecordingAudioChunksRef = useRef<Blob[]>([]);

    // State for AlertDialog
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
      commandProcessedSuccessfullyRef.current = true; // Signal this command is done
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

      // Stop main command listener if active
      if (recognitionRef.current) {
        commandProcessedSuccessfullyRef.current = true; // Signal that "heggles replay that" initiated this action
        try { recognitionRef.current.stop(); } catch (e) { console.warn("Error stopping main rec before snippet:", e); }
      }
      setIsRecognizingSpeech(false);
      setPartialWakeWordDetected(false);
      utteranceTranscriptRef.current = ''; // Clear any partial main command

      setIsCapturingAudioForSnippet(true);
      snippetTranscriptRef.current = '';
      snippetAudioChunksRef.current = [];
      toast({ title: "Recording Audio & Speech...", description: `Capturing for ${RECORDING_DURATION_MS / 1000} seconds.` });

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        snippetMediaRecorderRef.current = new MediaRecorder(stream);
        snippetMediaRecorderRef.current.ondataavailable = (event) => {
          if (event.data.size > 0) {
            snippetAudioChunksRef.current.push(event.data);
          }
        };
        snippetMediaRecorderRef.current.onstop = async () => {
          stream.getTracks().forEach(track => track.stop()); // Stop all tracks from the stream

          const audioBlob = new Blob(snippetAudioChunksRef.current, { type: 'audio/webm' });
          snippetAudioChunksRef.current = [];

          const base64AudioData = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.readAsDataURL(audioBlob);
            reader.onloadend = () => resolve(reader.result as string);
          });

          const liveTranscript = snippetTranscriptRef.current.trim();
          snippetTranscriptRef.current = ''; // Reset for next recording

          setIsLoading(true);
          try {
            const processedData = await processRecordedAudio(base64AudioData, liveTranscript);
            onThoughtRecalled({ id: crypto.randomUUID(), timestamp: Date.now(), ...processedData });
            toast({ title: "Recorded Snippet Processed", description: "AI analysis complete." });
          } catch (error) {
            toast({ title: "Error Processing Snippet", description: (error as Error).message, variant: "destructive" });
          } finally {
            setIsLoading(false);
            setIsCapturingAudioForSnippet(false);
          }
        };
        snippetMediaRecorderRef.current.start();

        // Start snippet-specific speech recognition
        snippetRecognitionRef.current = new SpeechRecognitionAPI();
        const snippetRecognizer = snippetRecognitionRef.current;
        snippetRecognizer.continuous = true; // Listen continuously during the 10s
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
          // We don't update any UI input with this transcript, it's purely for the snippet processing
        };
        snippetRecognizer.onerror = (event: SpeechRecognitionErrorEvent) => {
          console.warn('Snippet transcription error:', event.error, event.message);
        };
        snippetRecognizer.onend = () => {
          snippetRecognitionRef.current = null; // Ensure it's cleaned up for next time
        };
        snippetRecognizer.start();

        // Stop both media recorder and snippet recognizer after duration
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
        if (!isListening || hasMicPermission !== true || isLoading || isCapturingAudioForSnippet || isCapturingAudioForLongRecording || isDashboardDictationActive) {
          toast({ title: "Cannot Simulate Wake Word", description: "System is busy or listener is off/denied.", variant: "default"});
          return;
        }
        // If main recognition is active, stop it to allow clean restart with pre-filled "heggles"
        if (recognitionRef.current) {
          commandProcessedSuccessfullyRef.current = false; // Ensure utterance isn't cleared by onend
          try { recognitionRef.current.stop(); } catch(e) { /* ignore */ }
          // The onend will set recognitionRef.current to null, useEffect will restart
        }
        
        setPartialWakeWordDetected(true);
        utteranceTranscriptRef.current = WAKE_WORDS.HEGGLES_BASE + " "; // Prime with heggles and a space
        setInputText(utteranceTranscriptRef.current);
        toast({ title: "Heggles Activated", description: "Listening for your command...", duration: 2000 });
        
        // The main useEffect for recognitionRef will pick up the changes and restart if needed
      },
      startLongRecording: () => {
        if (!isListening || hasMicPermission !== true || isLoading || isDashboardDictationActive || isCapturingAudioForSnippet || isCapturingAudioForLongRecording) {
          return false; // Cannot start if conditions not met
        }
        // Stop other listeners
        if (recognitionRef.current) { commandProcessedSuccessfullyRef.current = true; try { recognitionRef.current.stop(); } catch(e) {/*ignore*/} }
        if (dashboardDictationRecognitionRef.current) { try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/} }
        setIsRecognizingSpeech(false);
        setPartialWakeWordDetected(false);
        setIsDashboardDictationActive(false);
        utteranceTranscriptRef.current = ''; // Clear main command buffer

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
            setInputText(""); // Clear input text area

            // Setup speech recognizer for long recording
            longRecordingSpeechRecognizerRef.current = new SpeechRecognitionAPI();
            const recognizer = longRecordingSpeechRecognizerRef.current;
            recognizer.continuous = true;
            recognizer.interimResults = true; // Show interim results in textarea
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
              // The actual processing and setting of inputText with final transcript happens in mediaRecorder.onstop
            };
            recognizer.start();

            // Setup media recorder for long recording
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            longRecordingMediaRecorderRef.current = new MediaRecorder(stream);
            longRecordingMediaRecorderRef.current.ondataavailable = (event) => {
              if (event.data.size > 0) {
                longRecordingAudioChunksRef.current.push(event.data);
              }
            };
            longRecordingMediaRecorderRef.current.onstop = async () => {
              stream.getTracks().forEach(track => track.stop()); // Stop stream tracks
              // const audioBlob = new Blob(longRecordingAudioChunksRef.current, { type: 'audio/webm' }); // Audio data is captured but not sent anywhere yet.
              longRecordingAudioChunksRef.current = []; // Clear chunks
              
              // Ensure final transcript is set to inputText
              setInputText(longRecordingTranscriptRef.current.trim()); 
              // longRecordingTranscriptRef.current = ''; // Reset for next time - actually, let it be for now, if user clicks process.

              setIsCapturingAudioForLongRecording(false); // Update state
              onStopLongRecordingParent(); // Notify parent
              toast({ title: "Recording Stopped", description: "Transcript populated. Click Brain icon to process." });
            };
            longRecordingMediaRecorderRef.current.start();
            return true;

          } catch (err) {
            console.error("Error starting continuous recording:", err);
            toast({ title: "Continuous Recording Error", description: `Could not start recording: ${(err as Error).message}`, variant: "destructive" });
            setIsCapturingAudioForLongRecording(false);
            setInputText(""); // Clear input text on error
            if (longRecordingSpeechRecognizerRef.current) { try { longRecordingSpeechRecognizerRef.current.stop(); } catch (e) {/* ignore */}}
            if (longRecordingMediaRecorderRef.current && longRecordingMediaRecorderRef.current.state === "recording") {
              try { longRecordingMediaRecorderRef.current.stop(); } catch (e) {/* ignore */}
            }
            onStopLongRecordingParent(); // Notify parent
            return false;
          }
        };
        startRecordingFlow(); // Call the async function
        return true; // Return true synchronously, actual start is async
      },
      stopLongRecordingAndProcess: () => {
        if (!isCapturingAudioForLongRecording) return;

        if (longRecordingSpeechRecognizerRef.current) {
          try { longRecordingSpeechRecognizerRef.current.stop(); } catch(e) { /* ignore */ }
        }
        if (longRecordingMediaRecorderRef.current && longRecordingMediaRecorderRef.current.state === "recording") {
          try { longRecordingMediaRecorderRef.current.stop(); } catch(e) { /* onstop will handle the rest */ }
        } else {
          // If media recorder wasn't running or already stopped, ensure UI state is correct
          setInputText(longRecordingTranscriptRef.current.trim()); // Ensure text area has the final transcript
          setIsCapturingAudioForLongRecording(false);
          onStopLongRecordingParent();
        }
      },
    }));

    // Effect for main "Heggles" command listener
    useEffect(() => {
      const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognitionAPI) {
        // Already handled by hasMicPermission check for initial setup
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
          commandProcessedSuccessfullyRef.current = false; // Reset for new listening session
        };

        recognition.onend = () => {
          setIsRecognizingSpeech(false);
          if (commandProcessedSuccessfullyRef.current) { // If a command was fully processed or an action taken
            setPartialWakeWordDetected(false);
            utteranceTranscriptRef.current = '';
            // setInputText(''); // Don't clear inputText here, it's populated for user to see/process
          }
          recognitionRef.current = null; // Critical to allow re-initialization by this useEffect
        };

        recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
          if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            setHasMicPermission(false);
            toast({ title: "Microphone Access Issue", variant: "destructive", description: "Speech recognition service denied. Check browser settings." });
          } else if (event.error !== 'no-speech' && event.error !== 'aborted') { // no-speech and aborted are common
            console.error('Main command recognition error:', event.error, event.message);
          }
          // Reset states on error to allow restart
          setPartialWakeWordDetected(false);
          utteranceTranscriptRef.current = '';
          commandProcessedSuccessfullyRef.current = true; // Treat as if command cycle ended
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

          if (newlyFinalizedSegmentThisTurn) {
            if (partialWakeWordDetected) {
              utteranceTranscriptRef.current = (utteranceTranscriptRef.current + " " + newlyFinalizedSegmentThisTurn).trim();
            } else if (newlyFinalizedSegmentThisTurn.toLowerCase().startsWith(hegglesBaseLower)) {
              setPartialWakeWordDetected(true);
              utteranceTranscriptRef.current = newlyFinalizedSegmentThisTurn.trim(); // Start fresh with Heggles
            }
          }
          
          // Update inputText only if wake word detected or was previously detected
          if (partialWakeWordDetected) {
            setInputText(utteranceTranscriptRef.current + (currentInterimSegment ? " " + currentInterimSegment.trim() : ""));
          } else if (currentInterimSegment.toLowerCase().includes(hegglesBaseLower)) {
            // If Heggles is in the *interim* for the first time in this segment
            setPartialWakeWordDetected(true);
            // For interim, just show what's being said starting with Heggles
            const hegglesIndex = currentInterimSegment.toLowerCase().indexOf(hegglesBaseLower);
            const relevantInterim = currentInterimSegment.substring(hegglesIndex);
            setInputText(relevantInterim.trim());
            utteranceTranscriptRef.current = relevantInterim.trim(); // Tentatively set utterance
          }


          const lastResultIsFinal = event.results[event.results.length - 1].isFinal;

          if (lastResultIsFinal && utteranceTranscriptRef.current) {
            const finalUtterance = utteranceTranscriptRef.current.trim();
            const finalLower = finalUtterance.toLowerCase();

            if (!finalLower.startsWith(hegglesBaseLower)) {
              // Final utterance does not start with Heggles, so ignore and reset.
              commandProcessedSuccessfullyRef.current = true; // End this cycle
              if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch(e) { /* ignore */ } }
              return;
            }

            // Check for immediate action commands first
            if (finalLower === WAKE_WORDS.HEGGLES_TURN_OFF.toLowerCase()) {
              onToggleListeningParent(false);
              // State cleared by onend because commandProcessedSuccessfullyRef will be true
            } else if (finalLower === WAKE_WORDS.HEGGLES_TURN_ON.toLowerCase()) {
              onToggleListeningParent(true);
              // State cleared by onend
            } else if (finalLower.startsWith(WAKE_WORDS.HEGGLES_SET_BUFFER.toLowerCase())) {
              const spokenDuration = finalUtterance.substring(WAKE_WORDS.HEGGLES_SET_BUFFER.length).trim();
              setBufferTimeByVoice(spokenDuration); // This sets commandProcessedSuccessfullyRef to true
            } else if (finalLower === WAKE_WORDS.HEGGLES_REPLAY_THAT.toLowerCase()) {
              startAudioRecordingForSnippet(); // This will set commandProcessedSuccessfullyRef to true and stop main listener
              setInputText(''); // Clear "heggles replay that" from input
            } else {
              // For all other "heggles..." commands or "heggles [unrecognized text]"
              // The text is already in inputText due to the logic above.
              // We mark this "command" cycle as done, so the listener can restart.
              // User will click Brain icon to process inputText.
              toast({title: "Command Ready", description: <><strong>{finalUtterance}</strong> populated. Click Brain icon to process.</>});
              commandProcessedSuccessfullyRef.current = true;
            }
            
            // Stop recognition if a command was processed or ready for manual submission
            if (recognitionRef.current && commandProcessedSuccessfullyRef.current) {
              try { recognitionRef.current.stop(); } catch(e) { console.warn("Error stopping main cmd rec after final result:", e); }
            } else if (finalLower === hegglesBaseLower && !commandProcessedSuccessfullyRef.current) {
              // Only "heggles" was said, keep listening. commandProcessedSuccessfullyRef remains false.
              // utteranceTranscriptRef.current already holds "heggles".
              // setInputText ensures "heggles" is visible.
            }
          }
        };
        
        try {
          if (recognitionRef.current && typeof recognitionRef.current.start === 'function') {
            commandProcessedSuccessfullyRef.current = false; // Reset for new listening session
            recognitionRef.current.start();
          }
        } catch (e) {
          console.error("Failed to start main command speech recognition:", e);
          if (recognitionRef.current) { // Ensure ref is nulled if start fails
            recognitionRef.current = null;
          }
        }

      } else if (!shouldBeListening && recognitionRef.current) {
        commandProcessedSuccessfullyRef.current = true; // Ensure state is cleared if listener is stopped externally
        try {
          recognitionRef.current.stop();
        } catch(e) {
          console.warn("Error stopping main command recognition (in useEffect else):", e);
        }
        // onend will set recognitionRef.current to null
      }

      // Cleanup function for the useEffect
      return () => {
        if (recognitionRef.current) {
          commandProcessedSuccessfullyRef.current = true; // Signal cleanup on unmount
          try { recognitionRef.current.stop(); } catch (e) { /* ignore */ }
          recognitionRef.current = null;
        }
        // Cleanup for dashboard dictation
        if (dashboardDictationRecognitionRef.current) {
          try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
          dashboardDictationRecognitionRef.current = null;
        }
        if (dashboardDictationPauseTimeoutRef.current) {
          clearTimeout(dashboardDictationPauseTimeoutRef.current);
        }
        // Cleanup for snippet recording
        if (snippetRecognitionRef.current) {
          try { snippetRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
          snippetRecognitionRef.current = null;
        }
        if (snippetMediaRecorderRef.current && snippetMediaRecorderRef.current.state === "recording") {
          try { snippetMediaRecorderRef.current.stop(); } catch(e) {/*ignore*/}
          snippetMediaRecorderRef.current = null;
        }
        // Cleanup for long recording
        if (longRecordingSpeechRecognizerRef.current) {
            try { longRecordingSpeechRecognizerRef.current.stop(); } catch(e) {/*ignore*/}
            longRecordingSpeechRecognizerRef.current = null;
        }
        if (longRecordingMediaRecorderRef.current && longRecordingMediaRecorderRef.current.state === "recording") {
            try { longRecordingMediaRecorderRef.current.stop(); } catch(e) {/*ignore*/}
            longRecordingMediaRecorderRef.current = null;
        }
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      isListening, 
      hasMicPermission, 
      isLoading, 
      isCapturingAudioForSnippet, 
      isDashboardDictationActive,
      isCapturingAudioForLongRecording,
      // Stable props/callbacks:
      onToggleListeningParent,
      setBufferTimeByVoice, // Already memoized
      startAudioRecordingForSnippet, // Already memoized
      toast 
    ]);


    // Effect to get initial microphone permission
    useEffect(() => {
      const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognitionAPI) {
        setIsBrowserUnsupported(true);
        setHasMicPermission(false);
        return;
      }
      setIsBrowserUnsupported(false);

      if (hasMicPermission === null) { // Only request if status is unknown
        navigator.mediaDevices.getUserMedia({ audio: true })
          .then((stream) => {
            stream.getTracks().forEach(track => track.stop()); // Release the stream immediately
            setHasMicPermission(true);
          })
          .catch(err => {
            console.warn("Microphone permission request error:", err.name, err.message);
            setHasMicPermission(false);
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
              // Toast shown in main listener's onerror if start is attempted
            }
          });
      }
    }, [hasMicPermission]); // Re-run if hasMicPermission changes (e.g. user changes it in browser settings)

    useEffect(() => {
      // If passive listening is turned off externally, stop any active long recording
      if (!isListening && isCapturingAudioForLongRecording && ref && typeof ref !== 'function' && ref.current) {
          ref.current.stopLongRecordingAndProcess();
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isListening, isCapturingAudioForLongRecording]); // ref is stable

    useEffect(() => {
      // Sync internal state if external prop for long recording changes
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isExternallyLongRecording]);


    // Handler for the Brain icon button (manual text processing)
    const handleProcessInputText = useCallback(async () => {
      const textToProcess = inputText.trim();
      if (!textToProcess) {
        toast({ title: "Input empty", description: "Cannot process an empty thought.", variant: "destructive" });
        return;
      }
      setIsLoading(true);
      const lowerText = textToProcess.toLowerCase();
      const hegglesBaseLower = WAKE_WORDS.HEGGLES_BASE.toLowerCase();

      const shoppingListPatternFull = new RegExp(`^${hegglesBaseLower}\\s+${WAKE_WORDS.ADD_TO_SHOPPING_LIST_FULL_PREFIX_REGEX_PART.toLowerCase()}\\s+(.+?)\\s+${WAKE_WORDS.TO_SHOPPING_LIST_SUFFIX_REGEX_PART.toLowerCase()}$`);
      const shoppingListMatch = lowerText.match(shoppingListPatternFull);
      
      const todoListPatternFull = new RegExp(`^${hegglesBaseLower}\\s+${WAKE_WORDS.ADD_TO_TODO_LIST_FULL_PREFIX_REGEX_PART.toLowerCase()}\\s+(.+?)\\s+${WAKE_WORDS.TO_TODO_LIST_SUFFIX_REGEX_PART.toLowerCase()}$`);
      const todoListMatch = lowerText.match(todoListPatternFull);

      const deleteListPattern = new RegExp(`^${hegglesBaseLower}\\s+${WAKE_WORDS.DELETE_ITEM_PREFIX_BASE.toLowerCase()}\\s+(.*?)(?:\\s+${WAKE_WORDS.FROM_SHOPPING_LIST_TRIGGER.toLowerCase()}|\\s+${WAKE_WORDS.FROM_TODO_LIST_TRIGGER.toLowerCase()})$`);
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
          toast({ title: "Deletion Command Incomplete", description: "Specify item and list.", variant: "default" });
          setIsLoading(false); setInputText('');
        }
      } else if (lowerText === WAKE_WORDS.HEGGLES_REPLAY_THAT.toLowerCase()) {
          // This flow should ideally now be handled by direct voice command to startAudioRecordingForSnippet
          // But if "heggles replay that" is typed/pasted and Brain is clicked, simulate buffer.
          if (typeof window !== 'undefined') {
              const storedBufferTime = localStorage.getItem(LOCALSTORAGE_KEYS.BUFFER_TIME);
              const bufferTime: BufferTimeValue = storedBufferTime ? JSON.parse(storedBufferTime) : DEFAULT_BUFFER_TIME;
              const bufferOption = BUFFER_TIME_OPTIONS.find(opt => opt.value === bufferTime);
              const bufferLabel = bufferOption ? bufferOption.label : `${bufferTime} Minute(s)`;
              const simulatedText = `Simulated recall from the ${bufferLabel} buffer. This text represents content from that period.`;
              
              setInputText(''); // Clear the command from input
              try {
                  const processedData = await processTextThought(simulatedText); // Process the simulated text
                  onThoughtRecalled({ id: crypto.randomUUID(), timestamp: Date.now(), ...processedData });
                  toast({ title: "Simulated Recall Processed", description: `Content from ${bufferLabel} buffer analyzed.` });
              } catch (error) {
                  toast({ title: "Error Processing Simulated Recall", description: (error as Error).message, variant: "destructive" });
              } finally {
                  setIsLoading(false);
              }
          } else {
              toast({ title: "Cannot Access Buffer Setting", variant: "destructive" });
              setIsLoading(false);
          }
      } else { // Process as a general thought
        try {
          const processedData = await processTextThought(textToProcess);
          let thoughtHandledByIntentOrAction = false;

          // Check intent analysis for actions first
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
          // Then check refined thought action items if no intent action was triggered
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
                break; // Handle one suggested action at a time
              }
            }
          }
          
          // If it was a question and answered by AI, or no specific list action was taken, recall the thought.
          if (!thoughtHandledByIntentOrAction) {
            onThoughtRecalled({ id: crypto.randomUUID(), timestamp: Date.now(), ...processedData });
            toast({ title: "Thought Processed", description: processedData.aiAnswer ? "AI answered your question." : "AI analysis complete." });
            setInputText(''); // Clear input after successful general processing
          } else if (!isAlertDialogOpen && thoughtHandledByIntentOrAction) {
            // If handled by action and no dialog is open (e.g. direct deletion), clear input.
             setInputText('');
          }
          // If AlertDialog is open, input text is managed by its onOpenChange.

        } catch (error) {
          toast({ title: "Error Processing Thought", description: (error as Error).message, variant: "destructive" });
        } finally {
          if (!isAlertDialogOpen) setIsLoading(false); // Only stop loading if no dialog
        }
      }
    }, [inputText, toast, onThoughtRecalled, addListItem, deleteListItem]); // addListItem, deleteListItem memoized by parent (page.tsx if they were there) or are stable if local
    
    const addListItem = useCallback((listKey: string, itemTextToAdd: string, listName: string) => {
      const item = itemTextToAdd.trim();
      if (!item) {
        toast({ title: "No item specified", description: `Please specify the item to add to ${listName}.`, variant: "default" });
        setIsAlertDialogOpen(false); // Close dialog
        setIsLoading(false); // Stop loading
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
        setIsAlertDialogOpen(false); // Close dialog
        setIsLoading(false); // Stop loading
        setInputText(''); // Clear input after successful addition
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

        if (typeof identifier === 'number') { // Deletion by 1-based index
          const indexToDelete = identifier - 1; 
          if (indexToDelete >= 0 && indexToDelete < currentItems.length) {
            deletedItemText = currentItems[indexToDelete].text;
            currentItems.splice(indexToDelete, 1);
            itemDeleted = true;
          } else {
            toast({ title: "Invalid Item Number", description: `Item number ${identifier} not found in ${listName}.`, variant: "default" });
          }
        } else { // Deletion by name (case-insensitive)
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
        setInputText(''); // Clear input after attempting deletion
      }
    }, [toast]);


    // Handler for dashboard dictation microphone button
    const handleDashboardMicClick = useCallback(async () => {
      const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognitionAPI) {
        toast({ title: "Browser Not Supported", variant: "destructive", description: "Speech recognition for dictation not available." });
        return;
      }
      if (isCapturingAudioForSnippet || isCapturingAudioForLongRecording) {
         toast({ title: "Action unavailable", description: "Another recording/processing is already in progress.", variant: "default"});
        return;
      }
      if (hasMicPermission === false) {
        toast({ title: "Microphone Access Denied", variant: "destructive" });
        return;
      }
      if (hasMicPermission === null) { // Try to get permission if not yet determined
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach(t => t.stop()); // Release stream
          setHasMicPermission(true);
          // Proceed to start dictation after setting permission
        } catch (err) {
          setHasMicPermission(false);
          toast({ title: "Microphone Access Denied", variant: "destructive" });
          return;
        }
      }

      if (isDashboardDictationActive) {
        // If already active, stop it
        if (dashboardDictationRecognitionRef.current) {
          try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
        }
        if (dashboardDictationPauseTimeoutRef.current) clearTimeout(dashboardDictationPauseTimeoutRef.current);
        // onend will handle setting isDashboardDictationActive to false
        return;
      }

      // Stop main command listener if it's running
      if (recognitionRef.current) {
        commandProcessedSuccessfullyRef.current = true; // Signal main listener cycle is done
        try { recognitionRef.current.stop(); } catch (e) { /* ignore */ }
      }
      setIsRecognizingSpeech(false);
      setPartialWakeWordDetected(false);
      utteranceTranscriptRef.current = '';

      // Start dashboard dictation
      setIsDashboardDictationActive(true);
      dashboardDictationAccumulatedTranscriptRef.current = ''; // Clear previous dictation
      setInputText(""); // Clear input field for new dictation

      dashboardDictationRecognitionRef.current = new SpeechRecognitionAPI();
      const recognition = dashboardDictationRecognitionRef.current;
      recognition.continuous = true; // Listen continuously
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        // isDashboardDictationActive already true
      };
      recognition.onresult = (event: SpeechRecognitionEvent) => {
        if (dashboardDictationPauseTimeoutRef.current) clearTimeout(dashboardDictationPauseTimeoutRef.current);
        
        let currentInterimTranscript = "";
        let currentFinalizedDictationSegment = "";

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const segment = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            currentFinalizedDictationSegment += (currentFinalizedDictationSegment ? " " : "") + segment.trim();
          } else {
            currentInterimTranscript += segment;
          }
        }
        if (currentFinalizedDictationSegment) {
          dashboardDictationAccumulatedTranscriptRef.current = 
            (dashboardDictationAccumulatedTranscriptRef.current + (dashboardDictationAccumulatedTranscriptRef.current ? " " : "") + currentFinalizedDictationSegment).trim();
        }
        
        const textToShowInInput = dashboardDictationAccumulatedTranscriptRef.current + (currentInterimTranscript ? (dashboardDictationAccumulatedTranscriptRef.current ? " " : "") + currentInterimTranscript.trim() : "");
        setInputText(textToShowInInput);

        const lowerTranscriptForEndCheck = textToShowInInput.trim().toLowerCase();
        const endCommand = WAKE_WORDS.END_DICTATION.toLowerCase();
        const stopCommand = WAKE_WORDS.STOP_DICTATION.toLowerCase();

        if (lowerTranscriptForEndCheck.endsWith(endCommand) || lowerTranscriptForEndCheck.endsWith(stopCommand)) {
          let finalSpokenText = dashboardDictationAccumulatedTranscriptRef.current; // Use accumulated final parts
          if (lowerTranscriptForEndCheck.endsWith(endCommand)) {
            const endCmdIdx = finalSpokenText.toLowerCase().lastIndexOf(endCommand);
            if (endCmdIdx !== -1) finalSpokenText = finalSpokenText.substring(0, endCmdIdx).trim();
          } else if (lowerTranscriptForEndCheck.endsWith(stopCommand)) {
            const stopCmdIdx = finalSpokenText.toLowerCase().lastIndexOf(stopCommand);
            if (stopCmdIdx !== -1) finalSpokenText = finalSpokenText.substring(0, stopCmdIdx).trim();
          }
          setInputText(finalSpokenText); // Update input text with cleaned transcript
          dashboardDictationAccumulatedTranscriptRef.current = finalSpokenText; // Store cleaned transcript
          if (dashboardDictationRecognitionRef.current) try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
          // onend will handle toast and processing
        } else {
          // Set timeout to stop if no speech for 2 seconds
          dashboardDictationPauseTimeoutRef.current = setTimeout(() => {
            if (dashboardDictationRecognitionRef.current) try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
          }, 2000);
        }
      };
      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.error('Dashboard dictation error:', event.error, event.message);
        if (dashboardDictationPauseTimeoutRef.current) clearTimeout(dashboardDictationPauseTimeoutRef.current);
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') setHasMicPermission(false);
        else if (event.error === 'no-speech' && !dashboardDictationAccumulatedTranscriptRef.current.trim()) { /* No toast if empty and no speech */ }
        else if (event.error === 'no-speech') { /* No toast for just no speech to avoid being too noisy */ }
        else {
          toast({ title: "Dictation Error", description: event.message || "Could not recognize speech.", variant: "destructive" });
        }
        setIsDashboardDictationActive(false);
        setInputText(dashboardDictationAccumulatedTranscriptRef.current.trim()); // Ensure final text is in input
      };
      recognition.onend = () => {
        if (dashboardDictationPauseTimeoutRef.current) clearTimeout(dashboardDictationPauseTimeoutRef.current);
        setIsDashboardDictationActive(false);
        dashboardDictationRecognitionRef.current = null; // Clear ref for next time
        
        const finalDictatedText = dashboardDictationAccumulatedTranscriptRef.current.trim();
        setInputText(finalDictatedText); // Ensure final text is in input area
        
        if (finalDictatedText) {
          toast({ title: "Dictation Ended", description: "Review text and click Brain icon to process."});
        }
        // Do NOT auto-process here. User clicks Brain icon.
      };
      
      try {
        recognition.start();
      } catch (e) {
        console.error("Failed to start dashboard dictation:", e);
        setIsDashboardDictationActive(false);
        toast({ title: "Dictation Error", description: "Could not start dictation.", variant: "destructive" });
      }
    }, [toast, hasMicPermission, isCapturingAudioForSnippet, isCapturingAudioForLongRecording, isDashboardDictationActive, inputText]); // Added inputText to deps if it's used to initialize dictation field


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
      if (isCapturingAudioForSnippet) return "Recording audio & speech (10s)...";
      if (isDashboardDictationActive) return "Dictating to input area...";
      if (isLoading && !isAlertDialogOpen) return "Processing..."; // Only show processing if no dialog is open
      if (!isListening) return "Voice Inactive (Passive Listening Off)";
      if (isBrowserUnsupported) return "Voice N/A (Browser Not Supported)";
      if (hasMicPermission === false) return <span className="text-destructive">Mic Access Denied</span>;
      if (hasMicPermission === null) return "Mic Awaiting Permission...";
      if (partialWakeWordDetected) return <>'<strong>Heggles</strong>' detected, awaiting command...</>;
      if (isRecognizingSpeech) return <>Say '<strong>Heggles</strong>' + command</>;
      if (isListening && hasMicPermission && !isBrowserUnsupported) return <>Listener active for '<strong>Heggles</strong>'</>;
      return "Voice status checking...";
    };

    const getTextareaPlaceholder = (): string => {
      if (isCapturingAudioForLongRecording) return "Continuous recording active. Transcript populates here when stopped. Click Brain icon to process.";
      if (isCapturingAudioForSnippet) return "Recording audio & speech for 10 seconds. Processed automatically.";
      if (isDashboardDictationActive) return "Dictating your thought... Say 'Heggles end' or 'Heggles stop' to finish. Text populates here for Brain processing.";
      if (isLoading && !isAlertDialogOpen) return "Processing...";
      if (!isListening) return "Enable voice commands to use voice, or type input here. Click Brain icon to process.";
      if (partialWakeWordDetected) return "'Heggles' detected. Finish your command. Text appears here. Click Brain icon to process.";
      if (isRecognizingSpeech) return "Listener active. Say 'Heggles' followed by your command. Text appears here for Brain processing.";
      return "Type thought or say 'Heggles' + command. Click Brain icon to process.";
    };
    
    const dashboardMicButtonDisabled = !isListening || hasMicPermission !== true || isRecognizingSpeech || isCapturingAudioForSnippet || isLoading || isCapturingAudioForLongRecording;

    const getDashboardDictationButtonIcon = () => {
        if (isDashboardDictationActive) return <Radio className="h-5 w-5 text-red-500 animate-pulse" />;
        if (dashboardMicButtonDisabled && hasMicPermission !== true) return <MicOff className="h-5 w-5 text-muted-foreground" />
        return <Mic className="h-5 w-5 text-primary" />;
    };
    
    const recallCmdSuffix = WAKE_WORDS.HEGGLES_REPLAY_THAT.substring(WAKE_WORDS.HEGGLES_BASE.length);
    const addShopCmdSuffix = WAKE_WORDS.ADD_TO_SHOPPING_LIST_FULL_PREFIX_REGEX_PART; // No HEGGLES_BASE here
    const addToDoCmdSuffix = WAKE_WORDS.ADD_TO_TODO_LIST_FULL_PREFIX_REGEX_PART; // No HEGGLES_BASE here
    const setBufferCmdSuffix = WAKE_WORDS.HEGGLES_SET_BUFFER.substring(WAKE_WORDS.HEGGLES_BASE.length);
    const deleteItemSuffix = WAKE_WORDS.DELETE_ITEM_PREFIX_BASE; // No HEGGLES_BASE here


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
              Say '<strong>Heggles</strong>' + your command. Most commands populate text below for processing with the <Brain className="inline-block h-3.5 w-3.5 mx-0.5" /> icon.
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
                  aria-label={isDashboardDictationActive ? "Stop dictation (or say 'Heggles end/stop')" : "Dictate directly into input area"}
                  title={isDashboardDictationActive ? "Stop dictation (or say 'Heggles end/stop')" : "Dictate directly into input area (ends on pause or 'Heggles end/stop')"}
                >
                  {getDashboardDictationButtonIcon()}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground pt-1">
                The "<strong>Heggles</strong>{recallCmdSuffix}" voice command triggers a 10s live audio recording & transcription.
                Other "<strong>Heggles</strong>" commands (e.g., "<strong>Heggles</strong> {addShopCmdSuffix} [item] to my shopping list", "<strong>Heggles</strong> {deleteItemSuffix} [item]...") populate the input area for manual submission with the <Brain className="inline-block h-3 w-3 mx-0.5" /> button.
                The <Mic className="inline-block h-3 w-3 mx-0.5 text-primary" /> icon button (dictate) transcribes speech directly into this area.
                The <PlayCircle className="inline-block h-3 w-3 mx-0.5 text-green-500"/> / <StopCircle className="inline-block h-3 w-3 mx-0.5 text-red-500"/> button (header) is for continuous recording.
              </p>
            </div>
          </CardContent>
        </Card>

        {alertDialogConfig && (
          <AlertDialog open={isAlertDialogOpen} onOpenChange={(open) => {
            setIsAlertDialogOpen(open);
            if (!open) {
              setIsLoading(false); // Ensure loading stops if dialog is cancelled
              // Do not clear input text on cancel, allow user to edit if they cancelled
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
                <AlertDialogCancel onClick={() => { setIsLoading(false); /* setInputText(''); Don't clear on cancel */ }}>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => {
                  alertDialogConfig.onConfirm(); // This will handle setIsLoading and setInputText internally
                }}>Confirm</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </>
    );
  });

ThoughtInputForm.displayName = "ThoughtInputForm";
