# On-screen texts waiting for the owner's approval

Branch `cleanup`, Stage 3 (8 November 2026). Once approved, each is added to `tests/approved-strings.json` (and the old ones listed as removed), and this file says nothing is waiting. Until then `npm run check:text` lists exactly these as not approved.

1. **People list, each person** (TODO C12). Was `Person 2`. Now `Person 2: SAMPLETON Alex` (the person's name boxes, in the form's order); still `Person 2` when no name is typed. The delete button's hidden label follows: `Delete Person 2: SAMPLETON Alex`.
2. **"Some characters could not be printed" list** (C12). Was `Person 1, Surname: ń`. Now `Person 1: Wroński Test, Surname: ń`.
3. **Template list, "Last updated"** (C12). Same words; the date is now day first, `Last updated 17/10/2026` (was the browser's order, e.g. `10/17/2026`).
4. **People card, after a download of several people** (C10, D21). New:
   - `Downloaded: 3 people in one PDF.` (`1 person` for one)
   - only when some value is too long: `2 people have a value too long for its box. On the PDF it runs past the edge of the box:` (`1 person has a value...` for one), then a list of those people as in item 1
   - `The People list stays in this browser until you clear it.`
   - buttons `Clear the People list` (opens the existing "Clear all people?" question) and `Keep it`
5. **Field settings, Field type** (D20). New button `ID number`, and the line under the types: `"ID number" gently warns if what's typed doesn't look like a Mauritian ID number. It prints exactly as typed.`
6. **Under an ID number field, when the value does not fit** (D20). New: `This doesn't look like a Mauritian ID number (a letter, then 13 letters or digits). A passport number is fine.`
