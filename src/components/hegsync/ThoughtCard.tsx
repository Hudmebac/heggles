
"use client"; // This is a Client Component

import { useState, useEffect } from 'react';
import { Pin, Sparkles, MessageSquareText, Tags, CalendarDays, AlertCircle, Trash2, HelpCircle, CheckCircle, Volume2, Search, Link as LinkIcon, ListPlus, CircleHelp, BrainCircuit } from 'lucide-react';
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


const aiAnswerContainsUncertainty = (answer: string | undefined): boolean => {
  if (!answer) return false;
  const lowerAnswer = answer.toLowerCase();
  const uncertaintyPhrases = [
    "i cannot answer", "i couldn't find", "not sure", "unable to determine",
    "i'm unable to answer", "i do not have enough information", "search did not yield",
    "results were not conclusive", "i'm sorry, i can't answer", "i don't know",
    "unable to provide an answer", "cannot provide an answer", "search results were not helpful",
    "information not found", "could not find information", "no definitive answer",
    "i'm sorry, i cannot", "apologies, i can't answer", "my search didn't yield a clear result",
    "my web search for that topic was not conclusive", "my search for that topic was not conclusive"
  ];
  return uncertaintyPhrases.some(phrase => lowerAnswer.includes(phrase));
};




interface ThoughtCardProps {
  thought: Thought | PinnedThought;
  onPin: (thought: Thought) => void;
  onClarify: (thought: Thought) => void;
  onDelete?: (thoughtId: string) => void; // Optional: only for recalled thoughts
  isPinned?: boolean;
}

export function ThoughtCard({ thought, onPin, onClarify, onDelete, isPinned = false }: ThoughtCardProps) {
  const questionForGoogleSearch = useMemo(() => {
    // If the AI answer indicates uncertainty and there's a question extracted, use that.
    // Otherwise, if there's a refined transcript that looks like a question, use that.
    // As a fallback, use the original text if it seems like a question (simple heuristic: ends with '?').
    if (aiAnswerContainsUncertainty(thought.aiAnswer) && thought.intentAnalysis?.extractedQuestion) return thought.intentAnalysis.extractedQuestion;
    if (thought.refinedTranscript && thought.refinedTranscript.trim().endsWith('?')) return thought.refinedTranscript.trim();
    if (thought.originalText.trim().endsWith('?')) return thought.originalText.trim();
    return null; // Don't show search link if no clear question is found
  }, [thought.intentAnalysis?.extractedQuestion, thought.originalText]);

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
    if (thought.aiAnswer) {
      console.log(`[ThoughtCard Debug] Thought ID: ${thought.id}`);
      console.log(`  AI Answer: "${thought.aiAnswer}"`);
      console.log(`  IsCreativeRequest: ${thought.isCreativeRequest}`);
      console.log(`  IsDirectionRequest: ${thought.isDirectionRequest}`);
      console.log(`  Suggested Action Text: ${thought.suggestedActionText || 'None'}`);
      console.log(`  Suggested Action Link: ${thought.suggestedActionLink || 'None'}`);
      console.log(`  Contains Uncertainty: ${aiAnswerContainsUncertainty(thought.aiAnswer)}`);
    } // `shouldShowGoogleSearchLink` is derived, not state or prop
  }, [thought.id, thought.aiAnswer, thought.isCreativeRequest, thought.isDirectionRequest, thought.suggestedActionText, thought.suggestedActionLink]);


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
        
        {/* AI Answer / Tool Suggestion Section */}
        {thought.aiAnswer && (
          <div className="space-y-1">
            <h4 className="font-semibold text-sm text-green-600 flex items-center justify-between">
              <span className="flex items-center">
                {thought.isCreativeRequest && <BrainCircuit className="mr-1.5 h-4 w-4"/>}
                {thought.isDirectionRequest && <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-map-pinned mr-1.5 h-4 w-4"><path d="M18 8c0 4.5-6 9-6 9s-6-4.5-6-9a6 6 0 0 1 12 0Z"/><circle cx="12" cy="8" r="2"/><path d="M8.835 14H5a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1h-3.835"/></svg>}
                {!thought.isCreativeRequest && !thought.isDirectionRequest && <HelpCircle className="mr-1.5 h-4 w-4"/>}
                AI Response:
              </span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handlePlayAnswer(thought.aiAnswer)}
                title="Play AI Answer"
                className="h-6 w-6"
              >
                <Volume2 className="h-4 w-4" />
              </Button>
            </h4>
            {thought.intentAnalysis?.isQuestion && thought.intentAnalysis.extractedQuestion && !thought.isCreativeRequest && !thought.isDirectionRequest && (
                 <p className="text-sm text-muted-foreground italic p-1">Q: {thought.intentAnalysis.extractedQuestion}</p>
            )}
            <p className="text-sm text-green-700 bg-green-50 p-2 rounded-md">{thought.aiAnswer}</p>
            
            {thought.suggestedActionLink && thought.suggestedActionText && (
              <Button variant="outline" size="sm" asChild className="mt-2 w-full text-xs">
                <a href={thought.suggestedActionLink} target="_blank" rel="noopener noreferrer">
                  {thought.isCreativeRequest && <BrainCircuit className="mr-2 h-3 w-3"/>}
                  {thought.isDirectionRequest && <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-map-pinned mr-2 h-3 w-3"><path d="M18 8c0 4.5-6 9-6 9s-6-4.5-6-9a6 6 0 0 1 12 0Z"/><circle cx="12" cy="8" r="2"/><path d="M8.835 14H5a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1h-3.835"/></svg>}
                  {!thought.isCreativeRequest && !thought.isDirectionRequest && <LinkIcon className="mr-2 h-3 w-3" />}
                  {thought.suggestedActionText}
                </a>
              </Button>
            )}

            {/* Additional action from creative request */}
            {thought.isCreativeRequest && thought.aiSuggestedActionFromCreative && thought.aiSuggestedListForCreativeAction && thought.aiSuggestedListForCreativeAction !== 'none' && (
                 <Button variant="outline" size="sm" onClick={handleSuggestAddToList} className="mt-2 w-full text-xs border-dashed border-primary text-primary hover:bg-primary/10">
                    <ListPlus className="mr-2 h-3 w-3"/>
                    Also add task: "{thought.aiSuggestedActionFromCreative.length > 20 ? thought.aiSuggestedActionFromCreative.substring(0,17) + '...' : thought.aiSuggestedActionFromCreative}" to {thought.aiSuggestedListForCreativeAction}?
                </Button>
            )}

            {aiAnswerContainsUncertainty(thought.aiAnswer) && questionForGoogleSearch && (
              <Button variant="outline" size="sm" asChild className="mt-2 w-full text-xs">
                <a
                  href={`https://www.google.com/search?q=${encodeURIComponent(questionForGoogleSearch)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Search className="mr-2 h-3 w-3" />
                  Search on Google
                </a>
              </Button>
            )}
          </div>
        )}

        {/* General Action Items & Intent Analysis (if not covered above) */}
        {thought.actionItems && thought.actionItems.length > 0 && !thought.isCreativeRequest && !thought.aiSuggestedActionFromCreative && (
          <div>
            <h4 className="font-semibold text-sm mb-1 text-orange-600 flex items-center">
              <AlertCircle className="mr-1.5 h-4 w-4"/> Action Items (from Refinement):
            </h4>
            <ul className="list-disc list-inside space-y-1 pl-1">
              {thought.actionItems.map((item, index) => (
                <li key={index} className="text-sm p-1 bg-orange-50 rounded-md">{item}</li>
              ))}
            </ul>
          </div>
        )}
         {thought.intentAnalysis?.isAction && thought.intentAnalysis.extractedAction && !thought.aiAnswer && !thought.aiSuggestedActionFromCreative && ( // Only show if not already handled by AI answer flow or creative suggestion
          <div>
            <h4 className="font-semibold text-sm mb-1 text-blue-600 flex items-center">
              <CheckCircle className="mr-1.5 h-4 w-4"/> Identified Action (from Intent):
            </h4>
            <p className="text-sm p-1 bg-blue-50 rounded-md">
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
