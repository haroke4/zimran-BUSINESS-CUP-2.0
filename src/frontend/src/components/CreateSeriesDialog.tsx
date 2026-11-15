import { useRef, useState, type FormEvent } from "react"
import { Plus, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { storyIdeas, type DraftInput } from "@/stories"

const moods = ["Tense", "Mysterious", "Light"]

export function CreateSeriesDialog({
  onCreate,
}: {
  onCreate: (input: DraftInput) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [premise, setPremise] = useState("")
  const [mood, setMood] = useState("")
  const [customMood, setCustomMood] = useState("")
  const [notes, setNotes] = useState("")
  const [invalid, setInvalid] = useState(false)
  const [ideaIndex, setIdeaIndex] = useState(0)
  const premiseInput = useRef<HTMLTextAreaElement>(null)

  function suggestIdea() {
    setPremise(storyIdeas[ideaIndex].premise)
    setIdeaIndex((ideaIndex + 1) % storyIdeas.length)
    setInvalid(false)
    toast.info("Idea filled in")
  }

  async function createSeries(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!premise.trim()) {
      setInvalid(true)
      premiseInput.current?.focus()
      return
    }
    setSubmitting(true)
    try {
      await onCreate({
        premise: premise.trim(),
        mood: customMood.trim() || mood,
        notes: notes.trim(),
      })
      setOpen(false)
      setPremise("")
      setMood("")
      setCustomMood("")
      setNotes("")
      setInvalid(false)
    } catch {
      /* The caller displays the public error. Keep the form for retry. */
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="lg" />}>
        <Plus data-icon="inline-start" /> Create a series
      </DialogTrigger>
      <DialogContent className="create-dialog" initialFocus={premiseInput}>
        <DialogHeader>
          <DialogTitle>Create a series</DialogTitle>
          <DialogDescription>
            Describe your idea. Your first scene will be created with sound and
            choices.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={createSeries} noValidate>
          <FieldGroup>
            <Field data-invalid={invalid}>
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <FieldLabel htmlFor="series-premise">
                  What's the story about?
                </FieldLabel>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={suggestIdea}
                >
                  <Sparkles data-icon="inline-start" /> Suggest an idea
                </Button>
              </div>
              <Textarea
                ref={premiseInput}
                id="series-premise"
                placeholder="Where does the story begin, and what happens?"
                rows={3}
                maxLength={600}
                value={premise}
                required
                aria-invalid={invalid}
                aria-describedby={invalid ? "premise-error" : undefined}
                onChange={(event) => {
                  setPremise(event.target.value)
                  if (event.target.value.trim()) setInvalid(false)
                }}
              />
              {invalid && (
                <FieldError id="premise-error">
                  Write a premise or pick a suggested idea.
                </FieldError>
              )}
            </Field>
            <FieldSet>
              <FieldLegend variant="label">Mood</FieldLegend>
              <ToggleGroup
                variant="outline"
                spacing={2}
                className="flex-wrap"
                value={mood ? [mood] : []}
                aria-label="Mood suggestions"
                onValueChange={(values) => {
                  setMood(values[0] ?? "")
                  if (values[0]) setCustomMood("")
                }}
              >
                {moods.map((item) => (
                  <ToggleGroupItem key={item} value={item}>
                    {item}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <Field>
                <FieldLabel htmlFor="series-mood" className="sr-only">
                  Your own mood
                </FieldLabel>
                <Input
                  id="series-mood"
                  placeholder="Or write your own"
                  maxLength={70}
                  value={customMood}
                  onChange={(event) => {
                    setCustomMood(event.target.value)
                    if (event.target.value.trim()) setMood("")
                  }}
                />
              </Field>
            </FieldSet>
            <Field>
              <FieldLabel htmlFor="series-notes">
                Notes <span className="text-muted-foreground">· optional</span>
              </FieldLabel>
              <Textarea
                id="series-notes"
                placeholder="For example, add a dog or make the story less dark"
                rows={2}
                maxLength={400}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-6">
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={submitting} aria-busy={submitting}>
              {submitting ? "Starting…" : "Create series"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
