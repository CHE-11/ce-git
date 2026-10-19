# One folder, a lot of repos

GitHub Desktop is a fine client when you live in one repository. It gets awkward when your work is a single directory that contains dozens of them. Some of those folders are repos. Some are just folders. A few of the repos contain other repos. The useful picture is a tree, and the useful action is updating all of them without opening each one.

ce-git is a small desktop app for that folder.

## The tree

You pick a root directory. ce-git walks it and lists every git repository it finds, including repositories nested inside other repositories. Plain folders stay in the tree only when they contain a repo, so the view is the shape of the folder you already have, with the noise left out.

Each repo shows its branch, whether the working tree is dirty, and how many commits it is ahead of or behind its upstream. Select one to see the changed files and the diff. Shift-click and Ctrl-click select several when the next action should apply to a group.

Directories that are not source, such as `node_modules`, `target`, and `dist`, are skipped. The scan still continues through a repository's other children, which is how nested repos show up instead of disappearing under their parent.

## Pull the default branch everywhere

The action I wanted most was one pull for the whole tree. **Pull all** fast-forwards each repo's default branch from `origin`. That branch is whatever `origin/HEAD` points at, then `main`, then `master`.

A dirty working tree is skipped. Local edits stay where they are. If you are checked out on a feature branch, ce-git still fast-forwards local `main` or `master` and leaves you on the branch you were on. If you are already on the default branch and the tree is clean, it pulls with `--ff-only`. A history that is not a fast-forward is reported and left alone. One repo failing does not stop the rest. The activity log lists what updated, what was skipped, and what failed.

**Pull selected** does the same thing for the repos you have checked.

## Push what is ahead

**Push all** asks first, then pushes every repo that is ahead of its upstream. Repos with nothing to push are skipped. A repo without an upstream is pushed with `git push -u origin HEAD`. **Push selected** is the same operation on the current selection.

ce-git shells out to the `git` already on your PATH. Push and pull use your SSH keys and Git Credential Manager. It does not keep a second copy of your credentials.

## Commit with a message you can edit

Open a repo, review the diff, and commit from the box at the bottom. **Generate with AI** reads the diff and drafts a conventional commit message. Nothing is committed until you press Commit.

Select several dirty repos and **AI commit** drafts a message for each one in a review list. You can edit any line, uncheck a repo, and then commit the ones you keep.

Open **AI settings** to save an OpenAI key, pick a model, and choose how much the model thinks. After the key is saved, ce-git loads the 10 newest text and multimodal models from your OpenAI account. Each model shows a price tier from `$` to `$$$$`. Thinking can be none, minimal, low, medium, high, extra high, or max. The key is stored in the operating system's credential manager and is not shown again. Model and thinking preferences stay in the app's local settings. An `OPENAI_API_KEY` environment variable is used only when no key is saved.

## Run it

From the project folder:

```powershell
pnpm install
pnpm tauri dev
```

**Install**, **Run**, and **Build** are also VS Code tasks. Build produces the desktop app with `pnpm tauri build`.

Choose the folder once. ce-git remembers it the next time you open the window.
