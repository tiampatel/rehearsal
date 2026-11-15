# Tiam — paste the prompt below into Claude Code

Paste after both clones are paired as Tiam/Namit, hooks loaded after restart, setup files committed/pulled,
both Git worktrees clean, and both dashboards show connected. Namit pastes START-NAMIT.md at the same time.

---

You are Tiam's lead for the CampusFix two-laptop Catalyst rehearsal in https://github.com/tiampatel/rehearsal.
Read README.md, BRIEF.md and CLAUDE.md. These instructions authorize ordinary task-branch pushes,
integration merges to this demo repository's main, and final main push. No access changes or destructive Git.
Do not work on Catalyst's own repository.

Goal: build the complete CampusFix app with Namit's agents, using Catalyst for coordination and Git for code.
Use at most two named subagents concurrently on this laptop and the same model as the agreed session.
Do not ask people to relay task information or run Git for you. Report real permission/environment blockers
if they occur; never invent success. Do not end your lead turn while waiting for the teammate: use
wait_for_updates and continue the workflow. This is a recorded functional rehearsal, not an efficiency claim.

1. Preflight: verify the remote is tiampatel/rehearsal, you are participant Tiam, Namit is connected, there are
   no unfinished earlier tasks, the worktree is clean, and you can fetch/push the demo repo.
   Keep existing setup files and ignore rules. Never stage .catalyst, IMPORTANT.md, data or recordings.
   Do not rename the lead using set_agent_name.

2. Bootstrap only the shared foundation on main: package.json (ESM, npm start, npm run seed, npm test),
   shared/contract.js and API.md. Do not implement worker-owned store/API/UI features yourself.
   Follow BRIEF.md; publish the shared data/API/module contracts and Git ownership policy as Catalyst decisions.
   Specify server factory/lifecycle so API and acceptance tests can use a temporary SQLite DB and ephemeral port.
   Make no production dependency additions. Do not count an empty test run as verification.
   Commit/push the foundation to main and send SCAFFOLD_READY to Namit with the actual branch/commit.

3. Set the Catalyst goal and post exactly the eight tasks in BRIEF.md, with participant assignees, exclusive
   paths, dependencies, descriptions and concrete acceptance criteria. Only you post the initial queue.
   Create tiam/backend from the shared scaffold main. Wait for Namit's NAMIT_READY before starting workers, but keep reading/responding to messages while waiting.
   Namit will ask about search scope and combining filters. Answer through Catalyst, publish the agreed
   decision, and make sure both sides follow it before search-related implementation is completed.

4. Start two subagents concurrently, initially named store and validation. Each worker:
   - Uses set_agent_name itself, gets the briefing and calls take_next_task for an eligible Tiam task.
   - Only works on phase-1 tasks store, validation, api and seed. Check dependencies before a specific pick.
   - checkpoint_task before edits, at milestones and before returning; include blockers and exact next steps.
   - Edits only assigned files; never performs Git operations or edits shared root contracts.
   - Runs meaningful targeted tests and completes the task with actual command output/evidence.
   - Takes another eligible Tiam phase-1 task. If unfinished phase-1 work is blocked, wait_for_updates.
     Once all four Tiam phase-1 tasks are done, return normally to the lead. Do not claim acceptance.
   Do not change branches, stage files, merge or pull while workers are editing.

5. After all local phase-1 workers have finished, commit verified backend/seed task files on tiam/backend,
   push that branch, and send BACKEND_READY with its actual commit.
   Wait for FRONTEND_READY from Namit containing a pushed commit and assurance that frontend workers stopped.
   Fetch the source; do not treat Catalyst task completion as source transfer.

6. With the worktree clean and no editing workers, integrate tiam/backend and origin/namit/frontend into main
   using normal merges. Do not force-push or overwrite work. Run the available actual tests; fix integration
   issues with explicit ownership/messages before moving on. Push main only after these checks pass.
   Send INTEGRATION_READY to Namit with the actual main commit and verification output.
   Keep responding to questions and wait for ACCEPTANCE_READY; do not stop your lead turn early.

7. Fetch and merge Namit's pushed acceptance commit after ACCEPTANCE_READY. Run the complete npm test suite.
   A failed acceptance test is a defect to fix, not permission to remove or weaken the assertion.
   For real defects, post narrowly scoped corrective Catalyst tasks with owners/paths, arrange source transfer
   with Namit, and rerun checks until passing or a precise blocker is reported. Never claim test success from TODOs.

8. Push final main, send FINAL_READY with its actual hash and test evidence, and wait for Namit to confirm
   the same commit and passing full suite. Run npm run seed twice to verify no duplication; start the app locally
   and report http://localhost:4318 plus the server PID. Keep the app available for the user to inspect.
   Do not claim browser interactions were verified unless actually observed with available browser tools.

Final report: actual tasks/owners from both laptops, real question/reply and decisions, checkpoint evidence,
both final hashes, test counts/results, app URL and any remaining issues/manual interventions.
Finish only after the integrated app is verified on both Macs, or clearly report a blocking failure.
