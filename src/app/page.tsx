"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocalStorage } from '@/lib/hooks/useLocalStorage';
import type { Thought, PinnedThought } from '@/lib/types';
import { ThoughtInputForm, type ThoughtInputFormHandle } from '@/components/hegsync/ThoughtInputForm';
import { RecentThoughtsList } from '@/components/hegsync/RecentThoughtsList';
import { ThoughtClarifierDialog } from '@/components/hegsync/ThoughtClarifierDialog';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Mic, Radio, PlayCircle, StopCircle } from 'lucide-react'; // Added PlayCircle, StopCircle for consistency
import { useToast } from '@/hooks/use-toast';
import { pinThoughtAndSuggestCategories } from '@/lib/actions';
import { LOCALSTORAGE_KEYS } from '@/lib/constants';

export default function DashboardPage() {
  const [recalledThoughts, setRecalledThoughts] = useLocalStorage<Thought[]>(LOCALSTORAGE_KEYS.RECALLED_THOUGHTS, []);
  const [pinnedThoughts, setPinnedThoughts] = useLocalStorage<PinnedThought[]>(LOCALSTORAGE_KEYS.MEMORY_VAULT, []);
  
  const [clarifyingThought, setClarifyingThought] = useState<Thought | null>(null);
  const [isClarifierOpen, setIsClarifierOpen] = useState(false);

  const thoughtInputFormRef = useRef<ThoughtInputFormHandle>(null);
  const [isLongRecording, setIsLongRecording] = useState(false); 

  const { toast } = useToast();

  const handleThoughtRecalled = useCallback((newThought: Thought) => {
    setRecalledThoughts(prevThoughts => [newThought, ...prevThoughts.slice(0, 14)].sort((a,b) => b.timestamp - a.timestamp));
  }, [setRecalledThoughts]);

  const handleEmptyRecalledThoughts = useCallback(() => {
    setRecalledThoughts([]);
    toast({ title: "Recent Thoughts Cleared", description: "All recalled thoughts have been removed from the dashboard." });
  }, [setRecalledThoughts, toast]);
  
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
      // Toast for stopping is handled within stopLongRecordingAndProcess's onstop handler
    }
  }, [isLongRecording, toast]);

  const onStopLongRecordingParent = useCallback(() => {
    setIsLongRecording(false);
  }, []);


  if (!isClient) {
    return null; 
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between mb-6 gap-2">
        <div className="flex items-center gap-3">
         <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        </div>
        <Button
          variant="ghost"
          size="lg" 
          className="p-2 h-14 w-14 rounded-full" 
          onClick={handleToggleLongRecording}
          title={isLongRecording ? "Stop Continuous Recording" : "Start Continuous Recording (Mic)"}
        >
          {isLongRecording ? (
            <Radio className="h-10 w-10 text-red-500 animate-pulse" />
          ) : (
            <Mic className="h-10 w-10 text-primary" />
          )}
        </Button>
      </div>
      
      <ThoughtInputForm 
        ref={thoughtInputFormRef}
        onThoughtRecalled={handleThoughtRecalled} 
        onEmptyRecalledThoughts={handleEmptyRecalledThoughts}
        isExternallyLongRecording={isLongRecording}
        onStopLongRecordingParent={onStopLongRecordingParent}
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
