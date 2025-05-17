
"use client";

import { useState } from 'react';
import { Loader2, Sparkles, FileText, CheckSquare } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { clarifyThoughtWithAI } from '@/lib/actions';
import type { Thought } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';

interface ThoughtClarifierDialogProps {
  thought: Thought | null;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onClarificationComplete?: (clarifiedThought: Thought) => void; // Optional: if we want to update the main list
}

export function ThoughtClarifierDialog({
  thought,
  isOpen,
  onOpenChange,
  onClarificationComplete,
}: ThoughtClarifierDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [clarifiedData, setClarifiedData] = useState<{ refinedTranscript: string; actionItems: string[] } | null>(null);
  const { toast } = useToast();

  const handleClarify = async () => {
    if (!thought) return;
    setIsLoading(true);
    setClarifiedData(null); 
    try {
      const result = await clarifyThoughtWithAI(thought.originalText);
      setClarifiedData(result);
      toast({ title: "Thought Clarified", description: "AI refinement complete." });
      if (onClarificationComplete && thought) {
         onClarificationComplete({
            ...thought,
            refinedTranscript: result.refinedTranscript,
            actionItems: result.actionItems,
        });
      }
    } catch (error) {
      toast({ title: "Clarification Failed", description: (error as Error).message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };
  
  // Reset state when dialog closes or thought changes
  useState(() => {
    if (!isOpen || !thought) {
      setClarifiedData(null);
      setIsLoading(false);
    }
  });


  if (!thought) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center"><Sparkles className="mr-2 h-5 w-5 text-primary" />AI Thought Clarifier</DialogTitle>
          <DialogDescription>
            Refine the thought, remove filler words, and identify action items.
          </DialogDescription>
        </DialogHeader>
        
        <ScrollArea className="max-h-[60vh] p-1 pr-4">
          <div className="space-y-6 p-2">
            <div>
              <h3 className="text-lg font-semibold mb-2 flex items-center"><FileText className="mr-2 h-5 w-5 text-muted-foreground"/>Original Transcript</h3>
              <p className="text-sm bg-secondary/50 p-3 rounded-md whitespace-pre-wrap">{thought.originalText}</p>
            </div>

            {clarifiedData && (
              <>
                <div>
                  <h3 className="text-lg font-semibold mb-2 flex items-center"><Sparkles className="mr-2 h-5 w-5 text-primary"/>Refined Transcript</h3>
                  <p className="text-sm bg-primary/10 p-3 rounded-md whitespace-pre-wrap">{clarifiedData.refinedTranscript}</p>
                </div>
                {clarifiedData.actionItems.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold mb-2 flex items-center"><CheckSquare className="mr-2 h-5 w-5 text-primary"/>Potential Action Items</h3>
                    <ul className="space-y-1 list-disc list-inside pl-1">
                      {clarifiedData.actionItems.map((item, index) => (
                        <li key={index} className="text-sm p-1 bg-primary/10 rounded-md">{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="mt-4">
          {!clarifiedData && (
            <Button onClick={handleClarify} disabled={isLoading} className="w-full sm:w-auto">
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              Clarify with AI
            </Button>
          )}
           <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full sm:w-auto">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
