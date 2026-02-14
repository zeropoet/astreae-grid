ØVEL Build Document
Canvas ↔ Data Structure Bridge (Local-First)
Purpose
ØVEL renders a bounded, expanding cosmological field (Astraea Grid). Node positions are fixed (stratified layers). Interpretation is fluid and computed per wallet as a local overlay. The canvas is not a UI; it is a field renderer driven by a stable data model.

1) System Layers
   1.1 Spatial Layer (Invariant)


Nodes have permanent coordinates (xPosition, yPosition) once placed.


Rings stabilize in layers (strata). Prior rings do not drift.


The boundary is bounded (radius), but can expand by sovereign invocation later.


Canvas effect: nodes do not move; only micro-oscillation and property modulation are allowed.
1.2 Structural Layer (Shared Reality)


Structural edges (relationships) are stored globally (DB).


Rendered always (backbone / skeleton).


Rarely changes.


Canvas effect: structural lines are always visible, forming the persistent map.
1.3 Interpretive Layer (Local Per Wallet)


Semantic edges are not stored globally.


Computed on the client as an overlay:


multi-factor scoring


attunement memory


stability crystallization (local + reversible)




Revealed by vessel proximity.


Canvas effect: semantic lines appear and dissolve as you traverse; each wallet experiences different overlays.
1.4 Vessel Layer (Presence)


Vessel is a traversal body with strong inertia.


Vessel has an aura (soft-body) that expresses attunement.


Vessel influences where interpretation intensifies locally (not global truth).


Canvas effect: the field “responds” near the vessel through semantic bloom and aura resonance.

2) Data Model
   2.1 Node
   Represents a gravitational coordinate in Astraea.
   Minimum fields:


id: string


xPosition: float


yPosition: float


ringIndex: int


isDormant: boolean


embedding: vector/float[] (semantic representation for interpretation)


semanticCandidates: json (optional perf optimization; see section 8)


Invariants:


xPosition, yPosition are fixed after ring layout.


ringIndex defines stratum membership.


2.2 Structural Edge (NodeConnection)
Represents shared non-subjective connections.
Minimum fields:


id: string


fromNodeId: string


toNodeId: string


type: "STRUCTURAL"


weight: float (optional meaning weight)


stability: float (shared backbone stability metric if you keep it)


Rule:


Only structural edges are stored globally for this phase.


2.3 GridState
Represents the current boundary + global field constants.
Minimum fields:


id: string


currentRadius: float


(Expansion mechanics exist conceptually but are out of scope for the vertical slice.)

3) API Contract (Local Runtime)
   All endpoints are served by Next.js API routes.
   3.1 GET /api/nodes
   Returns nodes that are active in the current visible field.
   Response
   [
   {
   "id": "uuid",
   "xPosition": 123.4,
   "yPosition": -44.1,
   "ringIndex": 1,
   "isDormant": false,
   "embedding": [ ... ]
   }
   ]


Performance note: embeddings can be separated into a second endpoint later (see section 8).

3.2 GET /api/structural-edges
Returns the shared backbone edges.
Response
[
{
"fromNodeId": "uuid",
"toNodeId": "uuid",
"type": "STRUCTURAL",
"weight": 0.92,
"stability": 3.4
}
]

3.3 GET /api/grid-state
Returns boundary radius.
Response
{ "currentRadius": 800 }


4) Canvas Engine Responsibilities (p5.js)
   The canvas is responsible for:


Rendering the spatial field (nodes, boundary, background)


Rendering structural edges (always visible)


Rendering semantic edges (local overlay, proximity revealed)


Rendering the vessel (strong inertia)


Rendering aura (soft-body) + coherence events


Running local reinterpretation loop (timed, not in draw loop)


Critical rule: no heavy computations inside draw().
draw() only renders + updates lightweight kinematics.

5) Visual Mapping: Data → Render
   5.1 Background


Subtle radial gradient keyed to field radius.


Non-animated (geological).


5.2 Nodes
Rendered from DB node coordinates:


Position: (xPosition, yPosition)


Size: base + proximity influence (gravityFactor)


Glow: increases with proximity + (optional) structural degree


Node immutability: never change (xPosition, yPosition) at runtime.
5.3 Structural Edges
Rendered from DB structural edges:


Always drawn


Weight/stability may affect opacity and thickness


Visible even in Gate mode


5.4 Semantic Edges (Local Overlay)
Computed on client:


Proximity-revealed only


Fade with distance


Never written to DB


Each wallet sees different edges


5.5 Vessel


Strong inertia movement


Cursor influences acceleration, not direct position


Soft boundary resistance at currentRadius


5.6 Aura


Soft-body spline around vessel


Frequency/amplitude modulated by:


vessel velocity


local semantic density


coherence events (brief synchronization)





6) Local Interpretation Engine (Client-Side)
   Semantic edges are generated as a local overlay using fixed weights:
   6.1 Interpretation Score (Fixed Weights)
   For candidate edge A → B:
   Score =
   0.45 * SemanticSimilarity +
   0.15 * RingProximity +
   0.15 * StructuralDensity +
   0.15 * GravityFactor +
   0.10 * AttunementWeight

Where each term is normalized 0..1.
Threshold: create semantic edge when Score > 0.65
Top-K: limit candidates per node (K=5..7 recommended)
6.2 Term Definitions


SemanticSimilarity: cosine similarity between embeddings


RingProximity: 1 / (abs(ringA - ringB) + 1)


StructuralDensity: degree(node) / maxDegree (computed from structural edges)


GravityFactor: 1 / (distance(vessel, nodeB) + 1) normalized by radius if desired


AttunementWeight: local memory that increases when vessel lingers near nodeB and decays slowly


6.3 Local Stability (Reversible “Crystallization”)
Maintain a local map:


stability[edgeKey] -> float


Update each recompute:


if edge persists: stability += Score * k


decay: stability *= 0.98


prune: keep only top N edges by stability (e.g. N=150)


Rendering: semantic edges with higher local stability can be rendered thicker/brighter (still local).

7) Field Mode Lifecycle (Gate → Awakening → Attuned)
   Even in a local-only build, mode is a render-state machine.
   7.1 Gate Mode (Default Resting Form)


Only structural edges shown


Semantic overlay paused (or suppressed)


Aura amplitude reduced; shape nearly circular


Background slightly compressed (subtle)


7.2 Awakening (Thresholded)
Triggered when first active vessel presence begins (e.g. mouse movement, wallet connect, or explicit “activate”).


short transition (3–5 seconds)


structural edges brighten slightly


aura begins to breathe


semantic engine activates after transition


7.3 Attuned


semantic engine runs every ~3–4s


semantic edges reveal near aura radius


coherence events may trigger aura sync pulses



8) Performance & Scaling Hooks (Planned)
   This build document supports scaling without redesign.
   8.1 Avoid O(N²)
   Do not compare every node against every node.
   Preferred:


spatial filter (within influence radius)


AND candidate prefilter (semanticCandidates) precomputed during ingestion


8.2 Embedding Transfer
If nodes grow:


do not ship embeddings on every /api/nodes call


split into:


GET /api/nodes/basic


GET /api/nodes/embeddings (once per session)




8.3 Render Culling


only render edges where at least one endpoint is near viewport + margin


cap rendered semantic edges to N (e.g. 150)


structural edges should remain moderate; if large, cull by weight or ring scope



9) Ingestion Contract (What must exist before the canvas works)
   For the canvas to render real field data, ingestion must produce:


Nodes with (xPosition, yPosition) and ringIndex


Nodes with embedding


Structural edges (optional in early slice, but preferred)


GridState with currentRadius


Important: the canvas does not ingest. It only renders what the DB already contains.

10) Implementation Checklist (Vertical Slice)
    ✅ DB migrated with Node / NodeConnection / GridState
    ✅ /api/nodes returns active nodes
    ✅ /api/structural-edges returns structural edges
    ✅ /api/grid-state returns radius
    ✅ GridEngine loads those once on setup
    ✅ Semantic overlay computed client-side on interval
    ✅ Structural always visible; semantic proximity-revealed
    ✅ Vessel inertia + aura running
    ✅ Gate → Awakening → Attuned transitions implemented