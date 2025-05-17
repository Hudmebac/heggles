
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocalStorage } from '@/lib/hooks/useLocalStorage';
import type { Thought, PinnedThought } from '@/lib/types';
// import { PassiveListenerControls } from '@/components/hegsync/PassiveListenerControls'; // Removed
import { ThoughtInputForm, type ThoughtInputFormHandle } from '@/components/hegsync/ThoughtInputForm';
import { RecentThoughtsList } from '@/components/hegsync/RecentThoughtsList';
import { ThoughtClarifierDialog } from '@/components/hegsync/ThoughtClarifierDialog';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Mic, Radio } from 'lucide-react'; // Changed PlayCircle, StopCircle to Mic, Radio
import { useToast } from '@/hooks/use-toast';
import { pinThoughtAndSuggestCategories } from '@/lib/actions';
import { LOCALSTORAGE_KEYS } from '@/lib/constants';

export default function DashboardPage() {
  // isListening state for wake word is removed. Continuous recording state is now primary for dashboard mic.
  const [recalledThoughts, setRecalledThoughts] = useLocalStorage<Thought[]>(LOCALSTORAGE_KEYS.RECALLED_THOUGHTS, []);
  const [pinnedThoughts, setPinnedThoughts] = useLocalStorage<PinnedThought[]>(LOCALSTORAGE_KEYS.MEMORY_VAULT, []);
  
  const [clarifyingThought, setClarifyingThought] = useState<Thought | null>(null);
  const [isClarifierOpen, setIsClarifierOpen] = useState(false);

  const thoughtInputFormRef = useRef<ThoughtInputFormHandle>(null);

  const [isLongRecording, setIsLongRecording] = useState(false); // This state now controls the header mic

  const { toast } = useToast();

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
    if (!isLongRecording) {
      if (thoughtInputFormRef.current?.startLongRecording()) {
        setIsLongRecording(true);
        toast({ title: "Continuous Recording Started", description: "Speak your thoughts. Click stop when done. Transcript will populate input for processing." });
      } else {
        toast({ title: "Could Not Start Recording", description: "System might be busy or microphone unavailable.", variant: "destructive" });
      }
    } else {
      thoughtInputFormRef.current?.stopLongRecordingAndProcess();
      // setIsLongRecording(false); // This will be set by onStopLongRecordingParent callback
      // Toast for stopping is now handled within ThoughtInputForm or after transcript population
    }
  }, [isLongRecording, toast]);

  const handleStopLongRecordingParent = useCallback(() => {
    setIsLongRecording(false);
  }, []);


  if (!isClient) {
    return null; 
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between mb-6 gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <Button
          variant="ghost"
          size="lg" // Made larger
          className="p-2 h-12 w-12 sm:h-14 sm:w-14 rounded-full" // Made larger and rounder
          onClick={handleToggleLongRecording}
          title={isLongRecording ? "Stop Continuous Recording" : "Start Continuous Recording (Mic)"}
        >
          {isLongRecording ? (
            <Radio className="h-7 w-7 sm:h-8 sm:w-8 text-red-500 animate-pulse" />
          ) : (
            <Mic className="h-7 w-7 sm:h-8 sm:w-8 text-primary" />
          )}
        </Button>
      </div>
      
      {/* PassiveListenerControls removed */}
      
      <ThoughtInputForm 
        ref={thoughtInputFormRef}
        onThoughtRecalled={handleThoughtRecalled} 
        isExternallyLongRecording={isLongRecording} // Pass this to sync state
        onStopLongRecordingParent={handleStopLongRecordingParent} // Callback to sync state
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
