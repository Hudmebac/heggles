
"use client";

import { useState, useEffect } from 'react';
import { useLocalStorage } from '@/lib/hooks/useLocalStorage';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Settings as SettingsIcon, Timer } from 'lucide-react';
import {
  BUFFER_TIME_OPTIONS,
  LOCALSTORAGE_KEYS,
  DEFAULT_BUFFER_TIME,
  type BufferTimeValue,
  WAKE_WORDS,
} from '@/lib/constants';

export default function SettingsPage() {
  const [bufferTime, setBufferTime] = useLocalStorage<BufferTimeValue>(
    LOCALSTORAGE_KEYS.BUFFER_TIME,
    DEFAULT_BUFFER_TIME
  );
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const handleBufferTimeChange = (value: string) => {
    setBufferTime(value as BufferTimeValue);
    // Dispatch a storage event so other components (like PassiveListenerControls) can react
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new StorageEvent('storage', {
            key: LOCALSTORAGE_KEYS.BUFFER_TIME,
            newValue: JSON.stringify(value as BufferTimeValue),
            storageArea: localStorage,
        }));
    }
  };

  if (!isClient) {
    return null; // Or a loading skeleton
  }
  
  const recallCmdSuffix = WAKE_WORDS.HEGGLES_REPLAY_THAT.substring(WAKE_WORDS.HEGGLES_BASE.length);


  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <SettingsIcon className="h-8 w-8 text-primary" />
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
      </div>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center text-xl">
            <Timer className="mr-2 h-6 w-6 text-muted-foreground" />
            Conceptual Buffer Time
          </CardTitle>
          <CardDescription>
            Adjust the simulated audio buffer period used by the &quot;<strong>Heggles</strong>{recallCmdSuffix}&quot; voice command.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="buffer-time-select" className="text-md font-medium">
              Select Buffer Period
            </Label>
            <Select
              value={bufferTime}
              onValueChange={handleBufferTimeChange}
            >
              <SelectTrigger id="buffer-time-select" aria-label="Select buffer time period">
                <SelectValue placeholder="Select buffer time" />
              </SelectTrigger>
              <SelectContent>
                {BUFFER_TIME_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-sm text-muted-foreground">
            This setting determines the duration from which the &quot;<strong>Heggles</strong>{recallCmdSuffix}&quot; voice command
            conceptually recalls a thought. For example, if set to &quot;5 Minutes&quot;, the command will
            simulate recalling a thought from the last 5 minutes of (conceptual) audio.
            The actual text processed by AI will be a placeholder indicating this selected duration.
          </p>
        </CardContent>
      </Card>
      
      {/* Future settings can be added here as new cards */}
    </div>
  );
}
