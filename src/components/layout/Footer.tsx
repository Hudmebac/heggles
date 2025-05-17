
import { Button } from "@/components/ui/button";
import Link from "next/link";
import Image from "next/image";

export function Footer() {
  return (
    <footer className="border-t bg-background/80 backdrop-blur-md">
      <div className="container mx-auto px-4 py-6 flex flex-col sm:flex-row justify-between items-center text-sm text-muted-foreground">
        <p>&copy; 2025 Craig Heggie. All rights reserved.</p>
        <Button variant="ghost" asChild className="mt-2 sm:mt-0">
          <Link href="https://heggie.netlify.app/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2">
            <Image
              src="https://heggie.netlify.app/favicon.ico"
              alt="HeggieHub Favicon"
              width={16}
              height={16}
              className="rounded-sm"
            />
            HeggieHub
          </Link>
        </Button>
      </div>
    </footer>
  );
}
