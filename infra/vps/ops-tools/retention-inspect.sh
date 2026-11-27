#!/bin/sh
# Runs INSIDE the scheduler container (guard.sh pipes it to `sh -s`). Strictly read-only:
# lists, downloads one dump to scratch, and runs production's own prune logic through a shim
# that PRINTS the deletions instead of performing them. WAL-G is only asked for a dry run
# (no --confirm). Any failure, including a listing, a checksum, wal-verify or the dry run,
# makes the exit status non-zero. Nothing is hidden behind `|| true`.
set -eu
. /ops/env.sh
s=$(mktemp -d); trap 'rm -rf "$s"' EXIT
fails=0
ok()   { echo "PASS $*"; }
bad()  { echo "FAIL $*"; fails=1; }
info() { echo "INFO $*"; }
PAIR='^school-kit-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{4,6}Z[.]dump[.]sha256$'

list() { # folder: exit 3 (nothing there yet) = empty; any other failure is a failure
  rc=0; rclone lsf --files-only "backup:${BACKUP_BUCKET}/dumps/$1" > "$s/$1" 2> "$s/$1.err" || rc=$?
  if [ "$rc" -eq 3 ]; then : > "$s/$1"; return 0; fi
  if [ "$rc" -ne 0 ]; then sed 's/^/  rclone: /' "$s/$1.err"; return 1; fi
}
for f in daily weekly; do
  if ! list "$f"; then bad "$f: object-store listing failed"; continue; fi
  complete=0; marker_only=0; dump_only=0
  for m in $(grep -E "$PAIR" "$s/$f" || true); do
    if grep -qxF "${m%.sha256}" "$s/$f"; then complete=$((complete+1)); else marker_only=$((marker_only+1)); fi
  done
  for d in $(grep -E '^school-kit-.*[.]dump$' "$s/$f" || true); do grep -qxF "$d.sha256" "$s/$f" || dump_only=$((dump_only+1)); done
  info "$f: complete pairs=$complete markers-without-dump=$marker_only dumps-without-marker=$dump_only"
  if [ "$f" = daily ]; then
    [ "$complete" -ge 1 ] && ok "daily has a complete dump+marker pair" || bad "daily has no complete pair"
    newest=$(grep -E "$PAIR" "$s/daily" | sort -r | head -n 1 || true)
    if [ -n "$newest" ] && ! grep -qxF "${newest%.sha256}" "$s/daily"; then bad "newest marker has no dump: $newest"; fi
  elif [ "${EXPECT_WEEKLY:-0}" = 1 ]; then
    [ "$complete" -ge 1 ] && ok "weekly has a complete pair" || bad "weekly expected but empty"
  fi
done

# Newest COMPLETE daily pair: independent download and checksum.
pick=
for m in $(grep -E "$PAIR" "$s/daily" | sort -r || true); do
  if grep -qxF "${m%.sha256}" "$s/daily"; then pick=$m; break; fi
done
if [ -n "$pick" ]; then
  d=${pick%.sha256}
  if rclone copyto "backup:${BACKUP_BUCKET}/dumps/daily/$pick" "$s/$pick" && rclone copyto "backup:${BACKUP_BUCKET}/dumps/daily/$d" "$s/$d"; then
    if ( cd "$s" && sha256sum -c "$pick" >/dev/null ) && pg_restore --list "$s/$d" >/dev/null; then ok "newest complete pair verifies (checksum + archive catalogue): $d"; else bad "newest complete pair FAILED verification: $d"; fi
  else bad "could not download the newest complete pair"; fi
fi

# Production's own prune function, with deletion replaced by a printout.
mkdir -p "$s/bin"
real=$(command -v rclone)
cat > "$s/bin/rclone" <<SHIM
#!/bin/sh
case "\$1" in
  deletefile) echo "WOULD DELETE \$2"; exit 0 ;;
  delete) echo "WOULD DELETE (legacy age-based) \$*"; exit 0 ;;
esac
exec $real "\$@"
SHIM
chmod 755 "$s/bin/rclone"
if grep -q '^KEEP_MIN=' /ops/backup.sh; then
  awk '/^KEEP_MIN=/{p=1} p{print} p&&/^}/{exit}' /ops/backup.sh > "$s/prune.sh"; args_d="daily 15"; args_w="weekly 57"
else
  sed -n '/^prune() {/,/^}/p' /ops/backup.sh > "$s/prune.sh"; args_d="daily 15d"; args_w="weekly 57d"
fi
if ( PATH="$s/bin:$PATH"; scratch="$s"; . "$s/prune.sh"; prune $args_d; prune $args_w ) > "$s/dry.out" 2> "$s/dry.err"; then
  n=$(grep -c '^WOULD DELETE' "$s/dry.out" || true)
  info "tonight's prune would delete $n object(s) (dry run; nothing was deleted)"
  newest3=$(grep -E "$PAIR" "$s/daily" | sort -r | head -n 3 || true)
  for m in $newest3; do
    if grep -q "WOULD DELETE.*${m%.sha256}" "$s/dry.out"; then bad "the prune would delete a newest-3 pair member: $m"; fi
  done
  ok "prune dry run completed without error"
else
  bad "prune dry run failed"; sed 's/^/  /' "$s/dry.err"
fi

# WAL-G: base backups, retention DRY RUN (no --confirm), integrity.
if wal-g backup-list --detail > "$s/bases.out" 2> "$s/bases.err"; then
  info "WAL-G base backups: $(grep -c '^base_' "$s/bases.out" || true)"; sed 's/^/  /' "$s/bases.out"
else bad "wal-g backup-list failed"; sed 's/^/  /' "$s/bases.err"; fi
if wal-g delete retain FULL 7 > "$s/retain.out" 2> "$s/retain.err"; then ok "wal-g 'delete retain FULL 7' dry run succeeded (no --confirm: nothing deleted)"; sed 's/^/  /' "$s/retain.out" | head -n 20
else bad "wal-g retention dry run failed"; sed 's/^/  /' "$s/retain.err"; fi
if wal-g wal-verify integrity timeline > "$s/verify.out" 2> "$s/verify.err"; then
  grep -q 'integrity check status: OK' "$s/verify.out" && ok "wal-verify integrity OK" || { bad "wal-verify integrity not OK"; sed 's/^/  /' "$s/verify.out"; }
  grep -q 'timeline check status: OK' "$s/verify.out" && ok "wal-verify timeline OK" || { bad "wal-verify timeline not OK"; sed 's/^/  /' "$s/verify.out"; }
else bad "wal-verify failed to run"; sed 's/^/  /' "$s/verify.err"; fi
exit "$fails"
