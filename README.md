# STLP V7 — Training + Assessment

This version continues the existing STLP Supabase project. **Do not rerun the original database setup.**

## Existing setup
1. Keep the existing Supabase project/config.js.
2. Keep the already-deployed Edge Function `admin-create-user`.
3. Keep the existing training-material storage bucket/policies.
4. Training material upload remains supported for PPT/PPTX, PDF, images and video.

## NEW: Assessment module
Run `assessment_setup.sql` **once** in the Supabase SQL Editor.

It adds:
- Admin assessment management for each training.
- MCQ questions with 4 options.
- Correct-answer selection.
- Passing marks from the training setting (default 90%).
- Allowed-attempt control.
- User assessment attempt and automatic score.
- Pass/Fail result.
- Training progress is marked completed after a pass.
- Admin Assessment Results page.
- Admin **Allow Retry** button for a failed attempt.

## Test flow
1. Admin > Training > Edit the training.
2. Set **Assessment Required = Yes**.
3. Set Passing Marks = 90 and Allowed Attempts as required.
4. Save.
5. Admin > Training > **Assessment**.
6. Add MCQ questions.
7. Publish the training.
8. Login as a user and open the training.
9. Open **Start Assessment**, answer all questions and submit.
10. Check **Assessments** for the result.

## Still to be built after Assessment
The current project also contains placeholder pages for:
- Certificates
- Notifications
- Detailed Progress
- Reports
- Training assignment/targeted user allocation

These should be implemented as the next modules rather than pretending they already exist.


## V8 fixes
- Admin Training page now has an Assessment button.
- User Training opens PDF/images/video inside the portal; PPT/PPTX uses Office web viewer; YouTube uses embedded player.
- Assessment retry field is queried correctly.
- Training completion no longer writes a non-existent updated_at column.


## V9 Assessment Result + Certificate
User can take assessment, receive score/pass-fail, complete training on pass, view certificate, and print/save certificate as PDF. Admin can allow retry from Assessment Results.

## V10 — Upload progress, department targeting, notification timestamps, feedback export, SOP folders
Run these two **new, additive-only** SQL files once in the Supabase SQL Editor (in any order). They do not touch or rerun any earlier setup:
- `department_assignment.sql`
- `sop_enhancements.sql`

What's new:
- **Training & SOP uploads** now show a blurred overlay with a real (not simulated) percentage ring while the file uploads, so admins/users can't accidentally double-submit.
- **Department-wise training assignment**: when adding/editing a training, admin can pick "All Departments" (default, same as before) or tick specific departments. Users only see trainings targeted at their department (or at "All").
- **Notifications** now show the publish date & time on every notification card (previously not shown at all).
- **Feedback page** has a "Download CSV" button that exports exactly what's currently filtered/visible on screen.
- **SOP module**: admin can create folders on demand ("+ New Folder"), move any SOP into a folder, hide/unhide a SOP from users without deleting it, and permanently delete a SOP (file + record). Every SOP card (for admin and users) now shows the uploader's name and the full upload date & time. The user upload flow itself is unchanged — users still just pick a title, description, and file; folder assignment is admin-only, done afterward.

## V11 — HR-wide Training Portal (Pre-Test, Trainers, Login-as-User, Security Logs, Library)
This update expands the portal from a Safety-only tool into a company/HR-wide training portal. Run these **new, additive-only** SQL files once in the Supabase SQL Editor (in any order):
- `pretest_module.sql`
- `trainers_and_security.sql`

You also need to **deploy one new Edge Function** (see `supabase-functions/admin-impersonate-user/index.ts`) — same way the existing `admin-create-user` function was deployed:
```
supabase functions deploy admin-impersonate-user
```
No new secrets are needed — it uses the same `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` that Supabase Edge Functions already have available by default.

What's new:
1. **Pre-Test + Post Assessment**: Admin can add a separate set of Pre-Test questions per training (Assessment → "A. Pre-Test" tab). If a training has Pre-Test questions, a user must answer them once before the training material opens (no pass/fail — just recorded); the material then opens automatically. The existing MCQ assessment (pass/fail, retry, certificate) is unchanged and is now labelled "Post Assessment" ("B. Post Assessment" tab) — it is a completely separate table from the Pre-Test, so nothing about its grading, certificates, or retry logic was touched.
2. **Admin "Login as User"**: On Users Management, each row has a "🔓 Login as User" button. Admin is switched into that user's real session (via a one-time server-minted token — the user's password is never seen or needed) and can complete tasks/assessments on their behalf. A banner at the top ("Viewing as X — Return to Admin") lets Admin switch back to their own account instantly, without re-entering a password. Every login-as-user event is recorded in Security Logs.
3. **Trainers menu** (Admin only): a certified-trainer directory. Every trainer must already be an existing user account — Admin adds a trainer by selecting from existing users and filling Experience, Contact Number, and uploading certificate file(s); "Remove Trainer" only removes the trainer record, never the underlying user login.
4. **History → Audit Logs + Security Logs**: the sidebar "History" item now expands into two pages:
   - **Audit Logs** — exactly what "History" showed before (assessments, training changes, user accounts), just relabelled.
   - **Security Logs** (new) — Login Success, Login Failed (tracks the name/employee-id that was typed, not IP — this app has no server to capture IP), Logout, and Admin Login-as-User events, each with full date & time. Both pages have filters and a CSV download.
5. **SOP's renamed to Library** — same module, storage bucket, and data as before; only the menu label and page heading changed.

