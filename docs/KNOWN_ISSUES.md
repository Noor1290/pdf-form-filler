# Known issues

Things noticed during the visual redesign that are about behaviour, not looks.
The redesign changed none of the items under "Not fixed". The few small
changes it did make on purpose are under "Fixed during the redesign". All
evidence uses fake data.

# Not fixed

## 1. A person being typed in is lost by clicking another person, or by "Clear all"

**Priority: HIGH**, both routes (1a and 1b). They silently lose data someone
has just typed. To be fixed on their own branch after the redesign.

**Where:** fill-in screen, People list.

### 1a. Clicking another person (HIGH)

**What happens:** add a first person, start typing a second one, then click
"Person 1" in the list before pressing "Add & fill next person". The second
person's typed values disappear. There is no warning and no way to get them
back.

**How to reproduce, step by step** (any template with at least one field; the
evidence below used a template called "Fake Form" with a field called
"Surname"):

1. Open the template from the home screen, so the fill-in screen shows.
2. Type "Testperson" into Surname.
3. Press "Add & fill next person". The People list now shows "Person 1" and
   the form is empty again.
4. Type "Sampleton" into Surname. Do not press "Add & fill next person".
5. Click "Person 1" in the People list.

Expected: the second person is kept (added to the list), or the app asks
before throwing the typed values away.

Actual: the form shows "Testperson" again, the People list still has only
"Person 1", and "Sampleton" is gone.

**Evidence:**

| Step | People listed | Surname box |
| --- | --- | --- |
| After step 4 | 1 | Sampleton |
| After step 5 | 1 | Testperson |

After step 5, "Sampleton" is nowhere on the screen or in any box, and no
dialog asked first.

**Where in the code:** the function handleSelectEntry in
src/components/FieldForm.tsx. When no listed person is selected (the form
holds a new, unadded person) it replaces the form's values without saving
them anywhere.

### 1b. Pressing "Clear all" (HIGH)

**How to reproduce:** follow steps 1 to 4 above, then press "Clear all" and
confirm.

Expected: the confirmation says that the person being typed will be thrown
away too, or keeps them.

Actual: the confirmation only counts the people in the list ("This will
remove everyone added to this batch (1 person)."), and confirming also empties
the form.

**Evidence:** with the same fake data, after confirming, 0 people are listed
and the Surname box is empty.

### Not affected

Clicking Download PDF with a second person typed but not yet added does
include them. The safety-net test covers this:
`secondPersonTypedButNotAddedDownload` produces 2 pages.

## 2. Moving a field opens its settings

**Where:** field editor, and the fill-in screen with positions unlocked.

**What happens:** drag a field to move it and let go. The "Field settings"
dialog for that field opens, although nothing was clicked on purpose. It has to
be closed with Done before carrying on. Resizing a field does not do this.

**Evidence:** the safety-net test records it. In
`tests/expected/templates-and-field-editor.json`, `settingsOpenAfterDragging`
is `1` after dragging the "Basic Salary" field by 40 by 30 pixels. The move
itself is saved correctly (x 74.38 to 104.12, y 163.63 to 185.94 points). In
`tests/expected/field-positions-drag-and-resize.json`, `settingsOpenedAfter`
is `1` after each move and `0` after each resize, on both the upright and the
rotated page.

**Likely cause:** the field reacts to the click that ends the drag the same way
it reacts to a plain click.

## 3. Fields on the page cannot be reached with the keyboard

**Where:** fill-in screen and field editor.

**What happens:** a field's settings open by clicking its outline on the PDF
page, and a field is moved or resized by dragging. Neither can be done with the
Tab key: the outlines are not focusable. Everything else (typing values,
people, import, download, the list of fields with its Rename and Delete
buttons, every dialog) works from the keyboard.

**Evidence:** `npm run check:a11y` visits 41 Tab stops on the fill-in screen
and its dialogs and 14 in the field editor; none of them is a field outline.

**Why it was left:** making the outlines focusable and giving them key
handling is new behaviour, not styling.

## 4. Short fields look like two lines in the field editor (cosmetic)

**Where:** field editor, and the fill-in screen with positions unlocked.

**What happens:** a field that is only about 20px tall shows as two horizontal
lines with squares on them, rather than an obvious box. Its drag handles (10px
squares at each corner and the middle of each side) cover most of the short
left and right sides, and since the redesign the box has no fill.

**Why it was left:** the handles are part of resizing and were not touched,
and field outlines stay a thin line with no fill so nothing tints the page.
Looks only; nothing is drawn or saved differently.

## 5. The visible-text check cannot see "Preparing PDF…" or "Saving…"

**Where:** `npm run check:text`.

**What happens:** the Download PDF button reads "Preparing PDF…" for a moment
while the file is made, and the Save buttons read "Saving…" for a moment. Both
are too brief to record reliably, so those two strings are not covered by the
check. They are unchanged in the code.

# Fixed during the redesign

Small behaviour changes made on purpose, each approved, because the redesign's
keyboard rules required them. Only where keyboard focus lands changed.

## Focus returns to the Rename button (home screen)

**Before:** closing the "Rename template" dialog (Escape, Cancel or Save) left
keyboard focus on the page itself, so the next Tab started again from the top.
Measured on the commit before the redesign (8aad0f4): focus was on the page
body after closing.

**Now:** focus goes back to the Rename button that opened the dialog. The
dialog still opens with the cursor in the name box.

**What changed:** the name box no longer asks for focus itself (autoFocus
removed); the dialog places focus when it opens and returns it when it
closes. Nothing about renaming changed.

## Focus returns after "Rename field"; "Name this field" manages its own focus (field editor)

**Before:** both dialogs had the same quirk as "Rename template" above: their
text box asked for focus itself, so closing the dialog left keyboard focus on
the page.

**Now:** closing "Rename field" (Escape, Cancel or Save) returns focus to the
"Rename field" button that opened it. "Name this field" opens when a box has
been drawn with the mouse, so there is no button to return to; it still opens
with the cursor in the name box, Tab stays inside it, and Escape closes it.

**What changed:** autoFocus removed from the two text boxes in
src/components/BoxEditor.tsx. Nothing about naming or renaming a field
changed, and no drag, resize or position code was touched (the safety net's
position recordings are unchanged).

## Company details: checked, no change needed

The "Remove this field?" dialog has no text box, so it never had the quirk.
`npm run check:a11y` confirms it: focus moves into the dialog, Tab stays
inside, Escape closes it, and focus returns to the Remove button that opened
it. No code was changed for this.
