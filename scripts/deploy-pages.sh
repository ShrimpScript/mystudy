#!/usr/bin/env bash
# Build the static site and publish it to the gh-pages branch (GitHub Pages serves it).
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build:pages
src=$(git rev-parse --short HEAD)
remote=$(git remote get-url origin)
tmp=$(mktemp -d)
cp -r dist-pages/. "$tmp"
cd "$tmp"
git init -q -b gh-pages
git add -A
git commit -q -m "Deploy Margin ($src)"
git push -f "$remote" gh-pages
echo "Deployed. GitHub Pages updates within a minute or two."
