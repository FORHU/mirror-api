# Cosmetics Recommendation Engine — Evaluation Report

This report evaluates the scoring and ranking behavior of the **Cosmetics & Skincare Recommendation Engine** (`src/utils/cosmetics.util.ts`). To perform this evaluation, we created and executed a high-fidelity diagnostic script ([evaluate-cosmetics.ts](file:///c:/Users/devrm/Documents/GitHub/mirror/mirror-api/src/scripts/evaluate-cosmetics.ts)) loaded with a diverse mock product catalog and simulated user profiles.

---

## 🔬 Evaluation Scenarios & Results

We tested the engine against **5 distinct user profiles** representing varied skin types, environmental conditions, and specific aesthetic concerns.

````carousel
### Scenario 1: Hot & Humid (Extreme Oily Need)
* **User Profile**: Oily skin, 55% Hydration, 85% Oiliness, concerns: `["enlarged pores on cheeks", "greasy t-zone", "oiliness"]`
* **Weather**: Hot & Humid (Oil Risk 80, Sweat Risk 80, Smudge Risk 70)

| Rank | Product | Score | Key Triggered Signals |
| :--- | :--- | :--- | :--- |
| **1** | Pore-Tightening Niacinamide Toner (Clarify) | **100/100** | `skin_oilFree` (+15), `skin_finish` (+10), `concern_Oiliness_type` (+20), `concern_Enlarged pores_type` (+20), `weather_oil` (+10) |
| **2** | Oil-Free Matte Gel Lotion (Clarify) | **98/100** | `skin_oilFree` (+15), `skin_finish` (+10), `concern_Oiliness_oilFree` (+20), `high_oiliness` (+5), `weather_oil` (+10) |
| **3** | Ultra Shield Sunscreen SPF 50+ (SolarGuard) | **84/100** | `skin_oilFree` (+15), `concern_Oiliness_oilFree` (+20), `weather_sweat` (+8), `weather_smudge` (+8) |

> [!NOTE]
> The engine perfectly selected the matte-finish, oil-free toner and moisturizer as top matches, while heavily scoring the sunscreen due to sweat/smudge weatherproof risks.

<!-- slide -->
### Scenario 2: Cold & Dry (Extreme Hydration Need)
* **User Profile**: Dry skin, 25% Hydration, 15% Oiliness, concerns: `["dry and tight skin", "fine lines around eyes", "wrinkles"]`
* **Weather**: Cold & Dry (Dryness Risk 90, UV Risk 10)

| Rank | Product | Score | Key Triggered Signals |
| :--- | :--- | :--- | :--- |
| **1** | Deep Moisture Rich Cream (HydraPure) | **100/100** (Clamped) | `skin_hydrating` (+15), `concern_Mild dehydration` (+48), `concern_Fine lines` (+30), `low_hydration` (+5), `weather_dry` (+10) |
| **2** | Oil-Free Gel Lotion (Clarify) | **100/100** (Clamped) | `skin_hydrating` (+15), `concern_Mild dehydration` (+40), `concern_Fine lines` (+30), `low_hydration` (+5), `weather_dry` (+10) |
| **3** | Youth Bounce Retinol Night Serum | **100/100** (Clamped) | `skin_hydrating` (+15), `concern_Mild dehydration` (+40), `concern_Fine lines` (+40), `weather_dry` (+10) |

> [!WARNING]
> **Score Saturation Alert**: Due to the severe conditions (Dry skin + Cold/Dry environment + Dehydration + Wrinkles), **four separate products hit the 100/100 clamp threshold**. This results in a loss of sorting resolution between different premium treatments.

<!-- slide -->
### Scenario 3: High UV Exposure (Sensitive Skin)
* **User Profile**: Sensitive skin, 40% Hydration, 30% Oiliness, concerns: `["redness on cheeks", "uneven skin tone", "dark spot"]`
* **Weather**: Sunny & Bright (UV Risk 85, Dryness Risk 50)

| Rank | Product | Score | Key Triggered Signals |
| :--- | :--- | :--- | :--- |
| **1** | Ultra Shield Sunscreen SPF 50+ (SolarGuard) | **57/100** | `concern_Uneven skin tone_spf` (+15), `concern_Uneven skin tone_type` (+20), `weather_uv` (+12) |
| **2** | Deep Moisture Rich Cream (HydraPure) | **52/100** | `skin_hydrating` (+10), `concern_Sensitivity_type` (+20), `concern_Sensitivity_tag` (+10) |
| **3** | Centella Soothing Milky Cleanser | **52/100** | `skin_hydrating` (+10), `concern_Sensitivity_type` (+20), `concern_Sensitivity_tag` (+10) |

> [!TIP]
> The sunscreen scored high for uneven skin tone + extreme UV risk. The soothing cream/cleanser scored high because they contain sensitive-friendly tags (`centella`, `ceramide`, `oatmeal`).

<!-- slide -->
### Scenario 4: Mild Dehydration (No Weather Data)
* **User Profile**: Normal skin, 45% Hydration, 40% Oiliness, concerns: `["feeling slightly tight and dehydrated"]`
* **Weather**: None (Sentinel-style baseline evaluation)

| Rank | Product | Score | Key Triggered Signals |
| :--- | :--- | :--- | :--- |
| **1** | Deep Moisture Rich Cream (HydraPure) | **49/100** | `concern_Mild dehydration_hydrating` (+20), `concern_Mild dehydration_type` (+20) |
| **2** | C-Glow Radiance Serum (Aura) | **49/100** | `concern_Mild dehydration` (+48), `low_hydration` (+1) |
| **3** | Snail Mucin Hydrating Essence | **49/100** | `concern_Mild dehydration` (+48), `low_hydration` (+1) |

> [!NOTE]
> In the absence of weather context, the engine isolates the continuous signal of `low_hydration` (<50%) and concern-keywords to safely rank hydration-oriented options without skewing results.
````

---

## 📈 Key Findings & Architectural Insights

### 1. The Clamping Saturation Problem (Resolution Loss)
In high-need scenarios (e.g. Dry skin + Cold/Dry Weather + Aging Concerns), scores accumulate very rapidly:
$$\text{Score} = \text{Skin Base} + \text{Concern Rules} + \text{Continuous Percentages} + \text{Weather Risks}$$
Because the engine clamps the output strictly between $[0, 100]$, multiple highly specialized products end up at a flat **100/100**. This makes their final ranking dependent purely on database query order.

### 2. Substring Matching Robustness
The concern rules match text based on regular expressions (e.g. `/dehydrat|dry|tight/i`). This works exceptionally well for open-ended AI skin analysis responses, but it highlights the need for a **strict tag vocabulary** in `CosmeticProduct.tags` (e.g., matching `"niacinamide"` or `"vitamin c"` regardless of case).

### 3. Continuous vs. Categorical Signals
The linear adjustments for hydration/oiliness percentages act as excellent tie-breakers:
* $\text{low\_hydration} = (50 - \text{hydrationPct}) / 5$
* $\text{high\_oiliness} = (\text{oilinessPct} - 60) / 5$
This provides organic, fluid adjustments that categorical rules can't achieve alone.

---

## 🛠️ Actionable Recommendations

To optimize the engine, we recommend the following enhancements:

### Recommendation A: Introduce "Soft Clamping" or Weighted Norms
Instead of a hard ceiling at 100, we could use a logarithmic decay or soft cap once scores exceed 80, keeping the final output bounded while maintaining distinct rankings:
```typescript
if (score > 80) {
  score = 80 + (score - 80) * 0.5; // Bounded but preserves ranking resolution
}
```

### Recommendation B: Seed Catalog Realignment
Ensure the production database catalog is seeded with products populated with:
* Lowercased `tags` matching active ingredients (e.g., `["ceramide", "niacinamide", "salicylic acid"]`).
* Correct `type` enums (e.g., `SUNSCREEN`, `MOISTURIZER`) to trigger the type-based bonuses (+20).
* Specific finish details (`MATTE`, `DEWY`, `NATURAL`).
