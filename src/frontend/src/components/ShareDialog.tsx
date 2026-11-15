import { useRef, useState } from "react"
import { Check, Copy, Link2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"

export function ShareDialog({ onOpen }: { onOpen: () => void }) {
  const linkInput = useRef<HTMLInputElement>(null)
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied">(
    "idle"
  )
  const link = window.location.href

  async function copyLink() {
    setCopyState("copying")
    try {
      await navigator.clipboard.writeText(link)
      setCopyState("copied")
      toast.success("Link copied")
    } catch {
      setCopyState("idle")
      linkInput.current?.focus()
      linkInput.current?.select()
      toast.error("Copy the highlighted link manually")
    }
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        if (open) {
          setCopyState("idle")
          onOpen()
        }
      }}
    >
      <DialogTrigger
        render={
          <Button
            variant="outline"
            size="icon-lg"
            aria-label="Share"
            title="Share"
          />
        }
      >
        <Link2 />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share story</DialogTitle>
          <DialogDescription>
            Anyone with this link can open this story.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="story-link">Story link</FieldLabel>
          <Input
            id="story-link"
            ref={linkInput}
            value={link}
            readOnly
            onFocus={(event) => event.target.select()}
          />
        </Field>
        <DialogFooter>
          <Button
            onClick={() => void copyLink()}
            disabled={copyState === "copying"}
            aria-busy={copyState === "copying"}
          >
            {copyState === "copying" && <Spinner data-icon="inline-start" />}
            {copyState === "copied" && <Check data-icon="inline-start" />}
            {copyState === "idle" && <Copy data-icon="inline-start" />}
            {copyState === "copying"
              ? "Copying…"
              : copyState === "copied"
                ? "Copied"
                : "Copy link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
