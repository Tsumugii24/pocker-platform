# GTO Baseline API

This document describes the public-facing API for querying the GTO baseline strategy from the solver data used by this project.

The API is designed for external callers that want a stable JSON interface. It does not run the river LLM exploit flow.

## Endpoint

```http
POST /api/v1/gto-baseline/query
Content-Type: application/json
Authorization: Bearer <api-key>
```

`Authorization` is required only when the server has `GTO_BASELINE_API_KEYS` configured. `X-API-Key: <api-key>` is also accepted.

## Authentication

For public deployment, configure one or more comma-separated keys:

```bash
GTO_BASELINE_API_KEYS=key_1,key_2
```

When this variable is empty, the endpoint is open. That is convenient for local development but should not be used on a public IP.

## Request Body

```json
{
  "board": "Ah,As,Ks",
  "path": ["CHECK", "BET 5"],
  "hand": "QsJh",
  "effective_stack": 95,
  "datasetSource": "default",
  "use_mdf": false,
  "sample": true
}
```

### Fields

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `board` | string | Yes | Community cards currently visible, comma-separated. The flop must be present. Examples: `Ah,As,Ks`, `Ah,As,Ks,Qh`, `Ah,As,Ks,Qh,Tc`. |
| `path` | string[] | Yes | Action path from the flop root to the target node. Use an empty array for the root action node. |
| `hand` | string | Yes | Queried hole cards, four characters, rank+suit per card. Example: `QsJh`. |
| `effective_stack` | number | No | Remaining effective stack from the caller's table state. Used to cap sampled bet or raise sizes. |
| `datasetSource` | string | No | Preferred configured dataset source for automatic missing-board downloads. |
| `use_mdf` | boolean | No | When `true`, allows the same flop MDF override used by the internal opponent decision path. Default: `false`. |
| `sample` | boolean | No | When `true`, returns a sampled baseline action. When `false`, only returns the distribution. Default: `true`. |

## Path Encoding

The solver tree starts from the flop. Preflop actions are not included.

This is a stateless replay API: the server does not keep a hand session for the caller. Every request must include the full action path from the flop root to the node being queried, even when the query is on the turn or river.

The backend uses that full path to reconstruct the current state:

1. It loads the canonical flop parquet file.
2. It replays all flop actions from the root.
3. When it reaches `DEAL:<turn>`, it takes the range, pot, and stack state from the flop end node, exports a turn solver config, runs or reuses the realtime turn result, and switches the query tree to that turn result.
4. It continues replaying turn actions.
5. When it reaches `DEAL:<river>`, it repeats the same process from the turn end node to build or reuse the realtime river result.

Because of this, turn and river calls must not send only the actions from the current street. They must include the previous street actions needed to derive the range and pot for realtime solving.

`effective_stack` is still accepted from the caller and is used as the final remaining-stack cap for sampled bet or raise actions. The solver state itself is reconstructed primarily from the initial config plus the full path.

Use these action formats:

| Situation | Path Item |
| --- | --- |
| Check | `CHECK` |
| Call | `CALL` |
| Fold | `FOLD` |
| Bet | `BET <amount>` |
| Raise | `RAISE <amount>` |
| Donk bet, when present in the tree | `DONK <amount>` |
| Turn or river card | `DEAL:<card>` |

Examples:

```json
[]
```

```json
["CHECK", "BET 5", "CALL", "DEAL:Qh", "CHECK"]
```

Bet and raise amounts may be continuous real table amounts. The backend maps them to the nearest discrete solver action available at that node.

## Street Examples

### Flop Query

Use this when querying the flop root or a later flop node. The path starts at the flop root and contains only flop actions.

```bash
curl -X POST "https://your-domain.example/api/v1/gto-baseline/query" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer key_1" \
  -d '{
    "board": "Ah,As,Ks",
    "path": [],
    "hand": "QsJh",
    "effective_stack": 100,
    "sample": false
  }'
```

For a flop node after action has occurred:

```json
{
  "board": "Ah,As,Ks",
  "path": ["CHECK", "BET 5", "CALL"],
  "hand": "QsJh",
  "effective_stack": 95,
  "sample": false
}
```

The backend only needs the flop parquet file for this query unless the path reaches a `DEAL:<turn>` chance node.

### Turn Query

Use this when the turn card has been dealt. The path still begins at the flop root, includes the flop actions, then includes `DEAL:<turn>`, followed by any turn actions that already happened.

```bash
curl -X POST "https://your-domain.example/api/v1/gto-baseline/query" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer key_1" \
  -d '{
    "board": "Ah,As,Ks,Qh",
    "path": ["CHECK", "BET 5", "CALL", "DEAL:Qh"],
    "hand": "QsJh",
    "effective_stack": 95,
    "sample": false
  }'
```

For a turn node after one turn action:

```json
{
  "board": "Ah,As,Ks,Qh",
  "path": ["CHECK", "BET 5", "CALL", "DEAL:Qh", "CHECK"],
  "hand": "QsJh",
  "effective_stack": 95,
  "sample": false
}
```

When replay reaches `DEAL:Qh`, the backend uses the flop end node's ranges, pot, and stack state to create or reuse the matching realtime turn solve result.

### River Query

Use this when the river card has been dealt. The path includes the full flop line, the turn deal, the full turn line, then `DEAL:<river>`, followed by any river actions that already happened.

```bash
curl -X POST "https://your-domain.example/api/v1/gto-baseline/query" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer key_1" \
  -d '{
    "board": "Ah,As,Ks,Qh,Tc",
    "path": [
      "CHECK", "BET 5", "CALL",
      "DEAL:Qh",
      "CHECK", "BET 12", "CALL",
      "DEAL:Tc"
    ],
    "hand": "QsJh",
    "effective_stack": 83,
    "sample": false
  }'
```

For a river node after one river action:

```json
{
  "board": "Ah,As,Ks,Qh,Tc",
  "path": [
    "CHECK", "BET 5", "CALL",
    "DEAL:Qh",
    "CHECK", "BET 12", "CALL",
    "DEAL:Tc",
    "CHECK"
  ],
  "hand": "QsJh",
  "effective_stack": 83,
  "sample": false
}
```

When replay reaches `DEAL:Tc`, the backend uses the turn end node's ranges, pot, and stack state to create or reuse the matching realtime river solve result.

## Successful Response

```json
{
  "status": "ok",
  "baseline_available": true,
  "sampled": true,
  "sampled_action": "BET 5",
  "action": "BET 5",
  "actions": ["CHECK", "BET 5"],
  "strategy": {
    "CHECK": 0.25,
    "BET 5": 0.75
  },
  "evs": {
    "CHECK": 0.1,
    "BET 5": 0.6
  },
  "decision_source": "gto_exact",
  "decision_detail": "Used the exact queried hand from the GTO strategy.",
  "strategy_hand_used": "QsJh",
  "node_type": "action_node",
  "board": "Ah,As,Ks",
  "actual_flop_board": "Ah,As,Ks",
  "canonical_flop_board": "Ac,Ad,Kc",
  "actual_path": "ROOT -> CHECK -> BET 4.8",
  "query_path": "ROOT -> CHECK -> [BET 5]",
  "pot": 10,
  "remaining_stack": 95
}
```

When `sample` is `false`, `sampled_action` and `action` are `null`; `strategy`, `actions`, and `evs` are still returned.

### Decision Sources

| Value | Meaning |
| --- | --- |
| `gto_exact` | The queried hand was found directly in the GTO strategy table. |
| `gto_proxy_hand` | The queried hand was missing, so a proxy hand from the acting range was used. |
| `mdf_override` | A sampled decision was overridden by the optional flop MDF rule. |
| `fallback_default` | No usable strategy was available; the backend returned its conservative fallback. |

## Error Responses

```json
{
  "error": "Unauthorized"
}
```

Common status codes:

| Status | Meaning |
| --- | --- |
| `400` | Missing or invalid request fields, invalid board, invalid path action, hand conflicts with board, or invalid boolean field. |
| `401` | `GTO_BASELINE_API_KEYS` is configured and the request did not provide a matching key. |
| `404` | Solver data or config was not found, or the path did not resolve to an action node. |
| `500` | Realtime solver execution, file loading, or unexpected backend error failed. |

## Curl Example

```bash
curl -X POST "https://your-domain.example/api/v1/gto-baseline/query" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer key_1" \
  -d '{
    "board": "Ah,As,Ks",
    "path": [],
    "hand": "QsJh",
    "sample": false
  }'
```

## Deployment Notes

For a public IP deployment:

1. Run the Flask app behind a production WSGI server such as Gunicorn on Linux or Waitress on Windows.
2. Put Nginx or Caddy in front for HTTPS, request size limits, access logs, and rate limiting.
3. Configure `GTO_BASELINE_API_KEYS`; do not expose the endpoint unauthenticated.
4. Keep `ai/gto/cache/dataset` on persistent storage so downloaded parquet files survive restarts.
5. Monitor `ai/gto/cache/results` disk usage, because turn and river realtime solves can create additional output files.
6. Avoid `debug=True` in production. Use process supervision such as systemd, Docker, or a hosting platform process manager.
