#!/usr/bin/env bash
# Fetch the pinned nektos/act binary into ./.act (idempotent).
#
# Mirrors the sibling repo-standards scripts/get-act.sh: a pinned version downloaded
# from GitHub releases and checksum-verified before extraction (supply-chain hygiene).
# Unlike that one, this resolves the asset per host OS/arch, so it serves both the Linux
# dev VM and Windows (HECATON) without edits. The binary is act.exe on Windows, act elsewhere.
set -euo pipefail
ACT_VERSION="v0.2.89"
DEST=".act"

# Resolve the release asset for this host.
os="$(uname -s)"
arch="$(uname -m)"
case "$arch" in
  x86_64 | amd64) arch="x86_64" ;;
  arm64 | aarch64) arch="arm64" ;;
  *)
    echo "ERROR: unsupported CPU arch '$arch'." >&2
    exit 1
    ;;
esac
case "$os" in
  Linux) asset="act_Linux_${arch}.tar.gz" bin="act" ;;
  Darwin) asset="act_Darwin_${arch}.tar.gz" bin="act" ;;
  MINGW* | MSYS* | CYGWIN* | Windows_NT) asset="act_Windows_${arch}.zip" bin="act.exe" ;;
  *)
    echo "ERROR: unsupported OS '$os'." >&2
    exit 1
    ;;
esac

if [ -x "${DEST}/${bin}" ]; then
  echo "act already present at ${DEST}/${bin}"
  exit 0
fi

mkdir -p "${DEST}"
gh release download "${ACT_VERSION}" --repo nektos/act \
  --pattern "${asset}" --pattern 'checksums.txt' --dir "${DEST}" --clobber
# Verify the archive against the published checksums BEFORE extracting.
# --ignore-missing: checksums.txt lists every asset; we only downloaded ours.
(cd "${DEST}" && sha256sum --ignore-missing -c checksums.txt)
# Extract. tar handles .tar.gz everywhere; .zip needs unzip, or PowerShell's
# Expand-Archive as a fallback (Git Bash ships GNU tar, which cannot read zip).
case "$asset" in
  *.tar.gz) tar -xzf "${DEST}/${asset}" -C "${DEST}" ;;
  *.zip)
    if command -v unzip >/dev/null 2>&1; then
      unzip -o "${DEST}/${asset}" -d "${DEST}"
    else
      powershell -NoProfile -Command "Expand-Archive -Path '${DEST}/${asset}' -DestinationPath '${DEST}' -Force"
    fi
    ;;
esac
chmod +x "${DEST}/${bin}" 2>/dev/null || true
rm -f "${DEST}/${asset}" "${DEST}/checksums.txt"
echo "act installed at ${DEST}/${bin}"
