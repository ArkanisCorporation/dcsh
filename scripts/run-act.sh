#!/usr/bin/env bash
# Run the build workflow locally via nektos/act — the same gate CI runs, in containers.
#
# Out-of-the-box: fetches the pinned act binary on first use, preflights Docker with a
# clear message (act runs the workflow in containers), and passes a GitHub token so act
# can resolve the private ArkanisCorporation/ci reusable workflows that build.yml calls.
# Invoked by `pnpm act`. No 1Password wrapper: build.yml declares no secrets of its own.
# Extra args pass through, e.g. `pnpm act -- -j node-lint`, `pnpm act -- --dryrun`.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Binary is act.exe on Windows, act elsewhere.
ACT="${HERE}/.act/act"
[ -x "${ACT}.exe" ] && ACT="${ACT}.exe"

# 1. Ensure act is present (pinned, checksum-verified).
if [ ! -x "${ACT}" ]; then
  echo "act not present — fetching the pinned binary..." >&2
  bash "${HERE}/scripts/get-act.sh"
  [ -x "${HERE}/.act/act.exe" ] && ACT="${HERE}/.act/act.exe"
fi

# 2. act needs a running Docker daemon. Fail fast with an actionable message.
if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker is not available (not installed, or the daemon is not running)." >&2
  echo "       'pnpm act' runs the workflow in a container — start Docker and retry." >&2
  exit 1
fi

# 3. act must fetch the private ArkanisCorporation/ci reusable workflows, which needs a
#    token. Prefer an explicit GITHUB_TOKEN; otherwise borrow the gh CLI's.
token="${GITHUB_TOKEN:-}"
if [ -z "${token}" ] && command -v gh >/dev/null 2>&1; then
  token="$(gh auth token 2>/dev/null || true)"
fi
if [ -z "${token}" ]; then
  echo "ERROR: no GitHub token available — act needs one to fetch the private" >&2
  echo "       ArkanisCorporation/ci reusable workflows. Run 'gh auth login' or set GITHUB_TOKEN." >&2
  exit 1
fi

# 4. Run the build workflow for the pull_request event (what CI runs on a PR).
exec "${ACT}" pull_request -W .github/workflows/build.yml -s GITHUB_TOKEN="${token}" "$@"
