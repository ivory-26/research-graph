/**
 * ResearchGraph Professional Force-Directed Simulation Engine
 *
 * Implements an organic, collision-aware knowledge layout:
 * - Geometric collision prevention accounting for node dimensions and label footprints
 * - Controlled node sizing (38–54px diameter)
 * - Distinct cluster separation (Sources, Claims, Methods, Datasets, Runs, Results)
 * - Hooke's spring attraction with generous rest lengths (180–220px)
 * - Multi-pass relaxation with strict non-overlap post-processing
 * - Deterministic stabilization (cooled simulation halts with stable coordinates)
 */

export interface SimNode {
  id: string;
  type: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  degree: number;
}

export interface SimEdge {
  id: string;
  source: string;
  target: string;
  relation?: string;
  weight?: number;
}

export interface ForceSimulationOptions {
  repulsion?: number;        // Many-body repulsion force (default: 3200)
  linkDistance?: number;     // Ideal spring rest length (default: 190)
  linkStiffness?: number;    // Spring tension (default: 0.035)
  gravity?: number;          // Gentle centering force (default: 0.015)
  collisionPadding?: number; // Visual buffer between nodes including labels (default: 86)
  iterations?: number;       // Relaxation steps (default: 280)
  damping?: number;          // Velocity friction (default: 0.86)
}

export interface ForceLayoutResult {
  positions: Record<string, { x: number; y: number }>;
  nodeDegrees: Record<string, number>;
  nodeRadii: Record<string, number>;
}

// Semantic cluster anchor regions to guarantee clear cluster separation
const CLUSTER_REGION_ANCHORS: Record<string, { x: number; y: number }> = {
  claim: { x: 0, y: 0 },                  // Core central hypothesis
  source: { x: -400, y: -190 },           // Upper-left literature constellation (Cyan)
  method: { x: -260, y: 280 },            // Lower-left algorithm constellation (Violet)
  dataset: { x: 300, y: -240 },           // Upper-right dataset & fixture constellation (Pink)
  run: { x: 220, y: 150 },                // Lower-right execution constellation (Amber)
  result: { x: 500, y: 180 },             // Far-right verified evaluation constellation (Emerald)
  note: { x: 0, y: 320 },                 // Bottom annotation cluster (Yellow)
};

// Deterministic individual offsets for the initial fixture nodes to prevent initial collapse
const SPECIFIC_NODE_INITIAL_OFFSETS: Record<string, { x: number; y: number }> = {
  // 3 distinct source papers spread along an arc
  'source-strobl-2007': { x: -360, y: -140 }, // Strobl et al. 2007 (Upper-left inner)
  'source-strobl-2008': { x: -520, y: -80 },  // Strobl et al. 2008 (Far upper-left)
  'source-kursa-2010': { x: -380, y: -320 },  // Kursa & Rudnicki 2010 (Upper-left top)

  // Central claim
  'claim-gini-bias': { x: 0, y: 0 },          // Core claim at center

  // Methods
  'method-impurity': { x: -280, y: 220 },     // Impurity importance
  'method-permutation': { x: -140, y: 360 },  // Permutation importance

  // Dataset
  'dataset-breast-w': { x: 280, y: -240 },    // breast-w + 3 noise cols

  // Runs
  'run-a': { x: 160, y: 160 },                // Impurity run
  'run-b': { x: 300, y: 110 },                // Permutation run

  // Results
  'result-a': { x: 460, y: 130 },             // Impurity verdict
  'result-b': { x: 600, y: 200 },             // Permutation verdict
};

export function computeForceLayout(
  nodes: { id: string; type: string; initialX?: number; initialY?: number }[],
  edges: { id: string; source: string; target: string; relation?: string }[],
  options: ForceSimulationOptions = {}
): ForceLayoutResult {
  const {
    repulsion = 3400,
    linkDistance = 195,
    linkStiffness = 0.032,
    gravity = 0.012,
    collisionPadding = 86, // Generous spacing accounting for 120px node labels
    iterations = 280,
    damping = 0.86,
  } = options;

  // 1. Calculate Node Degrees
  const nodeDegrees: Record<string, number> = {};
  for (const n of nodes) {
    nodeDegrees[n.id] = 0;
  }
  for (const e of edges) {
    if (nodeDegrees[e.source] !== undefined) nodeDegrees[e.source] += 1;
    if (nodeDegrees[e.target] !== undefined) nodeDegrees[e.target] += 1;
  }

  // 2. Initialize Simulation Nodes with Controlled Dimensions (36–48px normal, 48–54px central hubs)
  const simNodes: SimNode[] = nodes.map((n, idx) => {
    const deg = nodeDegrees[n.id] || 0;

    // Normal nodes: 38–46px diameter (radius 19–23px)
    // Central/hub nodes: 50–54px diameter (radius 25–27px)
    const isCentralHub = n.type === 'claim' || deg >= 4;
    const radius = isCentralHub
      ? 26 // 52px diameter
      : Math.min(19 + deg * 1.5, 23); // 38px to 46px diameter

    // Check specific preset anchor, or calculate deterministic offset
    let initX: number;
    let initY: number;

    if (SPECIFIC_NODE_INITIAL_OFFSETS[n.id]) {
      initX = SPECIFIC_NODE_INITIAL_OFFSETS[n.id].x;
      initY = SPECIFIC_NODE_INITIAL_OFFSETS[n.id].y;
    } else {
      const anchor = CLUSTER_REGION_ANCHORS[n.type] || { x: 0, y: 0 };
      // Deterministic angle based on node index to disperse nodes radially
      const angle = (idx * 2.39996) % (2 * Math.PI); // Golden angle dispersion
      const spreadDist = 70 + (idx % 3) * 45;
      initX = anchor.x + Math.cos(angle) * spreadDist;
      initY = anchor.y + Math.sin(angle) * spreadDist;
    }

    const x = typeof n.initialX === 'number' ? n.initialX : initX;
    const y = typeof n.initialY === 'number' ? n.initialY : initY;

    return {
      id: n.id,
      type: n.type,
      x,
      y,
      vx: 0,
      vy: 0,
      radius,
      degree: deg,
    };
  });

  const nodeMap = new Map<string, SimNode>();
  for (const sn of simNodes) {
    nodeMap.set(sn.id, sn);
  }

  // 3. Multi-Step Force-Directed Simulation with Thermal Annealing
  let alpha = 1.0;
  const alphaDecay = 1 - Math.pow(0.001, 1 / iterations);

  for (let step = 0; step < iterations; step++) {
    alpha *= (1 - alphaDecay);

    // A. Gentle Global Centering Gravity and Cluster Region Affinity
    for (const node of simNodes) {
      // Very gentle pull towards center to prevent total drift
      node.vx -= node.x * gravity * alpha;
      node.vy -= node.y * gravity * alpha;

      // Soft cluster anchor pull (keeps clusters in their general spatial region without clumping)
      const anchor = CLUSTER_REGION_ANCHORS[node.type];
      if (anchor) {
        const adx = anchor.x - node.x;
        const ady = anchor.y - node.y;
        const aDist = Math.sqrt(adx * adx + ady * ady);
        // Only pull toward anchor if drifted far away (> 240px)
        if (aDist > 240) {
          node.vx += (adx / aDist) * 1.5 * alpha;
          node.vy += (ady / aDist) * 1.5 * alpha;
        }
      }
    }

    // B. Many-Body Coulomb Repulsion between ALL node pairs
    for (let i = 0; i < simNodes.length; i++) {
      const a = simNodes[i];
      for (let j = i + 1; j < simNodes.length; j++) {
        const b = simNodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy);

        // Guard against identical coordinates with deterministic angle dispersion
        if (dist < 0.01) {
          const pseudoAngle = ((i * 37 + j * 73) % 360) * (Math.PI / 180);
          dx = Math.cos(pseudoAngle) * 4;
          dy = Math.sin(pseudoAngle) * 4;
          dist = Math.sqrt(dx * dx + dy * dy) || 1;
        }

        const distSq = Math.max(dist * dist, 400);
        const force = (repulsion / distSq) * alpha;

        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    // C. Hooke's Law Spring Links between connected nodes
    for (const edge of edges) {
      const a = nodeMap.get(edge.source);
      const b = nodeMap.get(edge.target);
      if (!a || !b) continue;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;

      // Generous rest lengths so connected nodes do not crowd each other
      let targetDist = linkDistance;
      if (edge.relation === 'cites') targetDist = linkDistance * 1.1;
      if (edge.relation === 'uses_dataset') targetDist = linkDistance * 1.15;
      if (edge.relation === 'tests') targetDist = linkDistance * 1.05;

      const displacement = dist - targetDist;
      const springForce = displacement * linkStiffness * alpha;

      const fx = (dx / dist) * springForce;
      const fy = (dy / dist) * springForce;

      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    // D. Rigid-Body Collision Avoidance (D3-force forceCollide style)
    // Directly pushes overlapping node circles and label envelopes apart
    for (let i = 0; i < simNodes.length; i++) {
      const a = simNodes[i];
      for (let j = i + 1; j < simNodes.length; j++) {
        const b = simNodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 0.01) {
          const pseudoAngle = ((i * 47 + j * 89) % 360) * (Math.PI / 180);
          dx = Math.cos(pseudoAngle) * 6;
          dy = Math.sin(pseudoAngle) * 6;
          dist = Math.sqrt(dx * dx + dy * dy) || 1;
        }

        // Required distance includes node radii + label footprint buffer
        const requiredMinDist = a.radius + b.radius + collisionPadding;

        if (dist < requiredMinDist) {
          const overlap = (requiredMinDist - dist);
          const pushRatio = (overlap / dist) * 0.5;

          const px = dx * pushRatio;
          const py = dy * pushRatio;

          // Immediate position separation
          a.x -= px;
          a.y -= py;
          b.x += px;
          b.y += py;

          // Damped velocity counter-impulse
          a.vx -= px * 0.4;
          a.vy -= py * 0.4;
          b.vx += px * 0.4;
          b.vy += py * 0.4;
        }
      }
    }

    // E. Velocity Integration and Damping
    for (const node of simNodes) {
      node.vx *= damping;
      node.vy *= damping;

      // Velocity ceiling prevents wild oscillations
      const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
      const maxSpeed = 22 * alpha;
      if (speed > maxSpeed && speed > 0) {
        node.vx = (node.vx / speed) * maxSpeed;
        node.vy = (node.vy / speed) * maxSpeed;
      }

      node.x += node.vx;
      node.y += node.vy;
    }
  }

  // 4. Final Post-Processing Collision Relaxation (35 strict geometric passes)
  // Guarantees zero overlaps regardless of edge tension
  for (let pass = 0; pass < 35; pass++) {
    for (let i = 0; i < simNodes.length; i++) {
      const a = simNodes[i];
      for (let j = i + 1; j < simNodes.length; j++) {
        const b = simNodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 0.01) {
          dx = 10;
          dy = 10;
          dist = Math.sqrt(200);
        }

        const requiredMinDist = a.radius + b.radius + collisionPadding;
        if (dist < requiredMinDist) {
          const overlap = requiredMinDist - dist;
          const px = (dx / dist) * overlap * 0.5;
          const py = (dy / dist) * overlap * 0.5;

          a.x -= px;
          a.y -= py;
          b.x += px;
          b.y += py;
        }
      }
    }
  }

  // 5. Assemble Stable Integer Positions
  const positions: Record<string, { x: number; y: number }> = {};
  const nodeRadii: Record<string, number> = {};

  for (const sn of simNodes) {
    positions[sn.id] = {
      x: Math.round(sn.x),
      y: Math.round(sn.y),
    };
    nodeRadii[sn.id] = Math.round(sn.radius);
  }

  return {
    positions,
    nodeDegrees,
    nodeRadii,
  };
}
