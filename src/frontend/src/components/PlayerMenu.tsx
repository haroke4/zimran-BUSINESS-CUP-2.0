import { useState } from "react"
import { House, Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"

export function PlayerMenu({
  onOpen,
  onLibrary,
}: {
  onOpen: () => void
  onLibrary: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        setOpen(value)
        if (value) onOpen()
      }}
    >
      <SheetTrigger
        render={
          <Button
            variant="outline"
            size="icon-lg"
            aria-label="Player menu"
            title="Player menu"
          />
        }
      >
        <Menu />
      </SheetTrigger>
      <SheetContent side="left" aria-describedby={undefined}>
        <SheetHeader>
          <SheetTitle>Your story</SheetTitle>
        </SheetHeader>
        <p className="px-4 text-sm text-muted-foreground">
          Your decisions are saved automatically. Return to the library to
          continue another story.
        </p>
        <Button
          variant="ghost"
          className="mx-4 justify-start"
          onClick={onLibrary}
        >
          <House data-icon="inline-start" /> Back to library
        </Button>
      </SheetContent>
    </Sheet>
  )
}
