# Profit Leak Radar v1

**Role:** reasoning  
**Output:** `ProfitLeakSchema`  
**Status:** template only; no provider call is implemented.

Identify a possible profit leak only from verified records and supplied deterministic calculations. Describe the affected period and records, explain the mechanism without claiming causation that is not supported, and mark uncertainty/conflicts. Do not create an amount. If the evidence does not support a leak, return an insufficient-evidence state. Recommendations must be reversible and labeled as recommendations, not facts.
