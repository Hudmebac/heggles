
"use client";

import { useState, useEffect, useMemo } from 'react';
import { useLocalStorage } from '@/lib/hooks/useLocalStorage';
import type { PinnedThought, Thought } from '@/lib/types';
import { ThoughtCard } from '@/components/hegsync/ThoughtCard';
import { ThoughtClarifierDialog } from '@/components/hegsync/ThoughtClarifierDialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Archive, Search, Tag, XCircle, ListCollapse } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function MemoryVaultPage() {
  const [pinnedThoughts, setPinnedThoughts] = useLocalStorage<PinnedThought[]>('hegsync-memory-vault', []);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | "all">("all");
  
  const [clarifyingThought, setClarifyingThought] = useState<PinnedThought | null>(null);
  const [isClarifierOpen, setIsClarifierOpen] = useState(false);
  const { toast } = useToast();

  const [isClient, setIsClient] = useState(false);
  useEffect(() => {
    setIsClient(true);
  }, []);

  const allCategories = useMemo(() => {
    const categories = new Set<string>();
    pinnedThoughts.forEach(thought => {
      thought.categories?.forEach(cat => categories.add(cat));
    });
    return Array.from(categories).sort();
  }, [pinnedThoughts]);

  const filteredThoughts = useMemo(() => {
    return pinnedThoughts
      .filter(thought => {
        const searchMatch = searchTerm === '' ||
          thought.originalText.toLowerCase().includes(searchTerm.toLowerCase()) ||
          thought.summary?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          thought.keywords?.some(k => k.toLowerCase().includes(searchTerm.toLowerCase())) ||
          thought.categories?.some(c => c.toLowerCase().includes(searchTerm.toLowerCase()));
        
        const categoryMatch = selectedCategory === "all" || thought.categories?.includes(selectedCategory);
        
        return searchMatch && categoryMatch;
      })
      .sort((a, b) => b.pinnedTimestamp - a.pinnedTimestamp);
  }, [pinnedThoughts, searchTerm, selectedCategory]);

  const handleClarifyThought = (thoughtToClarify: PinnedThought) => {
    setClarifyingThought(thoughtToClarify);
    setIsClarifierOpen(true);
  };
  
  const handleClarificationComplete = (updatedThought: PinnedThought) => {
    setPinnedThoughts(prev => prev.map(t => t.id === updatedThought.id ? { ...t, ...updatedThought } : t));
    setIsClarifierOpen(false);
  };

  const handleUnpinThought = (thoughtId: string) => {
    setPinnedThoughts(prev => prev.filter(t => t.id !== thoughtId));
    toast({ title: "Thought Unpinned", description: "Removed from Memory Vault." });
  };

  if (!isClient) {
    return null; // Or a loading spinner
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
        <h1 className="text-3xl font-bold tracking-tight flex items-center">
          <Archive className="mr-3 h-8 w-8 text-primary" /> Memory Vault
        </h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end p-4 border rounded-lg bg-card shadow">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search pinned thoughts..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 w-full"
          />
        </div>
        <div className="flex items-center gap-2">
          <Tag className="h-5 w-5 text-muted-foreground shrink-0" />
          <Select value={selectedCategory} onValueChange={(value) => setSelectedCategory(value as string)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Filter by category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {allCategories.map(category => (
                <SelectItem key={category} value={category}>{category}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      
      {filteredThoughts.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredThoughts.map(thought => (
            <div key={thought.id} className="relative group">
              <ThoughtCard
                thought={thought}
                onPin={() => {}} // Pinning is done from dashboard, here we might unpin
                onClarify={() => handleClarifyThought(thought)}
                isPinned={true}
              />
              <Button 
                variant="destructive" 
                size="icon" 
                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => handleUnpinThought(thought.id)}
                title="Unpin this thought"
              >
                <XCircle className="h-5 w-5" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-16">
          <ListCollapse className="mx-auto h-16 w-16 text-muted-foreground mb-6" />
          <h3 className="text-2xl font-semibold">Memory Vault is Empty or No Matches</h3>
          <p className="text-muted-foreground mt-2">
            {pinnedThoughts.length === 0 
              ? "Pin thoughts from the dashboard to save them here."
              : "Try adjusting your search or category filter."}
          </p>
        </div>
      )}

      {clarifyingThought && (
        <ThoughtClarifierDialog
          thought={clarifyingThought}
          isOpen={isClarifierOpen}
          onOpenChange={setIsClarifierOpen}
          onClarificationComplete={(updatedClarifiedThought) => 
            handleClarificationComplete(updatedClarifiedThought as PinnedThought)
          }
        />
      )}
    </div>
  );
}
