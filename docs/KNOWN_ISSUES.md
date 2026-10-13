# Known issues

Things noticed during the visual redesign that are about behaviour, not looks.
The redesign changed none of the items under "Not fixed". The few small
changes it did make on purpose are under "Fixed during the redesign". All
evidence uses fake data.

# Not fixed

## 1. (Fixed) A person being typed in is lost by clicking another person, or by "Clear all"

Fixed after the audit; see "Fixed after the audit" at the end of this file.
The number is kept so the items below keep theirs.

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

## 6. (Fixed) Something typed in the last moment before leaving the fill-in screen was not saved

Fixed after the audit; see "Fixed after the audit" at the end of this file.
The number is kept so later items keep theirs.

## 7. A rename dialog reads 'Choose a new name for "".' while it fades out (cosmetic)

**Priority: to be decided.** Found while extending the visible-text check;
not part of that task, so not fixed.

**Where:** "Rename template" on the home screen and "Rename field" in the
field editor.

**What happens:** the dialog's first line is 'Choose a new name for
"Fake Form".' When the dialog closes (Save, Cancel or Escape), the name is
forgotten at once but the dialog takes a moment to fade out, so for that
moment the line reads 'Choose a new name for "".'

**Evidence** (fake data): with the rename dialog closed by Save,
`npm run check:text` recorded `Choose a new name for "".` on the screen
behind the "This was NOT saved" warning. The walkthrough now waits for the
rename dialog to be gone before recording that screen.

**Where in the code:** src/components/TemplateList.tsx and
src/components/BoxEditor.tsx read the name from the same state that closes
the dialog.

## 8. (Fixed) The People list could miss the last key when the page was reloaded in the same instant

Fixed on 13 October 2026, the day it was found. On leaving the screen or closing the page, the People list is now brought level with the form before it is stored (`bringPeopleListLevel` in src/components/FieldForm.tsx). The audit test below then passed in every run. The second test named below was a matter of the test itself: its click is now made in the page with no wait. What follows is the record of the problem.

**Where:** the fill-in screen, with a person from the People list in the form.

**What happens:** a value typed for a listed person reaches the form at once
and the People list a moment later (a second pass of the screen, a few
thousandths of a second after the key). If the page is closed or reloaded
inside that moment, the value is stored for the form but the listed person is
stored without it. Nothing warns. A person cannot press reload that fast; a
test can.

**Evidence (13 October 2026, fake data):** the audit test "what is typed in
the last moment before leaving the fill-in screen is saved: Back to templates,
Edit fields and a reload" types a TAN for Person 2 and reloads at once. Its
last check ("and in the listed person it was typed for") found the TAN missing
in 6 of 11 runs of that test alone on the code as committed before that day's
work, and in 7 of 11 with that work in place, so the work did not cause it.
The whole audit (28 tests) passed in 2 of 2 runs on the earlier code; with the
work in place it failed twice, on this test and the one below, and passed the
third time. On 12 October it passed; the machine was busier on the 13th. The
form's own value ("the TAN typed just before the reload") was stored every
time.

**Also seen that day, in those same two runs:** "when storage is full, what is
typed just before "Back to templates" is not dropped unseen" failed because
the "NOT saved" warning opened before the test's click, which the warning then
covered. The 0.4 second wait before a save had already run out. It passed
when run again.

**Fix as suggested then:** when the screen is left or the page is closed, put the
form's values into the listed person before the People list is stored, the
way "Add & fill next person" and choosing another person already do. In
src/components/FieldForm.tsx (`saveWhatIsWaiting`).

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

# Fixed after the audit

Each has a test in `tests/audit.test.mjs` (`npm run test:audit`) that fails
without the fix. All evidence uses fake data.

## A person being typed in was lost by clicking another person, or by "Clear all" (was item 1, HIGH)

Re-tested before fixing, with the steps recorded under item 1: both routes
still lost the typed person.

**1a. Clicking another person.** A person typed into the form but not added
yet is now added to the People list first, then the clicked person is shown.
Nothing is asked. A form that holds only the company details, or nothing, is
not a person and adds nobody.

| Step | People listed | Surname box |
| --- | --- | --- |
| "SAMPLETON" typed, not added | 1 | SAMPLETON |
| "Person 1" clicked | 2 | TESTER |
| "Person 2" clicked | 2 | SAMPLETON |

**1b. "Clear all".** The confirmation is unchanged ("This will remove
everyone added to this batch (1 person)."), and that is now all it does: the
person still being typed stays in the form. When the form shows one of the
listed people, it is emptied with them, as before.

## After leaving a template and coming back, the download had an extra page (HIGH)

The form's last values were saved without saying whose they were, so on
coming back the last person was taken for someone new: 3 people gave 4 pages,
the last person twice. The form's saved values are now compared with the
listed people; when they are exactly one person's, that person is selected
again. Values that match nobody are still a new person, and are still in the
download.

## One character the fonts cannot print stopped the whole download (HIGH)

The three built-in fonts only have Western European characters. A value with
any other character (for example the first letter of a Polish first name)
used to end the download for everyone with "Something went wrong creating
your PDF." Now each such character is replaced with "?" in its own field (a
line break or tab with a space), the download finishes, and a dialog lists
the people and fields concerned. What is typed and stored is not changed.

Still true: those characters cannot be printed. Printing them needs a font
with wider coverage, which the project rules leave for later.

## With the browser's storage full, imported people looked saved and were lost on reload (CRITICAL)

Every save now reports whether the browser accepted it. On the fill-in
screen a refused save opens a warning that has to be answered ("This was NOT
saved"), and a notice stays on the screen, with "Not saved" beside the People
heading, until a save works. The people stay on screen so the PDF can still
be downloaded; "Try saving again" saves them once there is room. The field
editor, company details and renaming a template show the same warning instead
of failing silently.

Not changed: the PDFs themselves are still kept in this storage, which is
what fills it (see the audit report, risk R2).

## Something typed in the last moment before leaving the fill-in screen was not saved (was item 6)

Typed values and the People list are stored about 0.4 seconds after the last
change. Pressing "Back to templates" or "Edit fields", or closing or
reloading the page, inside that time used to cancel the save that was
waiting, so the last change was dropped and nothing warned.

Evidence before the fix (fake data, a template with one field called "ID"):

| Typed | Wait before "Back to templates" | Stored for the field |
| --- | --- | --- |
| TST001 | none | nothing |
| TST001 | 1 second | TST001 |

**Now:** whatever is still waiting is stored first, on "Back to templates",
"Edit fields" (and "Add fields"), and when the page is closed or reloaded.

When the browser refuses that save (its storage is full) and the screen was
not already marked "NOT saved":

- "Back to templates" and "Edit fields" stay on the screen and open the same
  "This was NOT saved" warning, so the PDF can still be downloaded. Pressed
  again after the warning, they leave as before.
- On closing or reloading the page, the browser asks its own "leave this
  page?" question, and the warning is there if the answer is to stay. The
  wording of that question is the browser's, not this tool's.

**Tests:** three in `tests/audit.test.mjs`, under "leaving the fill-in
screen". All three fail without the fix.

**What changed:** src/components/FieldForm.tsx only. No wording was added.
