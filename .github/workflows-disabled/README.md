# CI workflows (disabled in this push)

  The Replit GitHub OAuth app that pushed this repo does not have the `workflow` scope,
  so files inside `.github/workflows/` could not be pushed.

  To enable CI:

  1. Rename this directory back to `.github/workflows/`.
  2. Strip the `.txt` suffix from each workflow file.
  3. Commit and push from a token/credential that has the `workflow` scope.

  ```bash
  mv .github/workflows-disabled .github/workflows
  cd .github/workflows && for f in *.txt; do mv "$f" "${f%.txt}"; done
  ```
  