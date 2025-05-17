
"use client";

import { useState, useEffect } from 'react';
import { useLocalStorage } from '@/lib/hooks/useLocalStorage';
import type { Thought, PinnedThought } from '@/lib/types';
import { PassiveListenerControls } from '@/components/hegsync/PassiveListenerControls';
import { ThoughtInputForm } from '@/components/hegsync/ThoughtInputForm';
import { RecentThoughtsList } from '@/components/hegsync/RecentThoughtsList';
import { ThoughtClarifierDialog } from '@/components/hegsync/ThoughtClarifierDialog';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { pinThoughtAndSuggestCategories } from '@/lib/actions';
import { useRouter } from 'next/navigation';

export default function DashboardPage() {
  const [isListening, setIsListening] = useState(false);
  const [recalledThoughts, setRecalledThoughts] = useLocalStorage<Thought[]>('hegsync-recalled-thoughts', []);
  const [pinnedThoughts, setPinnedThoughts] = useLocalStorage<PinnedThought[]>('hegsync-memory-vault', []);
  
  const [clarifyingThought, setClarifyingThought] = useState<Thought | null>(null);
  const [isClarifierOpen, setIsClarifierOpen] = useState(false);

  const { toast } = useToast();
  const router = useRouter();

  const handleToggleListening = (active: boolean) => {
    setIsListening(active);
    // Simulate clearing buffer when listening stops, or initializing when it starts
    toast({ title: `Passive Listening ${active ? "Enabled" : "Disabled"}`, description: active ? "Ready to recall thoughts." : "" });
  };

  const handleThoughtRecalled = (newThought: Thought) => {
    setRecalledThoughts(prevThoughts => [newThought, ...prevThoughts].sort((a,b) => b.timestamp - a.timestamp));
  };
  
  const handlePinThought = async (thoughtToPin: Thought) => {
    try {
      const processedPinnedThoughtData = await pinThoughtAndSuggestCategories(thoughtToPin);
      const newPinnedThought: PinnedThought = {
        ...processedPinnedThoughtData,
        pinnedTimestamp: Date.now(),
      };
      setPinnedThoughts(prev => [newPinnedThought, ...prev].sort((a,b) => b.pinnedTimestamp - a.pinnedTimestamp));
      // Optionally remove from recalledThoughts or mark as pinned
      setRecalledThoughts(prev => prev.filter(t => t.id !== thoughtToPin.id));
      toast({ title: "Thought Pinned", description: "Successfully saved to Memory Vault." });
      router.push('/memory-vault'); // Navigate to memory vault after pinning
    } catch (error) {
      toast({ title: "Error Pinning Thought", description: (error as Error).message, variant: "destructive" });
    }
  };

  const handleClarifyThought = (thoughtToClarify: Thought) => {
    setClarifyingThought(thoughtToClarify);
    setIsClarifierOpen(true);
  };
  
  const handleClarificationComplete = (updatedThought: Thought) => {
    // Update the thought in recalledThoughts list
    setRecalledThoughts(prev => prev.map(t => t.id === updatedThought.id ? updatedThought : t));
    // Update in pinnedThoughts if it exists there too
    setPinnedThoughts(prev => prev.map(t => t.id === updatedThought.id ? { ...t, ...updatedThought } : t));
    setIsClarifierOpen(false);
  };


  // Ensure client-side only execution for localStorage access if needed for initial load
  const [isClient, setIsClient] = useState(false);
  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) {
    return null; // Or a loading spinner
  }

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
      
      <PassiveListenerControls isListening={isListening} onToggleListening={handleToggleListening} />
      
      <ThoughtInputForm onThoughtRecalled={handleThoughtRecalled} isListening={isListening} />

      <Separator />

      <div>
        <h2 className="text-2xl font-semibold mb-4">Recent Thoughts</h2>
        <RecentThoughtsList
          thoughts={recalledThoughts}
          onPinThought={handlePinThought}
          onClarifyThought={handleClarifyThought}
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
