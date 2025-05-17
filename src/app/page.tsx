
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocalStorage } from '@/lib/hooks/useLocalStorage';
import type { Thought, PinnedThought } from '@/lib/types';
import { PassiveListenerControls } from '@/components/hegsync/PassiveListenerControls';
import { ThoughtInputForm, type ThoughtInputFormHandle } from '@/components/hegsync/ThoughtInputForm';
import { RecentThoughtsList } from '@/components/hegsync/RecentThoughtsList';
import { ThoughtClarifierDialog } from '@/components/hegsync/ThoughtClarifierDialog';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { PlayCircle, StopCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { pinThoughtAndSuggestCategories } from '@/lib/actions';
// import { useRouter } from 'next/navigation'; // No longer used
import { LOCALSTORAGE_KEYS } from '@/lib/constants';

export default function DashboardPage() {
  const [isListening, setIsListening] = useState(true);
  const [recalledThoughts, setRecalledThoughts] = useLocalStorage<Thought[]>(LOCALSTORAGE_KEYS.RECALLED_THOUGHTS, []);
  const [pinnedThoughts, setPinnedThoughts] = useLocalStorage<PinnedThought[]>(LOCALSTORAGE_KEYS.MEMORY_VAULT, []);
  
  const [clarifyingThought, setClarifyingThought] = useState<Thought | null>(null);
  const [isClarifierOpen, setIsClarifierOpen] = useState(false);

  const thoughtInputFormRef = useRef<ThoughtInputFormHandle>(null);

  const [isLongRecording, setIsLongRecording] = useState(false);

  const { toast } = useToast();
  // const router = useRouter(); // No longer used

  const handleToggleListening = useCallback((active: boolean) => {
    setIsListening(active);
    if (!active && isLongRecording) { 
      thoughtInputFormRef.current?.stopLongRecordingAndProcess();
      setIsLongRecording(false);
      toast({ title: "Recording Stopped", description: "Passive listening was disabled." });
    }
    toast({ title: `Passive Listening ${active ? "Enabled" : "Disabled"}`, description: active ? "Ready for voice commands." : "Voice commands and recording are off." });
  }, [toast, isLongRecording]); 

  const handleThoughtRecalled = useCallback((newThought: Thought) => {
    setRecalledThoughts(prevThoughts => [newThought, ...prevThoughts].sort((a,b) => b.timestamp - a.timestamp));
  }, [setRecalledThoughts]);
  
  const handlePinThought = useCallback(async (thoughtToPin: Thought) => {
    try {
      const processedPinnedThoughtData = await pinThoughtAndSuggestCategories(thoughtToPin);
      const newPinnedThought: PinnedThought = {
        ...processedPinnedThoughtData,
        pinnedTimestamp: Date.now(),
      };
      setPinnedThoughts(prev => [newPinnedThought, ...prev].sort((a,b) => b.pinnedTimestamp - a.timestamp));
      setRecalledThoughts(prev => prev.filter(t => t.id !== thoughtToPin.id));
      toast({ title: "Thought Pinned", description: "Successfully saved to Memory Vault." });
      // router.push('/memory-vault'); // Removed this line
    } catch (error) {
      toast({ title: "Error Pinning Thought", description: (error as Error).message, variant: "destructive" });
    }
  }, [setPinnedThoughts, setRecalledThoughts, toast]);

  const handleClarifyThought = useCallback((thoughtToClarify: Thought) => {
    setClarifyingThought(thoughtToClarify);
    setIsClarifierOpen(true);
  }, []);
  
  const handleClarificationComplete = useCallback((updatedThought: Thought) => {
    setRecalledThoughts(prev => prev.map(t => t.id === updatedThought.id ? updatedThought : t));
    setPinnedThoughts(prev => prev.map(t => t.id === updatedThought.id ? { ...t, ...updatedThought } : t));
    setIsClarifierOpen(false);
  }, [setRecalledThoughts, setPinnedThoughts]);

  const handleDeleteRecalledThought = useCallback((thoughtId: string) => {
    setRecalledThoughts(prev => prev.filter(t => t.id !== thoughtId));
    toast({ title: "Thought Deleted", description: "The recalled thought has been removed." });
  }, [setRecalledThoughts, toast]);

  const [isClient, setIsClient] = useState(false);
  useEffect(() => {
    setIsClient(true);
  }, []);

  const handleToggleLongRecording = useCallback(() => {
    if (!isListening) {
      toast({ title: "Passive Listening Disabled", description: "Enable passive listening to start recording.", variant: "default" });
      return;
    }
    if (!isLongRecording) {
      if (thoughtInputFormRef.current?.startLongRecording()) {
        setIsLongRecording(true);
        toast({ title: "Continuous Recording Started", description: "Say your thoughts. Click stop to populate input for processing." });
      } else {
        toast({ title: "Could Not Start Recording", description: "System might be busy or microphone unavailable.", variant: "destructive" });
      }
    } else {
      thoughtInputFormRef.current?.stopLongRecordingAndProcess();
      setIsLongRecording(false);
      // The toast for stopping and populating input is now handled inside ThoughtInputForm
    }
  }, [isListening, isLongRecording, toast]);

  const handleStopLongRecordingParent = useCallback(() => {
    setIsLongRecording(false);
  }, []);


  if (!isClient) {
    return null; 
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center mb-6 gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <Button
          variant="ghost"
          size="icon"
          className="p-0 h-9 w-9 sm:h-10 sm:w-10"
          onClick={handleToggleLongRecording}
          disabled={!isListening}
          title={isLongRecording ? "Stop Continuous Recording" : "Start Continuous Recording"}
        >
          {isLongRecording ? (
            <StopCircle className="h-6 w-6 sm:h-7 sm:w-7 text-red-500 animate-pulse" />
          ) : (
            <PlayCircle className="h-6 w-6 sm:h-7 sm:w-7 text-green-500" />
          )}
        </Button>
      </div>
      
      <PassiveListenerControls isListening={isListening} onToggleListening={handleToggleListening} />
      
      <ThoughtInputForm 
        ref={thoughtInputFormRef}
        onThoughtRecalled={handleThoughtRecalled} 
        isListening={isListening}
        onToggleListeningParent={handleToggleListening}
        isExternallyLongRecording={isLongRecording}
        onStopLongRecordingParent={handleStopLongRecordingParent}
      />

      <Separator />

      <div>
        <h2 className="text-2xl font-semibold mb-4">Recent Thoughts</h2>
        <RecentThoughtsList
          thoughts={recalledThoughts}
          onPinThought={handlePinThought}
          onClarifyThought={handleClarifyThought}
          onDeleteThought={handleDeleteRecalledThought}
        />
      </div>

      {clarifyingThought && (
        <ThoughtClarifierDialog
          thought={clarifyingThought}
          isOpen={isClarifierOpen}
          onOpenChange={setIsClarifierOpen}
          onClarificationComplete={handleClarificationComplete}
        />
      )}
    </div>
  );
}
