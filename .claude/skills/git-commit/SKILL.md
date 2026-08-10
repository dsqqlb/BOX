---
name: git-commit
description: Stage changes and create a well-formed commit
triggers:
  - commit
  - git commit
  - 提交
  - 提交代码
  - commit changes
---

# Git Commit Skill

This skill stages changes and creates a well-formed commit following the project's conventions.

## Instructions

When this skill is invoked:

1. **Check current status**
   ```bash
   git status
   ```
   - If nothing to commit, report and exit
   - If there are only untracked files, ask which to include

2. **Check current branch**
   ```bash
   git branch --show-current
   ```
   - Show which branch we're committing to
   - Warn if committing directly to `main` — ask for confirmation

3. **Review what will be committed**
   ```bash
   git diff --stat
   git diff --cached --stat
   ```
   - Show staged and unstaged changes separately
   - For large diffs, summarize the scope rather than dumping everything

4. **Stage files**
   - Ask the user which files to stage (default: all modified + new files)
   - Use `git add <files>` for specific files, or `git add -A` for everything
   - **Never** stage files the user didn't ask for

5. **Generate commit message**
   
   Follow the project's commit style — a mix of conventional commits and Chinese descriptions:
   
   | Type | When to use |
   |------|-------------|
   | `feat:` | New feature or functionality |
   | `fix:` | Bug fix |
   | `refactor:` | Code restructuring without feature change |
   | `style:` | CSS / visual changes only |
   | `assets:` | Static assets (images, fonts, etc.) |
   | `chore:` | Build, config, or maintenance tasks |
   | `docs:` | Documentation changes |
   
   Format: `type: 中文描述` (e.g., `feat: 遥控器页面手机端竖屏适配`)
   
   - Describe **what** the change does, in Chinese
   - Keep it concise — one line preferred
   - Present the message to the user for review and editing

6. **Commit**
   ```bash
   git commit -m "<user-approved-message>"
   ```
   - The commit author is **dsqqlb** (the project owner) — this is already configured via `git config`
   - **Never** add `Co-authored-by:` trailers or any AI/Claude attribution
   - **Never** use `--author` to override the author

7. **Verify**
   ```bash
   git log -1 --oneline
   git status
   ```
   - Confirm the commit was created
   - Show remaining uncommitted changes, if any

8. **Optionally push**
   ```bash
   git push origin <current-branch>
   ```
   - Ask the user whether to push after committing
   - Only push if the user confirms

## Safety Checks

- ⚠️ Check for sensitive files (`.env`, credentials, API keys) before staging — warn if found
- ⚠️ Warn if committing directly to `main` — ask for confirmation
- ⚠️ Large binary files (>1MB) — ask for confirmation before staging
- ⚠️ Never amend or force-push without explicit user confirmation

## Common Scenarios

### Scenario 1: Simple commit on feature branch
→ Stage all, generate message, commit, ask about push

### Scenario 2: Partial commit (only some files)
→ Let user pick files, stage only those, generate message, commit

### Scenario 3: Nothing to commit
→ Report "Nothing to commit, working tree clean" and exit

### Scenario 4: Commit on main
→ Warn about committing directly to main, ask for confirmation

### Scenario 5: Amend last commit
→ Only if user explicitly requests — use `git commit --amend` and warn about force-push implications

## Output Format

After successful commit, report:
- Branch name
- Commit hash (short) and message
- Files changed, insertions, deletions
- Whether any changes remain uncommitted
