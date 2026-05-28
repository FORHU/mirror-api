# Garment & Outfit Search API

List endpoints for garments and outfits accept independent, Eloquent-style
search params. Both endpoints AND the search params with each other and with
the existing facet filters.

All responses use the project's standard envelope:

```json
{
  "status": "success",
  "statusCode": 200,
  "data": { "items": [...], "total": 0, "page": 1, "limit": 20, "totalPages": 0 }
}
```

---

## GET /garments

Mounted at:

- `/remote/garments` — user auth (mobile web)
- `/mirror/garments` — kiosk
- `/external/garments` — API-key auth (3rd party)

### Query params

| Param | Type | Notes |
|---|---|---|
| `page` | int | default `1` |
| `limit` | int | default `20`, max `100` |
| `searchGarment` | string | case-insensitive `contains` on `name` **or** `description`. Trimmed; empty/whitespace ignored. |
| `searchGarmentTags` | string | case-insensitive `contains` on any related tag's `name`. |
| `tag` | string | exact tag-name match (existing). |
| `garmentType` | enum / enum[] | `hasSome` on `GARMENT_TYPES`. |
| `fittingSlot` | enum / enum[] | `FITTING_SLOT`. Plural aliases accepted (`headgarments`, `uppergarments`, ...). |
| `category` | enum / enum[] | `hasSome` on `CATEGORY`. |
| `gender` | enum | `GARMENT_GENDER`. |
| `silhouette` | enum | `SILHOUETTE`. |
| `userId` | string | scopes to that user's garments. |
| `systemOnly` | `"true"` | system garments only (`userId IS NULL`); overrides `userId`. |

### Examples

```
GET /mirror/garments?searchGarment=denim
GET /mirror/garments?searchGarmentTags=summer
GET /mirror/garments?searchGarment=jacket&searchGarmentTags=outdoor&page=2&limit=20
GET /mirror/garments?searchGarment=shirt&category=top&gender=UNISEX
```

### Response data shape

```json
{
  "items": [
    {
      "id": "...",
      "name": "...",
      "description": "...",
      "tags": [{ "id": "...", "name": "..." }],
      "file": { "id": "...", "url": "..." }
    }
  ],
  "total": 87,
  "page": 1,
  "limit": 20,
  "totalPages": 5
}
```

### `tag` vs `searchGarmentTags`

Both filter against `Garment.tags`, but with different intent:

- `tag=summer` — exact tag-name equality. Suitable for filter chips.
- `searchGarmentTags=sum` — partial, case-insensitive match. Suitable for a
  search box.

They are independent params; you can supply either, both, or neither.

---

## GET /outfits

Mounted at:

- `/remote/outfits` — user auth (mobile web)
- `/mirror/outfits` — kiosk
- `/external/outfits` — API-key auth (3rd party)

### Query params

| Param | Type | Notes |
|---|---|---|
| `page` | int | default `1` |
| `limit` | int | default `20`, max `100` |
| `searchOutfit` | string | case-insensitive `contains` on outfit's own `name` **or** `description`. |
| `searchOutfitItems` | string | case-insensitive `contains` on any item's garment `name` **or** `description` (via `items.some.garment`). |
| `systemOnly` | `"true"` | system outfits only (`userId = null`); otherwise scoped to the authenticated user. |

Auth-scoping: on `/remote/outfits` and `/mirror/outfits`, results are filtered
to `req.user.id` unless `systemOnly=true`.

### Examples

```
GET /mirror/outfits?searchOutfit=festival
GET /mirror/outfits?searchOutfitItems=denim
GET /mirror/outfits?searchOutfit=summer&searchOutfitItems=jacket
GET /mirror/outfits?systemOnly=true&searchOutfit=classic&page=2
```

### Response data shape

```json
{
  "items": [
    {
      "id": "...",
      "name": "...",
      "description": "...",
      "file": { "id": "...", "url": "..." },
      "items": [
        {
          "garment": {
            "id": "...",
            "name": "...",
            "file": { "id": "...", "url": "..." }
          }
        }
      ]
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 20,
  "totalPages": 3
}
```

### `searchOutfit` vs `searchOutfitItems`

- `searchOutfit` — matches the outfit's own metadata. "Find the outfit named
  *Festival Look*."
- `searchOutfitItems` — matches any garment contained in the outfit. "Find
  outfits that contain a denim jacket."

Independent params; both may be supplied. When both are supplied, an outfit
must satisfy both (AND).

---

## Searching garments: two separate surfaces

Garments can be searched two different ways depending on what you want
returned. They are **not** interchangeable.

### 1. Search the full garment catalog → returns garment rows

```
GET /garments?searchGarment=denim
GET /garments?searchGarmentTags=summer
```

Hits `GarmentRepo.findAll`. Returns `Garment[]` directly, regardless of which
(if any) outfit contains them. Use this for autocomplete, wardrobe browsing,
"find denim items" UIs.

### 2. Search outfits by their contained garments → returns outfit rows

```
GET /outfits?searchOutfitItems=denim
```

Hits `OutfitRepo.findByUserId`. Returns whole outfits where **at least one**
item's garment matches. Use this for "show me outfits that include a denim
piece."

> ⚠️ **`searchOutfitItems` does not filter the `items[]` array.**
>
> The filter is `items: { some: { garment: ... } }` — an existence test on the
> relation, not a projection. The outfit comes back with **all** its items
> intact, including ones that didn't match the search term.

#### Worked example

Outfit `Festival Look` has 3 items: `denim jacket`, `white tee`, `black jeans`.

`GET /outfits?searchOutfitItems=denim` returns:

```json
{
  "id": "...",
  "name": "Festival Look",
  "items": [
    { "garment": { "name": "denim jacket" } },
    { "garment": { "name": "white tee"    } },
    { "garment": { "name": "black jeans"  } }
  ]
}
```

All three items are present. If you only want the *matching garments*, hit
`GET /garments?searchGarment=denim` instead.

### Per-outfit garment search

There is no current endpoint of the form "matching garments inside outfit X."
If you need that:

- **Frontend filter** — `GET /outfits/:id`, then filter `items[]` client-side
  by name match. Cheap, no API change.
- **New endpoint** — `GET /outfits/:id/garments?searchGarment=...`. Only worth
  adding if the item list is large enough to need server-side pagination.

### Quick picker

| You want… | Use |
|---|---|
| A list of garments matching a term | `GET /garments?searchGarment=...` |
| A list of garments matching a tag (fuzzy) | `GET /garments?searchGarmentTags=...` |
| A list of garments matching a tag (exact) | `GET /garments?tag=...` |
| A list of outfits whose name/desc matches | `GET /outfits?searchOutfit=...` |
| A list of outfits that contain a matching garment | `GET /outfits?searchOutfitItems=...` |
| Only the matching items *inside* one outfit | `GET /outfits/:id` + filter client-side |

---

## Breaking changes

The previous single `?q=` param has been **removed** from both endpoints.

| Old | New |
|---|---|
| `GET /garments?q=denim` | `GET /garments?searchGarment=denim` |
| `GET /garments?q=summer` *(intending to match a tag)* | `GET /garments?searchGarmentTags=summer` |
| `GET /outfits?q=festival` | `GET /outfits?searchOutfit=festival` |
| `GET /outfits?q=jacket` *(intending to match a contained garment)* | `GET /outfits?searchOutfitItems=jacket` |

Frontends that continue sending `?q=` will silently receive unfiltered results
— grep clients (`mirror-app`, `mirror-admin`, companion app) before shipping.

---

## Implementation notes

- All search clauses use Prisma's `contains` + `mode: "insensitive"`, which
  maps to Postgres `ILIKE '%term%'`. No leading-wildcard index will be used;
  acceptable at current scale.
- Search terms are trimmed; empty / whitespace-only values are ignored.
- Multiple search params combine via `AND`. Within a single param, the
  candidate columns combine via `OR`.
- For outfit item search the join is `outfit.items.some.garment.{name|description}`
  — equivalent to Eloquent `orWhereHas('items.garment', ...)`.
- For garment tag search the join is `garment.tags.some.name` — equivalent to
  Eloquent `orWhereHas('tags', fn($q) => $q->where('name','like',...))`.

### Future scaling

If outfit/garment volumes grow large enough that `ILIKE '%...%'` scans become
a bottleneck, options:

1. Add a Postgres trigram index (`pg_trgm` extension, `gin_trgm_ops`) on the
   searchable columns.
2. Materialize a denormalized `searchText` column on `Outfit`/`Garment` and
   FTS-index it.

Neither is needed today.
