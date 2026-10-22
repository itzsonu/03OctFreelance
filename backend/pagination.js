function pagination(query, defaultSize = 20) {
  const number = (key, fallback, max) => {
    const value = query[key];
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value) || Number(value) > max) { const error = new Error(`Invalid ${key}`); error.status = 400; throw error; }
    return Number(value);
  };
  const page = number("page", 1, 10000);
  const pageSize = number("pageSize", defaultSize, 50);
  return { page, pageSize, skip: (page - 1) * pageSize, explicit: query.page !== undefined || query.pageSize !== undefined };
}
const envelope = (items, total, paging, extra = {}) => ({ items, total, page: paging.page, pageSize: paging.pageSize, pages: Math.ceil(total / paging.pageSize), ...extra });
const listResponse = (res, items, total, paging, extra) => res.json(paging.explicit ? envelope(items, total, paging, extra) : items);
const failureStatus = error => error.status || 500;
module.exports = { pagination, envelope, listResponse, failureStatus };
