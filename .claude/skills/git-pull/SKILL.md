---
name: git-pull
description: Pull latest changes from GitHub remote repository
triggers:
  - pull from github
  - sync with remote
  - update from origin
  - fetch latest changes
---

# Git Pull Skill

This skill pulls the latest changes from the GitHub remote repository and handles common scenarios.

## Instructions

When this skill is invoked:

1. **Check current status first**
   ```bash
   git status
   ```
   - If there are uncommitted changes, ask the user whether to:
     - Stash changes before pulling
     - Commit changes before pulling
     - Abort the pull operation

2. **Check current branch**
   ```bash
   git branch --show-current
   ```
   - Confirm which branch we're pulling for

3. **Fetch remote updates**
   ```bash
   git fetch origin
   ```
   - This downloads the latest changes without merging

4. **Check if local is behind remote**
   ```bash
   git status -sb
   ```
   - Look for "behind" indicator to confirm pull is needed

5. **Pull with appropriate strategy**
   
   **Default strategy (rebase):**
   ```bash
   git pull --rebase origin <current-branch>
   ```
   
   **Merge strategy (if rebase conflicts or user prefers):**
   ```bash
   git pull origin <current-branch>
   ```

6. **Handle conflicts if they occur**
   - Show conflicted files: `git status`
   - List conflict markers: `git diff --name-only --diff-filter=U`
   - Ask user how to resolve:
     - Manually resolve conflicts
     - Abort pull: `git rebase --abort` or `git merge --abort`
     - Accept theirs: `git checkout --theirs <file>`
     - Accept ours: `git checkout --ours <file>`

7. **Verify success**
   ```bash
   git status
   git log -1 --oneline
   ```
   - Confirm local is now up-to-date with remote

8. **Restore stashed changes (if step 1 stashed)**
   ```bash
   git stash pop
   ```
   - Handle any conflicts from stash pop if needed

## Safety Checks

- ⚠️ **Never force pull** (`git reset --hard origin/<branch>`) without explicit user confirmation, as this will discard local changes
- ⚠️ Check for unpushed commits before pulling - warn user if they exist
- ⚠️ If pulling from main/master, extra caution with uncommitted work

## Common Scenarios

### Scenario 1: Clean working directory
→ Direct pull with rebase

### Scenario 2: Uncommitted changes
→ Ask: stash, commit, or abort

### Scenario 3: Local commits not pushed
→ Warn about potential conflicts, proceed with pull rebase

### Scenario 4: Merge conflicts
→ Guide user through resolution options

### Scenario 5: Already up-to-date
→ Report "Already up to date" and exit

## Output Format

After successful pull, report:
- Branch name
- Number of commits pulled
- Summary of changes (files changed, insertions, deletions)
- Any new/deleted files
- Whether any conflicts were resolved
