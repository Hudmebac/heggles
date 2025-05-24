
"use client"; // This is a Client Component

import { useState, useEffect } from 'react';
import { Pin, Sparkles, MessageSquareText, Tags, CalendarDays, AlertCircle, Trash2, HelpCircle, CheckCircle, Volume2, Search, Link as LinkIcon, ListPlus, CircleHelp, BrainCircuit, ExternalLink } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useMemo } from 'react';
import type { Thought, PinnedThought, ShoppingListItem, ToDoListItem } from '@/lib/types';
import { formatDistanceToNow } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { LOCALSTORAGE_KEYS } from '@/lib/constants';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface ThoughtCardProps {
  thought: Thought | PinnedThought;
  onPin: (thought: Thought) => void;
  onClarify: (thought: Thought) => void;
  onDelete?: (thoughtId: string) => void; // Optional: only for recalled thoughts
  isPinned?: boolean;
}

export function ThoughtCard({ thought, onPin, onClarify, onDelete, isPinned = false }: ThoughtCardProps) {
  const { toast } = useToast();
  const [isSuggestActionDialogOpen, setIsSuggestActionDialogOpen] = useState(false);
  const [dialogActionDetails, setDialogActionDetails] = useState<{
    actionText: string;
    listType: "todo" | "shopping";
  } | null>(null);


  const timeAgo = formatDistanceToNow(new Date(thought.timestamp), { addSuffix: true });

  const handlePlayAnswer = (textToSpeak: string | undefined) => {
    if (!textToSpeak) return;

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel(); // Cancel any ongoing speech
      const utterance = new SpeechSynthesisUtterance(textToSpeak);
      window.speechSynthesis.speak(utterance);
    } else {
      console.warn("Speech synthesis not supported in this browser.");
      toast({title: "Text-to-Speech Not Supported", description: "Your browser does not support speech synthesis.", variant: "default"});
    }
  };

  useEffect(() => {
    // For debugging AI responses if needed
    if (thought.aiAnswer || (thought.actionItems && thought.actionItems.length > 0) || thought.suggestedActionLink) {
      console.log(`[ThoughtCard Debug] Thought ID: ${thought.id}`);
      console.log(`  AI Answer: "${thought.aiAnswer}"`);
      console.log(`  IsCreativeRequest: ${thought.isCreativeRequest}`);
      console.log(`  IsDirectionRequest: ${thought.isDirectionRequest}`);
      console.log(`  Suggested Action Text: ${thought.suggestedActionText || 'None'}`);
      console.log(`  Suggested Action Link: ${thought.suggestedActionLink || 'None'}`);
      console.log(`  Action Items: `, thought.actionItems);
    }
  }, [thought]);


  const handleSuggestAddToList = () => {
    if (thought.aiSuggestedActionFromCreative && thought.aiSuggestedListForCreativeAction && thought.aiSuggestedListForCreativeAction !== 'none') {
        setDialogActionDetails({
            actionText: thought.aiSuggestedActionFromCreative,
            listType: thought.aiSuggestedListForCreativeAction
        });
      setIsSuggestActionDialogOpen(true);
    }
  };
  
  const confirmAddSuggestedItemToList = () => {
    if (!dialogActionDetails) return;
    const {actionText, listType} = dialogActionDetails;
    const listKey = listType === 'shopping' ? LOCALSTORAGE_KEYS.SHOPPING_LIST : LOCALSTORAGE_KEYS.TODO_LIST;
    const listName = listType === 'shopping' ? "Shopping List" : "To-Do List";
    
    try {
      const currentItemsString = localStorage.getItem(listKey);
      let currentItems: Array<ShoppingListItem | ToDoListItem> = currentItemsString ? JSON.parse(currentItemsString) : [];

      if (listType === 'shopping') {
        const newItem: ShoppingListItem = { id: crypto.randomUUID(), text: actionText, completed: false };
        currentItems = [...currentItems, newItem] as ShoppingListItem[];
      } else { // ToDo
        const newItem: ToDoListItem = {
          id: crypto.randomUUID(), text: actionText, completed: false,
          timeSettingType: 'not_set', startTime: null, endTime: null, dueDate: null
        };
        currentItems = [...currentItems, newItem] as ToDoListItem[];
      }
      localStorage.setItem(listKey, JSON.stringify(currentItems));
      window.dispatchEvent(new StorageEvent('storage', { key: listKey, newValue: JSON.stringify(currentItems) }));
      toast({ title: "Item Added", description: `\"${actionText}\" added to your ${listName} based on AI suggestion.` });
    } catch (error) {
      console.error(`Error adding suggested item to ${listName}:`, error);
      toast({ title: `Error updating ${listName}`, description: "Could not save the suggested item.", variant: "destructive" });
    }
    setIsSuggestActionDialogOpen(false);
    setDialogActionDetails(null);
  };

  const hasAiResponseContent = thought.aiAnswer || thought.suggestedActionLink || (thought.actionItems && thought.actionItems.length > 0 && !thought.suggestedActionLink);

  return (
    <Card className="shadow-md hover:shadow-lg transition-shadow duration-200 flex flex-col h-full">
      <CardHeader>
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="text-lg flex items-center">
              <MessageSquareText className="mr-2 h-5 w-5 text-primary" />
              Thought
            </CardTitle>
            <CardDescription className="flex items-center mt-1">
              <CalendarDays className="mr-1.5 h-4 w-4 text-muted-foreground" /> {timeAgo}
            </CardDescription>
          </div>
          <div className="flex items-center space-x-1">
            {onDelete && !isPinned && (
              <Button variant="ghost" size="icon" onClick={() => onDelete(thought.id)} title="Delete this thought">
                <Trash2 className="h-5 w-5 text-destructive" />
              </Button>
            )}
            {!isPinned && (
               <Button variant="ghost" size="icon" onClick={() => onPin(thought)} title="Pin this thought">
                <Pin className="h-5 w-5" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 flex-grow">
        {thought.originalText && (
          <div>
            <h4 className="font-semibold text-sm mb-1">Original Text:</h4>
            <p className="text-sm text-muted-foreground p-2 bg-secondary/30 rounded-md whitespace-pre-wrap">{thought.originalText}</p>
          </div>
        )}
        {thought.summary && (
          <div>
            <h4 className="font-semibold text-sm mb-1">AI Summary:</h4>
            <p className="text-sm text-muted-foreground p-2 bg-secondary/30 rounded-md">{thought.summary}</p>
          </div>
        )}
        {thought.refinedTranscript && (
          <div>
            <h4 className="font-semibold text-sm mb-1 text-primary flex items-center">
              <Sparkles className="mr-1.5 h-4 w-4"/> Refined Transcript:
            </h4>
            <p className="text-sm text-muted-foreground p-2 bg-primary/10 rounded-md whitespace-pre-wrap">{thought.refinedTranscript}</p>
          </div>
        )}
        
        {/* AI Response Section */}
        {hasAiResponseContent && (
          <div className="space-y-1 pt-2 border-t border-border">
            <h4 className="font-semibold text-sm text-green-600 flex items-center justify-between">
              <span className="flex items-center">
                {thought.isCreativeRequest && <BrainCircuit className="mr-1.5 h-4 w-4"/>}
                {thought.isDirectionRequest && <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-map-pin mr-1.5 h-4 w-4"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>}
                {!thought.isCreativeRequest && !thought.isDirectionRequest && thought.aiAnswer && <HelpCircle className="mr-1.5 h-4 w-4"/>}
                AI Response:
              </span>
              {thought.aiAnswer && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handlePlayAnswer(thought.aiAnswer)}
                  title="Play AI Answer"
                  className="h-6 w-6"
                >
                  <Volume2 className="h-4 w-4" />
                </Button>
              )}
            </h4>
            {thought.intentAnalysis?.isQuestion && thought.intentAnalysis.extractedQuestion && !thought.isCreativeRequest && !thought.isDirectionRequest && (
                 <p className="text-xs text-muted-foreground italic p-1 bg-muted rounded-md">You asked: "{thought.intentAnalysis.extractedQuestion}"</p>
            )}
            {thought.aiAnswer && <p className="text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/30 p-2 rounded-md">{thought.aiAnswer}</p>}
            
            {/* Specific Tool/Action Link (AI Studio, Google Maps) */}
            {thought.suggestedActionLink && thought.suggestedActionText && (
              <Button variant="outline" size="sm" asChild className="mt-2 w-full text-xs">
                <a href={thought.suggestedActionLink} target="_blank" rel="noopener noreferrer">
                  {thought.isCreativeRequest && <BrainCircuit className="mr-2 h-3 w-3"/>}
                  {thought.isDirectionRequest && <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-map-pin mr-2 h-3 w-3"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>}
                  {!thought.isCreativeRequest && !thought.isDirectionRequest && <ExternalLink className="mr-2 h-3 w-3" />}
                  {thought.suggestedActionText}
                </a>
              </Button>
            )}

            {/* Additional action from creative request */}
            {thought.isCreativeRequest && thought.aiSuggestedActionFromCreative && thought.aiSuggestedListForCreativeAction && thought.aiSuggestedListForCreativeAction !== 'none' && (
                 <Button variant="outline" size="sm" onClick={handleSuggestAddToList} className="mt-2 w-full text-xs border-dashed border-primary text-primary hover:bg-primary/10">
                    <ListPlus className="mr-2 h-3 w-3"/>
                    Also add: "{thought.aiSuggestedActionFromCreative.length > 25 ? thought.aiSuggestedActionFromCreative.substring(0,22) + '...' : thought.aiSuggestedActionFromCreative}" to {thought.aiSuggestedListForCreativeAction}?
                </Button>
            )}

            {/* Fallback Action Items (e.g., Google Search, etc.) if AI couldn't answer and didn't provide a specific tool link */}
            {thought.actionItems && thought.actionItems.length > 0 && !thought.suggestedActionLink && (
              <div className="mt-2 space-y-1 pt-2 border-t border-border">
                <p className="text-xs text-muted-foreground">If that wasn't helpful, you can also try:</p>
                {thought.actionItems.map((action, index) => (
                  <Button variant="link" size="sm" asChild key={index} className="p-0 h-auto text-xs justify-start text-primary hover:text-primary/80">
                    <a href={action.url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="mr-1.5 h-3 w-3" />
                      {action.title}
                    </a>
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* General Action Items from refineThought (only if not already covered by AI response section) */}
        {thought.actionItems && thought.actionItems.length > 0 && !hasAiResponseContent && (
          <div>
            <h4 className="font-semibold text-sm mb-1 text-orange-600 dark:text-orange-400 flex items-center">
              <AlertCircle className="mr-1.5 h-4 w-4"/> Potential Action Items:
            </h4>
            <ul className="list-disc list-inside space-y-1 pl-1">
              {thought.actionItems.map((item, index) => (
                <li key={index} className="text-sm p-1 bg-orange-50 dark:bg-orange-900/30 rounded-md">{item}</li>
              ))}
            </ul>
          </div>
        )}
         {thought.intentAnalysis?.isAction && thought.intentAnalysis.extractedAction && !hasAiResponseContent && !thought.aiSuggestedActionFromCreative && ( 
          <div>
            <h4 className="font-semibold text-sm mb-1 text-blue-600 dark:text-blue-400 flex items-center">
              <CheckCircle className="mr-1.5 h-4 w-4"/> Identified Action:
            </h4>
            <p className="text-sm p-1 bg-blue-50 dark:bg-blue-900/30 rounded-md">
              {thought.intentAnalysis.extractedAction}
              {thought.intentAnalysis.suggestedList && thought.intentAnalysis.suggestedList !== 'none' && (
                <span className="text-xs italic ml-1">(Suggested for: {thought.intentAnalysis.suggestedList})</span>
              )}
            </p>
          </div>
        )}

        {thought.keywords && thought.keywords.length > 0 && (
          <div>
            <h4 className="font-semibold text-sm mb-1 flex items-center">
              <Tags className="mr-1.5 h-4 w-4 text-muted-foreground" /> Keywords:
            </h4>
            <div className="flex flex-wrap gap-1">
              {thought.keywords.map((keyword, index) => (
                <Badge key={index} variant="secondary">
                  {keyword}
                </Badge>
              ))}
            </div>
          </div>
        )}
        {(thought as PinnedThought).categories && ((thought as PinnedThought).categories?.length ?? 0) > 0 && (
           <div>
            <h4 className="font-semibold text-sm mb-1">Categories:</h4>
            <div className="flex flex-wrap gap-1">
              {(thought as PinnedThought).categories!.map((category, index) => (
                <Badge key={index} variant="outline" className="bg-primary/10 text-primary-foreground">
                  {category}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
      <CardFooter>
        <Button variant="outline" size="sm" onClick={() => onClarify(thought)} className="w-full">
          <Sparkles className="mr-2 h-4 w-4" />
          {thought.refinedTranscript ? "View/Re-Clarify" : "Clarify with AI"}
        </Button>
      </CardFooter>

      {dialogActionDetails && (
        <AlertDialog open={isSuggestActionDialogOpen} onOpenChange={setIsSuggestActionDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>AI Suggestion</AlertDialogTitle>
              <AlertDialogDescription>
                The AI also suggests adding the task "<strong>{dialogActionDetails.actionText}</strong>" to your {dialogActionDetails.listType} list. Would you like to add it?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => {setIsSuggestActionDialogOpen(false); setDialogActionDetails(null);}}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={confirmAddSuggestedItemToList}>Add to List</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </Card>
  );
}
