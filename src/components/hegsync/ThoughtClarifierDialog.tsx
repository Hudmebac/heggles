
"use client";

import { useState, useEffect } from 'react';
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
  onClarificationComplete?: (clarifiedThought: Thought) => void;
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

  useEffect(() => {
    if (isOpen && thought) {
      // If the thought passed to the dialog already has refined data, display it.
      // Otherwise, start with no clarified data.
      if (thought.refinedTranscript || (thought.actionItems && thought.actionItems.length > 0)) {
        setClarifiedData({
          refinedTranscript: thought.refinedTranscript || thought.originalText, // Fallback if only action items exist
          actionItems: thought.actionItems || [],
        });
      } else {
        setClarifiedData(null); // This thought hasn't been clarified yet or has no existing clarification
      }
      setIsLoading(false); // Reset loading state when dialog opens or thought changes
    } else if (!isOpen) {
      // Optional: Reset when dialog closes. Useful if parent doesn't always pass a new `thought` object instance.
      // setClarifiedData(null); 
      // setIsLoading(false);
    }
  }, [isOpen, thought]); // Re-evaluate when dialog opens/closes or thought prop changes

  const handleClarify = async () => {
    if (!thought) return;
    setIsLoading(true);
    // We don't setClarifiedData(null) here anymore, as results will overwrite.
    // This provides a slightly smoother experience if re-clarifying.
    try {
      const result = await clarifyThoughtWithAI(thought.originalText); // Always clarify original text
      setClarifiedData(result); // Update dialog's view immediately
      toast({ title: "Thought Clarified", description: "AI refinement complete." });
      if (onClarificationComplete && thought) {
         onClarificationComplete({ // This updates the thought in the parent list
            ...thought,
            refinedTranscript: result.refinedTranscript,
            actionItems: result.actionItems,
        });
      }
    } catch (error) {
      toast({ title: "Clarification Failed", description: (error as Error).message, variant: "destructive" });
      // If clarification fails, we might want to revert clarifiedData or leave it as is
      // For now, it will retain the new (failed) data or previous if setClarifiedData(null) was used.
      // If API fails, clarifiedData might not be set if the error happens before setClarifiedData(result).
    } finally {
      setIsLoading(false);
    }
  };
  
  if (!thought) return null;

  const currentDisplayData = clarifiedData; // This is what the UI will render for refined content

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

            {currentDisplayData && (
              <>
                <div>
                  <h3 className="text-lg font-semibold mb-2 flex items-center"><Sparkles className="mr-2 h-5 w-5 text-primary"/>Refined Transcript</h3>
                  <p className="text-sm bg-primary/10 p-3 rounded-md whitespace-pre-wrap">{currentDisplayData.refinedTranscript}</p>
                </div>
                {currentDisplayData.actionItems.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold mb-2 flex items-center"><CheckSquare className="mr-2 h-5 w-5 text-primary"/>Potential Action Items</h3>
                    <ul className="space-y-1 list-disc list-inside pl-1">
                      {currentDisplayData.actionItems.map((item, index) => (
                        <li key={index} className="text-sm p-1 bg-primary/10 rounded-md">{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
             {!currentDisplayData && !isLoading && (
                 <p className="text-sm text-muted-foreground text-center py-4">Click "Clarify with AI" to refine this thought.</p>
            )}
            {isLoading && !currentDisplayData && ( // Show loading only if there's no data to display yet
                 <div className="flex justify-center items-center py-4">
                    <Loader2 className="h-8 w-8 animate-spin text-primary"/>
                    <p className="ml-2 text-muted-foreground">Clarifying...</p>
                 </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="mt-4">
          <Button onClick={handleClarify} disabled={isLoading} className="w-full sm:w-auto">
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {/* Button text changes based on whether there's already some clarification data */}
            {currentDisplayData ? "Re-Clarify with AI" : "Clarify with AI"}
          </Button>
           <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full sm:w-auto">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
