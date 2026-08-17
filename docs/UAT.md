# User acceptance testing

DOC-01, whose acceptance criterion is "an institution can complete UAT without a
developer in the room". So: no curl, no database, no logs. Everything below is
done in a browser by somebody holding the role named.

Each script states **who**, **what to do**, and **what you should see**. If what
you see differs, that is a defect — write down the script number and the step.

Sign in at `/onyx/login`. The demo institution's accounts are
`<role>@demo.onyx` with the password you were given.

---

## 1 · Learning (LRN)

### 1.1 A learner finds their work — *student*
1. Sign in.
2. **You should see** a dashboard naming one thing to do next, not a wall of counters.
3. Open **Courses**.
4. **You should see** your own courses as cards with a progress bar and a Resume button, and a catalogue below.
5. Press **Resume**.
6. **You should see** the course page open on the next unfinished lesson, named on the button before you pressed it.

### 1.2 Content resumes where you left it — *student*
1. Open a video lesson and let it play for ten seconds. Leave the page.
2. Come back to the same lesson.
3. **You should see** it resume where you were, and a note saying so.

### 1.3 Attendance by code — *faculty*, then *student*
1. *Faculty*: on a course, open a session and show the check-in code.
2. *Student*: on the same session, type the code.
3. **You should see** yourself marked present.
4. *Student*: try the same code again.
5. **You should see** a refusal saying you are already marked.
6. *Faculty*: wait 30 seconds, then have the learner try the old code.
7. **You should see** it refused.

### 1.4 Attendance percentages — *faculty*
1. On a course, open **Attendance**.
2. **You should see** per-learner percentages worst-first, a cohort figure, and anybody under the threshold flagged.
3. Change the threshold and apply it.
4. **You should see** the flags change and the URL keep your choice.
5. Press **Export CSV**.
6. **You should see** a spreadsheet with one row per learner per session.

### 1.5 Assignments, marking and release — *faculty*, then *student*
1. *Faculty*: create an assignment with a due date, marks and a rubric.
2. *Student*: open it. **You should see** the due date, what it is worth, and what happens if you are late, as labels at the top.
3. *Student*: type an answer, then close the tab without submitting.
4. *Student*: reopen it. **You should see** your draft still there.
5. *Student*: submit.
6. *Faculty*: mark it against the rubric.
7. *Student*: **you should see** no score yet.
8. *Faculty*: press **Return all marked papers**.
9. *Student*: **you should now see** the score and the feedback.

### 1.6 Asking for help — *student*, then *faculty*
1. *Student*: ask a question on a course.
2. *Student*: escalate it.
3. *Faculty*: open **Mentor queue**. **You should see** it unowned, with a deadline.
4. *Faculty*: assign it to somebody else.
5. *That person*: **you should see** it in your **Inbox**.

---

## 2 · Code Lab (LAB)

> Needs a sandbox. If Code Lab reports it is not configured, stop and tell
> whoever runs the platform — the rest of this section will not work.

### 2.1 Solving a problem — *student*
1. **Practice** → pick a problem.
2. **You should see** an editor, a language picker, a run button and a console.
3. Run something wrong. **You should see** which visible cases failed, and nothing about the hidden ones.
4. Submit a correct solution. **You should see** a score and per-case results.

### 2.2 The answer key stays hidden — *student*
1. On a problem page, open your browser's view-source or developer tools.
2. **You should see** no hidden test input, no expected output, anywhere.

### 2.3 Projects — *student*
1. **Workspaces** → start one → add two files.
2. Take a snapshot. Change a file. Restore the snapshot.
3. **You should see** the exact file tree you captured.

---

## 3 · Assessment (ASS)

### 3.1 Sitting a paper — *exams*, then *student*
1. *Exams*: build a question bank, then set a paper drawing from it. Turn monitoring on.
2. *Student*: open it. **You should see** what is recorded and a consent tick you must give before starting.
3. *Student*: start, answer a question, then close the tab.
4. *Student*: reopen. **You should see** your answers intact and the timer where it should be — not reset.
5. *Student*: change your computer's clock forward and reload.
6. **You should see** the timer unchanged. The clock is the server's.

### 3.2 Camera and screen — *exams*, then *student*
1. *Exams*: set a paper requiring a camera.
2. *Student*: open it. **You should see** a check-my-camera step, and Start disabled until it passes.
3. *Student*: refuse the camera. **You should see** you cannot start.
4. *Student*: allow it and start. **You should see** yourself in a small self-view, and a line saying no video is recorded.

### 3.3 Marking, moderation and release — *exams*
1. Mark the paper with anonymous marking on. **You should see** no candidate names.
2. Moderate a mark.
3. Before publishing, sign in as the candidate. **You should see** no result.
4. Publish. **You should now see** it.
5. *Exams*: open the results screen. **You should see** cohort statistics and per-item difficulty.
6. Press **Export CSV**, then **Export PDF**. **You should see** two files: one for a spreadsheet, one you can print.

---

## 4 · Career (CAR)

### 4.1 A credential — *exams or placement*, then *student*, then *anybody*
1. *Staff*: **Certificates** → issue one to a learner.
2. *Student*: **Your profile**. **You should see** it, with a Download button.
3. Download it. **You should see** a printable certificate naming the holder and carrying a credential id and a verification address.
4. *Anybody, signed out, on any device*: open the verification address.
5. **You should see** the holder's name, what it is for, who issued it, and that it is valid — and nothing else about the person.
6. *Staff*: revoke it with a reason.
7. *Anybody*: reload the verification page. **You should see** it reported as revoked — not as missing.

### 4.2 Placement — *placement*, then *student*, then *employer*
1. *Placement*: add an employer and link a contact's account.
2. *That contact*: **you should see** an inbox notification saying you have employer access.
3. *Placement*: post a role with an eligibility rule.
4. *Student*, ineligible: **you should see** why you cannot apply, rule by rule.
5. *Student*, eligible: apply.
6. *Employer*: **you should see** the candidate in your own pipeline — and nothing else belonging to the institution.

---

## 5 · Campus (CMP)

### 5.1 A term — *admin*
1. **Programmes** → create a programme, a semester and a batch.
2. **Courses** → create a course in that programme.
3. **Teaching load** → allocate it to a lecturer with hours.
4. **You should see** their load change on the same screen.

### 5.2 Timetable clashes — *admin*
1. **Timetable** → add a room → schedule a class.
2. Schedule a second class in the same room at the same time.
3. **You should see** the clash named *before* you submit.
4. Submit anyway. **You should see** it refused, naming what it collided with.
5. Publish the semester. *Student*: **you should now see** it.

### 5.3 Exams and seating — *exams*
1. Schedule an exam, add a hall, allocate seating.
2. **You should see** every candidate with exactly one seat.
3. Print the seating and attendance sheet. **You should see** a PDF with a column to sign.
4. *Student*: **you should see** your own seat and nobody else's.

### 5.4 Transcripts — *exams*
1. **Results** → issue a transcript for a learner.
2. In **Check a transcript**, enter its serial.
3. **You should see** two separate answers: the seal is intact, and it matches the register.
4. Change one of that learner's published marks and check the serial again.
5. **You should see** the seal still intact but the register moved on, and advice to reissue rather than edit.

### 5.5 Fees and paying — *admin*, then *student*
1. *Admin*: **Finance** → fee head → structure → publish → raise an invoice.
2. *Admin*: configure a gateway in test mode.
3. *Student*: **Fees**. **You should see** what you owe and a **Pay** button.
4. Pay it in the gateway's test mode.
5. **You should see** yourself returned to Fees, and the invoice settled once the bank confirms.
6. *Admin*: **You should see** exactly one payment against that invoice, not two.

### 5.6 A guardian — *admin*, then *student*, then *guardian*
1. *Admin*: **People** → link a guardian to a learner.
2. *Student*: **you should see** a notification that somebody asked to be linked.
3. *Guardian*: **you should see** nothing yet.
4. *Student*: accept, and switch on attendance only.
5. *Guardian*: **you should see** attendance, and neither results nor fees.
6. *Student*: switch it off. *Guardian*: reload. **You should see** it gone.

---

## 6 · Everyone's boundaries

Try each of these as the role named. **Every one should be refused.**

| As | Try to open |
| --- | --- |
| Student | `/onyx/finance` |
| Student | `/onyx/audit` |
| Student | `/onyx/people` |
| Faculty | `/onyx/finance` |
| Employer | `/onyx/people` |
| Guardian | `/onyx/courses` |
| Anybody from institution A | anything belonging to institution B |

---

## Signing off

UAT passes when every script above does what it says. Record, per script: the
date, who ran it, pass or fail, and for any failure exactly what you saw
instead.
