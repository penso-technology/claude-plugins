---
name: release
description: Cut a marketplace release with plain git in the git-flow shape this repo uses (release branch off develop, --no-ff merge to main in a temporary worktree, bare annotated tag), after checking every changed plugin bumped its version. Stops before any push.
disable-model-invocation: true
---

Release version `$ARGUMENTS` (bare semver such as `0.3.0`; ask when missing or malformed).
The git-flow CLI is not installed; every step is plain git. Nothing here pushes. The merge into
`main` happens in a temporary worktree, so the checkout other sessions may have open never
switches branch.

## Preconditions (stop with the reason on any failure)

1. Working tree clean, current branch `develop`.
2. `git fetch origin`; neither branch behind its remote: `git rev-list --count develop..origin/develop`
   and `git rev-list --count main..origin/main` both print 0.
3. No tag `<v>` (`git tag -l <v>` is empty) and no leftover `release/*` branch
   (`git branch --list 'release/*'` is empty): a leftover means an earlier run was interrupted;
   finish or delete it by hand first.
4. Version-bump check. With `LAST=$(git describe --tags --abbrev=0 main)`:
   - `git diff --name-only $LAST...develop -- plugins/` gives the changed plugin folders (three
     dots: only what `develop` added since the release, not what `main` has and `develop` lacks).
   - For each `<id>`: if `git cat-file -e $LAST:plugins/<id>/.claude-plugin/plugin.json` fails,
     the plugin is new and passes at `0.1.0`; otherwise compare
     `git show $LAST:plugins/<id>/.claude-plugin/plugin.json | jq -r .version` with
     `jq -r .version plugins/<id>/.claude-plugin/plugin.json`.
   - Any changed plugin with an unchanged version blocks the release: list them and stop.
     Bumping belongs in the change itself (CLAUDE.md, Invariants), not here.
5. Run the verification gate (CLAUDE.md) on `develop` for each changed plugin and report the
   results; a failure stops the release.

## Cut it

```sh
git branch release/<v> develop
git worktree add "${TMPDIR:-/tmp}/claude-plugins-release-<v>" main
git -C "${TMPDIR:-/tmp}/claude-plugins-release-<v>" merge --no-ff release/<v> -m "Merge branch 'release/<v>'"
git tag -a <v> -m "<v>: <the changed plugin ids, as prose>" main
git worktree remove "${TMPDIR:-/tmp}/claude-plugins-release-<v>"
git merge --no-ff release/<v> -m "Merge branch 'release/<v>' into develop"
git branch -d release/<v>
```

The tag message follows the existing ones (`0.1.0: context-bar and model-limits`,
`0.2.0: agent-model-label`). The back-merge into `develop` normally answers "Already up to date"
and creates no commit: the release branch carries no commits of its own, since plugin versions are
bumped with the change and the marketplace has no version file. That is why `main` is not an
ancestor of `develop` in this repo's history; it is expected, not a half-finished release.

## Then stop

Report the merge commit on `main`, the tag, and the plugins it ships. End with:
"ready for your manual test: say the word and I'll push `main`, `develop` and the tag."
Installers get the release only after `main` is pushed, since the marketplace clone tracks `main`.
