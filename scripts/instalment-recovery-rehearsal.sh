#!/usr/bin/env bash
set -euo pipefail
for image in "$CANDIDATE_IMAGE" "$RECOVERY_IMAGE"; do
  [[ "$image" =~ ^ghcr.io/voclain1/school-kit-api@sha256:[a-f0-9]{64}$ ]]
  docker pull "$image"
done
test "$CANDIDATE_IMAGE" != "$RECOVERY_IMAGE"
docker pull pgvector/pgvector:pg18
docker pull redis:7-alpine
prefix="instalment-${GITHUB_RUN_ID:-$$}"
network="$prefix"; db="$prefix-db"; api="$prefix-api"; redis="$prefix-redis"; receipts="$prefix-receipts"
cleanup() {
  code=$?
  if ((code != 0)); then docker logs --tail 80 "$api" 2>&1 || true; fi
  docker rm -fv "$api" "$db" "$redis" >/dev/null 2>&1 || true
  docker volume rm "$receipts" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker network create --internal "$network"
docker volume create "$receipts"
docker run --rm --network none --user 0 -v "$receipts:/srv/receipts" --entrypoint chown "$CANDIDATE_IMAGE" 1000:1000 /srv/receipts
docker run -d --name "$db" -p 127.0.0.1::5432 -e POSTGRES_USER=school_kit -e POSTGRES_DB=school_kit -e POSTGRES_PASSWORD=fixture-migrations pgvector/pgvector:pg18
docker network connect --alias postgres "$network" "$db"
docker run -d --name "$redis" --network "$network" --network-alias redis redis:7-alpine
for _ in {1..60}; do
  if docker exec "$db" pg_isready -h 127.0.0.1 -U school_kit >/dev/null 2>&1; then break; fi
  sleep 1
done
sql() { docker exec -i "$db" psql -X -v ON_ERROR_STOP=1 -qAt -U school_kit -d school_kit "$@"; }
sql < infra/postgres/init/01-extensions.sql
sql < infra/postgres/init/02-app-role.sql
port=$(docker port "$db" 5432/tcp)
export DIRECT_URL="postgresql://school_kit:fixture-migrations@$port/school_kit"
test "$(sql -c "SELECT current_setting('server_version_num')::int / 10000")" = 18
pending=$(mktemp -d)
migrations=packages/db/prisma/migrations
for path in "$migrations"/202701{17*,18*,20*,210900*,211000*,211100*,23*,24*}; do
  if [[ -d "$path" ]]; then mv "$path" "$pending"; fi
done
test "$(find "$pending" -mindepth 1 -maxdepth 1 -type d | wc -l)" = 7
pnpm --filter @school-kit/db exec prisma migrate deploy
school=ab000000-0000-4000-a000-000000000001
invoice=ab000000-0000-4000-a000-000000000002
payment=ab000000-0000-4000-a000-000000000003
payment2=ab000000-0000-4000-a000-000000000004
sql <<SQL
INSERT INTO schools (id,name,slug,updated_at) VALUES ('$school','Fictional Recovery School','instalment-fixture',now());
INSERT INTO invoices (id,school_id,student_id,term_id,academic_year_id,items,total_amount,total_discount,total_due,total_paid,status,updated_at)
VALUES ('$invoice','$school','fixture-student','fixture-term','fixture-year','[]',20000,0,20000,0,'ISSUED',now());
INSERT INTO payment_plans (id,school_id,invoice_id,name,created_by) VALUES ('fixture-plan','$school','$invoice','Two fictional instalments','fixture-owner');
INSERT INTO payment_plan_installments (id,school_id,plan_id,amount,due_date)
VALUES ('target-one','$school','fixture-plan',10000,'2027-01-01'),('target-two','$school','fixture-plan',10000,'2027-02-01');
SQL
mv "$pending"/* "$migrations/"
rmdir "$pending"
pnpm --filter @school-kit/db exec prisma migrate deploy
pnpm --filter @school-kit/db exec prisma migrate status
test "$(sql -c "SELECT count(*) FROM payment_plan_installments WHERE plan_id='fixture-plan'")" = 2
for id in "$payment" "$payment2"; do
  sql -c "INSERT INTO payments (id,school_id,invoice_id,student_id,installment_id,amount,method,status,paystack_reference,updated_at)
  VALUES ('$id','$school','$invoice','fixture-student','target-two',11000,'PAYSTACK','PENDING','PSK-$school-$id',now());"
done
key=sk_test_instalment_recovery_fictional
start_api() {
  docker run -d --name "$api" --network "$network" -v "$receipts:/srv/receipts" \
    -e STORAGE_FILESYSTEM_ROOT=/srv/receipts -e NODE_ENV=test \
    -e DATABASE_URL=postgresql://app_user:app_user@postgres:5432/school_kit \
    -e REDIS_URL=redis://redis:6379 -e SCHEDULED_JOBS=off \
    -e BETTER_AUTH_SECRET=instalment-fixture-secret-not-for-real-authentication \
    -e BETTER_AUTH_URL=http://localhost:3001 -e WEB_BASE_URL=http://localhost:3001 \
    -e PORTAL_BASE_URL=http://localhost:3002 -e PAYSTACK_SECRET_KEY="$key" "$1"
  for _ in {1..60}; do
    if docker exec "$api" node -e 'fetch("http://127.0.0.1:4000/api/v1/health").then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))'; then return; fi
    sleep 1
  done
  return 1
}
send() {
  docker exec -e FIXTURE_KEY="$key" -e FIXTURE_REF="PSK-$school-$1" "$api" node -e '
    const body=JSON.stringify({event:"charge.success",data:{reference:process.env.FIXTURE_REF,amount:11000,currency:"NGN",domain:"test",status:"success",paid_at:"2026-11-26T00:00:00Z"}});
    const sig=require("node:crypto").createHmac("sha512",process.env.FIXTURE_KEY).update(body).digest("hex");
    fetch("http://127.0.0.1:4000/api/v1/payments/paystack/webhook",{method:"POST",body,headers:{"Content-Type":"application/json","x-paystack-signature":sig}})
      .then(async r=>{if(!r.ok)throw Error("webhook HTTP "+r.status);await r.text()}).catch(e=>{console.error(e);process.exit(1)});
  '
}
fingerprint() {
  sql -c "SELECT p.id,p.installment_id,p.amount,p.allocated_kobo,p.status,p.receipt_number,p.receipt_url FROM payments p ORDER BY p.id;
    SELECT total_paid,status FROM invoices WHERE id='$invoice';
    SELECT id,paid FROM payment_plan_installments ORDER BY id;
    SELECT reference,reason,unapplied_kobo,review_status FROM paystack_payment_exceptions ORDER BY reference,reason;
    SELECT payment_id,amount,status,paystack_refund_ref FROM refunds ORDER BY payment_id;"
}
start_api "$CANDIDATE_IMAGE"
send "$payment"
test "$(sql -c "SELECT amount,allocated_kobo,status,installment_id,receipt_number IS NOT NULL FROM payments WHERE id='$payment'")" = '11000|10000|SUCCESS|target-two|t'
test "$(sql -c "SELECT paid FROM payment_plan_installments ORDER BY id")" = $'f\nt'
before=$(fingerprint)
docker rm -f "$api"
start_api "$RECOVERY_IMAGE"
send "$payment"
test "$(fingerprint)" = "$before"
send "$payment2"
test "$(sql -c "SELECT amount,allocated_kobo,status,installment_id,receipt_number IS NULL FROM payments WHERE id='$payment2'")" = '11000|0|SUCCESS|target-two|t'
test "$(sql -c "SELECT total_paid,status FROM invoices WHERE id='$invoice'")" = '10000|PARTIALLY_PAID'
test "$(sql -c "SELECT count(*) FROM paystack_payment_exceptions WHERE invoice_id='$invoice' AND unapplied_kobo IN (1000,11000)")" = 2
docker exec -e FIXTURE_PAYMENT="$payment" -e FIXTURE_SCHOOL="$school" "$api" node -e '
  const {RefundsService}=require("./dist/modules/payments/refunds.service.js");
  const {PaymentPlanService}=require("./dist/modules/payments/payment-plan.service.js");
  const fixtureProvider={refundTransaction:async()=>({id:"fictional-reversal"})};
  const service=new RefundsService(fixtureProvider,new PaymentPlanService());
  service.create({schoolId:process.env.FIXTURE_SCHOOL,userId:"fixture-owner",sessionId:"fixture"},{paymentId:process.env.FIXTURE_PAYMENT,amount:11000,reason:"Fictional recovery rehearsal"})
    .then(result=>{if(result.status!=="PROCESSED")throw Error("refund not processed");process.exit(0)})
    .catch(error=>{console.error(error);process.exit(1)});
'
test "$(sql -c "SELECT status,allocated_kobo,receipt_number IS NOT NULL FROM payments WHERE id='$payment'")" = 'REVERSED|10000|t'
test "$(sql -c "SELECT total_paid,status FROM invoices WHERE id='$invoice'")" = '0|REFUNDED'
test "$(sql -c "SELECT paid FROM payment_plan_installments ORDER BY id")" = $'f\nf'
test "$(sql -c "SELECT count(*) FROM refunds WHERE payment_id='$payment' AND amount=11000 AND status='PROCESSED'")" = 1
after=$(fingerprint)
docker rm -f "$api"
start_api "$CANDIDATE_IMAGE"
send "$payment"
send "$payment2"
test "$(fingerprint)" = "$after"
test "$(sql -c "SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='payments'::regclass")" = t
test "$(sql -c "SET ROLE app_user; SELECT count(*) FROM payments;")" = 0
test "$(sql -c "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL")" = 0
receipt=$(sql -c "SELECT receipt_url FROM payments WHERE id='$payment'")
docker exec "$api" grep -q 'Unapplied funds' "/srv/receipts/$receipt"
echo 'Candidate → recovery → candidate passed on one upgraded PostgreSQL 18 database, including out-of-order allocation, surplus, receipt, refund, RLS and replay checks.' | tee -a "$GITHUB_STEP_SUMMARY"
