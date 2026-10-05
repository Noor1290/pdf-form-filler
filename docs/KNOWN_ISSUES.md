# Known issues

Things noticed during the visual redesign that are about behaviour, not looks.
Apart from the short list under "Fixed during the redesign" at the end, none
of them were changed by the redesign. Each needs a decision before it is
fixed. All evidence below uses fake data.

## 1. Moving a field opens its settings

**Where:** field editor, and the fill-in screen with positions unlocked.

**What happens:** drag a field to move it and let go. The "Field settings"
dialog for that field opens, although nothing was clicked on purpose. It has to
be closed with Done before carrying on.

**Evidence:** the safety-net test records it. In
`tests/expected/templates-and-field-editor.json`, `settingsOpenAfterDragging`
is `1` after dragging the "Basic Salary" field by 40 by 30 pixels. The move
itself is saved correctly (x 74.38 to 104.12, y 163.63 to 185.94 points).

**Likely cause:** the field reacts to the click that ends the drag the same way
it reacts to a plain click.

## 2. A person being typed in is lost by clicking another person, or by "Clear all"

**Priority: HIGH**, both routes (2a and 2b below). They silently lose data
someone has just typed. To be fixed on their own branch after the redesign.

### 2a. Clicking another person

**Where:** fill-in screen, People list.

**What happens:** add a first person, start typing a second one, then click
"Person 1" in the list before pressing "Add & fill next person". The second
person's typed values disappear. There is no warning and no way to get them
back.

**Evidence** (fake data, template "Fake Form"):

| Step | People listed | Surname box |
| --- | --- | --- |
| Type "Testperson", press "Add & fill next person", type "Sampleton" | 1 | Sampleton |
| Click "Person 1" | 1 | Testperson |

After the click, "Sampleton" is nowhere on the screen or in any box, and no
dialog asked first.

**How to reproduce, step by step** (any template with at least one field; the
table above used a field called "Surname"):

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

### 2b. Pressing "Clear all" (also HIGH)

Follow steps 1 to 4 above, then press "Clear all" and confirm.

Expected: the confirmation says that the person being typed will be thrown
away too, or keeps them.

Actual: the confirmation only counts the people in the list ("This will
remove everyone added to this batch (1 person)."), and confirming also empties
the form. Reproduced with the same fake data: afterwards 0 people are listed
and the Surname box is empty.

**Where in the code:** the function handleSelectEntry in
src/components/FieldForm.tsx. When no listed person is selected (the form
holds a new, unadded person) it replaces the form's values without saving
them anywhere.

**Not affected:** clicking Download PDF with a second person typed but not yet
added does include them (the safety-net test covers this:
`secondPersonTypedButNotAddedDownload` produces 2 pages).

## 3. The visible-text check cannot see "Preparing PDF…"

**Where:** `npm run check:text`.

**What happens:** the Download PDF button reads "Preparing PDF…" for a moment
while the file is made. It is too brief to record reliably, so that one string
is not covered by the check. It is unchanged in the code.

## 4. Fields on the page cannot be reached with the keyboard

**Where:** fill-in screen and field editor.

**What happens:** a field's settings open by clicking its outline on the PDF
page, and a field is moved or resized by dragging. Neither can be done with the
Tab key: the outlines are not focusable. Everything else on the fill-in screen
(typing values, people, import, download, every dialog) works from the keyboard.

**Evidence:** `npm run check:a11y` reaches 91 Tab stops on the fill-in screen
and its dialogs; none of them is a field outline.

**Why it was left:** making the outlines focusable and giving them key
handling is new behaviour, not styling.

## 5. Short fields look like two lines in the field editor (cosmetic)

**Where:** field editor, and the fill-in screen with positions unlocked.

**What happens:** a field that is only about 20px tall shows as two horizontal
lines with squares on them, rather than an obvious box. Its drag handles (10px
squares at each corner and the middle of each side) cover most of the short
left and right sides, and since the redesign the box has no fill.

**Why it was left:** the handles are part of resizing and were not touched,
and field outlines stay a thin line with no fill so nothing tints the page.
Looks only; nothing is drawn or saved differently.

## Fixed during the redesign

Small behaviour changes made on purpose, each approved, because the redesign's
keyboard rules required them.

### Focus returns to the Rename button (home screen)

**Before:** closing the "Rename template" dialog (Escape, Cancel or Save) left
keyboard focus on the page itself, so the next Tab started again from the top.
Measured on the commit before the redesign (8aad0f4): focus was on the page
body after closing.

**Now:** focus goes back to the Rename button that opened the dialog. The
dialog still opens with the cursor in the name box.

**What changed:** the name box no longer asks for focus itself (autoFocus
removed); the dialog places focus when it opens and returns it when it
closes. Only where focus lands changed, nothing about renaming.

### Focus returns after "Rename field"; "Name this field" manages its own focus (field editor)

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
