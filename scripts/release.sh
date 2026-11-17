#!/bin/sh
# Usage: npm run release -- 0.1.0
#
# Apps install a tag (`github:adamaviner/ed-payments#v0.1.0`) and npm doesn't build git dependencies
# that have no `prepare` script, so the tag must carry the built files. main never holds dist: the
# version bump is committed on the branch, then the tag goes on a commit just past it that adds dist.
set -eu

version=${1:?Usage: npm run release -- <version>, e.g. 0.1.0}
tag="v$version"

# Usually main. A stage branch may release before its PR is merged, so the app's PR can install the tag.
branch=$(git rev-parse --abbrev-ref HEAD)
[ "$branch" != HEAD ] || { echo "Check out a branch first." >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "Commit or discard your changes first." >&2; exit 1; }
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then echo "$tag already exists." >&2; exit 1; fi

# The example app's typecheck resolves the package through dist, so build before checking.
npm run build
npm run check

npm version "$version" --no-git-tag-version >/dev/null
git commit -q -am "Release $tag"
npm run build

git checkout -q --detach
git add -f dist
git commit -q -m "Built files for $tag"
git tag -a "$tag" -m "$tag"
git checkout -q "$branch"
# Leaving the tag removed its tracked dist; build again so this checkout keeps working.
npm run build >/dev/null

git push -q origin "$branch" "$tag"
echo "Pushed $tag. Apps install it with: npm install github:adamaviner/ed-payments#$tag"
