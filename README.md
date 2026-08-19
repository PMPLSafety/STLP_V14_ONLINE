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
