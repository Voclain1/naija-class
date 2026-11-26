#!/usr/bin/env bash
set -euo pipefail
umask 077
mode=$1
release=$2
[[ "$release" =~ ^[a-f0-9]{40}$ ]]
cd /opt/school-kit
state="/opt/school-kit/releases/$release"
base=(docker compose -p school-kit --env-file deploy.env -f docker-compose.yml -f invoice-565.override.yml)
docker_service() { docker ps -q --filter label=com.docker.compose.project=school-kit --filter "label=com.docker.compose.service=$1"; }
snapshot() {
  for service in postgres redis ops-pinned render-worker caddy; do
    container=$(docker_service "$service")
    [[ -n "$container" && "$container" != *$'\n'* ]]
    docker inspect --format '{{.Id}} {{.Image}} {{.State.StartedAt}}' "$container"
  done
  sha256sum deploy.env api.env web.env portal.env backup.env docker-compose.yml invoice-565.override.yml
  stat --printf '%i %s %Y\n' backup-ops.override.yml
}
check_api() {
  for _ in {1..60}; do
    if curl -fsS -m 3 http://127.0.0.1:4000/api/v1/health/db | jq -e '.role == "app_user"' >/dev/null; then return; fi
    sleep 2
  done
  return 1
}
case "$mode" in
prepare)
  test -f backup-ops.override.yml
  test -r invoice-565.override.yml
  test ! -e "$state"
  install -d -m700 "$state"
  snapshot > "$state/protected-before"
  for ref in "$3" "$4" "$5" "$6"; do docker image inspect "$ref" --format '{{.Id}}'; done
  cat > "$state/candidate.yml" <<YAML
services:
  api:
    image: $3
  web:
    image: $4
  portal:
    image: $5
YAML
  cat > "$state/recovery.yml" <<YAML
services:
  api:
    image: $6
YAML
  "${base[@]}" -f "$state/candidate.yml" config --quiet
  "${base[@]}" -f "$state/candidate.yml" -f "$state/recovery.yml" config --quiet
  echo 'Pinned candidate and recovery images available. Protected stack snapshot recorded.'
  ;;
pause)
  test -s "$state/protected-before"
  snapshot | cmp "$state/protected-before"
  check_api
  db=$(docker_service postgres)
  docker exec "$db" pg_dump -U postgres -d school_kit -Fc > "$state/pre-cutover.dump.partial"
  test "$(stat -c %s "$state/pre-cutover.dump.partial")" -gt 1024
  docker exec -i "$db" pg_restore --list < "$state/pre-cutover.dump.partial" >/dev/null
  mv "$state/pre-cutover.dump.partial" "$state/pre-cutover.dump"
  (cd "$state" && sha256sum pre-cutover.dump > pre-cutover.dump.sha256 && sha256sum -c pre-cutover.dump.sha256)
  "${base[@]}" stop -t 45 api
  test -z "$(docker_service api)"
  echo 'API stopped. Fresh PostgreSQL dump and checksum verified. Existing backup scheduler kept running.'
  ;;
switch)
  test -s "$state/pre-cutover.dump"
  (cd "$state" && sha256sum -c pre-cutover.dump.sha256)
  snapshot | cmp "$state/protected-before"
  scoped=("${base[@]}" -f "$state/candidate.yml")
  "${scoped[@]}" up -d --no-deps --no-build --pull never api web portal
  if ! check_api; then
    "${scoped[@]}" -f "$state/recovery.yml" up -d --no-deps --no-build --pull never api
    check_api
    snapshot | cmp "$state/protected-before"
    echo 'Candidate API failed health. Qualified recovery API started; cutover remains failed.'
    exit 1
  fi
  for pair in "api:$3" "web:$4" "portal:$5"; do
    service=${pair%%:*}
    image=${pair#*:}
    test "$(docker inspect --format '{{.Image}}' "$(docker_service "$service")")" = "$(docker image inspect --format '{{.Id}}' "$image")"
    printf 'Running %s %s\n' "$service" "$image"
  done
  for port in 3001 3002; do
    curl -fsS --retry 8 --retry-connrefused --retry-delay 1 -m 5 -o /dev/null "http://127.0.0.1:$port/api/health"
  done
  snapshot | cmp "$state/protected-before"
  docker top "$(docker_service ops-pinned)" -eo pid,comm | grep -q cron
  docker exec -i "$(docker_service api)" node - <<'NODE'
const assert = require("node:assert/strict");
const { withTenant, basePrisma } = require("@school-kit/db");
const { installmentOutstanding } = require("./dist/modules/payments/installment-progress.js");
const { randomUUID } = require("node:crypto");
const school = randomUUID(), invoice = randomUUID(), plan = randomUUID();
const earlier = randomUUID(), later = randomUUID();
const rollback = new Error("expected fictional fixture rollback");
(async () => {
  try {
    await withTenant(school, async db => {
      await db.school.create({ data: { id: school, name: "Fictional Instalment Cutover", slug: "cutover-fixture-" + school } });
      await db.invoice.create({ data: {
        id: invoice, schoolId: school, studentId: "fictional-student", termId: "fictional-term",
        academicYearId: "fictional-year", status: "PARTIALLY_PAID", items: [], totalAmount: 20000,
        totalDiscount: 0, totalDue: 20000, totalPaid: 10000, issuedAt: new Date(),
      } });
      await db.paymentPlan.create({ data: { id: plan, schoolId: school, invoiceId: invoice, name: "Fictional Plan", createdBy: "fixture",
        installments: { create: [
          { id: earlier, schoolId: school, amount: 10000, dueDate: new Date("2027-01-01") },
          { id: later, schoolId: school, amount: 10000, dueDate: new Date("2027-02-01") },
        ] },
      } });
      await db.payment.create({ data: {
        schoolId: school, invoiceId: invoice, studentId: "fictional-student", installmentId: later,
        amount: 11000, allocatedKobo: 10000, method: "CASH", status: "SUCCESS",
      } });
      assert.equal(await installmentOutstanding(db, school, invoice, earlier, 10000), 10000);
      assert.equal(await installmentOutstanding(db, school, invoice, later, 10000), 0);
      throw rollback;
    });
    throw new Error("fixture unexpectedly committed");
  } catch (error) {
    if (error !== rollback) throw error;
  }
  assert.equal(await withTenant(school, db => db.school.count({ where: { id: school } })), 0);
  console.log("Production runtime verified out-of-order attribution with a rolled-back fictional fixture.");
})().catch(error => { console.error(error);process.exitCode = 1; }).finally(() => basePrisma.$disconnect());
NODE
  echo 'Scoped production health checks passed. PostgreSQL, Redis, ops-pinned, render worker, Caddy and protected configuration unchanged.'
  ;;
*) exit 2 ;;
esac
