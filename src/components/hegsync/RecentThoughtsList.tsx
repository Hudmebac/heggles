
"use client";

import { useState, useMemo } from 'react';
import type { Thought } from '@/lib/types';
import { ThoughtCard } from './ThoughtCard';import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';import { ListCollapse } from 'lucide-react';
import { Lightbulb } from 'lucide-react';
interface RecentThoughtsListProps {
  thoughts: Thought[];
  onPinThought: (thought: Thought) => void;
  onClarifyThought: (thought: Thought) => void;
  onDeleteThought: (thoughtId: string) => void;
}

export function RecentThoughtsList({ thoughts, onPinThought, onClarifyThought, onDeleteThought }: RecentThoughtsListProps) {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredThoughts = useMemo(() => {
    if (!searchTerm) return thoughts;
    return thoughts.filter(thought =>
      thought.originalText.toLowerCase().includes(searchTerm.toLowerCase()) ||
      thought.summary?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      thought.keywords?.some(k => k.toLowerCase().includes(searchTerm.toLowerCase()))
    ).sort((a,b) => b.timestamp - a.timestamp); // Ensure sorted by most recent
  }, [thoughts, searchTerm]);

  if (thoughts.length === 0) {
    return (
      <div className="text-center py-10">
        <ListCollapse className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-xl font-semibold">No Thoughts Yet</h3>
        <p className="text-muted-foreground">Recalled thoughts will appear here.</p>
      </div>
    );
  }
  
  return (
    <>
 <div className="relative flex-grow">
 <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search thoughts..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10 w-full"

        />
      </div>
      {filteredThoughts.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 space-y-6">
          {filteredThoughts.map(thought => (
            <ThoughtCard
              key={thought.id}
              thought={thought}
              onPin={onPinThought}
              onClarify={onClarifyThought}
              onDelete={onDeleteThought}
            />
          ))}
        </div>

      ) : (
        <div className="text-center py-10">
          <Search className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-xl font-semibold">No Matching Thoughts</h3>
          <p className="text-muted-foreground">Try a different search term.</p>
        </div>
      )}
    </>
  );
}
