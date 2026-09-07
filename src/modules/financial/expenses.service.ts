import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { DEFAULT_EXPENSE_CATEGORIES, toCategorySlug } from "../../lib/financial/financial.domain.js";
import type {
  CreateExpenseCategoryInput,
  CreateExpenseInput,
  ListExpenseCategoriesQuery,
  ListExpensesQuery,
  UpdateExpenseCategoryInput,
  UpdateExpenseInput,
} from "./financial.schemas.js";

// PROGRAM 3 / Financial Management F2. All money is stored as
// Prisma.Decimal (never a float). Every read and write is tenant-scoped
// on businessId; nothing here is customer-visible. Expenses use
// deletedAt soft-deletion so a withdrawn entry stays auditable.

const categorySelect = {
  id: true,
  name: true,
  slug: true,
  isDefault: true,
  sortOrder: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ExpenseCategorySelect;

const expenseSelect = {
  id: true,
  amount: true,
  currency: true,
  spentAt: true,
  vendor: true,
  description: true,
  reference: true,
  paymentMethod: true,
  categoryId: true,
  appointmentId: true,
  customerId: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, name: true, slug: true } },
  createdByMember: { select: { id: true, user: { select: { id: true, fullName: true } } } },
  _count: { select: { receipts: { where: { deletedAt: null } } } },
} satisfies Prisma.ExpenseSelect;

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/**
 * Idempotently seeds the descriptive default categories the first time a
 * business touches the feature. `skipDuplicates` + the (businessId, slug)
 * unique index make concurrent callers safe - the second one seeds
 * nothing.
 */
export async function ensureDefaultExpenseCategories(businessId: string): Promise<void> {
  const existing = await prisma.expenseCategory.count({ where: { businessId } });
  if (existing > 0) return;
  await prisma.expenseCategory.createMany({
    data: DEFAULT_EXPENSE_CATEGORIES.map((name, index) => ({
      businessId,
      name,
      slug: toCategorySlug(name),
      isDefault: true,
      sortOrder: index,
    })),
    skipDuplicates: true,
  });
}

export async function listExpenseCategories(businessId: string, query: ListExpenseCategoriesQuery) {
  await ensureDefaultExpenseCategories(businessId);
  return prisma.expenseCategory.findMany({
    where: { businessId, ...(query.includeArchived ? {} : { archivedAt: null }) },
    orderBy: [{ archivedAt: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    select: categorySelect,
  });
}

export async function createExpenseCategory(businessId: string, input: CreateExpenseCategoryInput) {
  const slug = toCategorySlug(input.name);
  if (!slug) throw ApiError.badRequest("Category name must contain letters or numbers");
  const maxSort = await prisma.expenseCategory.aggregate({ where: { businessId }, _max: { sortOrder: true } });
  try {
    return await prisma.expenseCategory.create({
      data: { businessId, name: input.name, slug, sortOrder: (maxSort._max.sortOrder ?? -1) + 1 },
      select: categorySelect,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw ApiError.conflict("A category with a similar name already exists");
    }
    throw error;
  }
}

export async function updateExpenseCategory(businessId: string, id: string, input: UpdateExpenseCategoryInput) {
  const existing = await prisma.expenseCategory.findFirst({ where: { id, businessId }, select: { id: true } });
  if (!existing) throw ApiError.notFound("Category not found");

  const data: Prisma.ExpenseCategoryUpdateInput = {};
  if (input.name !== undefined) {
    const slug = toCategorySlug(input.name);
    if (!slug) throw ApiError.badRequest("Category name must contain letters or numbers");
    data.name = input.name;
    data.slug = slug;
  }
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
  if (input.archived !== undefined) data.archivedAt = input.archived ? new Date() : null;

  try {
    return await prisma.expenseCategory.update({ where: { id }, data, select: categorySelect });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw ApiError.conflict("A category with a similar name already exists");
    }
    throw error;
  }
}

/**
 * Archives a category (never a hard delete) so historical expenses keep a
 * readable label. Expenses are not reassigned.
 */
export async function archiveExpenseCategory(businessId: string, id: string) {
  const result = await prisma.expenseCategory.updateMany({
    where: { id, businessId, archivedAt: null },
    data: { archivedAt: new Date() },
  });
  if (result.count !== 1) throw ApiError.notFound("Category not found or already archived");
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

async function assertLinksBelongToBusiness(
  businessId: string,
  links: { categoryId?: string | null; appointmentId?: string | null; customerId?: string | null },
): Promise<void> {
  if (links.categoryId) {
    const category = await prisma.expenseCategory.findFirst({
      where: { id: links.categoryId, businessId },
      select: { id: true },
    });
    if (!category) throw ApiError.badRequest("Category does not belong to this business");
  }
  if (links.appointmentId) {
    const appointment = await prisma.appointment.findFirst({
      where: { id: links.appointmentId, businessId },
      select: { id: true },
    });
    if (!appointment) throw ApiError.badRequest("Appointment does not belong to this business");
  }
  if (links.customerId) {
    const customer = await prisma.customer.findFirst({
      where: { id: links.customerId, businessId },
      select: { id: true },
    });
    if (!customer) throw ApiError.badRequest("Customer does not belong to this business");
  }
}

function serializeExpense(row: Prisma.ExpenseGetPayload<{ select: typeof expenseSelect }>) {
  return {
    id: row.id,
    amount: row.amount.toFixed(2),
    currency: row.currency,
    spentAt: row.spentAt,
    vendor: row.vendor,
    description: row.description,
    reference: row.reference,
    paymentMethod: row.paymentMethod,
    categoryId: row.categoryId,
    category: row.category,
    appointmentId: row.appointmentId,
    customerId: row.customerId,
    receiptCount: row._count.receipts,
    createdBy: row.createdByMember
      ? { memberId: row.createdByMember.id, name: row.createdByMember.user.fullName }
      : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listExpenses(businessId: string, query: ListExpensesQuery) {
  const where: Prisma.ExpenseWhereInput = {
    businessId,
    deletedAt: null,
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.from || query.to
      ? { spentAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
      : {}),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.expense.findMany({
      where,
      orderBy: [{ spentAt: "desc" }, { createdAt: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: expenseSelect,
    }),
    prisma.expense.count({ where }),
  ]);
  return {
    items: rows.map(serializeExpense),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

export async function getExpense(businessId: string, id: string) {
  const row = await prisma.expense.findFirst({ where: { id, businessId, deletedAt: null }, select: expenseSelect });
  if (!row) throw ApiError.notFound("Expense not found");
  return serializeExpense(row);
}

export async function createExpense(businessId: string, createdByMemberId: string, input: CreateExpenseInput) {
  await assertLinksBelongToBusiness(businessId, input);
  const row = await prisma.expense.create({
    data: {
      businessId,
      createdByMemberId,
      amount: new Prisma.Decimal(input.amount),
      currency: input.currency,
      spentAt: input.spentAt,
      vendor: input.vendor ?? null,
      description: input.description ?? null,
      reference: input.reference ?? null,
      paymentMethod: input.paymentMethod ?? null,
      categoryId: input.categoryId ?? null,
      appointmentId: input.appointmentId ?? null,
      customerId: input.customerId ?? null,
    },
    select: expenseSelect,
  });
  return serializeExpense(row);
}

export async function updateExpense(businessId: string, id: string, input: UpdateExpenseInput) {
  const existing = await prisma.expense.findFirst({ where: { id, businessId, deletedAt: null }, select: { id: true } });
  if (!existing) throw ApiError.notFound("Expense not found");
  await assertLinksBelongToBusiness(businessId, input);

  const data: Prisma.ExpenseUpdateInput = {};
  if (input.amount !== undefined) data.amount = new Prisma.Decimal(input.amount);
  if (input.currency !== undefined) data.currency = input.currency;
  if (input.spentAt !== undefined) data.spentAt = input.spentAt;
  if (input.vendor !== undefined) data.vendor = input.vendor ?? null;
  if (input.description !== undefined) data.description = input.description ?? null;
  if (input.reference !== undefined) data.reference = input.reference ?? null;
  if (input.paymentMethod !== undefined) data.paymentMethod = input.paymentMethod ?? null;
  if (input.categoryId !== undefined) {
    data.category = input.categoryId ? { connect: { id: input.categoryId } } : { disconnect: true };
  }
  if (input.appointmentId !== undefined) {
    data.appointment = input.appointmentId ? { connect: { id: input.appointmentId } } : { disconnect: true };
  }
  if (input.customerId !== undefined) {
    data.customer = input.customerId ? { connect: { id: input.customerId } } : { disconnect: true };
  }

  const row = await prisma.expense.update({ where: { id }, data, select: expenseSelect });
  return serializeExpense(row);
}

export async function deleteExpense(businessId: string, id: string) {
  const result = await prisma.expense.updateMany({
    where: { id, businessId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (result.count !== 1) throw ApiError.notFound("Expense not found");
}
