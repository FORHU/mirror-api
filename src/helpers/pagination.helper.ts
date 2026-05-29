/**
 * Pagination helpers. Parses query params into safe ints, formats list
 * results into the nested envelope shape used by the response helper.
 *
 * ── Usage (new code, no repo today) ─────────────────────────────────────
 *
 *   import { parsePagination, buildPage } from "../helpers/pagination.helper";
 *   import { responseSuccess } from "../helpers/response.helper";
 *
 *   const { page, limit, skip } = parsePagination(req.query);
 *   const [items, total] = await Promise.all([
 *     prisma.thing.findMany({ where, skip, take: limit }),
 *     prisma.thing.count({ where }),
 *   ]);
 *   return responseSuccess(res, 200, buildPage(items, total, { page, limit }));
 *
 * ── Usage (existing repos that already return `{ data, total, page, limit }`) ──
 *
 *   import { pageFromRepo } from "../helpers/pagination.helper";
 *   import { responseSuccess } from "../helpers/response.helper";
 *
 *   const result = await OutfitService.getUserOutfits(userId, req.query);
 *   return responseSuccess(res, 200, pageFromRepo(result));
 *
 * ── Response shape ──────────────────────────────────────────────────────
 *
 *   {
 *     "status": "success",
 *     "statusCode": 200,
 *     "data": {
 *       "items":      [ ... ],
 *       "total":      87,
 *       "page":       1,
 *       "limit":      20,
 *       "totalPages": 5
 *     }
 *   }
 *
 * ── Defaults ────────────────────────────────────────────────────────────
 *   page  → 1
 *   limit → 20  (clamped to maxLimit = 100)
 *
 *   parsePagination(req.query, { limit: 50, maxLimit: 200 })  // override
 */

export interface PaginationParams {
  page: number;
  limit: number;
  skip: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  search?: string;
  filters?: Record<string, any>;
}

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  search?: string;
  filters?: Record<string, any>;
}

const DEFAULTS = { page: 1, limit: 20, maxLimit: 100 };

/**
 * Reads `page` / `limit` from `req.query`, clamps to sane bounds, returns
 * `{ page, limit, skip }` ready to hand to Prisma.
 */
export function parsePagination(
  query: Record<string, any> | undefined | null,
  opts: Partial<typeof DEFAULTS> = {}
): PaginationParams {
  const { page: defPage, limit: defLimit, maxLimit } = { ...DEFAULTS, ...opts };

  const rawPage = parseInt(String(query?.page), 10);
  const rawLimit = parseInt(String(query?.limit), 10);

  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : defPage;
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, maxLimit) : defLimit;

  let sortBy: string | undefined;
  let sortOrder: "asc" | "desc" | undefined;
  let search: string | undefined;
  const filters: Record<string, any> = {};

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (key === "sortBy") {
        sortBy = String(value);
      } else if (key === "sortOrder") {
        const lower = String(value).toLowerCase();
        sortOrder = lower === "desc" ? "desc" : lower === "asc" ? "asc" : undefined;
      } else if (key === "search") {
        search = String(value);
      } else if (key !== "page" && key !== "limit") {
        filters[key] = value;
      }
    }
  }

  return {
    page,
    limit,
    skip: (page - 1) * limit,
    sortBy,
    sortOrder,
    search,
    filters: Object.keys(filters).length ? filters : undefined,
  };
}

/**
 * Formats a Prisma findMany + count result into the standard page envelope.
 *
 *   const { skip, limit, page } = parsePagination(req.query);
 *   const [items, total] = await Promise.all([
 *     prisma.thing.findMany({ skip, take: limit }),
 *     prisma.thing.count(),
 *   ]);
 *   return paginated(res, buildPage(items, total, { page, limit }));
 */
export function buildPage<T>(
  items: T[],
  total: number,
  params: {
    page: number;
    limit: number;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    search?: string;
    filters?: Record<string, any>;
  }
): PageResult<T> {
  return {
    items,
    total,
    page: params.page,
    limit: params.limit,
    totalPages: params.limit > 0 ? Math.ceil(total / params.limit) : 0,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
    search: params.search,
    filters: params.filters,
  };
}

/**
 * Adapter for repos that already return `{ data, total, page, limit }`.
 * Maps `data → items` and adds `totalPages` so existing services don't need
 * to change.
 */
export function pageFromRepo<T>(result: {
  data: T[];
  total: number;
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  search?: string;
  filters?: Record<string, any>;
}): PageResult<T> {
  return buildPage(result.data, result.total, {
    page: result.page,
    limit: result.limit,
    sortBy: result.sortBy,
    sortOrder: result.sortOrder,
    search: result.search,
    filters: result.filters,
  });
}
