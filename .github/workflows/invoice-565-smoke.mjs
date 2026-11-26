import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { basePrisma, withTenant } from '@school-kit/db';
import { InvoiceGenerationService } from './dist/modules/invoices/invoice-generation.service.js';

const schoolId = randomUUID();
const rollback = Symbol('rollback fictional invoice verification');
const service = new InvoiceGenerationService();
const req = { ipAddress: null };
try {
  await withTenant(schoolId, async (db) => {
    await db.school.create({ data: { id: schoolId, name: 'Fictional #565 rollback-only fixture', slug: `fictional-565-${schoolId}`, status: 'ACTIVE' } });
    const user = await db.user.create({ data: { schoolId, firstName: 'Fictional', lastName: 'Verifier' } });
    const auth = { schoolId, userId: user.id, sessionId: 'rollback-only-smoke' };
    const startDate = new Date('2025-09-01');
    const endDate = new Date('2026-07-31');
    const year = await db.academicYear.create({ data: { schoolId, label: 'Fictional year', startDate, endDate } });
    const term = await db.term.create({ data: { schoolId, academicYearId: year.id, sequence: 1, name: 'Fictional term', startDate, endDate } });
    const level = await db.classLevel.create({ data: { schoolId, name: 'Fictional level', code: 'fixture', orderIndex: 1, stage: 'JSS' } });
    const arm = await db.classArm.create({ data: { schoolId, classLevelId: level.id, name: 'Fictional arm', code: 'fixture' } });
    const student = await db.student.create({ data: { schoolId, firstName: 'Fictional', lastName: 'Student', admissionNumber: 'F-565', dateOfBirth: new Date('2010-01-01'), gender: 'MALE' } });
    await db.enrollment.create({ data: { schoolId, studentId: student.id, termId: term.id, academicYearId: year.id, classArmId: arm.id, status: 'ENROLLED' } });
    const category = await db.feeCategory.create({ data: { schoolId, name: 'Fictional fees', createdBy: user.id } });
    const common = { schoolId, categoryId: category.id, classLevelId: level.id, termId: term.id, createdBy: user.id };
    const fee = await db.feeItem.create({ data: { ...common, name: 'Tuition', amount: 100_000 } });
    const dto = { termId: term.id, classArmId: arm.id };
    const initial = await service.generateForArmInTransaction(auth, dto, req, db);
    assert.equal(initial.created, 1);
    const old = initial.invoices[0];
    await service.cancelInTransaction(db, auth, old.id);
    await db.feeItem.update({ where: { id: fee.id }, data: { amount: 80_000 } });
    await db.feeItem.createMany({ data: [
      { ...common, name: 'Fictional books', amount: 5_000 },
      { ...common, name: 'Fictional materials', amount: 7_500 },
    ] });
    const [preview] = await service.previewForArmInTransaction(auth, dto, db);
    assert.equal(preview.alreadyInvoiced, false);
    assert.equal(preview.totalDue, 92_500);
    const replacement = await service.generateForArmInTransaction(auth, dto, req, db);
    assert.equal(replacement.created, 1);
    assert.equal(replacement.invoices[0].totalDue, 92_500);
    assert.notEqual(replacement.invoices[0].id, old.id);
    const history = await db.invoice.findUniqueOrThrow({ where: { id: old.id } });
    assert.equal(history.status, 'CANCELLED');
    assert.equal(history.totalDue, 100_000);
    const repeated = await service.generateForArmInTransaction(auth, dto, req, db);
    assert.equal(repeated.created, 0);
    assert.equal(repeated.skipped, 1);
    throw rollback;
  }, { timeoutMs: 30_000, retryConnectionErrors: false, label: 'fictional-invoice-565-rollback-only' });
  throw new Error('Verification must never commit');
} catch (error) {
  if (error !== rollback) {
    console.error('Fictional rollback-only verification failed:', error instanceof Error ? error.name : typeof error);
    process.exitCode = 1;
  } else {
    assert.equal(await basePrisma.school.count({ where: { id: schoolId } }), 0);
    console.log('Production API smoke passed: correct current fees, preserved cancelled amount, no duplicate, fictional transaction rolled back.');
  }
} finally {
  await basePrisma.$disconnect();
}
