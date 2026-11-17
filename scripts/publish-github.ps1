# Push the current checkout to its configured GitHub origin.
# This script does not rename branches, initialize repositories, stage files, or create commits.
# Run from the repository root after reviewing and committing your local changes.
param([string]$Branch = "")
$ErrorActionPreference = 'Stop'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git is required.' }
if (-not (Test-Path .git)) { throw 'This folder is not a Git checkout. Clone the repository first.' }
$remote = (git remote get-url origin 2>$null)
if (-not $remote) { throw 'Git remote origin is missing.' }
if (-not $Branch) { $Branch = (git branch --show-current).Trim() }
if (-not $Branch) { throw 'Detached HEAD: supply a branch to push.' }
if (git status --porcelain) { throw 'Working tree has uncommitted changes. Review and commit them before publishing.' }
Write-Host "Pushing $Branch to $remote"
git push --set-upstream origin $Branch
if ($LASTEXITCODE -ne 0) { throw 'Git push failed.' }
# Repository rename remains an owner action under GitHub Settings > General.
# After the rename run:
# git remote set-url origin https://github.com/EdwardNguyen2854/aventics-worktrack.git