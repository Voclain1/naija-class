#!/usr/bin/env bash
set -euo pipefail

for image in "$CANDIDATE_IMAGE" "$RECOVERY_IMAGE" "$BACKUP_IMAGE" "$CANDIDATE_RENDER_IMAGE" "$RECOVERY_RENDER_IMAGE"; do
  [[ $image =~ ^ghcr\.io/voclain1/school-kit-(api|postgres|render)@sha256:[0-9a-f]{64}$ ]]
  docker pull "$image"
done

test "$CANDIDATE_IMAGE" != "$RECOVERY_IMAGE"

prefix="batch2-${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}"
network="$prefix-isolated"
db="$prefix-db"
redis="$prefix-redis"
api="$prefix-api"
worker="$prefix-worker"
receipts="$prefix-receipts"
cleanup() {
  status=$?
  if [ "$status" != 0 ]; then
    docker logs --tail 80 "$api" 2>&1 || true
    docker logs --tail 80 "$worker" 2>&1 || true
  fi
  docker rm -fv "$api" "$worker" "$redis" "$db" >/dev/null 2>&1 || true
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
VALUES ('$invoice','$school','fixture-student','fixture-term','fixture-year','[]',20000,0,20000,0,'ISSUED',now());
INSERT INTO payment_plans (id,school_id,invoice_id,name,created_by) VALUES ('fixture-plan','$school','$invoice','Instalment recovery','fixture-owner');
INSERT INTO payment_plan_installments (id,school_id,plan_id,amount,due_date) VALUES ('target-one','$school','fixture-plan',10000,'2027-01-01'),('target-two','$school','fixture-plan',10000,'2027-02-01');
INSERT INTO payments (id,school_id,invoice_id,student_id,installment_id,amount,method,status,paystack_reference,updated_at)
VALUES ('$payment','$school','$invoice','fixture-student','target-two',11000,'PAYSTACK','PENDING','$reference',now());
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
  test "$(sql -c "SELECT amount,allocated_kobo,status,installment_id,receipt_number IS NOT NULL FROM payments WHERE id='$payment'")" = '11000|10000|SUCCESS|target-two|t'
  test "$(sql -c "SELECT total_paid,status FROM invoices WHERE id='$invoice'")" = '10000|PARTIALLY_PAID'
  test "$(sql -c "SELECT paid FROM payment_plan_installments WHERE plan_id='fixture-plan' ORDER BY id")" = $'f\nt'
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

echo 'Candidate -> recovery -> candidate: one settled allocation, one receipt, one audit and one exception; duplicate suppressed, FORCE RLS retained.'

# ---- document rendering by the render workers -------------------------------
# The worker image is the only place Chromium runs. Both the allocation-compatible
# recovery worker and the candidate worker must turn a queued job into a real PDF.
year=ab000000-0000-4000-a000-0000000000a1; term=ab000000-0000-4000-a000-0000000000a2
level=ab000000-0000-4000-a000-0000000000a3; arm=ab000000-0000-4000-a000-0000000000a4
student=ab000000-0000-4000-a000-0000000000a5; card=ab000000-0000-4000-a000-0000000000a6
sql <<SQL
INSERT INTO academic_years (id,school_id,label,start_date,end_date,is_current,updated_at) VALUES ('$year','$school','2026/2027','2026-09-01','2027-07-31',true,now());
INSERT INTO terms (id,school_id,academic_year_id,sequence,name,start_date,end_date,is_current,updated_at) VALUES ('$term','$school','$year',1,'First Term','2026-09-14','2026-12-18',true,now());
INSERT INTO class_levels (id,school_id,name,code,stage,order_index,is_active,updated_at) VALUES ('$level','$school','JSS 1','jss1','JSS',1,true,now());
INSERT INTO class_arms (id,school_id,class_level_id,name,code,is_active,updated_at) VALUES ('$arm','$school','$level','JSS 1A','jss1-a',true,now());
INSERT INTO students (id,school_id,admission_number,first_name,last_name,date_of_birth,gender,updated_at) VALUES ('$student','$school','ADM-1','Fictional','Pupil','2014-01-01','FEMALE',now());
INSERT INTO report_cards (id,school_id,student_id,term_id,academic_year_id,class_arm_id,overall_total,overall_average,overall_position,subjects_count,updated_at)
VALUES ('$card','$school','$student','$term','$year','$arm',0,0,1,0,now());
SQL
start_worker() {
  docker run -d --name "$worker" --network "$network" -v "$receipts:/srv/receipts" \
    -e STORAGE_FILESYSTEM_ROOT=/srv/receipts -e NODE_ENV=test -e RENDER_WORKER_PORT=4001 \
    -e DATABASE_URL=postgresql://app_user:fixture-runtime@postgres:5432/school_kit \
    -e REDIS_URL=redis://redis:6379 "$1"
  for _ in {1..90}; do
    if docker exec "$worker" node -e 'fetch("http://127.0.0.1:4001/health").then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))'; then return; fi
    sleep 1
  done
  return 1
}
enqueue() {
  docker exec -e CARD="$card" -e SCHOOL="$school" "$api" node -e '
    const {Queue}=require("bullmq");
    const q=new Queue("report-cards",{connection:{host:"redis",port:6379}});
    q.add("render",{schoolId:process.env.SCHOOL,userId:"fixture-user",reportCardId:process.env.CARD},{attempts:1})
      .then(()=>q.close()).catch(e=>{console.error(e);process.exit(1)});
  '
}
render_with() {
  local image=$1 label=$2
  sql -c "UPDATE report_cards SET pdf_status='PENDING', artifact_url=NULL, generated_at=NULL WHERE id='$card'"
  docker run --rm --network none --user 0 -v "$receipts:/srv/receipts" --entrypoint sh "$RECOVERY_IMAGE" -c 'rm -rf /srv/receipts/schools'
  start_worker "$image"
  enqueue
  for _ in {1..120}; do
    [ "$(sql -c "SELECT pdf_status FROM report_cards WHERE id='$card'")" = GENERATED ] && break
    sleep 1
  done
  test "$(sql -c "SELECT pdf_status FROM report_cards WHERE id='$card'")" = GENERATED
  path=$(sql -c "SELECT artifact_url FROM report_cards WHERE id='$card'")
  test "$(docker exec "$worker" head -c 5 "/srv/receipts/$path")" = '%PDF-'
  test "$(docker exec "$worker" stat -c %s "/srv/receipts/$path")" -gt 1000
  test "$(sql -c "SELECT count(*) FROM audit_logs WHERE action='report-card.render' AND entity_id='$card'")" -ge 1
  echo "$label worker rendered a real PDF ($(docker exec "$worker" stat -c %s "/srv/receipts/$path") bytes) and audited it."
  docker rm -f "$worker" >/dev/null
}
render_with "$RECOVERY_RENDER_IMAGE" recovery
render_with "$CANDIDATE_RENDER_IMAGE" candidate
echo 'Both render workers produced a valid PDF from a queued job on the migrated schema.'
