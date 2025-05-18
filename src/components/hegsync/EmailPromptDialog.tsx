
"use client";

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';

interface EmailPromptDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (email: string) => void;
  listNameToShare: string;
}

export function EmailPromptDialog({
  isOpen,
  onOpenChange,
  onConfirm,
  listNameToShare,
}: EmailPromptDialogProps) {
  const [email, setEmail] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen) {
      setEmail(''); // Clear email field when dialog opens
    }
  }, [isOpen]);

  const handleSubmit = () => {
    if (!email.trim()) {
      toast({
        title: 'Email Required',
        description: 'Please enter an email address.',
        variant: 'destructive',
      });
      return;
    }
    if (!email.includes('@') || !email.includes('.')) {
      toast({
        title: 'Invalid Email Format',
        description: 'Please enter a valid email address.',
        variant: 'destructive',
      });
      return;
    }
    onConfirm(email);
    onOpenChange(false); // Close dialog on successful confirm
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Share {listNameToShare} via Email</DialogTitle>
          <DialogDescription>
            Enter the email address you want to send this list to.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="email-input" className="text-right col-span-1">
              Email
            </Label>
            <Input
              id="email-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="recipient@example.com"
              className="col-span-3"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>Send Email</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
