const STORAGE_KEY = "dashub.service-plans.build-001.v1";

/** PlanRepository contract: list(), get(id), put(plan). Local browser data only. */
export function createLocalPlanRepository(storage) {
  const read = () => {
    try {
      const data = JSON.parse(storage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(data) ? data : [];
    } catch { return []; }
  };
  const write = (plans) => storage.setItem(STORAGE_KEY, JSON.stringify(plans));
  return {
    list: () => read().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    get: (id) => read().find((plan) => plan.id === id) ?? null,
    put(plan) {
      const plans = read();
      const index = plans.findIndex((item) => item.id === plan.id);
      if (index === -1) plans.push(plan);
      else plans[index] = plan;
      write(plans);
      return plan;
    },
    seed(plans) {
      if (storage.getItem(STORAGE_KEY) === null) write(plans);
    },
  };
}
