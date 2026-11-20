# OpenSpecControl — Features

Feature list of the app, kept in sync with the `Features` section of the `README`. Each
entry names the user-facing behavior and where the data lives.

## Drafts

Persistent proposal drafts, per repository, so an idea can be written calmly and sent to
OpenSpec when it is ready. Implemented by the `add-proposal-drafts` change.

- **Drafts section in the rail.** Each repository's section gets a collapsible **Drafts**
  area next to _Specs_ and _Archived_: **New draft**, the history ordered by last
  modification, and a search box that matches title and content without distinguishing
  case or accents, including partial words.
- **Draft editor in the middle pane.** Title and Markdown body with an **Edit / Preview**
  toggle (the preview reuses the read-only document renderer), plus creation and
  modification dates. The interface is in English, like the rest of the app.
- **Autosave.** About one second after the last keystroke the draft is saved — the
  indicator shows _Saving… / Saved / Not saved_ — and the pending text is also saved when
  you switch draft, change, repository or view, when a field loses focus, and when the
  window is hidden or closed (best effort). A failed save keeps the text in the editor
  and shows the reason; there is no save button.
- **4000-character send limit.** The editor shows an `n / 4000` counter. Past the limit it
  warns `n / 4000: shorten the draft to send it` and disables **Explore** and **Propose**,
  while editing and saving keep working; the core rejects an over-limit send too.
- **Send as Explore or Propose.** Both buttons send the content to the repository's agent
  with the same native OpenSpec command **New change** uses, connecting the agent if
  needed (`Ctrl/Cmd+Enter` sends as Propose). **Propose** stays disabled while the content
  is empty. Once the agent accepts it, the draft is marked as sent with its mode and date
  and becomes read-only, with only **Duplicate** and **Delete** left.
- **Duplicate and Delete.** **Duplicate** opens a new editable draft with the same content
  titled «… (copy)»; **Delete** asks for confirmation and removes the draft from the
  history and the search.
- **Local persistence.** Drafts are stored in the app's SQLite database
  (`~/.openspeccontrol/openspeccontrol.db`), never in the repository: `git status` stays
  clean, and drafts survive restarts and removing or re-adding a repository folder.
