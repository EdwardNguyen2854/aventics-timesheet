# Publish this checkout to the existing GitHub repository.
# Requires Git with authentication configured on this machine.
$ErrorActionPreference = 'Stop'
$repo = 'https://github.com/EdwardNguyen2854/aventics-timesheet.git'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Install Git: https://git-scm.com/' }
if (-not (Test-Path .git)) { git init }
git branch -M main
$remotes = @(git remote)
if ($remotes -contains 'origin') { git remote set-url origin $repo }
else { git remote add origin $repo }
git add .
if ((git status --porcelain)) { git commit -m 'feat: initialize Aventics Timesheet web app' }
git push -u origin main
