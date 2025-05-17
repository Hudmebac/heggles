
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
  isExternallyLongRecording: boolean; // Controlled by header button in parent
  onStopLongRecordingParent: () => void; // Callback to parent when long rec stops
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

    // For main "Heggles" command listener
    const [hasMicPermission, setHasMicPermission] = useState<boolean | null>(null);
    const [isRecognizingSpeech, setIsRecognizingSpeech] = useState(false); // True when main command listener is active
    const [isBrowserUnsupported, setIsBrowserUnsupported] = useState(false);
    const [partialWakeWordDetected, setPartialWakeWordDetected] = useState(false);
    const recognitionRef = useRef<SpeechRecognition | null>(null);
    const utteranceTranscriptRef = useRef<string>(''); // Accumulates full utterance for current session
    const commandProcessedSuccessfullyRef = useRef<boolean>(false); // Tracks if a command cycle completed

    // For dashboard direct dictation mic button
    const [isDashboardDictationActive, setIsDashboardDictationActive] = useState(false);
    const dashboardDictationRecognitionRef = useRef<SpeechRecognition | null>(null);
    const dashboardDictationPauseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const dashboardDictationAccumulatedTranscriptRef = useRef<string>('');

    // For 10-second "Heggles replay that" recording (triggered by voice or button)
    const [isCapturingAudioForSnippet, setIsCapturingAudioForSnippet] = useState(false); // For the 10s recording
    const snippetMediaRecorderRef = useRef<MediaRecorder | null>(null);
    const snippetRecognitionRef = useRef<SpeechRecognition | null>(null);
    const snippetTranscriptRef = useRef<string>('');
    const snippetAudioChunksRef = useRef<Blob[]>([]);

    // For continuous recording (from header button)
    const [isCapturingAudioForLongRecording, setIsCapturingAudioForLongRecording] = useState(false); // For header button continuous rec
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

      // Stop main command listener if active and mark its cycle as complete
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
          stream.getTracks().forEach(track => track.stop()); // Stop mic tracks after media recorder stops

          const audioBlob = new Blob(snippetAudioChunksRef.current, { type: 'audio/webm' });
          snippetAudioChunksRef.current = [];

          const base64AudioData = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.readAsDataURL(audioBlob);
            reader.onloadend = () => resolve(reader.result as string);
          });

          const liveTranscript = snippetTranscriptRef.current.trim();
          snippetTranscriptRef.current = ''; // Reset for next use

          setIsLoading(true);
          try {
            const processedData = await processRecordedAudio(base64AudioData, liveTranscript);
            onThoughtRecalled({ id: crypto.randomUUID(), timestamp: Date.now(), ...processedData });
            toast({ title: "Recorded Snippet Processed", description: "AI analysis complete." });
          } catch (error) {
            toast({ title: "Error Processing Snippet", description: (error as Error).message, variant: "destructive" });
          } finally {
            setIsLoading(false);
            setIsCapturingAudioForSnippet(false); // Ensure this is reset
          }
        };
        snippetMediaRecorderRef.current.start();

        // Start live transcription for the snippet
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
          // Optionally display interim results if needed, e.g., setInputText(snippetTranscriptRef.current + " " + interim.trim());
        };
        snippetRecognizer.onerror = (event: SpeechRecognitionErrorEvent) => {
          console.warn('Snippet transcription error:', event.error, event.message);
          // No toast here to avoid double-toasting if MediaRecorder also errors
        };
        snippetRecognizer.onend = () => {
          snippetRecognitionRef.current = null; // Clean up ref
        };
        snippetRecognizer.start();

        // Stop both MediaRecorder and SnippetRecognizer after duration
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
        // Ensure cleanup if error occurs during setup
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
      startLongRecording: () => {
        if (!isListening || hasMicPermission !== true || isLoading || isDashboardDictationActive || isCapturingAudioForSnippet || isCapturingAudioForLongRecording) {
          return false;
        }
        // Stop other listeners
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
            setInputText(""); // Clear input for live transcript

            longRecordingSpeechRecognizerRef.current = new SpeechRecognitionAPI();
            const recognizer = longRecordingSpeechRecognizerRef.current;
            recognizer.continuous = true;
            recognizer.interimResults = true; // Show live transcript
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
              // Update inputText with combined final and current interim
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
              // `setInputText` with final transcript happens in `stopLongRecordingAndProcess` or media recorder onstop
            };
            recognizer.start();

            // Start MediaRecorder for audio capture (optional if only transcript is needed, but good for future)
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            longRecordingMediaRecorderRef.current = new MediaRecorder(stream);
            longRecordingMediaRecorderRef.current.ondataavailable = (event) => {
              if (event.data.size > 0) {
                longRecordingAudioChunksRef.current.push(event.data);
              }
            };
            longRecordingMediaRecorderRef.current.onstop = async () => {
              stream.getTracks().forEach(track => track.stop());
              // const audioBlob = new Blob(longRecordingAudioChunksRef.current, { type: 'audio/webm' });
              longRecordingAudioChunksRef.current = []; // Clear chunks
              
              // Final transcript is already in longRecordingTranscriptRef.current
              // Populate input text area, then user clicks Brain to process
              setInputText(longRecordingTranscriptRef.current.trim()); 
              
              setIsCapturingAudioForLongRecording(false);
              onStopLongRecordingParent(); // Notify parent
              toast({ title: "Recording Stopped", description: "Transcript populated. Click Brain icon to process." });
            };
            longRecordingMediaRecorderRef.current.start();
            return true;

          } catch (err) {
            console.error("Error starting continuous recording:", err);
            toast({ title: "Continuous Recording Error", description: `Could not start recording: ${(err as Error).message}`, variant: "destructive" });
            setIsCapturingAudioForLongRecording(false);
            setInputText(""); // Clear any partial transcript
            if (longRecordingSpeechRecognizerRef.current) { try { longRecordingSpeechRecognizerRef.current.stop(); } catch (e) {/* ignore */}}
            if (longRecordingMediaRecorderRef.current && longRecordingMediaRecorderRef.current.state === "recording") {
              try { longRecordingMediaRecorderRef.current.stop(); } catch (e) {/* ignore */}
            }
            onStopLongRecordingParent();
            return false;
          }
        };
        startRecordingFlow(); // Don't need to await this async function here.
        return true; // Indicate that the process to start has begun.
      },
      stopLongRecordingAndProcess: () => {
        if (!isCapturingAudioForLongRecording) return;

        if (longRecordingSpeechRecognizerRef.current) {
          try { longRecordingSpeechRecognizerRef.current.stop(); } catch(e) { /* ignore */ }
          // onend will set it to null
        }
        if (longRecordingMediaRecorderRef.current && longRecordingMediaRecorderRef.current.state === "recording") {
          try { longRecordingMediaRecorderRef.current.stop(); } catch(e) { /* onstop will handle the rest */ }
          // If stop fails or it's already stopped, the rest of the logic might need to run manually
        } else {
          // If media recorder was already stopped or failed to start, ensure UI reflects stop
          setInputText(longRecordingTranscriptRef.current.trim()); // ensure final transcript is in input
          setIsCapturingAudioForLongRecording(false);
          onStopLongRecordingParent();
        }
      },
    }));

    // Effect for main "Heggles" command listener
    useEffect(() => {
      const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognitionAPI) {
        // setIsBrowserUnsupported(true); // Already handled in initial check
        return;
      }

      const shouldBeListening = isListening && // Main toggle from parent
                                hasMicPermission === true &&
                                !isLoading && // Not processing anything
                                !isCapturingAudioForSnippet && // Not doing 10s recording
                                !isDashboardDictationActive && // Not doing dashboard dictation
                                !isCapturingAudioForLongRecording; // Not doing continuous recording

      if (shouldBeListening && recognitionRef.current === null) {
        recognitionRef.current = new SpeechRecognitionAPI();
        const recognition = recognitionRef.current;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onstart = () => {
          setIsRecognizingSpeech(true);
          commandProcessedSuccessfullyRef.current = false; // Reset for new session
        };

        recognition.onend = () => {
          setIsRecognizingSpeech(false);
          if (commandProcessedSuccessfullyRef.current) { // If a command was fully processed
            setPartialWakeWordDetected(false);
            utteranceTranscriptRef.current = '';
            // setInputText(''); // Input text is cleared by specific command handlers or Brain processing
          }
          // Crucially, set recognitionRef.current to null to allow useEffect to re-initialize
          recognitionRef.current = null;
        };

        recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
          // Removed console.warn for 'no-speech' and 'aborted' to reduce console noise
          if (!(event.error === 'no-speech' || event.error === 'aborted')) {
            console.error('Main command recognition error:', event.error, event.message);
          }
          if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            setHasMicPermission(false);
            toast({ title: "Microphone Access Issue", variant: "destructive", description: "Speech recognition service denied. Check browser settings or permissions." });
          }
          setPartialWakeWordDetected(false); // Reset on any error
          // utteranceTranscriptRef.current = ''; // Reset on error
          commandProcessedSuccessfullyRef.current = true; // Assume error ends current attempt
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
            // Try to detect "Heggles" at the start of a new finalized segment or current interim
            if (newlyFinalizedSegmentThisTurn.toLowerCase().startsWith(hegglesBaseLower)) {
              setPartialWakeWordDetected(true);
              utteranceTranscriptRef.current = newlyFinalizedSegmentThisTurn; // Start utterance with this segment
              setInputText(utteranceTranscriptRef.current + " " + currentInterimSegment.trim());
            } else if (currentInterimSegment.toLowerCase().startsWith(hegglesBaseLower)) {
              setPartialWakeWordDetected(true);
              // Don't set utteranceTranscriptRef yet, wait for finalization of "Heggles" part
              setInputText(currentInterimSegment.trim()); // Show interim "Heggles..."
            } else if (newlyFinalizedSegmentThisTurn && !newlyFinalizedSegmentThisTurn.toLowerCase().startsWith(hegglesBaseLower)) {
              // Finalized speech that doesn't start with Heggles - ignore for this listener cycle
              // commandProcessedSuccessfullyRef.current = true; // Mark this "unrelated speech" cycle as done
              // if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch(e) { /* ignore */ } }
              return; // Don't process further or populate input text
            }
          } else { // partialWakeWordDetected is true
            if (newlyFinalizedSegmentThisTurn) {
              utteranceTranscriptRef.current = (utteranceTranscriptRef.current + " " + newlyFinalizedSegmentThisTurn).trim();
            }
            setInputText(utteranceTranscriptRef.current + (currentInterimSegment ? " " + currentInterimSegment.trim() : ""));
          }
        
          const lastResultIsFinal = event.results[event.results.length - 1].isFinal;
        
          if (lastResultIsFinal && utteranceTranscriptRef.current) {
            const finalUtterance = utteranceTranscriptRef.current.trim();
            const finalLower = finalUtterance.toLowerCase();
        
            if (!finalLower.startsWith(hegglesBaseLower)) {
              commandProcessedSuccessfullyRef.current = true; 
              if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch(e) { /* ignore */ } }
              return; // Should have been caught by earlier check, but defensive
            }
        
            // Check for specific immediate commands
            if (finalLower === WAKE_WORDS.HEGGLES_TURN_OFF.toLowerCase()) {
              onToggleListeningParent(false);
              setInputText(''); commandProcessedSuccessfullyRef.current = true;
            } else if (finalLower === WAKE_WORDS.HEGGLES_TURN_ON.toLowerCase()) {
              onToggleListeningParent(true);
              setInputText(''); commandProcessedSuccessfullyRef.current = true;
            } else if (finalLower.startsWith(WAKE_WORDS.HEGGLES_SET_BUFFER.toLowerCase())) {
              const spokenDuration = finalUtterance.substring(WAKE_WORDS.HEGGLES_SET_BUFFER.length).trim();
              setBufferTimeByVoice(spokenDuration); // This sets commandProcessedSuccessfullyRef and clears input
              commandProcessedSuccessfullyRef.current = true; // Ensure it's true
            } else if (finalLower === WAKE_WORDS.HEGGLES_REPLAY_THAT.toLowerCase()) {
              startAudioRecordingForSnippet(); // This sets commandProcessedSuccessfullyRef and stops recognitionRef
              setInputText(''); // Clear input after "replay that" is initiated
              commandProcessedSuccessfullyRef.current = true; // Ensure it's true
            } else if (finalLower === hegglesBaseLower && !currentInterimSegment) { // Exactly "Heggles" and nothing more typed/spoken immediately after
              setInputText(finalUtterance + " "); // Show "Heggles "
              commandProcessedSuccessfullyRef.current = false; // Not a complete command, keep listening
              // DO NOT STOP recognition here, let it continue for the rest of the command
              return; // Exit early to prevent stopping
            } else {
              // For all other commands starting with "Heggles" (add/delete, or unrecognized)
              // The text is already in inputText (set above)
              // This turn of speech recognition is complete. The user will click Brain.
              commandProcessedSuccessfullyRef.current = true;
            }
            
            // If a command was processed or populated for Brain, stop the current recognition cycle
            if (recognitionRef.current && commandProcessedSuccessfullyRef.current) {
              try { recognitionRef.current.stop(); } catch(e) { console.warn("Error stopping main cmd rec after final result processing:", e); }
            }
          }
        };
        
        try {
          // Ensure conditions are still met right before starting
          if (recognitionRef.current && isListening && !isLoading && !isCapturingAudioForSnippet && !isDashboardDictationActive && !isCapturingAudioForLongRecording) {
            commandProcessedSuccessfullyRef.current = false; // Reset for new session
            recognitionRef.current.start();
          } else if (recognitionRef.current) {
            // Conditions changed while setting up, nullify to allow re-evaluation
            recognitionRef.current = null;
          }
        } catch (e) {
          console.error("Failed to start main command speech recognition:", e);
          if (recognitionRef.current) {
            recognitionRef.current = null; // Ensure it's null if start failed
          }
        }
      } else if (!shouldBeListening && recognitionRef.current) {
        // Conditions to listen are no longer met, stop if active
        commandProcessedSuccessfullyRef.current = true; // Consider this cycle done
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
          commandProcessedSuccessfullyRef.current = true; // Ensure clean state on unmount/re-run
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
        onToggleListeningParent, // memoized
        setBufferTimeByVoice,    // memoized
        startAudioRecordingForSnippet, // memoized
        toast, // from useToast, generally stable
        onThoughtRecalled,       // memoized
        addListItem,             // memoized
        deleteListItem,          // memoized
        isRecognizingSpeech      // Added dependency
    ]);


    // Initial microphone permission check and browser support
    useEffect(() => {
      const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognitionAPI) {
        setIsBrowserUnsupported(true);
        setHasMicPermission(false);
        return;
      }
      setIsBrowserUnsupported(false);

      if (hasMicPermission === null) { // Only check if permission status is unknown
        navigator.mediaDevices.getUserMedia({ audio: true })
          .then((stream) => {
            stream.getTracks().forEach(track => track.stop()); // Release mic immediately after permission check
            setHasMicPermission(true);
          })
          .catch(err => {
            console.warn("Microphone permission request error:", err.name, err.message);
            setHasMicPermission(false); // Assume denied if error
          });
      }
    }, [hasMicPermission]); // Re-run if hasMicPermission changes (e.g. user changes it in browser settings)

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

          currentItems = currentItems.filter(item => item.text.toLowerCase() !== lowerIdentifier);
          if (currentItems.length < (JSON.parse(currentItemsString) as Array<ShoppingListItem | ToDoListItem>).length) { // Compare with original length
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

      // Pattern matching for add/delete commands
      const shoppingListAddPattern = new RegExp(`^${hegglesBaseLower}\\s+${WAKE_WORDS.ADD_TO_SHOPPING_LIST_FULL_PREFIX_REGEX_PART.toLowerCase()}\\s+(.+?)(?:\\s+${WAKE_WORDS.TO_SHOPPING_LIST_SUFFIX_REGEX_PART.toLowerCase()})?$`);
      const shoppingListAddMatch = lowerText.match(shoppingListAddPattern);
      
      const todoListAddPattern = new RegExp(`^${hegglesBaseLower}\\s+${WAKE_WORDS.ADD_TO_TODO_LIST_FULL_PREFIX_REGEX_PART.toLowerCase()}\\s+(.+?)(?:\\s+${WAKE_WORDS.TO_TODO_LIST_SUFFIX_REGEX_PART.toLowerCase()})?$`);
      const todoListAddMatch = lowerText.match(todoListAddPattern);

      const deleteListPattern = new RegExp(`^${hegglesBaseLower}\\s+${WAKE_WORDS.DELETE_ITEM_PREFIX_BASE.toLowerCase()}\\s+(.*?)(?:\\s+${WAKE_WORDS.FROM_SHOPPING_LIST_TRIGGER.toLowerCase()}|\\s+${WAKE_WORDS.FROM_TODO_LIST_TRIGGER.toLowerCase()})$`);
      const deleteListMatch = lowerText.match(deleteListPattern);


      if (lowerText === WAKE_WORDS.HEGGLES_REPLAY_THAT.toLowerCase()) {
          // This specific command should ideally be caught by the voice listener and trigger startAudioRecordingForSnippet directly.
          // If it reaches here via text input, it means the voice command itself populated the input.
          // For consistency, let's treat it as if user wants to process "Heggles replay that" as text, leading to simulated buffer.
          if (typeof window !== 'undefined') {
              const storedBufferTime = localStorage.getItem(LOCALSTORAGE_KEYS.BUFFER_TIME);
              const bufferTime: BufferTimeValue = storedBufferTime ? JSON.parse(storedBufferTime) : DEFAULT_BUFFER_TIME;
              const bufferOption = BUFFER_TIME_OPTIONS.find(opt => opt.value === bufferTime);
              const bufferLabel = bufferOption ? bufferOption.label : `${bufferTime} Minute(s)`;
              const simulatedText = `Simulated recall from the ${bufferLabel} buffer. This text represents content from that period.`;
              
              setInputText(''); 
              try {
                  const processedData = await processTextThought(simulatedText); 
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
        // setIsLoading(false) will be handled by AlertDialog's onOpenChange or onConfirm
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
            deleteListItem(listKey, itemIdentifierStr, listName); // This also sets isLoading false and clears input
          }
        } else {
          toast({ title: "Deletion Command Incomplete", description: "Specify item and list (e.g., '...from my shopping list').", variant: "default" });
          setIsLoading(false); setInputText('');
        }
      } else { 
        // General text processing
        try {
          const processedData = await processTextThought(textToProcess);
          let thoughtHandledByIntentOrAction = false;

          // Check intent analysis for list additions
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
          // Check refined thought action items if no intent action was triggered
          else if (processedData.actionItems && processedData.actionItems.length > 0 && !thoughtHandledByIntentOrAction) {
            for (const action of processedData.actionItems) { // Iterate through all action items
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
                break; // Process first actionable item found
              }
            }
          }
          
          // If an AlertDialog was opened, isLoading will be handled by its closure.
          // Otherwise, if no action taken and no question answered, add to recent thoughts.
          if (!thoughtHandledByIntentOrAction) {
            onThoughtRecalled({ id: crypto.randomUUID(), timestamp: Date.now(), ...processedData });
            toast({ title: "Thought Processed", description: processedData.aiAnswer ? "AI answered your question." : "AI analysis complete." });
            setInputText(''); 
            setIsLoading(false);
          } else if (!isAlertDialogOpen && thoughtHandledByIntentOrAction) {
             // This case might happen if AlertDialog was somehow skipped but thoughtHandledByIntentOrAction was true
             setInputText('');
             setIsLoading(false);
          }
          // If an AlertDialog is open, isLoading is true, and will be set to false when dialog closes.

        } catch (error) {
          toast({ title: "Error Processing Thought", description: (error as Error).message, variant: "destructive" });
          setIsLoading(false); // Ensure loading is false on error
        }
      }
    }, [inputText, toast, onThoughtRecalled, addListItem, deleteListItem]); // addListItem, deleteListItem memoized
    
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
        // onend will handle setIsDashboardDictationActive(false) and processing
        return;
      }

      // Stop main command listener if active
      commandProcessedSuccessfullyRef.current = true; 
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch (e) { /* ignore */ }
      }
      setIsRecognizingSpeech(false);
      setPartialWakeWordDetected(false);
      utteranceTranscriptRef.current = '';

      setIsDashboardDictationActive(true);
      dashboardDictationAccumulatedTranscriptRef.current = inputText; // Start with current input text
      // let currentDictationTranscript = inputText; // Use existing text as base

      dashboardDictationRecognitionRef.current = new SpeechRecognitionAPI();
      const recognition = dashboardDictationRecognitionRef.current;
      recognition.continuous = true; 
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        // Don't clear inputText if user wants to append
        // setInputText(""); 
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
          setInputText(finalSpokenText); // Final text before stopping
          if (dashboardDictationRecognitionRef.current) try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
          // onend will now handle processing
        } else {
          dashboardDictationPauseTimeoutRef.current = setTimeout(() => {
            if (dashboardDictationRecognitionRef.current) try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
            // onend will handle processing
          }, 2000); // 2 seconds pause
        }
      };
      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (event.error === 'aborted') {
          console.info('Dashboard dictation aborted.');
        } else if (event.error === 'no-speech') {
          console.warn('Dashboard dictation: No speech detected.');
        } else {
          console.error('Dashboard dictation error:', event.error, event.message);
          toast({ title: "Dictation Error", description: event.message || "Could not recognize speech.", variant: "destructive" });
        }
        if (dashboardDictationPauseTimeoutRef.current) clearTimeout(dashboardDictationPauseTimeoutRef.current);
        setIsDashboardDictationActive(false);
        // Don't auto-process on error, let user decide with Brain button
        // setInputText(dashboardDictationAccumulatedTranscriptRef.current.trim()); 
      };
      recognition.onend = () => {
        if (dashboardDictationPauseTimeoutRef.current) clearTimeout(dashboardDictationPauseTimeoutRef.current);
        setIsDashboardDictationActive(false);
        dashboardDictationRecognitionRef.current = null;
        
        const finalDictatedText = dashboardDictationAccumulatedTranscriptRef.current.trim(); 
        setInputText(finalDictatedText); // Ensure final text is in input area
        
        // DO NOT auto-process after dictation. User clicks Brain.
        // if (finalDictatedText) {
        //   handleProcessInputText(); 
        // }
        dashboardDictationAccumulatedTranscriptRef.current = ''; // Reset for next time
      };
      
      try {
        dashboardDictationAccumulatedTranscriptRef.current = inputText; // Start with current text
        recognition.start();
      } catch (e) {
        console.error("Failed to start dashboard dictation:", e);
        setIsDashboardDictationActive(false);
        toast({ title: "Dictation Error", description: "Could not start dictation.", variant: "destructive" });
      }
    }, [toast, hasMicPermission, isCapturingAudioForSnippet, isCapturingAudioForLongRecording, isDashboardDictationActive, inputText, handleProcessInputText]); // Added inputText and handleProcessInputText


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
      if (isLoading && !isAlertDialogOpen) return "Processing..."; 
      if (!isListening) return "Voice Inactive (Passive Listening Off)";
      if (isBrowserUnsupported) return "Voice N/A (Browser Not Supported)";
      if (hasMicPermission === false) return <span className="text-destructive">Mic Access Denied</span>;
      if (hasMicPermission === null) return "Mic Awaiting Permission...";
      if (partialWakeWordDetected) return <>'<strong>Heggles</strong>' detected, awaiting command...</>;
      if (isRecognizingSpeech) return <>Listener active for '<strong>Heggles</strong>'</>; // Changed from Say 'Heggles' + command
      if (isListening && hasMicPermission && !isBrowserUnsupported) return <>Listener active for '<strong>Heggles</strong>'</>;
      return "Voice status checking...";
    };

    const getTextareaPlaceholder = (): string => {
      if (isCapturingAudioForLongRecording) return "Continuous recording active. Transcript populates here. Click Brain icon to process.";
      if (isCapturingAudioForSnippet) return "Recording audio & speech for 10 seconds. Transcript will appear here for processing.";
      if (isDashboardDictationActive) return "Dictating your thought... Say 'Heggles end' or 'Heggles stop' to finish. Text populates here for Brain processing.";
      if (isLoading && !isAlertDialogOpen) return "Processing...";
      if (!isListening) return "Enable voice commands to use voice, or type input here. Click Brain icon to process.";
      if (partialWakeWordDetected) return "'Heggles' detected. Finish your command. Text appears here. Click Brain icon to process.";
      if (isRecognizingSpeech) return "Listener active. Say 'Heggles' followed by your command. Text appears here for Brain processing.";
      return "Type thought or say 'Heggles' + command. Click Brain icon to process.";
    };
    
    // Disable dashboard dictation mic if another audio process is active or main listener is off
    const dashboardMicButtonDisabled = !isListening || // Cannot dictate if main listening is off
                                       hasMicPermission !== true ||
                                       isRecognizingSpeech || // Cannot dictate if main command listener is pulsing
                                       isCapturingAudioForSnippet ||
                                       isLoading ||
                                       isCapturingAudioForLongRecording;


    const getDashboardDictationButtonIcon = () => {
        if (isDashboardDictationActive) return <Radio className="h-5 w-5 text-red-500 animate-pulse" />;
        if (!isListening || hasMicPermission !== true) return <MicOff className="h-5 w-5 text-muted-foreground" />
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
              {isListening && hasMicPermission !== null && !isBrowserUnsupported && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground" title={typeof getMicStatusText() === 'string' ? getMicStatusText() as string : undefined}>
                  {getMicIconForCardHeader()}
                  <span>{getMicStatusText()}</span>
                </div>
              )}
            </div>
            <CardDescription>
              Say '<strong>Heggles</strong>' + your command. Commands populate text below for processing with the <Brain className="inline-block h-3.5 w-3.5 mx-0.5" /> icon. {' '}
              "<strong>Heggles</strong>{recallCmdSuffix}" triggers a 10s live audio recording for processing.
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
                  aria-label={isDashboardDictationActive ? "Stop dictation (or say 'Heggles end/stop')" : "Dictate directly into input area"}
                  title={isDashboardDictationActive ? "Stop dictation (or say 'Heggles end/stop')" : "Dictate directly into input area (ends on pause or 'Heggles end/stop')"}
                >
                  {getDashboardDictationButtonIcon()}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground pt-1">
                "<strong>Heggles</strong>{recallCmdSuffix}" voice command triggers a 10s live audio recording & transcription, then processes.
                Other "<strong>Heggles</strong>" commands (e.g., "<strong>Heggles</strong> {addShopCmdSuffix} [item] to my shopping list", "<strong>Heggles</strong> {deleteItemSuffix} [item]...") populate the input area for manual submission with the <Brain className="inline-block h-3 w-3 mx-0.5" /> button.
                The <Mic className="inline-block h-3 w-3 mx-0.5 text-primary" /> icon button (dictate) transcribes speech directly into this area (stops on pause or "<strong>Heggles</strong> end/stop"). You then click the <Brain className="inline-block h-3 w-3 mx-0.5" /> button.
                The <PlayCircle className="inline-block h-3 w-3 mx-0.5 text-green-500" />/<StopCircle className="inline-block h-3 w-3 mx-0.5 text-red-500" /> button (header) is for continuous recording; its transcript populates here when stopped, then use <Brain className="inline-block h-3 w-3 mx-0.5" /> to process.
              </p>
            </div>
          </CardContent>
        </Card>

        {alertDialogConfig && (
          <AlertDialog open={isAlertDialogOpen} onOpenChange={(open) => {
            setIsAlertDialogOpen(open);
            if (!open) { // When dialog is closed (Cancel or Confirm)
              setIsLoading(false); 
              // Only clear input text if the action was confirmed and successful
              // This is handled within addListItem/deleteListItem or after onThoughtRecalled
              // If cancelled, inputText should remain.
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
                <AlertDialogCancel onClick={() => { /* State handled by onOpenChange */ setInputText(inputText); /* Keep input on cancel */ }}>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => {
                  alertDialogConfig.onConfirm(); 
                  // setIsLoading(false) and setInputText('') are handled by addListItem/deleteListItem
                }}>Confirm</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </>
    );
  });

ThoughtInputForm.displayName = "ThoughtInputForm";
