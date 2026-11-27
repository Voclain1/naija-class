#!/bin/sh
# Pre-release verified dump, run INSIDE the pinned backup scheduler container. It is a real file
# (copied in with `docker cp`, run by path), never a script fed through a pipe or heredoc: a command
# inside it that reads standard input could otherwise swallow the rest of the script, and the shell
# would reach end-of-file and report success having done a fraction of the work. Its own stdin is closed.
#   env: TS (UTC stamp), BACKUP_BUCKET (from /ops/env.sh)
set -eu
exec </dev/null
. /ops/env.sh
umask 077
s=$(mktemp -d); trap 'rm -rf "$s"' EXIT
f="$s/school-kit-pre-release-$TS.dump"
pg_dump -Fc -f "$f"
[ "$(wc -c < "$f")" -gt 1024 ]
pg_restore --list "$f" >/dev/null
d=$(sha256sum "$f"); d=${d%% *}
printf '%s  %s\n' "$d" "$(basename "$f")" > "$f.sha256"
remote="backup:${BACKUP_BUCKET}/dumps/pre-release/$(basename "$f")"
rclone copyto "$f" "$remote"
rclone copyto "$remote" "$s/readback"
a=$(sha256sum "$s/readback"); [ "${a%% *}" = "$d" ]
rclone copyto "$f.sha256" "$remote.sha256"
# the marker the caller looks for: without it the snapshot did not finish, whatever the exit status
echo "SNAPSHOT $(basename "$f") verified off-site"
