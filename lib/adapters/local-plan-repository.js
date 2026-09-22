const STORAGE_KEY = "dashub.service-plans.build-001.v2";
const LEGACY_KEY = "dashub.service-plans.build-001.v1";
const empty = () => ({ plans: [], templates: [], companies: [], users: [], payouts: [] });
const clone = (value) => JSON.parse(JSON.stringify(value));

/** WorkspaceRepository: one local JSON document keeps cross-plan payout writes atomic. */
export function createLocalPlanRepository(storage) {
  const read = () => {
    try {
      const data = JSON.parse(storage.getItem(STORAGE_KEY) || "null");
      return data && Array.isArray(data.plans) ? data : empty();
    } catch { return empty(); }
  };
  const write = (workspace) => storage.setItem(STORAGE_KEY, JSON.stringify(workspace));
  const transact = (change) => {
    const workspace = read();
    const result = change(workspace);
    write(workspace);
    return result;
  };
  const replace = (items, record) => {
    const index = items.findIndex((item) => item.id === record.id);
    if (index < 0) items.push(record); else items[index] = record;
  };
  return {
    list: () => read().plans.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    get: (id) => read().plans.find((plan) => plan.id === id) ?? null,
    put: (plan) => transact((data) => { replace(data.plans, plan); return plan; }),
    putMany: (plans, payouts) => transact((data) => {
      plans.forEach((plan) => replace(data.plans, plan));
      if (payouts) data.payouts = payouts;
      return plans;
    }),
    listTemplates: () => read().templates,
    putTemplate: (template) => transact((data) => { replace(data.templates, template); return template; }),
    getWorkspace: () => clone(read()),
    listPayouts: () => read().payouts,
    updateCompany: (company) => transact((data) => { replace(data.companies, company); return company; }),
    updateUser: (user) => transact((data) => { replace(data.users, user); return user; }),
    seed(seedWorkspace) {
      if (storage.getItem(STORAGE_KEY) !== null) return;
      const data = Array.isArray(seedWorkspace) ? { ...empty(), plans: seedWorkspace } : clone(seedWorkspace);
      try {
        const legacy = JSON.parse(storage.getItem(LEGACY_KEY) || "[]");
        if (Array.isArray(legacy)) {
          for (const plan of legacy) {
            if (!data.plans.some((item) => item.id === plan.id)) data.plans.push(plan);
          }
        }
      } catch { /* Corrupt legacy data cannot replace the new seed. */ }
      write(data);
    },
  };
}
