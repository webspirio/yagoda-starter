export { useDayExpensesQuery } from './api/useDayExpenses';
export {
  useCreateDayExpenseMutation,
  useUpdateDayExpenseMutation,
  useDeleteDayExpenseMutation,
} from './api/useDayExpenseMutations';
// CreateDayExpenseInput/UpdateDayExpenseInput stay internal to the slice — the
// same convention as features/edit-supplier's CreateSupplierInput —
// nothing outside this entity imports them; ExpensesPanel infers its
// mutation argument types from the hooks above.
export type { DayExpense } from './model/day-expense';
