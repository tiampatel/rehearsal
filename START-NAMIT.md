# Namit — paste the prompt below into Claude Code

Paste after both clones are paired as Tiam/Namit, hooks loaded after restart, setup files committed/pulled,
both worktrees clean, and both dashboards show connected. Tiam pastes START-TIAM.md at the same time.

---

You are Namit's lead for the CampusFix two-laptop Catalyst rehearsal in https://github.com/tiampatel/rehearsal.
Read README.md, BRIEF.md and CLAUDE.md. These instructions authorize ordinary pushes to namit/frontend.
Tiam alone integrates and pushes main. No access changes, force-pushes, destructive Git or changes outside this clone.

Use at most two named subagents concurrently and the same model as the agreed session. Build the frontend
and acceptance checks while Tiam's agents build the backend. Communicate through Catalyst; leads handle Git.
Do not ask people to relay task details or run Git for you. Report real environment/auth blockers rather than
inventing success. Keep your lead turn active with wait_for_updates while waiting for Tiam.

1. Verify this clone's origin is tiampatel/rehearsal, you are participant Namit, Tiam is connected,
   the worktree is clean and Git authentication/push access works. Do not initialize another Catalyst project,
   rename the lead, create competing shared contracts, or repost Tiam's task queue.

2. Wait for SCAFFOLD_READY. Fetch and fast-forward main to Tiam's actual scaffold commit with no editing workers.
   Read the published decisions and API.md/shared contract. Create namit/frontend from that main.
   Ask Tiam through Catalyst: should search cover title only or both title and description, and do combined
   filters use AND or OR? Wait for the actual agreed reply/decision and acknowledge it before completing that behavior.
   Send NAMIT_READY after the shared source/contracts are available locally. Do not fabricate a response.

3. Start two subagents concurrently, initially named layout and client. Each worker:
   - Calls set_agent_name, gets a briefing, and takes an eligible Namit task from the shared queue.
   - Phase 1 is only layout, client and interactions. Do not claim acceptance until the later integration phase.
   - checkpoint_task before edits and at milestones, with blockers, evidence and concrete next steps.
   - Works within exclusive paths, without Git operations or edits to package.json/shared contracts.
   - Runs meaningful targeted checks and completes tasks with actual evidence.
   - Takes another eligible Namit phase-1 task; when unfinished phase work is blocked, uses wait_for_updates.
     Once all three phase-1 tasks are done, returns normally to the lead.
   The UI must be functional and accessible; no static-only result, external assets or external APIs.
   If a root-config change is essential, ask Tiam and wait for the pushed change rather than editing it independently.

4. After local frontend workers have stopped, commit only verified frontend and frontend-unit-test files
   on namit/frontend. Push the branch and send FRONTEND_READY with the actual commit and evidence.
   Do not try to test against backend source you have not fetched. Keep the worktree clean and wait for INTEGRATION_READY.

5. After Tiam sends INTEGRATION_READY, fetch and fast-forward namit/frontend to origin/main, verifying it
   contains the exact announced commit. There must be no editing workers or dirty application files.
   Now start one named acceptance subagent to take the acceptance task from Catalyst.
   It writes test/acceptance.test.js against the real integrated app and a temporary database,
   exercises the required end-to-end HTTP behavior in BRIEF.md, and runs the actual full suite.
   It does not fake tests, use TODOs, suppress errors, change implementation files without ownership,
   or complete a failing task. If it finds a defect, report it with evidence, coordinate an owner through
   Tiam, fetch the fix safely, and rerun. It completes acceptance only with actual passing evidence.

6. Once the acceptance worker has finished, commit/push the acceptance tests on namit/frontend.
   Send ACCEPTANCE_READY with the actual commit and full test output.
   Wait for FINAL_READY. If Tiam reports a real integration issue, coordinate a scoped fix; do not silently alter contracts.

7. After FINAL_READY, with workers stopped and a clean tree, fetch and fast-forward to final origin/main.
   Confirm the exact final hash, rerun the complete npm test suite, and send your actual result/hash to Tiam.
   Run npm run seed twice to verify no duplicate fixtures; start the app locally and report http://localhost:4318
   and its PID. Keep it available for inspection. The two Macs have separate app databases, which is expected.
   Do not claim browser interactions were verified unless actually observed with available browser tools.

Final report: named agents, tasks you completed, the real cross-laptop contract question/reply,
checkpoints, final commit, actual test evidence, app URL and any manual interventions/issues.
Do not stop the lead while there is unfinished work or a required teammate message is pending.
