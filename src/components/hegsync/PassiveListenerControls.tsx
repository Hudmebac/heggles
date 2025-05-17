
"use client";

import { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, AlertTriangle, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { WAKE_WORDS, RECORDING_DURATION_MS } from '@/lib/constants';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface PassiveListenerControlsProps {
  isListening: boolean;
  onToggleListening: (isListening: boolean) => void;
}

// Basic inline SVGs as a fallback for icons in text
const BrainIconSvg = () => <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-brain inline-block h-3 w-3 mx-0.5"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.98-1.65 2.5 2.5 0 0 1-1.09-2.38V10c0-2.07 1.12-3.98 2.86-5.06S9.59 3.08 9.59 3.08A2.33 2.33 0 0 1 9.5 2Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.98-1.65 2.5 2.5 0 0 0 1.09-2.38V10c0-2.07-1.12-3.98-2.86-5.06S14.41 3.08 14.41 3.08A2.33 2.33 0 0 0 14.5 2Z"/></svg>;
const PlayCircleIconSvg = () => <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-play-circle inline-block h-3 w-3 mx-0.5 text-green-500"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>;
const StopCircleIconSvg = () => <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-stop-circle inline-block h-3 w-3 mx-0.5 text-red-500"><circle cx="12" cy="12" r="10"/><rect width="6" height="6" x="9" y="9"/></svg>;
const MicIconSvg = () => <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-mic inline-block h-3 w-3 mx-0.5 text-primary"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>;


export function PassiveListenerControls({ isListening, onToggleListening }: PassiveListenerControlsProps) {
  const [showWarning, setShowWarning] = useState(false);
  const [accordionValue, setAccordionValue] = useState<string>(""); // "" means collapsed

  // Effect for the warning message display
  useEffect(() => {
    let warningTimerId: NodeJS.Timeout | undefined;
    if (isListening) {
      setShowWarning(true);
      warningTimerId = setTimeout(() => {
        setShowWarning(false);
      }, 5000);
    } else {
      setShowWarning(false);
    }
    return () => {
      if (warningTimerId) {
        clearTimeout(warningTimerId);
      }
    };
  }, [isListening]);

  // Effect to manage auto-opening of accordion
  const firstRenderRef = useRef(true);
  const prevIsListeningRef = useRef(isListening);

  useEffect(() => {
    if (firstRenderRef.current) {
      if (isListening) {
        setAccordionValue("voice-commands-panel"); // Open if listening on initial mount
      }
      firstRenderRef.current = false;
    } else {
      if (isListening && !prevIsListeningRef.current) { // Open if isListening transitioned from false to true
        setAccordionValue("voice-commands-panel");
      }
    }
    prevIsListeningRef.current = isListening;
  }, [isListening]);

  const handleToggleSwitch = (checked: boolean) => {
    onToggleListening(checked);
  };

  const recallCmdSuffix = WAKE_WORDS.HEGGLES_REPLAY_THAT.substring(WAKE_WORDS.HEGGLES_BASE.length);
  const addShopCmdSuffix = WAKE_WORDS.ADD_TO_SHOPPING_LIST_FULL_PREFIX_REGEX_PART;
  const addToDoCmdSuffix = WAKE_WORDS.ADD_TO_TODO_LIST_FULL_PREFIX_REGEX_PART;
  const setBufferCmdSuffix = WAKE_WORDS.HEGGLES_SET_BUFFER.substring(WAKE_WORDS.HEGGLES_BASE.length);
  const turnOnCmdSuffix = WAKE_WORDS.HEGGLES_TURN_ON.substring(WAKE_WORDS.HEGGLES_BASE.length);
  const turnOffCmdSuffix = WAKE_WORDS.HEGGLES_TURN_OFF.substring(WAKE_WORDS.HEGGLES_BASE.length);
  const deleteItemSuffix = WAKE_WORDS.DELETE_ITEM_PREFIX.substring(WAKE_WORDS.HEGGLES_BASE.length);
  const recordingDurationSeconds = RECORDING_DURATION_MS / 1000;

  return (
    <Card className="w-full shadow-lg">
      <Accordion
        type="single"
        collapsible
        value={accordionValue}
        onValueChange={(value) => setAccordionValue(value || "")} // Ensure empty string for collapsed
      >
        <AccordionItem value="voice-commands-panel" className="border-b-0">
          <CardHeader className="p-4">
            <AccordionTrigger className="p-0 hover:no-underline">
              <div className="flex flex-row justify-between items-center w-full">
                <div className="flex items-center">
                  {isListening ? <Mic className="mr-2 h-6 w-6 text-primary animate-pulse" /> : <MicOff className="mr-2 h-6 w-6 text-muted-foreground" />}
                  <CardTitle className="text-xl">
                    Voice Commands.
                  </CardTitle>
                </div>
              </div>
            </AccordionTrigger>
            <div className="flex items-center justify-between space-x-2 pt-3">
                <Label htmlFor="listening-mode-switch" className="text-base font-medium">
                    {isListening ? "Listening Active" : "Listening Inactive"}
                </Label>
                <Switch
                    id="listening-mode-switch"
                    checked={isListening}
                    onCheckedChange={handleToggleSwitch}
                    aria-label="Toggle voice command listening mode"
                />
            </div>
          </CardHeader>
          <AccordionContent>
            <CardContent className="pt-0 pb-4 px-4 space-y-4">
              {showWarning && (
                <div className="flex items-center p-3 border border-yellow-400 bg-yellow-50 text-yellow-700 rounded-md text-sm">
                  <AlertTriangle className="h-5 w-5 mr-2" />
                  <span>
                    Voice command listening is active. Microphone may be used for voice commands.
                  </span>
                </div>
              )}
              <div className="flex items-start p-3 border rounded-lg bg-secondary/30 text-sm text-muted-foreground">
                  <Info className="h-5 w-5 mr-2 mt-0.5 shrink-0 text-primary" />
                  <div>
                      Most voice commands starting with '<strong>Heggles</strong>' will populate the input area on the dashboard. Click the <BrainIconSvg /> icon to process the populated text.
                      The "Conceptual Buffer Time" (used by voice command '<strong>Heggles</strong>{setBufferCmdSuffix} [duration]') can be configured on the <Button variant="link" asChild className="p-0 h-auto text-sm text-muted-foreground underline"><a href="/settings">Settings page</a></Button>.
                      <ul className="list-disc pl-5 mt-1 space-y-0.5">
                        <li>Toggle listening: <q><strong>Heggles</strong>{turnOnCmdSuffix}</q> / <q><strong>Heggles</strong>{turnOffCmdSuffix}</q>. (Immediate action)</li>
                        <li>If "<strong>Heggles</strong>{recallCmdSuffix}" populates the input, clicking <BrainIconSvg /> triggers a {recordingDurationSeconds}-second live audio recording & transcription for processing.</li>
                        <li>Add to shopping list: <q><strong>Heggles</strong> {addShopCmdSuffix} [item] to my shopping list</q>. (Populates input for <BrainIconSvg /> processing & confirmation)</li>
                        <li>Add to to-do list: <q><strong>Heggles</strong> {addToDoCmdSuffix} [task] to my to do list</q>. (Populates input for <BrainIconSvg /> processing & confirmation)</li>
                        <li>Set buffer: <q><strong>Heggles</strong>{setBufferCmdSuffix} [e.g., 5 minutes / always on]</q>. (Immediate action, updates setting on Settings page)</li>
                        <li>Delete item: <q><strong>Heggles</strong> {deleteItemSuffix} [item/item number X] from [shopping list/to do list]</q>. (Populates input for <BrainIconSvg /> processing)</li>
                        <li>The <MicIconSvg /> icon button (in Input & Recall card) is for direct dictation into the input area (stops on pause or "<strong>Heggles</strong> end/stop"); then use <BrainIconSvg /> to process.</li>
                        <li>The <PlayCircleIconSvg />/<StopCircleIconSvg /> button (header) is for continuous recording; its transcript populates the input area when stopped, then use <BrainIconSvg /> to process.</li>
                      </ul>
                  </div>
              </div>
            </CardContent>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Card>
  );
}
