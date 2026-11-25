#!/usr/bin/env bash
set -euo pipefail

for image in "$CANDIDATE_IMAGE" "$RECOVERY_IMAGE" "$BACKUP_IMAGE"; do
  [[ $image =~ ^ghcr\.io/voclain1/school-kit-(api|postgres)@sha256:[0-9a-f]{64}$ ]]
  docker pull "$image"
done

prefix="batch2-${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}"
network="$prefix-isolated"
db="$prefix-db"
redis="$prefix-redis"
api="$prefix-api"
receipts="$prefix-receipts"
cleanup() {
  status=$?
  if [ "$status" != 0 ]; then
    docker logs --tail 80 "$api" 2>&1 || true
  fi
  docker rm -fv "$api" "$redis" "$db" >/dev/null 2>&1 || true
  docker volume rm "$receipts" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create --internal "$network"
docker volume create "$receipts"
docker run --rm --network none --user 0 -v "$receipts:/srv/receipts" \
  --entrypoint chown "$RECOVERY_IMAGE" 1000:1000 /srv/receipts
docker run -d --name "$db" -p 127.0.0.1::5432 \
  -e POSTGRES_PASSWORD=fixture-postgres -e POSTGRES_DB=school_kit \
  -e SCHOOL_KIT_PASSWORD=fixture-migrations -e APP_USER_PASSWORD=fixture-runtime \
  -e PGDATA=/var/lib/postgresql/data "$BACKUP_IMAGE"
docker network connect --alias postgres "$network" "$db"
docker run -d --name "$redis" --network "$network" --network-alias redis redis:7-alpine

for _ in {1..60}; do
  if docker exec "$db" pg_isready -h 127.0.0.1 -U school_kit; then break; fi
  sleep 1
done
port=$(docker port "$db" 5432/tcp)
DIRECT_URL="postgresql://school_kit:fixture-migrations@$port/school_kit" \
  pnpm --filter @school-kit/db exec prisma migrate deploy

sql() { docker exec -i "$db" psql -X -v ON_ERROR_STOP=1 -qAt -U postgres -d school_kit "$@"; }
school=ab000000-0000-4000-a000-000000000001
invoice=ab000000-0000-4000-a000-000000000002
payment=ab000000-0000-4000-a000-000000000003
reference="PSK-$school-$payment"
sql <<SQL
INSERT INTO schools (id,name,slug,updated_at) VALUES ('$school','Batch 2 Fixture','batch-two-fixture',now());
INSERT INTO invoices (id,school_id,student_id,term_id,academic_year_id,items,total_amount,total_discount,total_due,total_paid,status,updated_at)
VALUES ('$invoice','$school','fixture-student','fixture-term','fixture-year','[]',10000,0,10000,0,'ISSUED',now());
INSERT INTO payments (id,school_id,invoice_id,student_id,amount,method,status,paystack_reference,updated_at)
VALUES ('$payment','$school','$invoice','fixture-student',11000,'PAYSTACK','PENDING','$reference',now());
SQL

fixture_key=sk_test_batch2_fictional
start_api() {
  local image=$1 scheduled=$2
  docker run -d --name "$api" --network "$network" \
    -v "$receipts:/srv/receipts" \
    -e STORAGE_FILESYSTEM_ROOT=/srv/receipts -e NODE_ENV=test \
    -e DATABASE_URL=postgresql://app_user:fixture-runtime@postgres:5432/school_kit \
    -e REDIS_URL=redis://redis:6379 -e SCHEDULED_JOBS="$scheduled" \
    -e BETTER_AUTH_SECRET=batch2-fixture-secret-not-for-real-authentication \
    -e BETTER_AUTH_URL=http://localhost:3001 -e WEB_BASE_URL=http://localhost:3001 \
    -e PORTAL_BASE_URL=http://localhost:3002 \
    -e PAYSTACK_SECRET_KEY="$fixture_key" -e PAYSTACK_WEBHOOK_MODE=test \
    -e PAYSTACK_WEBHOOK_REQUIRE_MODERN=off "$image"
  for _ in {1..60}; do
    if docker exec "$api" node -e 'fetch("http://127.0.0.1:4000/api/v1/health").then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))'; then return; fi
    sleep 1
  done
  return 1
}

send() {
  docker exec -e FIXTURE_KEY="$fixture_key" -e FIXTURE_REF="$reference" "$api" node -e '
    const body=JSON.stringify({event:"charge.success",data:{reference:process.env.FIXTURE_REF,amount:11000,currency:"NGN",domain:"test",status:"success",paid_at:"2026-11-25T00:00:00Z"}});
    const signature=require("node:crypto").createHmac("sha512",process.env.FIXTURE_KEY).update(body).digest("hex");
    fetch("http://127.0.0.1:4000/api/v1/payments/paystack/webhook",{method:"POST",body,headers:{"Content-Type":"application/json","x-paystack-signature":signature}})
      .then(r=>{if(r.status!==200)throw Error("webhook returned "+r.status)}).catch(e=>{console.error(e);process.exit(1)});
  '
}

start_api "$CANDIDATE_IMAGE" off
send
test "$(sql -c 'SELECT count(*) FROM paystack_webhook_inbox WHERE processed_at IS NULL')" = 1
test "$(sql -c "SELECT total_paid FROM invoices WHERE id='$invoice'")" = 0
docker rm -f "$api"

start_api "$RECOVERY_IMAGE" on
for _ in {1..60}; do
  if [ "$(sql -c 'SELECT count(*) FROM paystack_webhook_inbox WHERE processed_at IS NOT NULL')" = 1 ]; then break; fi
  sleep 1
done
check_finance() {
  test "$(sql -c 'SELECT count(*) FROM paystack_webhook_inbox WHERE processed_at IS NOT NULL')" = 1
  test "$(sql -c "SELECT amount,allocated_kobo,status,receipt_number IS NOT NULL FROM payments WHERE id='$payment'")" = '11000|10000|SUCCESS|t'
  test "$(sql -c "SELECT total_paid,status FROM invoices WHERE id='$invoice'")" = '10000|PAID'
  test "$(sql -c "SELECT count(*) FROM audit_logs WHERE entity_id='$payment' AND action='payment.paystack-confirm'")" = 1
  test "$(sql -c "SELECT count(*) FROM paystack_payment_exceptions WHERE reference='$reference' AND unapplied_kobo=1000")" = 1
  test "$(sql -c "SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='paystack_webhook_inbox'::regclass")" = t
  test "$(sql -c "SET ROLE app_user; SELECT count(*) FROM paystack_webhook_inbox;")" = 0
  test "$(sql -c "SET ROLE app_user; SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname=current_user;")" = f
}
check_finance
receipt=$(sql -c "SELECT receipt_number FROM payments WHERE id='$payment'")
send
test "$(sql -c 'SELECT count(*) FROM paystack_webhook_inbox')" = 1
check_finance
test "$(sql -c "SELECT receipt_number FROM payments WHERE id='$payment'")" = "$receipt"
docker rm -f "$api"
start_api "$CANDIDATE_IMAGE" off
check_finance
echo 'Candidate → recovery → candidate: one settled allocation, one receipt, one audit and one exception; duplicate suppressed, FORCE RLS retained.'
