"use client"

import React from "react"
import { useEffect, useRef, useState } from "react"
import type p5 from "p5"
import { interpretationScore } from "@/lib/interpretation"
import {
    FIELD_CONFIG,
    JUPITER_MASS_EARTHS,
    PLANETARY_BODIES
} from "@/lib/field/config"
import {
    createSphereState,
    resizeSphere,
    samplePlanetaryForce,
    sampleShell,
    sphericalContainment,
    updateSphereCenter,
    type SphereState
} from "@/lib/field/sphere"
import { resolveFieldSeed } from "@/lib/field/seed"
import type {
    GridStateRecord,
    NodeRecord,
    StructuralEdgeRecord
} from "@/lib/types"

type SemanticEdge = {
    from: string
    to: string
    weight: number
    stability: number
}

type ProjectedNode = {
    x: number
    y: number
    scale: number
    depth: number
    force: number
}

type StabilizedNode = {
    x: number
    y: number
    vx: number
    vy: number
}

type MicroSphereParticle = {
    x: number
    y: number
    vx: number
    vy: number
    phase: number
    magnitude: number
}

type CoreInteractionMode =
    | "attract_primary"
    | "attract_shadow"
    | "shear_orbit"
    | "turbulence_kick"

type CoreInteractionProfile = {
    mode: CoreInteractionMode
    fx: number
    fy: number
}

type MetaNode = {
    id: string
    row: number
    col: number
    x: number
    y: number
    energy: number
    coherence: number
    focus: number
}

type MetaBias = {
    phaseDrift: number
    pressureBias: number
    shearX: number
    shearY: number
    iconDrive: number
}

type CenterMode = "memory" | "attractor"

export default function GridEngine() {
    const containerRef = useRef<HTMLDivElement>(null)
    const [loadError, setLoadError] = useState<string | null>(null)
    const reloadSeedRef = useRef(Math.random())

    useEffect(() => {
        let semanticTimer: ReturnType<typeof setInterval> | null = null
        let instance: p5 | null = null
        let cancelled = false

        const sketch = (p: p5) => {
            const reloadSeed = resolveFieldSeed(reloadSeedRef.current)
            reloadSeedRef.current = reloadSeed
            let nodes: NodeRecord[] = []
            let structuralEdges: StructuralEdgeRecord[] = []
            let nodeById = new Map<string, NodeRecord>()
            let depthById: Record<string, number> = {}
            let localSemanticEdges: SemanticEdge[] = []
            let structuralNeighbors = new Map<string, string[]>()
            let strainByEdgeKey: Record<string, number> = {}
            let delayedConnectorByNode: Record<string, number> = {}
            let focusFieldByNode: Record<string, number> = {}
            let microSpheres: MicroSphereParticle[] = []
            let shadowMicroSpheres: MicroSphereParticle[] = []
            let coreInteractionById: Record<string, CoreInteractionProfile> = {}
            let nextCoreInteractionShuffleMs = 0
            let iconHubNodeId = ""
            let metaNodes: MetaNode[] = []
            let metaRows = 3
            let metaCols = 3
            let localMetaNodeId = "m-1-1"
            let metaBias: MetaBias = {
                phaseDrift: 0,
                pressureBias: 0,
                shearX: 0,
                shearY: 0,
                iconDrive: 0
            }
            let metaPhase = 0
            let centerMode: CenterMode = "memory"
            let centerModeClockMs = 0
            let centerModeDurationMs = 9500

            let vessel = {
                x: 0,
                y: 0,
                vx: 0,
                vy: 0
            }

            let attunement: Record<string, number> = {}
            let structuralDegree: Record<string, number> = {}
            let localStability: Record<string, number> = {}
            let stabilizedById: Record<string, StabilizedNode> = {}
            let maxDegree = 1
            let gridRows = 8
            let gridCols = 8
            let auraPhase = 0
            let forcePhase = 0
            let semanticDensity = 0
            let warmPressure = 0
            let warmHoldMs = 0
            let eventPhase: "idle" | "ignite" | "hold" | "release" | "residue" = "idle"
            let eventClockMs = 0
            let eventGain = 0
            let silenceMs = 0
            let silenceCooldownMs = 0
            let eventActivity = 0
            let lastFrameMs = 0
            let lastDeltaSec = 1 / 60
            let sphere: SphereState = createSphereState(
                reloadSeed,
                window.innerWidth,
                window.innerHeight
            )
            const useViewportGrid = FIELD_CONFIG.useViewportGrid
            let diagnosticsOn = FIELD_CONFIG.diagnosticsDefaultOn
            const MACRO_TIME = 0.00016
            const MESO_TIME = 0.00052
            const MICRO_TIME = 0.00024

            function canvasSize() {
                const hostW = containerRef.current?.clientWidth ?? window.innerWidth
                const hostH = containerRef.current?.clientHeight ?? window.innerHeight
                return {
                    width: Math.max(320, hostW),
                    height: Math.max(240, hostH)
                }
            }

            function distance(ax: number, ay: number, bx: number, by: number) {
                const dx = ax - bx
                const dy = ay - by
                return Math.sqrt(dx * dx + dy * dy)
            }

            function clamp01(value: number) {
                return Math.max(0, Math.min(1, value))
            }

            function isNodeRecord(value: unknown): value is NodeRecord {
                if (!value || typeof value !== "object") return false
                const node = value as Partial<NodeRecord>
                return (
                    typeof node.id === "string" &&
                    typeof node.xPosition === "number" &&
                    typeof node.yPosition === "number" &&
                    typeof node.ringIndex === "number" &&
                    typeof node.isDormant === "boolean" &&
                    Array.isArray(node.embedding) &&
                    node.embedding.every(n => typeof n === "number")
                )
            }

            function isStructuralEdgeRecord(value: unknown): value is StructuralEdgeRecord {
                if (!value || typeof value !== "object") return false
                const edge = value as Partial<StructuralEdgeRecord>
                return (
                    typeof edge.fromNodeId === "string" &&
                    typeof edge.toNodeId === "string" &&
                    edge.type === "STRUCTURAL" &&
                    typeof edge.weight === "number" &&
                    typeof edge.stability === "number"
                )
            }

            function isGridStateRecord(value: unknown): value is GridStateRecord {
                if (!value || typeof value !== "object") return false
                const state = value as Partial<GridStateRecord>
                return typeof state.currentRadius === "number"
            }

            async function fetchJson<T>(
                url: string,
                validate: (value: unknown) => value is T
            ): Promise<T | null> {
                try {
                    const response = await fetch(url)
                    if (!response.ok) return null
                    const data = await response.json()
                    return validate(data) ? data : null
                } catch {
                    return null
                }
            }

            function maybeCandidateIds(node: NodeRecord): string[] | null {
                if (!node.semanticCandidates) return null
                if (Array.isArray(node.semanticCandidates)) {
                    return node.semanticCandidates.filter(id => typeof id === "string")
                }
                return null
            }

            function updateTensionGeometry() {
                const { width, height } = canvasSize()
                sphere = resizeSphere(sphere, reloadSeed, width, height)
            }

            function updateTensionPoint() {
                sphere = updateSphereCenter(sphere)
            }

            function updateWarmPressure() {
                const now = p.millis()
                const dtSec =
                    lastFrameMs <= 0 ? 1 / 60 : Math.min(0.08, Math.max(0.001, (now - lastFrameMs) / 1000))
                lastFrameMs = now
                lastDeltaSec = dtSec

                const speed = Math.sqrt(vessel.vx * vessel.vx + vessel.vy * vessel.vy)
                const speedNorm = Math.min(1, speed / 42)
                const shellAtVessel = sampleShell(sphere, vessel.x, vessel.y).shell
                const pressureInput =
                    shellAtVessel * 0.68 +
                    semanticDensity * 0.18 +
                    speedNorm * 0.14 +
                    Math.max(0, metaBias.pressureBias) * 0.12

                warmPressure += pressureInput * FIELD_CONFIG.warmPressureGainPerSec * dtSec
                warmPressure -= warmPressure * FIELD_CONFIG.warmPressureDecayPerSec * dtSec
                warmPressure = Math.max(0, Math.min(1, warmPressure))

                if (warmPressure >= FIELD_CONFIG.warmPressureHoldThreshold) {
                    warmHoldMs += dtSec * 1000
                } else {
                    warmHoldMs = 0
                }
            }

            function planetaryForceAt(x: number, y: number, t: number) {
                return samplePlanetaryForce(
                    x,
                    y,
                    t,
                    sphere.point,
                    sphere.radius,
                    PLANETARY_BODIES,
                    JUPITER_MASS_EARTHS
                )
            }

            function depthFromId(id: string) {
                let hash = 2166136261
                for (let i = 0; i < id.length; i++) {
                    hash ^= id.charCodeAt(i)
                    hash = Math.imul(hash, 16777619)
                }
                const seeded = (hash ^ Math.floor(reloadSeed * 0xffffffff)) >>> 0
                const unit = seeded / 4294967295
                return unit * 2 - 1
            }

            function ensureDepthMap() {
                const nextDepth: Record<string, number> = {}
                for (const node of nodes) {
                    nextDepth[node.id] = depthById[node.id] ?? depthFromId(node.id)
                }
                depthById = nextDepth
            }

            function ensureStabilizationState() {
                const nextState: Record<string, StabilizedNode> = {}
                for (const node of nodes) {
                    const prev = stabilizedById[node.id]
                    nextState[node.id] = prev ?? {
                        x: node.xPosition,
                        y: node.yPosition,
                        vx: 0,
                        vy: 0
                    }
                }
                stabilizedById = nextState
            }

            function edgeKey(a: string, b: string) {
                return a < b ? `${a}|${b}` : `${b}|${a}`
            }

            function rebuildStructuralMetadata() {
                structuralDegree = {}
                const nextNeighbors = new Map<string, string[]>()
                for (const node of nodes) {
                    nextNeighbors.set(node.id, [])
                }
                for (const edge of structuralEdges) {
                    structuralDegree[edge.fromNodeId] = (structuralDegree[edge.fromNodeId] || 0) + 1
                    structuralDegree[edge.toNodeId] = (structuralDegree[edge.toNodeId] || 0) + 1
                    if (!nextNeighbors.has(edge.fromNodeId)) nextNeighbors.set(edge.fromNodeId, [])
                    if (!nextNeighbors.has(edge.toNodeId)) nextNeighbors.set(edge.toNodeId, [])
                    nextNeighbors.get(edge.fromNodeId)?.push(edge.toNodeId)
                    nextNeighbors.get(edge.toNodeId)?.push(edge.fromNodeId)
                }
                structuralNeighbors = nextNeighbors
                maxDegree = Math.max(...Object.values(structuralDegree), 1)
            }

            function parseGridId(id: string) {
                const match = /^v-(\d+)-(\d+)$/.exec(id)
                if (!match) return null
                return { row: Number(match[1]), col: Number(match[2]) }
            }

            function coreBounds() {
                const coreRows = 4
                const coreCols = 4
                const rowStart = Math.max(0, Math.floor((gridRows - coreRows) / 2))
                const colStart = Math.max(0, Math.floor((gridCols - coreCols) / 2))
                return {
                    rowStart,
                    rowEnd: rowStart + coreRows - 1,
                    colStart,
                    colEnd: colStart + coreCols - 1
                }
            }

            function coreDistance(id: string) {
                const coord = parseGridId(id)
                if (!coord) return null
                const bounds = coreBounds()
                const dr =
                    coord.row < bounds.rowStart
                        ? bounds.rowStart - coord.row
                        : coord.row > bounds.rowEnd
                          ? coord.row - bounds.rowEnd
                          : 0
                const dc =
                    coord.col < bounds.colStart
                        ? bounds.colStart - coord.col
                        : coord.col > bounds.colEnd
                          ? coord.col - bounds.colEnd
                          : 0
                return {
                    isCore: dr === 0 && dc === 0,
                    distance: Math.max(dr, dc)
                }
            }

            function currentCoreIds() {
                const bounds = coreBounds()
                const ids: string[] = []
                for (let r = bounds.rowStart; r <= bounds.rowEnd; r++) {
                    for (let c = bounds.colStart; c <= bounds.colEnd; c++) {
                        ids.push(`v-${r}-${c}`)
                    }
                }
                return ids
            }

            function pickIconHubNode() {
                const ids = currentCoreIds()
                if (ids.length === 0) return
                const seeded = Math.floor(Math.abs(Math.sin(reloadSeed * 917.11)) * 1000000)
                iconHubNodeId = ids[seeded % ids.length]
            }

            function buildMetaGrid(width: number, height: number) {
                const next: MetaNode[] = []
                const span = Math.max(220, Math.min(width, height) * 0.7)
                const stepX = metaCols > 1 ? span / (metaCols - 1) : 0
                const stepY = metaRows > 1 ? span / (metaRows - 1) : 0
                const originX = -span / 2
                const originY = -span / 2
                const centerRow = Math.floor(metaRows / 2)
                const centerCol = Math.floor(metaCols / 2)
                localMetaNodeId = `m-${centerRow}-${centerCol}`

                for (let row = 0; row < metaRows; row++) {
                    for (let col = 0; col < metaCols; col++) {
                        const id = `m-${row}-${col}`
                        const seed = Math.sin(
                            reloadSeed * 63.1 + row * 1.93 + col * 2.71
                        )
                        const base = (seed + 1) / 2
                        next.push({
                            id,
                            row,
                            col,
                            x: originX + col * stepX,
                            y: originY + row * stepY,
                            energy: 0.18 + base * 0.32,
                            coherence: 0.42 + base * 0.22,
                            focus: 0.14 + (1 - base) * 0.24
                        })
                    }
                }
                metaNodes = next
            }

            function rebuildMetaGrid() {
                const { width, height } = canvasSize()
                buildMetaGrid(width, height)
            }

            function metaNodeForGridNode(nodeId: string) {
                const coord = parseGridId(nodeId)
                if (!coord || metaNodes.length === 0) {
                    return metaNodes.find(node => node.id === localMetaNodeId) ?? null
                }
                const rowNorm = gridRows > 1 ? coord.row / (gridRows - 1) : 0.5
                const colNorm = gridCols > 1 ? coord.col / (gridCols - 1) : 0.5
                const mRow = Math.max(0, Math.min(metaRows - 1, Math.round(rowNorm * (metaRows - 1))))
                const mCol = Math.max(0, Math.min(metaCols - 1, Math.round(colNorm * (metaCols - 1))))
                return metaNodes.find(node => node.row === mRow && node.col === mCol) ?? null
            }

            function metaDisplayPosition(metaNode: MetaNode) {
                return {
                    x: metaNode.x + metaBias.shearX * 24,
                    y: metaNode.y + metaBias.shearY * 24
                }
            }

            function centerModeEnvelope() {
                const phaseNorm = Math.max(0, Math.min(1, centerModeClockMs / Math.max(1, centerModeDurationMs)))
                const arc = Math.sin(phaseNorm * Math.PI)
                const intensity = 0.45 + arc * 0.55
                if (centerMode === "memory") {
                    return {
                        foldBias: 0.72 * intensity,
                        expandBias: 1.14 * intensity,
                        stitchBias: 0.8 * intensity,
                        glyphBias: 0.86 * intensity
                    }
                }
                return {
                    foldBias: 1.2 * intensity,
                    expandBias: 0.72 * intensity,
                    stitchBias: 1.28 * intensity,
                    glyphBias: 1.16 * intensity
                }
            }

            function updateMetaCenterMode() {
                const dtMs = Math.min(100, Math.max(1, lastDeltaSec * 1000))
                centerModeClockMs += dtMs
                if (centerModeClockMs < centerModeDurationMs) return
                centerModeClockMs = 0
                centerMode = centerMode === "memory" ? "attractor" : "memory"
                const base = centerMode === "memory" ? 10200 : 9400
                centerModeDurationMs = base + Math.random() * 2600
            }

            function updateMetaField(projected: Map<string, ProjectedNode>) {
                if (metaNodes.length === 0 || nodes.length === 0) return

                metaPhase += 0.0022
                const dt = Math.min(0.05, Math.max(0.001, lastDeltaSec || 1 / 60))

                let avgForce = 0
                for (const node of nodes) {
                    avgForce += projected.get(node.id)?.force ?? 0
                }
                avgForce /= Math.max(1, nodes.length)

                let avgFocus = 0
                for (const node of nodes) {
                    avgFocus += focusFieldByNode[node.id] || 0
                }
                avgFocus /= Math.max(1, nodes.length)

                const strains = Object.values(strainByEdgeKey)
                let avgStrain = 0
                if (strains.length > 0) {
                    for (const value of strains) avgStrain += value
                    avgStrain /= strains.length
                }

                const localEnergy = clamp01(eventGain * 0.44 + warmPressure * 0.36 + avgForce * 0.2)
                const localCoherence = clamp01(1 - avgStrain * 1.25)
                const localFocus = clamp01(avgFocus * 0.62 + eventGain * 0.38)

                const local = metaNodes.find(node => node.id === localMetaNodeId)
                if (!local) return

                local.energy += (localEnergy - local.energy) * (0.32 * dt * 60)
                local.coherence += (localCoherence - local.coherence) * (0.28 * dt * 60)
                local.focus += (localFocus - local.focus) * (0.3 * dt * 60)
                local.energy = clamp01(local.energy)
                local.coherence = clamp01(local.coherence)
                local.focus = clamp01(local.focus)

                let neighborEnergy = 0
                let neighborFocus = 0
                let neighborCoherence = 0
                let pullX = 0
                let pullY = 0
                let count = 0

                for (const node of metaNodes) {
                    if (node.id === localMetaNodeId) continue
                    const distanceNorm = Math.hypot(node.col - local.col, node.row - local.row) || 1
                    const coupling = 1 / (1 + distanceNorm * 0.8)
                    const phase = metaPhase * (0.55 + coupling * 0.28) + (node.row + node.col) * 0.9
                    const oscEnergy = 0.5 + 0.5 * Math.sin(phase + reloadSeed * 2.2)
                    const oscFocus = 0.5 + 0.5 * Math.cos(phase * 1.2 + reloadSeed * 1.7)
                    const oscCoherence = 0.5 + 0.5 * Math.sin(phase * 0.73 + 1.9)
                    const targetEnergy = clamp01(0.22 + oscEnergy * 0.56 + local.energy * 0.16)
                    const targetFocus = clamp01(0.16 + oscFocus * 0.48 + local.focus * 0.22)
                    const targetCoherence = clamp01(0.24 + oscCoherence * 0.52 + local.coherence * 0.14)

                    node.energy += (targetEnergy - node.energy) * (0.1 + coupling * 0.18) * dt * 60
                    node.focus += (targetFocus - node.focus) * (0.1 + coupling * 0.2) * dt * 60
                    node.coherence += (targetCoherence - node.coherence) * (0.09 + coupling * 0.17) * dt * 60
                    node.energy = clamp01(node.energy)
                    node.focus = clamp01(node.focus)
                    node.coherence = clamp01(node.coherence)

                    const influence = (node.energy - local.energy) * 0.5 + (node.focus - local.focus) * 0.5
                    pullX += (node.col - local.col) * influence * coupling
                    pullY += (node.row - local.row) * influence * coupling

                    neighborEnergy += node.energy
                    neighborFocus += node.focus
                    neighborCoherence += node.coherence
                    count += 1
                }

                const inv = count > 0 ? 1 / count : 0
                neighborEnergy *= inv
                neighborFocus *= inv
                neighborCoherence *= inv

                metaBias.phaseDrift = clamp01(0.5 + pullX * 0.32) - 0.5
                metaBias.pressureBias = clamp01((neighborEnergy - local.energy) * 0.7 + 0.5) - 0.5
                metaBias.shearX = pullX * 0.32
                metaBias.shearY = pullY * 0.32
                metaBias.iconDrive = clamp01(neighborFocus * 0.58 + (1 - neighborCoherence) * 0.42)
            }

            function refreshCoreInteractionWeights(force = false) {
                const now = p.millis()
                if (!force && now < nextCoreInteractionShuffleMs && Object.keys(coreInteractionById).length === 16) {
                    return
                }

                const coreIds = currentCoreIds()
                const modes: CoreInteractionMode[] = [
                    "attract_primary",
                    "attract_shadow",
                    "shear_orbit",
                    "turbulence_kick"
                ]
                const next: Record<string, CoreInteractionProfile> = {}
                coreIds.forEach((id, idx) => {
                    const angle = Math.random() * Math.PI * 2
                    next[id] = {
                        mode: modes[Math.floor(Math.random() * modes.length)],
                        fx: Math.cos(angle),
                        fy: Math.sin(angle)
                    }
                })
                coreInteractionById = next
                nextCoreInteractionShuffleMs = now + 950 + Math.random() * 1150
            }

            function projectedNodes() {
                const projected = new Map<string, ProjectedNode>()
                const px = vessel.x / Math.max(1, p.width / 2)
                const py = vessel.y / Math.max(1, p.height / 2)
                forcePhase += 0.012 + metaBias.phaseDrift * 0.0028
                const startupRaw = Math.min(1, p.millis() / 5500)
                const startupEase = startupRaw * startupRaw * (3 - 2 * startupRaw)

                for (const node of nodes) {
                    const z = depthById[node.id] ?? 0
                    const zLift = (z + 1) / 2
                    const distToVessel = distance(vessel.x, vessel.y, node.xPosition, node.yPosition)
                    const proximityForce = Math.max(0, 1 - distToVessel / 320)
                    const attuneForce = attunement[node.id] || 0
                    const structuralForce =
                        (structuralDegree[node.id] || 0) / Math.max(1, maxDegree)
                    const waveForce =
                        ((Math.sin(forcePhase + node.xPosition * 0.006 + node.yPosition * 0.006) + 1) / 2) * 0.2
                    const force = Math.min(
                        1,
                        proximityForce * 0.5 +
                            attuneForce * 0.22 +
                            structuralForce * 0.18 +
                            waveForce * 0.06 +
                            semanticDensity * 0.1
                    )
                    const perspective = 1 + z * 0.22
                    const parallaxWeight = 0.55 + force * 1.05
                    const parallaxX = px * z * 36 * parallaxWeight
                    const parallaxY = py * z * 28 * parallaxWeight
                    const dx = node.xPosition - vessel.x
                    const dy = node.yPosition - vessel.y
                    const mag = Math.sqrt(dx * dx + dy * dy) || 1
                    const forceDisplacement = (4 + 11 * zLift) * force * startupEase
                    const forceX = (dx / mag) * forceDisplacement
                    const forceY = (dy / mag) * forceDisplacement
                    const planetary = planetaryForceAt(
                        node.xPosition,
                        node.yPosition,
                        forcePhase * 0.45 + reloadSeed * 5
                    )
                    const spherical = sphericalContainment(
                        sphere,
                        node.xPosition,
                        node.yPosition,
                        zLift,
                        Math.min(1, force + warmPressure * 0.55)
                    )
                    const planetaryScale = (13 + zLift * 9 + force * 11 + warmPressure * 10) * startupEase
                    const planetX = planetary.fx * planetaryScale
                    const planetY = planetary.fy * planetaryScale
                    const warmShellScale = 1 + warmPressure * 0.55 * startupEase
                    const preWrapX =
                        node.xPosition * perspective + parallaxX + forceX + spherical.x * warmShellScale + planetX
                    const preWrapY =
                        node.yPosition * perspective + parallaxY + forceY + spherical.y * warmShellScale + planetY

                    // Wrap the plane around the sphere: radial distance maps through sin/cos
                    // so the grid reads like it is bending over a curved body.
                    const wx = preWrapX - sphere.point.x
                    const wy = preWrapY - sphere.point.y
                    const wr = Math.sqrt(wx * wx + wy * wy) || 1
                    const maxWrap = Math.max(1, sphere.radius * 1.55)
                    const normalized = Math.min(1, wr / maxWrap)
                    const theta = normalized * (Math.PI / 2)
                    const wrappedR = Math.sin(theta) * maxWrap
                    const wrapDepth = 1 - Math.cos(theta)
                    const wrapBlend = (0.2 + warmPressure * 0.2 + spherical.shell * 0.18) * (0.35 + startupEase * 0.65)
                    const wrappedX = sphere.point.x + (wx / wr) * wrappedR
                    const wrappedY = sphere.point.y + (wy / wr) * wrappedR
                    const finalX = preWrapX + (wrappedX - preWrapX) * wrapBlend
                    const finalY = preWrapY + (wrappedY - preWrapY) * wrapBlend
                    const wrapScaleBoost = 1 + wrapDepth * 0.18 * wrapBlend
                    const coreInfo = coreDistance(node.id)
                    const coreNear = coreInfo ? Math.max(0, 1 - coreInfo.distance / 4) : 0
                    const isCore16 = coreInfo?.isCore ?? false
                    const coreElastic = isCore16 ? 1 : 0
                    const state = stabilizedById[node.id] ?? {
                        x: node.xPosition,
                        y: node.yPosition,
                        vx: 0,
                        vy: 0
                    }
                    const anchorX = node.xPosition
                    const anchorY = node.yPosition
                    const billowPhase =
                        forcePhase * (0.24 + coreNear * 0.08) +
                        node.xPosition * 0.004 +
                        node.yPosition * 0.003
                    const billowAmp =
                        (0.45 + coreNear * 0.25) *
                        (0.45 + warmPressure * 0.5) *
                        startupEase
                    const billowX = Math.sin(billowPhase) * billowAmp
                    const billowY = Math.cos(billowPhase * 0.9) * billowAmp
                    const rdx = finalX - sphere.point.x
                    const rdy = finalY - sphere.point.y
                    const rmag = Math.sqrt(rdx * rdx + rdy * rdy) || 1
                    const rnx = rdx / rmag
                    const rny = rdy / rmag
                    const rtx = -rny
                    const rty = rnx
                    const shellRepulseBand = Math.max(1, sphere.radius * 1.55)
                    const shellProximity = Math.max(0, 1 - rmag / shellRepulseBand)
                    const repulse =
                        (10 + force * 12 + warmPressure * 14) *
                        shellProximity *
                        (0.28 + coreElastic * 1.08)
                    const elasticPhase =
                        forcePhase * 2.6 +
                        node.xPosition * 0.012 +
                        node.yPosition * 0.011 +
                        reloadSeed * 6.2
                    const elasticWave = Math.sin(elasticPhase) * (2.8 + warmPressure * 2.4) * coreElastic
                    const repulseX = rnx * repulse + rtx * elasticWave
                    const repulseY = rny * repulse + rty * elasticWave
                    const targetX = finalX + billowX + repulseX
                    const targetY = finalY + billowY + repulseY
                    const followGain = 1.15 + (1 - coreNear) * 0.45 + coreElastic * 1.15
                    const restoreGain = (4.2 + coreNear * 2.8) * (1 - coreElastic * 0.34)
                    const damping = 0.68 + coreNear * 0.06 - coreElastic * 0.1
                    const stabilizer = 0.62 + coreNear * 0.25

                    state.vx +=
                        (targetX - state.x) * followGain * lastDeltaSec +
                        (anchorX - state.x) * restoreGain * lastDeltaSec * stabilizer
                    state.vy +=
                        (targetY - state.y) * followGain * lastDeltaSec +
                        (anchorY - state.y) * restoreGain * lastDeltaSec * stabilizer
                    state.vx *= Math.max(0.5, damping)
                    state.vy *= Math.max(0.5, damping)
                    state.x += state.vx
                    state.y += state.vy
                    stabilizedById[node.id] = state

                    // Re-apply spherical warp after stabilization so the shell form stays pronounced.
                    const swx = state.x - sphere.point.x
                    const swy = state.y - sphere.point.y
                    const swr = Math.sqrt(swx * swx + swy * swy) || 1
                    const sMaxWrap = Math.max(1, sphere.radius * 1.58)
                    const sNorm = Math.min(1, swr / sMaxWrap)
                    const sTheta = sNorm * (Math.PI / 2)
                    const sWrappedR = Math.sin(sTheta) * sMaxWrap
                    const sWrappedX = sphere.point.x + (swx / swr) * sWrappedR
                    const sWrappedY = sphere.point.y + (swy / swr) * sWrappedR
                    const shellBoost = sampleShell(sphere, state.x, state.y).shell
                    const postWrapBlend = (0.2 + warmPressure * 0.16 + shellBoost * 0.26) * (0.35 + startupEase * 0.65)
                    const displayXBase = state.x + (sWrappedX - state.x) * postWrapBlend
                    const displayYBase = state.y + (sWrappedY - state.y) * postWrapBlend
                    const shearScale = (8 + force * 10 + zLift * 7) * (0.2 + startupEase * 0.8)
                    const shearedX = displayXBase + metaBias.shearX * shearScale
                    const shearedY = displayYBase + metaBias.shearY * shearScale
                    const metaAnchor = metaNodeForGridNode(node.id)
                    let displayX = shearedX
                    let displayY = shearedY
                    if (metaAnchor) {
                        const modeEnvelope = centerModeEnvelope()
                        const anchor = metaDisplayPosition(metaAnchor)
                        const foldCarrier =
                            0.5 +
                            0.5 *
                                Math.sin(
                                    metaPhase * 3.1 +
                                        metaAnchor.row * 0.85 +
                                        metaAnchor.col * 0.7 +
                                        node.ringIndex * 0.12
                                )
                        const foldStrength =
                            (0.02 + eventGain * 0.06 + warmPressure * 0.05 + metaBias.iconDrive * 0.11) *
                            modeEnvelope.foldBias *
                            startupEase
                        const foldBlend = Math.max(0, Math.min(0.28, foldStrength * foldCarrier))
                        const foldedX = shearedX + (anchor.x - shearedX) * foldBlend
                        const foldedY = shearedY + (anchor.y - shearedY) * foldBlend

                        const expandPulse =
                            0.5 +
                            0.5 *
                                Math.sin(
                                    metaPhase * 2.25 +
                                        node.xPosition * 0.004 +
                                        node.yPosition * 0.004 +
                                        metaAnchor.energy * 2.1
                                )
                        const expandScale =
                            1 +
                            (0.03 + eventGain * 0.08 + metaBias.iconDrive * 0.05) *
                                expandPulse *
                                modeEnvelope.expandBias
                        displayX = anchor.x + (foldedX - anchor.x) * expandScale
                        displayY = anchor.y + (foldedY - anchor.y) * expandScale
                    }

                    projected.set(node.id, {
                        x: displayX,
                        y: displayY,
                        scale: Math.max(0.75, perspective * wrapScaleBoost),
                        depth: z,
                        force: Math.min(
                            1,
                            force +
                                planetary.intensity * 0.2 +
                                spherical.shell * 0.32 +
                                warmPressure * 0.25 +
                                coreNear * 0.08
                        )
                    })
                }

                applyLaplacianRelaxation(projected, startupEase)

                return projected
            }

            function applyLaplacianRelaxation(
                projected: Map<string, ProjectedNode>,
                startupEase: number
            ) {
                const relaxationBase = 0.055 * (0.4 + startupEase * 0.6)
                const relaxed = new Map<string, ProjectedNode>()

                for (const node of nodes) {
                    const current = projected.get(node.id)
                    if (!current) continue

                    const neighbors = structuralNeighbors.get(node.id) ?? []
                    if (neighbors.length === 0) {
                        relaxed.set(node.id, current)
                        continue
                    }

                    let sumX = 0
                    let sumY = 0
                    let count = 0
                    for (const neighborId of neighbors) {
                        const neighbor = projected.get(neighborId)
                        if (!neighbor) continue
                        sumX += neighbor.x
                        sumY += neighbor.y
                        count += 1
                    }
                    if (count === 0) {
                        relaxed.set(node.id, current)
                        continue
                    }

                    const avgX = sumX / count
                    const avgY = sumY / count
                    const core = coreDistance(node.id)
                    const coreLock = core?.isCore ? 0.28 : 1
                    const forceDamp = 1 - Math.min(0.72, current.force * 0.55)
                    const lambda = relaxationBase * coreLock * forceDamp

                    relaxed.set(node.id, {
                        ...current,
                        x: current.x + (avgX - current.x) * lambda,
                        y: current.y + (avgY - current.y) * lambda
                    })
                }

                for (const [id, value] of relaxed) {
                    projected.set(id, value)
                }
            }

            function updateEdgeStrain(projected: Map<string, ProjectedNode>) {
                const nextStrain: Record<string, number> = {}
                for (const edge of structuralEdges) {
                    const from = projected.get(edge.fromNodeId)
                    const to = projected.get(edge.toNodeId)
                    const fromRest = nodeById.get(edge.fromNodeId)
                    const toRest = nodeById.get(edge.toNodeId)
                    if (!from || !to || !fromRest || !toRest) continue
                    const restLength = Math.max(
                        1,
                        distance(fromRest.xPosition, fromRest.yPosition, toRest.xPosition, toRest.yPosition)
                    )
                    const currentLength = Math.max(1, distance(from.x, from.y, to.x, to.y))
                    const strain = Math.abs(currentLength - restLength) / restLength
                    nextStrain[edgeKey(edge.fromNodeId, edge.toNodeId)] = Math.min(1, strain * 3.5)
                }
                strainByEdgeKey = nextStrain
            }

            function updateDelayedConnectorField(projected: Map<string, ProjectedNode>) {
                const nextField: Record<string, number> = {}
                for (const node of nodes) {
                    nextField[node.id] = (delayedConnectorByNode[node.id] || 0) * 0.9
                }

                for (const edge of structuralEdges) {
                    const from = projected.get(edge.fromNodeId)
                    const to = projected.get(edge.toNodeId)
                    if (!from || !to) continue

                    const strain = strainByEdgeKey[edgeKey(edge.fromNodeId, edge.toNodeId)] || 0
                    const fromWeight = neighborhoodWeight(edge.fromNodeId, projected)
                    const toWeight = neighborhoodWeight(edge.toNodeId, projected)
                    const imbalance = Math.min(1, Math.abs(toWeight - fromWeight))
                    const meanForce = (from.force + to.force) / 2
                    const signal = Math.min(1, strain * 0.55 + imbalance * 0.95 + meanForce * 0.35)

                    nextField[edge.fromNodeId] = Math.min(1, (nextField[edge.fromNodeId] || 0) + signal * 0.11)
                    nextField[edge.toNodeId] = Math.min(1, (nextField[edge.toNodeId] || 0) + signal * 0.11)

                    const fromNeighbors = structuralNeighbors.get(edge.fromNodeId) ?? []
                    const toNeighbors = structuralNeighbors.get(edge.toNodeId) ?? []
                    for (const neighborId of fromNeighbors) {
                        nextField[neighborId] = Math.min(1, (nextField[neighborId] || 0) + signal * 0.025)
                    }
                    for (const neighborId of toNeighbors) {
                        nextField[neighborId] = Math.min(1, (nextField[neighborId] || 0) + signal * 0.025)
                    }
                }

                delayedConnectorByNode = nextField
            }

            function updateFocusField(projected: Map<string, ProjectedNode>) {
                const candidates = nodes
                    .map(node => {
                        const point = projected.get(node.id)
                        if (!point) return null
                        const core = coreDistance(node.id)
                        const activity =
                            (delayedConnectorByNode[node.id] || 0) * 0.62 +
                            point.force * 0.3 +
                            (core?.isCore ? 0.08 : 0)
                        return { id: node.id, activity, x: point.x, y: point.y }
                    })
                    .filter((entry): entry is { id: string; activity: number; x: number; y: number } => Boolean(entry))
                    .sort((a, b) => b.activity - a.activity)

                const seeds: Array<{ id: string; activity: number; x: number; y: number }> = []
                for (const candidate of candidates) {
                    if (candidate.activity < 0.2) break
                    const isFar = seeds.every(seed => distance(seed.x, seed.y, candidate.x, candidate.y) > 100)
                    if (!isFar) continue
                    seeds.push(candidate)
                    if (seeds.length >= 2) break
                }

                const sigma = Math.max(64, Math.min(p.width, p.height) * 0.09)
                const nextFocus: Record<string, number> = {}
                for (const node of nodes) {
                    const point = projected.get(node.id)
                    if (!point) continue
                    let target = 0
                    for (const seed of seeds) {
                        const d = distance(point.x, point.y, seed.x, seed.y)
                        const g = Math.exp(-(d * d) / (2 * sigma * sigma)) * seed.activity
                        target = Math.max(target, g)
                    }
                    const prev = focusFieldByNode[node.id] || 0
                    const rise = prev * 0.74 + target * 0.42
                    const decay = prev * 0.86 + target * 0.08
                    nextFocus[node.id] = Math.max(0, Math.min(1, target > prev ? rise : decay))
                }
                focusFieldByNode = nextFocus
            }

            function measureEventActivity() {
                const values = nodes.map(node => focusFieldByNode[node.id] || 0).sort((a, b) => b - a)
                if (values.length === 0) return 0
                const top = values.slice(0, Math.min(5, values.length))
                const meanTop = top.reduce((sum, v) => sum + v, 0) / top.length
                const connectorMean =
                    nodes.reduce((sum, node) => sum + (delayedConnectorByNode[node.id] || 0), 0) /
                    Math.max(1, nodes.length)
                return Math.min(1, meanTop * 0.75 + connectorMean * 0.45)
            }

            function updateEventLifecycle() {
                const dtMs = lastDeltaSec * 1000
                eventClockMs += dtMs
                if (silenceCooldownMs > 0) {
                    silenceCooldownMs = Math.max(0, silenceCooldownMs - dtMs)
                }
                if (silenceMs > 0) {
                    silenceMs = Math.max(0, silenceMs - dtMs)
                }

                eventActivity = measureEventActivity()

                const startThreshold = 0.3
                const holdThreshold = 0.22

                if (eventPhase === "idle") {
                    eventGain = Math.max(0, eventGain - 0.0018 * dtMs)
                    if (silenceMs <= 0 && eventActivity >= startThreshold) {
                        eventPhase = "ignite"
                        eventClockMs = 0
                    }
                    return
                }

                if (eventPhase === "ignite") {
                    eventGain = Math.min(1, eventGain + 0.003 * dtMs)
                    if (eventClockMs >= 520) {
                        eventPhase = "hold"
                        eventClockMs = 0
                    }
                    return
                }

                if (eventPhase === "hold") {
                    eventGain = Math.min(1, eventGain + 0.0006 * dtMs)
                    if (eventActivity < holdThreshold || eventClockMs >= 1250) {
                        eventPhase = "release"
                        eventClockMs = 0
                    }
                    return
                }

                if (eventPhase === "release") {
                    eventGain = Math.max(0, eventGain - 0.0024 * dtMs)
                    if (eventGain <= 0.18 || eventClockMs >= 840) {
                        eventPhase = "residue"
                        eventClockMs = 0
                    }
                    return
                }

                if (eventPhase === "residue") {
                    eventGain = Math.max(0, eventGain - 0.0012 * dtMs)
                    if (eventClockMs >= 950) {
                        if (silenceCooldownMs <= 0) {
                            silenceMs = 520
                            silenceCooldownMs = 980
                        }
                        eventPhase = "idle"
                        eventClockMs = 0
                    }
                }
            }

            function buildViewportGrid(width: number, height: number) {
                const cols = 8
                const rows = 8
                const margin = 18
                const side = Math.max(120, Math.min(width, height) - margin * 2)
                const minX = -side / 2
                const maxX = side / 2
                const minY = -side / 2
                const maxY = side / 2
                const stepX = cols > 1 ? (maxX - minX) / (cols - 1) : 0
                const stepY = rows > 1 ? (maxY - minY) / (rows - 1) : 0
                const centerCol = (cols - 1) / 2
                const centerRow = (rows - 1) / 2

                const nextNodes: NodeRecord[] = []
                const nextEdges: StructuralEdgeRecord[] = []

                for (let row = 0; row < rows; row++) {
                    for (let col = 0; col < cols; col++) {
                        const x = minX + col * stepX
                        const y = minY + row * stepY
                        const ringIndex = Math.floor(
                            Math.max(
                                Math.abs(col - centerCol),
                                Math.abs(row - centerRow)
                            )
                        )

                        nextNodes.push({
                            id: `v-${row}-${col}`,
                            xPosition: x,
                            yPosition: y,
                            ringIndex,
                            isDormant: false,
                            embedding: [
                                col / Math.max(1, cols - 1),
                                row / Math.max(1, rows - 1),
                                (Math.sin((row + 1) * 0.42) + Math.cos((col + 1) * 0.37) + 2) / 4
                            ]
                        })

                        if (col + 1 < cols) {
                            nextEdges.push({
                                fromNodeId: `v-${row}-${col}`,
                                toNodeId: `v-${row}-${col + 1}`,
                                type: "STRUCTURAL",
                                weight: 0.72,
                                stability: 0.7
                            })
                        }

                        if (row + 1 < rows) {
                            nextEdges.push({
                                fromNodeId: `v-${row}-${col}`,
                                toNodeId: `v-${row + 1}-${col}`,
                                type: "STRUCTURAL",
                                weight: 0.72,
                                stability: 0.7
                            })
                        }
                    }
                }

                return { nodes: nextNodes, edges: nextEdges, rows, cols }
            }

            function rebuildGridForViewport() {
                const { width, height } = canvasSize()
                const viewportGrid = buildViewportGrid(width, height)
                nodes = viewportGrid.nodes
                structuralEdges = viewportGrid.edges
                gridRows = viewportGrid.rows
                gridCols = viewportGrid.cols
                nodeById = new Map(nodes.map(node => [node.id, node]))

                rebuildStructuralMetadata()
                ensureStabilizationState()
                pickIconHubNode()
            }

            async function loadData() {
                const fetchedNodes = await fetchJson(
                    "/api/nodes",
                    (value): value is NodeRecord[] =>
                        Array.isArray(value) && value.every(isNodeRecord)
                )
                const fetchedStructuralEdges = await fetchJson(
                    "/api/structural-edges",
                    (value): value is StructuralEdgeRecord[] =>
                        Array.isArray(value) && value.every(isStructuralEdgeRecord)
                )

                setLoadError(null)

                if (useViewportGrid) {
                    rebuildGridForViewport()
                } else {
                    nodes = fetchedNodes ?? []
                    structuralEdges = fetchedStructuralEdges ?? []
                    nodeById = new Map(nodes.map(node => [node.id, node]))

                    rebuildStructuralMetadata()
                    ensureStabilizationState()
                    pickIconHubNode()
                }
                ensureDepthMap()

                const gridState = await fetchJson("/api/grid-state", isGridStateRecord)
                if (gridState?.currentRadius && gridState.currentRadius > 0) {
                    // Window is the only boundary now, but keep this call for API parity.
                }
            }

            function updateVessel() {
                const targetX = p.mouseX - p.width / 2
                const targetY = p.mouseY - p.height / 2

                vessel.vx = targetX - vessel.x
                vessel.vy = targetY - vessel.y
                vessel.x = targetX
                vessel.y = targetY
            }

            function updateAttunement() {
                for (const node of nodes) {
                    const d = distance(vessel.x, vessel.y, node.xPosition, node.yPosition)
                    const lingerBand = 210
                    const current = attunement[node.id] || 0

                    if (d < lingerBand) {
                        const gain = (1 - d / lingerBand) * 0.1
                        attunement[node.id] = Math.min(1, current + gain)
                    } else {
                        attunement[node.id] = Math.max(0, current * 0.975)
                    }
                }
            }

            function recomputeSemantic() {
                for (const key of Object.keys(localStability)) {
                    localStability[key] *= 0.98
                    if (localStability[key] < 0.02) {
                        delete localStability[key]
                    }
                }

                updateAttunement()

                const influenceRadius = Math.max(220, Math.min(p.width, p.height) * 0.4)
                const influenceNodes = nodes.filter(node =>
                    distance(vessel.x, vessel.y, node.xPosition, node.yPosition) <= influenceRadius
                )

                const nextEdges = new Map<string, { from: string; to: string; score: number }>()

                for (const a of influenceNodes) {
                    const candidateIds = maybeCandidateIds(a)
                    const candidatePool = candidateIds
                        ? candidateIds
                              .map(id => nodeById.get(id))
                              .filter((node): node is NodeRecord => Boolean(node))
                        : influenceNodes

                    const scored: Array<{ to: string; score: number }> = []

                    for (const b of candidatePool) {
                        if (a.id === b.id) continue

                        const score = interpretationScore(
                            a,
                            b,
                            vessel,
                            structuralDegree,
                            maxDegree,
                            attunement
                        )

                        if (score > FIELD_CONFIG.semanticThreshold) {
                            scored.push({ to: b.id, score })
                        }
                    }

                    scored
                        .sort((lhs, rhs) => rhs.score - lhs.score)
                        .slice(0, FIELD_CONFIG.topKPerNode)
                        .forEach(candidate => {
                            const key = `${a.id}->${candidate.to}`
                            nextEdges.set(key, { from: a.id, to: candidate.to, score: candidate.score })
                        })
                }

                for (const [key, value] of nextEdges) {
                    localStability[key] = (localStability[key] || 0) + value.score * 0.32
                }

                const retainedKeys = Object.entries(localStability)
                    .sort((lhs, rhs) => rhs[1] - lhs[1])
                    .slice(0, FIELD_CONFIG.maxStableEdges)
                    .map(entry => entry[0])

                const retainedSet = new Set(retainedKeys)
                for (const key of Object.keys(localStability)) {
                    if (!retainedSet.has(key)) {
                        delete localStability[key]
                    }
                }

                localSemanticEdges = retainedKeys
                    .map(key => {
                        const base = nextEdges.get(key)
                        if (!base) return null
                        return {
                            from: base.from,
                            to: base.to,
                            weight: base.score,
                            stability: Math.min(1, (localStability[key] || 0) / 2)
                        }
                    })
                    .filter((edge): edge is SemanticEdge => Boolean(edge))

                semanticDensity = Math.min(1, localSemanticEdges.length / 42)
            }

            function drawBackground() {
                const silenceGate = silenceMs > 0 ? 0.25 + 0.75 * (1 - silenceMs / 520) : 1
                p.noStroke()
                p.background(0, 0, 0)

                p.noFill()
                p.stroke(210, 210, 210, 18)
                p.strokeWeight(0.9)
                p.circle(sphere.point.x, sphere.point.y, sphere.radius * 2)
                const breath = pulseWave(sphere.spin * 0.8, reloadSeed * 2.3)
                const bloom = 1 + breath * 0.09 + warmPressure * 0.14
                p.stroke(255, 255, 255, (22 + warmPressure * 48 + breath * 24) * (0.45 + silenceGate * 0.55))
                p.strokeWeight(1.2 + warmPressure * 1.1 + breath * 0.7)
                p.circle(sphere.point.x, sphere.point.y, sphere.radius * 1.72 * bloom)
                p.stroke(210, 210, 210, 10)
                p.strokeWeight(0.7)
                p.circle(sphere.point.x, sphere.point.y, sphere.radius * 1.45)

                const pulse = pulseWave(sphere.spin * 0.42, 1.1 + reloadSeed * 1.7)
                p.stroke(255, 255, 255, (16 + pulse * 18 + warmPressure * 22) * (0.45 + silenceGate * 0.55))
                p.strokeWeight(0.9 + pulse * 0.55 + warmPressure * 0.8)
                p.circle(
                    sphere.point.x,
                    sphere.point.y,
                    sphere.radius * (2.08 + pulse * 0.14 + warmPressure * 0.18 + breath * 0.08)
                )

                // Outer animated pressure ring makes spherical tension visually obvious.
                const outerPulse = pulseWave(sphere.spin * 0.3, 1.7 + reloadSeed * 2.9)
                p.stroke(225, 225, 225, (6 + warmPressure * 16 + outerPulse * 8) * (0.45 + silenceGate * 0.55))
                p.strokeWeight(0.7 + warmPressure * 0.45)
                p.circle(
                    sphere.point.x,
                    sphere.point.y,
                    sphere.radius * (2.34 + outerPulse * 0.22 + warmPressure * 0.25)
                )
            }

            function drawMetaLattice() {
                if (metaNodes.length === 0) return
                const local = metaNodes.find(node => node.id === localMetaNodeId)
                if (!local) return
                const modeEnvelope = centerModeEnvelope()
                const silenceGate = silenceMs > 0 ? 0.22 + 0.78 * (1 - silenceMs / 520) : 1
                const lifecycleGate = 0.2 + eventGain * 0.95
                const shiftX = metaBias.shearX * 24
                const shiftY = metaBias.shearY * 24

                p.noFill()
                for (const from of metaNodes) {
                    for (const to of metaNodes) {
                        const rowNeighbor = from.row === to.row && Math.abs(from.col - to.col) === 1
                        const colNeighbor = from.col === to.col && Math.abs(from.row - to.row) === 1
                        if (!rowNeighbor && !colNeighbor) continue
                        if (to.id < from.id) continue

                        const midpointEnergy = (from.energy + to.energy) * 0.5
                        const midpointCoherence = (from.coherence + to.coherence) * 0.5
                        const alpha = (2 + midpointEnergy * 9 + midpointCoherence * 6) * lifecycleGate * silenceGate
                        p.stroke(180, 180, 180, alpha)
                        p.strokeWeight(0.6)
                        p.line(from.x + shiftX, from.y + shiftY, to.x + shiftX, to.y + shiftY)
                    }
                }

                for (const node of metaNodes) {
                    const isLocal = node.id === localMetaNodeId
                    const alpha = (3 + node.energy * 14 + node.focus * 10) * lifecycleGate * silenceGate
                    p.stroke(220, 220, 220, alpha)
                    p.strokeWeight(1)
                    const radius = isLocal ? 8 + node.focus * 5 + modeEnvelope.glyphBias * 1.5 : 4 + node.focus * 3
                    drawNodePolygon(node.x + shiftX, node.y + shiftY, radius, 4, metaPhase * 0.5 + node.row * 0.3 + node.col * 0.2)
                    if (isLocal) {
                        p.stroke(255, 255, 255, (8 + node.focus * 16) * lifecycleGate * silenceGate)
                        p.strokeWeight(1)
                        p.circle(node.x + shiftX, node.y + shiftY, radius * 2.25)
                        p.stroke(255, 255, 255, (5 + modeEnvelope.glyphBias * 16) * lifecycleGate * silenceGate)
                        p.strokeWeight(1)
                        const modeSides = centerMode === "memory" ? 6 : 3
                        drawNodePolygon(
                            node.x + shiftX,
                            node.y + shiftY,
                            radius * (centerMode === "memory" ? 0.65 : 0.72),
                            modeSides,
                            metaPhase * (centerMode === "memory" ? 0.35 : 0.7)
                        )
                    }
                }
            }

            function drawLayerStitches(projected: Map<string, ProjectedNode>) {
                if (metaNodes.length === 0) return
                const modeEnvelope = centerModeEnvelope()
                const silenceGate = silenceMs > 0 ? 0.2 + 0.8 * (1 - silenceMs / 520) : 1
                const lifecycleGate = 0.2 + eventGain * 0.95
                const stitchCarrier = 0.5 + 0.5 * Math.sin(metaPhase * 3)

                for (const node of nodes) {
                    const point = projected.get(node.id)
                    if (!point) continue
                    const metaAnchor = metaNodeForGridNode(node.id)
                    if (!metaAnchor) continue
                    const anchor = metaDisplayPosition(metaAnchor)
                    const dx = anchor.x - point.x
                    const dy = anchor.y - point.y
                    const d = Math.sqrt(dx * dx + dy * dy) || 1
                    const nx = dx / d
                    const ny = dy / d
                    const tx = -ny
                    const ty = nx
                    const bend = (2 + metaAnchor.focus * 8 + stitchCarrier * 6) * (0.5 + metaAnchor.energy * 0.5)
                    const cx = (point.x + anchor.x) * 0.5 + tx * bend
                    const cy = (point.y + anchor.y) * 0.5 + ty * bend
                    const alpha =
                        (2 + stitchCarrier * 14 + metaAnchor.energy * 14 + metaAnchor.focus * 10) *
                        modeEnvelope.stitchBias *
                        lifecycleGate *
                        silenceGate

                    p.noFill()
                    p.stroke(200, 200, 200, alpha)
                    p.strokeWeight(0.65 + metaAnchor.focus * 0.35 + modeEnvelope.stitchBias * 0.2)
                    p.beginShape()
                    p.vertex(point.x, point.y)
                    p.quadraticVertex(cx, cy, anchor.x, anchor.y)
                    p.endShape()
                }
            }

            function focusCentroid(projected: Map<string, ProjectedNode>) {
                let sumX = 0
                let sumY = 0
                let sumW = 0
                for (const node of nodes) {
                    const focus = focusFieldByNode[node.id] || 0
                    if (focus <= 0.01) continue
                    const point = projected.get(node.id)
                    if (!point) continue
                    sumX += point.x * focus
                    sumY += point.y * focus
                    sumW += focus
                }
                if (sumW <= 0.001) {
                    return { x: sphere.point.x, y: sphere.point.y, w: 0 }
                }
                return { x: sumX / sumW, y: sumY / sumW, w: Math.min(1, sumW / Math.max(1, nodes.length * 0.5)) }
            }

            function coreBox(projected: Map<string, ProjectedNode>) {
                const bounds = coreBounds()
                let minX = Number.POSITIVE_INFINITY
                let minY = Number.POSITIVE_INFINITY
                let maxX = Number.NEGATIVE_INFINITY
                let maxY = Number.NEGATIVE_INFINITY

                for (let r = bounds.rowStart; r <= bounds.rowEnd; r++) {
                    for (let c = bounds.colStart; c <= bounds.colEnd; c++) {
                        const point = projected.get(`v-${r}-${c}`)
                        if (!point) continue
                        minX = Math.min(minX, point.x)
                        minY = Math.min(minY, point.y)
                        maxX = Math.max(maxX, point.x)
                        maxY = Math.max(maxY, point.y)
                    }
                }

                if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
                    const span = gridCellSize() * 2
                    return {
                        minX: sphere.point.x - span,
                        maxX: sphere.point.x + span,
                        minY: sphere.point.y - span,
                        maxY: sphere.point.y + span
                    }
                }

                const padding = Math.max(4, gridCellSize() * 0.08)
                return {
                    minX: minX + padding,
                    maxX: maxX - padding,
                    minY: minY + padding,
                    maxY: maxY - padding
                }
            }

            function gridCellSize() {
                let minRest = Number.POSITIVE_INFINITY
                for (const edge of structuralEdges) {
                    const from = nodeById.get(edge.fromNodeId)
                    const to = nodeById.get(edge.toNodeId)
                    if (!from || !to) continue
                    const d = distance(from.xPosition, from.yPosition, to.xPosition, to.yPosition)
                    if (d > 0.1 && d < minRest) {
                        minRest = d
                    }
                }
                if (Number.isFinite(minRest)) return minRest
                return Math.max(24, Math.min(p.width, p.height) / 8)
            }

            function updateMicroSpheres(projected: Map<string, ProjectedNode>) {
                const cell = gridCellSize()
                const dt = lastDeltaSec
                const centroid = focusCentroid(projected)
                const box = coreBox(projected)
                const centerX = (box.minX + box.maxX) / 2
                const centerY = (box.minY + box.maxY) / 2
                const t = p.millis() * MACRO_TIME
                const planetaryAtCenter = planetaryForceAt(centerX, centerY, p.millis() * MESO_TIME)
                const margin = Math.max(3, cell * 0.08)
                const maxSpeed = Math.max(2.6, cell * 0.14)
                const turbulenceBase = 1.55 + warmPressure * 2.1

                if (shadowMicroSpheres.length !== microSpheres.length) {
                    shadowMicroSpheres = microSpheres.map((particle, idx) => ({
                        x: particle.x + Math.cos(idx * 0.7 + 1.2) * 3,
                        y: particle.y + Math.sin(idx * 0.7 + 1.2) * 3,
                        vx: 0,
                        vy: 0,
                        phase: particle.phase + Math.PI * 0.75,
                        magnitude: particle.magnitude
                    }))
                }

                for (let idx = 0; idx < microSpheres.length; idx++) {
                    const particle = microSpheres[idx]
                    const shadow = shadowMicroSpheres[idx]
                    const magnitude = Math.max(0.1, Math.min(1, particle.magnitude))
                    const shadowMagnitude = Math.max(0.1, Math.min(1, shadow.magnitude))
                    const primaryMass = 1.8 + (1 - magnitude) * 2.8
                    const shadowMass = 1.8 + (1 - shadowMagnitude) * 2.8
                    const planetary = planetaryForceAt(
                        particle.x || sphere.point.x,
                        particle.y || sphere.point.y,
                        p.millis() * MESO_TIME
                    )
                    const planetaryShadow = planetaryForceAt(
                        shadow.x || sphere.point.x,
                        shadow.y || sphere.point.y,
                        p.millis() * MESO_TIME
                    )
                    const orbitX =
                        centerX + Math.sin(t * 2.1 + reloadSeed * 2.1 + particle.phase) * (cell * 0.07)
                    const orbitY =
                        centerY + Math.cos(t * 1.8 + reloadSeed * 3.7 + particle.phase * 0.8) * (cell * 0.05)
                    const shadowOrbitX =
                        centerX + Math.sin(t * 2.1 + reloadSeed * 2.1 + shadow.phase) * (cell * 0.07)
                    const shadowOrbitY =
                        centerY + Math.cos(t * 1.8 + reloadSeed * 3.7 + shadow.phase * 0.8) * (cell * 0.05)
                    const centerPullX = (centerX - particle.x) * 1.05
                    const centerPullY = (centerY - particle.y) * 1.05
                    const shadowCenterPullX = (centerX - shadow.x) * 0.95
                    const shadowCenterPullY = (centerY - shadow.y) * 0.95
                    const anchorPullX = (orbitX - particle.x) * 0.38
                    const anchorPullY = (orbitY - particle.y) * 0.38
                    const shadowAnchorPullX = (shadowOrbitX - shadow.x) * 0.36
                    const shadowAnchorPullY = (shadowOrbitY - shadow.y) * 0.36
                    const focusPullX = (centroid.x - particle.x) * (0.1 + centroid.w * 0.45)
                    const focusPullY = (centroid.y - particle.y) * (0.1 + centroid.w * 0.45)
                    const shadowFocusPullX = (centroid.x - shadow.x) * (0.06 + centroid.w * 0.28)
                    const shadowFocusPullY = (centroid.y - shadow.y) * (0.06 + centroid.w * 0.28)
                    const wanderX = Math.sin(t * 3.7 + reloadSeed * 11.2 + particle.phase * 1.7) * cell * 0.18
                    const wanderY = Math.cos(t * 3.2 + reloadSeed * 9.6 + particle.phase * 1.4) * cell * 0.15
                    const shadowWanderX = Math.sin(t * 3.9 + reloadSeed * 12.4 + shadow.phase * 1.9) * cell * 0.15
                    const shadowWanderY = Math.cos(t * 3.4 + reloadSeed * 10.8 + shadow.phase * 1.6) * cell * 0.13
                    const planetaryX = (planetary.fx - planetaryAtCenter.fx) * 980
                    const planetaryY = (planetary.fy - planetaryAtCenter.fy) * 980
                    const shadowPlanetaryX = (planetaryShadow.fx - planetaryAtCenter.fx) * 880
                    const shadowPlanetaryY = (planetaryShadow.fy - planetaryAtCenter.fy) * 880
                    // Curl-like noise field introduces local turbulence without persistent directional bias.
                    const n1 = p.noise(
                        particle.x * 0.018 + reloadSeed * 7.3,
                        particle.y * 0.018 + reloadSeed * 3.1,
                        t * 0.9 + particle.phase
                    )
                    const n2 = p.noise(
                        particle.x * 0.02 + reloadSeed * 5.7,
                        particle.y * 0.02 + reloadSeed * 4.9,
                        t * 1.1 + particle.phase * 1.3 + 19.7
                    )
                    const turbulenceX = (n1 - 0.5) * cell * turbulenceBase
                    const turbulenceY = (n2 - 0.5) * cell * turbulenceBase
                    const sn1 = p.noise(
                        shadow.x * 0.018 + reloadSeed * 9.1,
                        shadow.y * 0.018 + reloadSeed * 4.4,
                        t * 1.05 + shadow.phase + 41
                    )
                    const sn2 = p.noise(
                        shadow.x * 0.02 + reloadSeed * 6.2,
                        shadow.y * 0.02 + reloadSeed * 5.3,
                        t * 0.95 + shadow.phase * 1.15 + 73
                    )
                    const shadowTurbulenceX = (sn1 - 0.5) * cell * (turbulenceBase * 0.95)
                    const shadowTurbulenceY = (sn2 - 0.5) * cell * (turbulenceBase * 0.95)
                    const gust = p.noise(
                        t * 0.55 + particle.phase * 2.4 + 77,
                        particle.phase * 0.73 + 11
                    )
                    const gustAmp = gust > 0.78 ? (gust - 0.78) * cell * 2.3 : 0
                    const gustAngle = particle.phase * 3.7 + t * 2.1
                    const gustX = Math.cos(gustAngle) * gustAmp
                    const gustY = Math.sin(gustAngle) * gustAmp
                    const shadowGust = p.noise(
                        t * 0.5 + shadow.phase * 2.1 + 97,
                        shadow.phase * 0.61 + 17
                    )
                    const shadowGustAmp = shadowGust > 0.8 ? (shadowGust - 0.8) * cell * 2.0 : 0
                    const shadowGustAngle = shadow.phase * 3.4 + t * 2.0
                    const shadowGustX = Math.cos(shadowGustAngle) * shadowGustAmp
                    const shadowGustY = Math.sin(shadowGustAngle) * shadowGustAmp
                    const interactionPrimary = coreInteractionForceAt(
                        particle.x,
                        particle.y,
                        false,
                        projected,
                        cell
                    )
                    const interactionShadow = coreInteractionForceAt(
                        shadow.x,
                        shadow.y,
                        true,
                        projected,
                        cell
                    )
                    let boundaryX = 0
                    let boundaryY = 0
                    let shadowBoundaryX = 0
                    let shadowBoundaryY = 0

                    if (particle.x < box.minX + margin) {
                        boundaryX += (box.minX + margin - particle.x) * 5.5
                    } else if (particle.x > box.maxX - margin) {
                        boundaryX -= (particle.x - (box.maxX - margin)) * 5.5
                    }

                    if (particle.y < box.minY + margin) {
                        boundaryY += (box.minY + margin - particle.y) * 5.5
                    } else if (particle.y > box.maxY - margin) {
                        boundaryY -= (particle.y - (box.maxY - margin)) * 5.5
                    }
                    if (shadow.x < box.minX + margin) {
                        shadowBoundaryX += (box.minX + margin - shadow.x) * 5.3
                    } else if (shadow.x > box.maxX - margin) {
                        shadowBoundaryX -= (shadow.x - (box.maxX - margin)) * 5.3
                    }
                    if (shadow.y < box.minY + margin) {
                        shadowBoundaryY += (box.minY + margin - shadow.y) * 5.3
                    } else if (shadow.y > box.maxY - margin) {
                        shadowBoundaryY -= (shadow.y - (box.maxY - margin)) * 5.3
                    }

                    const dx = particle.x - shadow.x
                    const dy = particle.y - shadow.y
                    const d2 = dx * dx + dy * dy + 0.0001
                    const d = Math.sqrt(d2)
                    const nx = dx / d
                    const ny = dy / d
                    const repel = Math.min(cell * 2.4, (cell * cell * 0.34) / d2)
                    const desiredOrbit = cell * (0.2 + magnitude * 0.36)
                    const radialError = d - desiredOrbit
                    const orbitalSpring = -radialError * 0.9
                    const swirl = Math.min(cell * (0.35 + magnitude * 0.2), (cell * 1.2) / (d + 1))
                    const tx = -ny
                    const ty = nx
                    const polarity = idx % 2 === 0 ? 1 : -1
                    const orbitalDrive = (0.45 + eventGain * 0.6 + warmPressure * 0.4) * polarity
                    const pdx = particle.x - centerX
                    const pdy = particle.y - centerY
                    const pMag = Math.sqrt(pdx * pdx + pdy * pdy) || 1
                    const ptx = -pdy / pMag
                    const pty = pdx / pMag
                    const sdx = shadow.x - centerX
                    const sdy = shadow.y - centerY
                    const sMag = Math.sqrt(sdx * sdx + sdy * sdy) || 1
                    const stx = -sdy / sMag
                    const sty = sdx / sMag
                    const centerVortex = 0.12 + eventGain * 0.24

                    particle.vx +=
                        (
                            (centerPullX +
                                anchorPullX +
                                focusPullX +
                                wanderX +
                                planetaryX +
                                turbulenceX +
                                gustX +
                                interactionPrimary.fx +
                                boundaryX +
                                nx * (repel + orbitalSpring) +
                                tx * (swirl + orbitalDrive) +
                                ptx * centerVortex * cell) /
                            primaryMass
                        ) *
                        dt
                    particle.vy +=
                        (
                            (centerPullY +
                                anchorPullY +
                                focusPullY +
                                wanderY +
                                planetaryY +
                                turbulenceY +
                                gustY +
                                interactionPrimary.fy +
                                boundaryY +
                                ny * (repel + orbitalSpring) +
                                ty * (swirl + orbitalDrive) +
                                pty * centerVortex * cell) /
                            primaryMass
                        ) *
                        dt
                    shadow.vx +=
                        (
                            (shadowCenterPullX +
                                shadowAnchorPullX +
                                shadowFocusPullX +
                                shadowWanderX +
                                shadowPlanetaryX +
                                shadowTurbulenceX +
                                shadowGustX +
                                interactionShadow.fx +
                                shadowBoundaryX -
                                nx * (repel + orbitalSpring) -
                                tx * (swirl + orbitalDrive) +
                                stx * centerVortex * cell) /
                            shadowMass
                        ) *
                        dt
                    shadow.vy +=
                        (
                            (shadowCenterPullY +
                                shadowAnchorPullY +
                                shadowFocusPullY +
                                shadowWanderY +
                                shadowPlanetaryY +
                                shadowTurbulenceY +
                                shadowGustY +
                                interactionShadow.fy +
                                shadowBoundaryY -
                                ny * (repel + orbitalSpring) -
                                ty * (swirl + orbitalDrive) +
                                sty * centerVortex * cell) /
                            shadowMass
                        ) *
                        dt
                }

                const separation = Math.max(4, cell * 0.18)
                const separationSq = separation * separation
                for (let i = 0; i < microSpheres.length; i++) {
                    for (let j = i + 1; j < microSpheres.length; j++) {
                        const a = microSpheres[i]
                        const b = microSpheres[j]
                        const dx = b.x - a.x
                        const dy = b.y - a.y
                        const d2 = dx * dx + dy * dy
                        if (d2 <= 0.001 || d2 > separationSq) continue
                        const d = Math.sqrt(d2)
                        const nx = dx / d
                        const ny = dy / d
                        const push = ((separation - d) / separation) * 0.06
                        a.vx -= nx * push
                        a.vy -= ny * push
                        b.vx += nx * push
                        b.vy += ny * push
                    }
                }

                for (const particle of microSpheres) {
                    particle.vx *= 0.935
                    particle.vy *= 0.935
                    const speed = Math.sqrt(particle.vx * particle.vx + particle.vy * particle.vy)
                    if (speed > maxSpeed) {
                        const scale = maxSpeed / speed
                        particle.vx *= scale
                        particle.vy *= scale
                    }
                    particle.x += particle.vx * dt * 60
                    particle.y += particle.vy * dt * 60

                    if (particle.x < box.minX) {
                        particle.x = box.minX
                        particle.vx *= -0.25
                    } else if (particle.x > box.maxX) {
                        particle.x = box.maxX
                        particle.vx *= -0.25
                    }
                    if (particle.y < box.minY) {
                        particle.y = box.minY
                        particle.vy *= -0.25
                    } else if (particle.y > box.maxY) {
                        particle.y = box.maxY
                        particle.vy *= -0.25
                    }
                }
                for (const shadow of shadowMicroSpheres) {
                    shadow.vx *= 0.94
                    shadow.vy *= 0.94
                    const speed = Math.sqrt(shadow.vx * shadow.vx + shadow.vy * shadow.vy)
                    if (speed > maxSpeed) {
                        const scale = maxSpeed / speed
                        shadow.vx *= scale
                        shadow.vy *= scale
                    }
                    shadow.x += shadow.vx * dt * 60
                    shadow.y += shadow.vy * dt * 60
                    if (shadow.x < box.minX) {
                        shadow.x = box.minX
                        shadow.vx *= -0.24
                    } else if (shadow.x > box.maxX) {
                        shadow.x = box.maxX
                        shadow.vx *= -0.24
                    }
                    if (shadow.y < box.minY) {
                        shadow.y = box.minY
                        shadow.vy *= -0.24
                    } else if (shadow.y > box.maxY) {
                        shadow.y = box.maxY
                        shadow.vy *= -0.24
                    }
                }
            }

            function drawShadowMicroSpheres() {
                const cell = gridCellSize()
                const maxDiameter = cell * 0.96
                const baseRadius = Math.max(3, maxDiameter / 2)
                for (let i = 0; i < shadowMicroSpheres.length; i++) {
                    const particle = shadowMicroSpheres[i]
                    const magnitude = Math.max(0.1, Math.min(1, particle.magnitude))
                    const magnitude100 = 1 + ((magnitude - 0.1) / 0.9) * 99
                    const radius = Math.max(1, baseRadius * (magnitude100 / 100) * 0.94)
                    p.noFill()
                    p.stroke(255, 255, 255, 110)
                    p.strokeWeight(1)
                    p.circle(particle.x, particle.y, radius * 1.02)
                }
            }

            function drawMicroSpheres() {
                const cell = gridCellSize()
                const maxDiameter = cell * 0.96
                const baseRadius = Math.max(3, maxDiameter / 2)
                for (let i = 0; i < microSpheres.length; i++) {
                    const particle = microSpheres[i]
                    const magnitude = Math.max(0.1, Math.min(1, particle.magnitude))
                    const magnitude100 = 1 + ((magnitude - 0.1) / 0.9) * 99
                    const radius = Math.max(1, baseRadius * (magnitude100 / 100))
                    const x = particle.x
                    const y = particle.y

                    p.noStroke()
                    p.fill(250, 250, 250, 18)
                    p.circle(x, y, radius * 2.2)
                    p.fill(255, 255, 255, 52)
                    p.circle(x, y, radius * 1.45)
                    p.fill(255, 255, 255, 105)
                    p.circle(x, y, radius * 1.02)

                    p.noFill()
                    p.stroke(255, 255, 255, 110)
                    p.strokeWeight(1)
                    p.circle(x, y, radius * 1.01)
                }
            }

            function drawVessel() {
                const speed = Math.min(1, Math.sqrt(vessel.vx * vessel.vx + vessel.vy * vessel.vy) / 30)
                const aura = 18 + speed * 24 + semanticDensity * 20

                p.noFill()
                p.stroke(230, 230, 230, 90)
                p.strokeWeight(1.2)
                p.circle(vessel.x, vessel.y, aura)

                p.noStroke()
                p.fill(255, 255, 255)
                p.circle(vessel.x, vessel.y, 9)
            }

            function drawDiagnostics(projected: Map<string, ProjectedNode>) {
                if (!diagnosticsOn) return
                const avgForce =
                    projected.size === 0
                        ? 0
                        : Array.from(projected.values()).reduce((sum, value) => sum + value.force, 0) /
                          projected.size

                p.push()
                p.resetMatrix()
                p.noStroke()
                p.fill(0, 0, 0, 140)
                p.rect(10, 10, 380, 164, 6)
                p.fill(255, 255, 255, 210)
                p.textSize(12)
                p.text(`seed: ${reloadSeed.toFixed(6)}`, 18, 30)
                p.text(`sphere radius: ${sphere.radius.toFixed(1)} sigma: ${sphere.sigma.toFixed(1)}`, 18, 48)
                p.text(`avg force: ${avgForce.toFixed(3)} semantic edges: ${localSemanticEdges.length}`, 18, 66)
                p.text(`warm pressure: ${warmPressure.toFixed(3)} hold: ${(warmHoldMs / 1000).toFixed(2)}s`, 18, 84)
                p.text(`event: ${eventPhase} gain: ${eventGain.toFixed(2)} silence: ${(silenceMs / 1000).toFixed(2)}s`, 18, 102)
                p.text(`warp cap: ${FIELD_CONFIG.maxWarpedStructuralEdges}`, 18, 120)
                p.text(
                    `meta drift: ${metaBias.phaseDrift.toFixed(3)} pressure: ${metaBias.pressureBias.toFixed(3)} icon: ${metaBias.iconDrive.toFixed(2)}`,
                    18,
                    138
                )
                p.text(
                    `center mode: ${centerMode} t:${(centerModeDurationMs / 1000).toFixed(1)}s`,
                    18,
                    156
                )
                p.pop()
            }

            function depthBand(depth: number) {
                if (depth < -0.35) {
                    return { freqX: 0.007, freqY: 0.012, amp: 12, alpha: 18, weight: 0.65 }
                }
                if (depth < 0.35) {
                    return { freqX: 0.009, freqY: 0.015, amp: 17, alpha: 24, weight: 0.85 }
                }
                return { freqX: 0.013, freqY: 0.018, amp: 22, alpha: 30, weight: 1.05 }
            }

            function substrateOffset(x: number, y: number, depth: number, force: number, t: number) {
                const band = depthBand(depth)
                const waveA = Math.sin(x * band.freqX + t * 0.6)
                const waveB = Math.cos(y * band.freqY - t * 0.45)
                const waveC = Math.sin((x + y) * 0.003 + t * 0.75)
                const wave = (waveA + waveB + waveC) / 3
                const scale = band.amp * (0.5 + force * 0.35) * (1 + warmPressure * 0.35)
                const d = distance(x, y, vessel.x, vessel.y)
                const vesselLift = Math.max(0, 1 - d / 420) * band.amp * 0.45
                const planetary = planetaryForceAt(x, y, t * 0.38 + 0.8)
                return {
                    ox: Math.cos(t * 0.45 + depth * 2.6) * wave * scale * 0.14 + planetary.fx * (28 + warmPressure * 14),
                    oy: wave * scale + vesselLift + planetary.fy * (28 + warmPressure * 14)
                }
            }

            function drawSecondaryStructures(projected: Map<string, ProjectedNode>) {
                const t = p.millis() * MESO_TIME
                const startup = Math.min(1, p.millis() / 5500)
                const silenceGate = silenceMs > 0 ? 0.24 + 0.76 * (1 - silenceMs / 520) : 1
                const lifecycleGate = 0.22 + eventGain * 0.9
                // Secondary substrate is derived from the primary grid only;
                // avoid full-screen passing waves.
                const sampleStep = Math.max(
                    1,
                    Math.floor(structuralEdges.length / FIELD_CONFIG.maxSecondaryStrands)
                )
                p.noFill()
                for (let i = 0; i < structuralEdges.length; i += sampleStep) {
                    const edge = structuralEdges[i]
                    const from = projected.get(edge.fromNodeId)
                    const to = projected.get(edge.toNodeId)
                    if (!from || !to) continue
                    const focusEdge =
                        ((focusFieldByNode[edge.fromNodeId] || 0) + (focusFieldByNode[edge.toNodeId] || 0)) / 2
                    if (focusEdge < 0.14) continue

                    const avgDepth = (from.depth + to.depth) / 2
                    const avgForce = (from.force + to.force) / 2
                    const a = substrateOffset(from.x, from.y, avgDepth, avgForce, t)
                    const b = substrateOffset(to.x, to.y, avgDepth, avgForce, t)
                    const mx = (from.x + to.x) / 2
                    const my = (from.y + to.y) / 2
                    const m = substrateOffset(mx, my, avgDepth, avgForce, t + 0.4)
                    const alpha = (20 + avgForce * 30 + focusEdge * 90) * startup * lifecycleGate * silenceGate

                    p.stroke(196, 196, 196, alpha)
                    p.strokeWeight((0.7 + avgForce * 0.5 + focusEdge * 1.1) * (0.5 + lifecycleGate * 0.5))
                    p.beginShape()
                    p.curveVertex(from.x + a.ox, from.y + a.oy)
                    p.curveVertex(from.x + a.ox, from.y + a.oy)
                    p.curveVertex(mx + m.ox, my + m.oy)
                    p.curveVertex(to.x + b.ox, to.y + b.oy)
                    p.curveVertex(to.x + b.ox, to.y + b.oy)
                    p.endShape()
                }
            }

            function coreInteractionForceAt(
                x: number,
                y: number,
                isShadow: boolean,
                projected: Map<string, ProjectedNode>,
                cell: number
            ) {
                const sigma = Math.max(42, cell * 1.12)
                let fx = 0
                let fy = 0
                for (const [nodeId, profile] of Object.entries(coreInteractionById)) {
                    const point = projected.get(nodeId)
                    if (!point) continue
                    const dx = point.x - x
                    const dy = point.y - y
                    const d2 = dx * dx + dy * dy + 0.0001
                    const d = Math.sqrt(d2)
                    const nx = dx / d
                    const ny = dy / d
                    const tx = -ny
                    const ty = nx
                    const falloff = Math.exp(-(d2) / (2 * sigma * sigma))
                    const pull = cell * falloff
                    const neighbors = structuralNeighbors.get(nodeId) ?? []
                    let edgeX = 0
                    let edgeY = 0
                    for (const neighborId of neighbors) {
                        const neighbor = projected.get(neighborId)
                        if (!neighbor) continue
                        edgeX += neighbor.x - point.x
                        edgeY += neighbor.y - point.y
                    }
                    const edgeMag = Math.sqrt(edgeX * edgeX + edgeY * edgeY) || 1
                    const ex = edgeX / edgeMag
                    const ey = edgeY / edgeMag

                    if (profile.mode === "attract_primary") {
                        const sign = isShadow ? -0.4 : 1
                        // Shift from direct radial attraction to connector-following pull.
                        fx += (ex * 0.72 + nx * 0.28) * pull * 1.05 * sign
                        fy += (ey * 0.72 + ny * 0.28) * pull * 1.05 * sign
                    } else if (profile.mode === "attract_shadow") {
                        const sign = isShadow ? 1 : -0.4
                        fx += (ex * 0.72 + nx * 0.28) * pull * 1.05 * sign
                        fy += (ey * 0.72 + ny * 0.28) * pull * 1.05 * sign
                    } else if (profile.mode === "shear_orbit") {
                        const sign = isShadow ? -1 : 1
                        fx += (tx * 0.95 + ex * 0.35 + profile.fx * 0.22) * pull * sign
                        fy += (ty * 0.95 + ey * 0.35 + profile.fy * 0.22) * pull * sign
                    } else {
                        const sign = isShadow ? -1 : 1
                        fx += (profile.fx * 0.7 + ex * 0.3) * pull * 0.85 * sign
                        fy += (profile.fy * 0.7 + ey * 0.3) * pull * 0.85 * sign
                    }
                }
                const mag = Math.sqrt(fx * fx + fy * fy) || 1
                const maxMag = cell * 1.35
                if (mag > maxMag) {
                    const s = maxMag / mag
                    fx *= s
                    fy *= s
                }
                return { fx, fy }
            }

            p.setup = async () => {
                const { width, height } = canvasSize()
                p.createCanvas(width, height)
                updateTensionGeometry()
                rebuildMetaGrid()
                const totalSphereCount = 212
                const primarySphereCount = Math.max(1, Math.floor(totalSphereCount / 2))
                microSpheres = Array.from({ length: primarySphereCount }, (_, idx) => {
                    const golden = idx * 2.399963229728653
                    const radiusUnit = Math.sqrt((idx + 0.5) / primarySphereCount)
                    const r = (3 + radiusUnit * 14) * (0.9 + Math.sin(idx * 0.37 + reloadSeed * 3.1) * 0.08)
                    const magnitude = 0.1 + 0.9 * p.noise(idx * 0.13 + reloadSeed * 11.7)
                    return {
                        x: sphere.point.x + Math.cos(golden) * r,
                        y: sphere.point.y + Math.sin(golden) * r,
                        vx: 0,
                        vy: 0,
                        phase: idx * 0.63 + reloadSeed * Math.PI,
                        magnitude
                    }
                })
                shadowMicroSpheres = microSpheres.map((particle, idx) => ({
                    x: particle.x + Math.cos(idx * 0.74 + 1.1) * 3.4,
                    y: particle.y + Math.sin(idx * 0.74 + 1.1) * 3.4,
                    vx: 0,
                    vy: 0,
                    phase: particle.phase + Math.PI * 0.75,
                    magnitude: particle.magnitude
                }))
                refreshCoreInteractionWeights(true)
                await loadData()
                recomputeSemantic()
                semanticTimer = setInterval(recomputeSemantic, 3000)
            }

            p.windowResized = () => {
                const { width, height } = canvasSize()
                p.resizeCanvas(width, height)
                updateTensionGeometry()
                rebuildMetaGrid()
                if (useViewportGrid) {
                    rebuildGridForViewport()
                    ensureDepthMap()
                    recomputeSemantic()
                }
            }

            p.keyPressed = () => {
                if (p.key === "d" || p.key === "D") {
                    diagnosticsOn = !diagnosticsOn
                }
            }

            function neighborhoodWeight(nodeId: string, projected: Map<string, ProjectedNode>) {
                const neighbors = structuralNeighbors.get(nodeId) ?? []
                const selfForce = projected.get(nodeId)?.force ?? 0
                const selfMode = coreInteractionById[nodeId]?.mode ?? "shear_orbit"
                const degreeNorm = Math.min(1, (structuralDegree[nodeId] || 0) / Math.max(1, maxDegree))
                const modeScore = selfMode === "shear_orbit" ? 1 : selfMode === "turbulence_kick" ? 0.85 : 0.7

                let neighborForceSum = 0
                let neighborModeSum = 0
                let count = 0
                for (const neighborId of neighbors) {
                    neighborForceSum += projected.get(neighborId)?.force ?? selfForce
                    const mode = coreInteractionById[neighborId]?.mode ?? "shear_orbit"
                    neighborModeSum += mode === "shear_orbit" ? 1 : mode === "turbulence_kick" ? 0.85 : 0.7
                    count += 1
                }

                const neighborForce = count > 0 ? neighborForceSum / count : selfForce
                const neighborMode = count > 0 ? neighborModeSum / count : modeScore

                return (
                    selfForce * 0.32 +
                    neighborForce * 0.28 +
                    modeScore * 0.18 +
                    neighborMode * 0.14 +
                    degreeNorm * 0.08
                )
            }

            function drawBentConnector(
                x1: number,
                y1: number,
                x2: number,
                y2: number,
                signedWeight: number,
                tension: number
            ) {
                const dx = x2 - x1
                const dy = y2 - y1
                const length = Math.sqrt(dx * dx + dy * dy) || 1
                const nx = -dy / length
                const ny = dx / length
                const midX = (x1 + x2) / 2
                const midY = (y1 + y2) / 2
                const bend = length * (0.08 + Math.min(1, Math.abs(signedWeight)) * 0.26) * (0.5 + tension * 0.9)
                const sign = signedWeight >= 0 ? 1 : -1
                const cx = midX + nx * bend * sign
                const cy = midY + ny * bend * sign

                p.beginShape()
                p.vertex(x1, y1)
                p.quadraticVertex(cx, cy, x2, y2)
                p.endShape()
            }

            function poeticEnvelope(x: number, y: number, depth: number, t: number) {
                const swayA = Math.sin(x * 0.0052 + t * 0.42)
                const swayB = Math.cos(y * 0.0047 - t * 0.33)
                const swayC = Math.sin((x + y) * 0.0028 + depth * 2.3 + t * 0.51)
                return (swayA + swayB + swayC + 3) / 6
            }

            function pulseWave(base: number, phase: number) {
                const waveA = Math.sin(base + phase)
                const waveB = Math.sin(base * 0.73 + phase * 1.31 + reloadSeed * 6.1)
                const mixed = waveA * 0.68 + waveB * 0.32
                return Math.max(0, Math.min(1, (mixed + 1) / 2))
            }

            function drawStructuralEdges(projected: Map<string, ProjectedNode>) {
                const t = p.millis() * MESO_TIME
                const startup = Math.min(1, p.millis() / 5500)
                const silenceGate = silenceMs > 0 ? 0.22 + 0.78 * (1 - silenceMs / 520) : 1
                const lifecycleGate = 0.2 + eventGain * 0.95
                const warpStep = Math.max(
                    1,
                    Math.floor(structuralEdges.length / FIELD_CONFIG.maxWarpedStructuralEdges)
                )
                const maxCoreDistance = Math.max(gridRows, gridCols)
                const buildPhase = (p.millis() * 0.00016) % 1
                for (let idx = 0; idx < structuralEdges.length; idx++) {
                    const edge = structuralEdges[idx]
                    const from = projected.get(edge.fromNodeId)
                    const to = projected.get(edge.toNodeId)
                    if (!from || !to) continue

                    const depthFactor = ((from.depth + to.depth) / 2 + 1) / 2
                    const forceFactor = (from.force + to.force) / 2
                    const avgDepth = (from.depth + to.depth) / 2
                    const fromCore = coreDistance(edge.fromNodeId)
                    const toCore = coreDistance(edge.toNodeId)
                    const dCore = Math.min(
                        fromCore?.distance ?? maxCoreDistance,
                        toCore?.distance ?? maxCoreDistance
                    )
                    const nearCore = fromCore?.isCore || toCore?.isCore
                    const dNorm = Math.min(1, dCore / Math.max(1, maxCoreDistance))
                    const front = Math.abs(dNorm - buildPhase)
                    const buildWave = Math.max(0, 1 - front * 9)
                    const coreBoost = nearCore ? 0.42 : Math.max(0, 0.28 - dNorm * 0.2)
                    const strain = strainByEdgeKey[edgeKey(edge.fromNodeId, edge.toNodeId)] || 0
                    const connectorField =
                        ((delayedConnectorByNode[edge.fromNodeId] || 0) + (delayedConnectorByNode[edge.toNodeId] || 0)) / 2
                    const focusEdge =
                        ((focusFieldByNode[edge.fromNodeId] || 0) + (focusFieldByNode[edge.toNodeId] || 0)) / 2
                    const quietGate = (0.2 + focusEdge * 1.15) * lifecycleGate * silenceGate
                    const fromWeight = neighborhoodWeight(edge.fromNodeId, projected)
                    const toWeight = neighborhoodWeight(edge.toNodeId, projected)
                    const signedWeight = toWeight - fromWeight
                    const bendTension = Math.min(1, (from.force + to.force) / 2 + strain * 0.8 + warmPressure * 0.25)
                    const tone = poeticEnvelope(
                        (from.x + to.x) / 2,
                        (from.y + to.y) / 2,
                        avgDepth,
                        t
                    )
                    const a = substrateOffset(from.x, from.y, avgDepth, from.force, t)
                    const b = substrateOffset(to.x, to.y, avgDepth, to.force, t)
                    const fromWarpX = from.x + a.ox * 0.72
                    const fromWarpY = from.y + a.oy * 0.58
                    const toWarpX = to.x + b.ox * 0.72
                    const toWarpY = to.y + b.oy * 0.58

                    // base scaffold line
                    const baseTone = 140 + strain * 52
                    p.stroke(
                        baseTone,
                        baseTone,
                        baseTone,
                        (8 +
                            edge.stability * 6 +
                            depthFactor * 10 +
                            coreBoost * 28 +
                            buildWave * 18 +
                            strain * 22 +
                            connectorField * 12) * quietGate
                    )
                    p.strokeWeight(
                        0.78 *
                            (0.45 + depthFactor * 0.24 + coreBoost * 0.22 + strain * 0.16 + connectorField * 0.08 + tone * 0.06 + focusEdge * 0.4)
                    )
                    p.noFill()
                    drawBentConnector(from.x, from.y, to.x, to.y, signedWeight, bendTension)
                    p.stroke(baseTone + 12, baseTone + 12, baseTone + 12, (3 + tone * 12 + connectorField * 6) * quietGate)
                    p.strokeWeight(0.24 + tone * 0.3 + strain * 0.1 + focusEdge * 0.3)
                    drawBentConnector(
                        from.x + a.ox * 0.12,
                        from.y + a.oy * 0.12,
                        to.x + b.ox * 0.12,
                        to.y + b.oy * 0.12,
                        signedWeight * 0.7,
                        bendTension * 0.75
                    )

                    // warped substrate line (same edge, displaced by field)
                    if (idx % warpStep === 0) {
                        const warpTone = 170 + strain * 45
                        p.stroke(
                            warpTone,
                            warpTone,
                            warpTone,
                            (12 + edge.stability * 6 + depthFactor * 9 + forceFactor * 12 + coreBoost * 16 + buildWave * 12) *
                                startup +
                                strain * 26 +
                                connectorField * 16 +
                                tone * 10 +
                                focusEdge * 36
                        )
                        p.strokeWeight(
                            1.0 *
                                (0.42 +
                                    depthFactor * 0.24 +
                                    forceFactor * 0.16 +
                                    coreBoost * 0.15 +
                                    buildWave * 0.14 +
                                    strain * 0.14 +
                                    connectorField * 0.1 +
                                    focusEdge * 0.38)
                        )
                        drawBentConnector(
                            fromWarpX,
                            fromWarpY,
                            toWarpX,
                            toWarpY,
                            signedWeight * 1.15,
                            Math.min(1, bendTension + 0.12)
                        )
                    }

                }
            }

            function drawNodePolygon(x: number, y: number, radius: number, sides: number, rotation: number) {
                p.beginShape()
                for (let i = 0; i < sides; i++) {
                    const a = rotation + (i / sides) * Math.PI * 2
                    p.vertex(x + Math.cos(a) * radius, y + Math.sin(a) * radius)
                }
                p.endShape(p.CLOSE)
            }

            function drawCoreConstellation(projected: Map<string, ProjectedNode>) {
                const phase = pulseWave(p.millis() * MICRO_TIME * 4.5, reloadSeed * 2.1)
                const t = p.millis() * MACRO_TIME
                const bounds = coreBounds()
                p.noFill()
                p.stroke(245, 245, 245, 48 + phase * 82 + warmPressure * 40)
                p.strokeWeight(1.35 + phase * 0.8)

                for (let r = bounds.rowStart; r <= bounds.rowEnd; r++) {
                    for (let c = bounds.colStart; c <= bounds.colEnd; c++) {
                        const id = `v-${r}-${c}`
                        const point = projected.get(id)
                        if (!point) continue
                        const tone = poeticEnvelope(point.x, point.y, point.depth, t)
                        const right = projected.get(`v-${r}-${c + 1}`)
                        const down = projected.get(`v-${r + 1}-${c}`)
                        if (right) {
                            p.stroke(245, 245, 245, 42 + phase * 70 + tone * 26)
                            p.line(point.x, point.y, right.x, right.y)
                        }
                        if (down) {
                            p.stroke(245, 245, 245, 42 + phase * 70 + tone * 26)
                            p.line(point.x, point.y, down.x, down.y)
                        }
                    }
                }
            }

            function drawSubstrateAnchors(projected: Map<string, ProjectedNode>) {
                const t = p.millis() * MESO_TIME
                const startup = Math.min(1, p.millis() / 5500)
                const silenceGate = silenceMs > 0 ? 0.18 + 0.82 * (1 - silenceMs / 520) : 1
                const lifecycleGate = 0.18 + eventGain * 0.9
                let i = 0
                for (const node of nodes) {
                    i += 1
                    if (i % 3 !== 0) continue
                    const point = projected.get(node.id)
                    if (!point) continue
                    const focus = focusFieldByNode[node.id] || 0
                    if (focus < 0.16) continue
                    const offset = substrateOffset(point.x, point.y, point.depth, point.force, t)
                    const warpX = point.x + offset.ox * 0.72
                    const warpY = point.y + offset.oy * 0.58
                    const d = distance(vessel.x, vessel.y, point.x, point.y)
                    const proximity = Math.max(0, 1 - d / 300)
                    const alpha = (12 + point.force * 20 + proximity * 14 + focus * 60) * startup * lifecycleGate * silenceGate
                    const shell = sampleShell(sphere, point.x, point.y).shell
                    const shellBoost = 0.65 + shell * 0.95 + warmPressure * 0.42

                    p.stroke(210, 210, 210, alpha * shellBoost)
                    p.strokeWeight((0.42 + point.force * 0.45 + focus * 0.8) * shellBoost)
                    p.line(point.x, point.y, warpX, warpY)

                    p.noStroke()
                    p.fill(235, 235, 235, (10 + point.force * 28 + focus * 58) * shellBoost)
                    p.circle(warpX, warpY, (1 + point.force * 1.2 + focus * 1.8) * shellBoost)
                }
            }

            function drawSemanticEdges(projected: Map<string, ProjectedNode>) {
                const revealRadius = 260
                const silenceGate = silenceMs > 0 ? 0.2 + 0.8 * (1 - silenceMs / 520) : 1
                const lifecycleGate = 0.2 + eventGain * 0.95

                for (const edge of localSemanticEdges) {
                    const from = projected.get(edge.from)
                    const to = projected.get(edge.to)
                    if (!from || !to) continue
                    const focusEdge =
                        ((focusFieldByNode[edge.from] || 0) + (focusFieldByNode[edge.to] || 0)) / 2

                    const mx = (from.x + to.x) / 2
                    const my = (from.y + to.y) / 2
                    const d = distance(vessel.x, vessel.y, mx, my)
                    if (d > revealRadius) continue

                    const reveal = 1 - d / revealRadius
                    const depthFactor = ((from.depth + to.depth) / 2 + 1) / 2
                    const forceFactor = (from.force + to.force) / 2
                    const quietGate = (0.22 + focusEdge * 1.2) * lifecycleGate * silenceGate
                    p.stroke(235, 235, 235, (12 + 80 * reveal * edge.stability + depthFactor * 12 + forceFactor * 14) * quietGate)
                    p.strokeWeight((0.45 + edge.stability * 0.8) * (0.62 + depthFactor * 0.2 + forceFactor * 0.2 + focusEdge * 0.45))
                    p.line(from.x, from.y, to.x, to.y)
                }
            }

            function drawSecondaryIconRipples(projected: Map<string, ProjectedNode>) {
                if (!iconHubNodeId) return
                const hubNode = nodeById.get(iconHubNodeId)
                if (!hubNode) return

                const silenceGate = silenceMs > 0 ? 0.2 + 0.8 * (1 - silenceMs / 520) : 1
                const lifecycleGate = 0.2 + eventGain * 0.95
                const phase = p.millis() * (0.0008 + metaBias.iconDrive * 0.0006)
                const crestWidth = 0.2

                for (const node of nodes) {
                    if (node.id === iconHubNodeId) continue
                    const projection = projected.get(node.id)
                    if (!projection) continue
                    const connectorField = delayedConnectorByNode[node.id] || 0
                    const focus = focusFieldByNode[node.id] || 0
                    const baseSignal = Math.min(1, connectorField * 0.6 + focus * 0.45)
                    const dGrid = distance(
                        node.xPosition,
                        node.yPosition,
                        hubNode.xPosition,
                        hubNode.yPosition
                    )
                    const travel = phase * 3.2 - dGrid * 0.028
                    const wave = 0.5 + 0.5 * Math.sin(travel)
                    const crest = Math.max(0, 1 - Math.abs(wave - 0.92) / crestWidth)
                    const sustain = Math.max(0.1, baseSignal * 0.8 + eventGain * 0.3)
                    const alpha = (2 + crest * 34 + sustain * 10 + metaBias.iconDrive * 12) * lifecycleGate * silenceGate
                    if (alpha < 3) continue

                    const { x, y, scale, depth } = projection
                    const tone = poeticEnvelope(x, y, depth, phase * 0.9)
                    const iconRadius = (1.8 + crest * 3.6 + sustain * 1.8 + tone * 0.8) * scale
                    const rotation = phase * 0.8 + dGrid * 0.003 + node.ringIndex * 0.13

                    p.noFill()
                    p.stroke(255, 255, 255, alpha)
                    p.strokeWeight(1)
                    drawNodePolygon(x, y, iconRadius, 4, rotation)

                    p.stroke(220, 220, 220, (1 + crest * 18 + sustain * 8) * lifecycleGate * silenceGate)
                    p.strokeWeight(1)
                    p.circle(x, y, iconRadius * (2.2 + crest * 0.8))
                }
            }

            function drawNodes(projected: Map<string, ProjectedNode>) {
                const reactionRadius = 230
                const startup = Math.min(1, p.millis() / 5500)
                const silenceGate = silenceMs > 0 ? 0.2 + 0.8 * (1 - silenceMs / 520) : 1
                const lifecycleGate = 0.2 + eventGain * 0.95
                auraPhase += (0.009 + metaBias.phaseDrift * 0.0018) * (0.4 + startup * 0.6)

                for (const node of nodes) {
                    const projection = projected.get(node.id)
                    if (!projection) continue
                    const { x, y, scale, depth } = projection
                    const force = projection.force
                    const core = coreDistance(node.id)
                    const d = distance(vessel.x, vessel.y, x, y)
                    const proximity = Math.max(0, 1 - d / reactionRadius)
                    const degreeGlow = Math.min(1, (structuralDegree[node.id] || 0) / (maxDegree || 1))
                    const depthLift = (depth + 1) / 2
                    const coreBoost = core?.isCore ? 1 : Math.max(0, 0.35 - (core?.distance ?? 99) * 0.1)
                    const connectorField = delayedConnectorByNode[node.id] || 0
                    const focus = focusFieldByNode[node.id] || 0
                    const quietGate = (0.2 + focus * 1.2) * lifecycleGate * silenceGate
                    const buildPhase = (p.millis() * 0.00016) % 1
                    const dNorm = Math.min(1, (core?.distance ?? 8) / Math.max(1, Math.max(gridRows, gridCols)))
                    const front = Math.abs(dNorm - buildPhase)
                    const buildWave = Math.max(0, 1 - front * 10)

                    if (proximity > 0) {
                        const pulse = pulseWave(auraPhase + x * 0.01 + y * 0.01, node.ringIndex * 0.27)
                        const halo = (8 + proximity * 30 + pulse * 7 + coreBoost * 14 + buildWave * 8) * scale * (0.75 + startup * 0.25)

                        p.noFill()
                        p.stroke(225, 225, 225, (20 + proximity * 26 + depthLift * 12 + force * 20 + coreBoost * 24 + buildWave * 18) * startup * quietGate)
                        p.strokeWeight(0.55 + depthLift * 0.3 + force * 0.3 + coreBoost * 0.3 + focus * 0.45)
                        p.circle(x, y, halo)

                        p.stroke(200, 200, 200, (6 + proximity * 10 + force * 8 + coreBoost * 6) * startup * quietGate)
                        p.strokeWeight(0.35 + depthLift * 0.18 + force * 0.14 + coreBoost * 0.12 + focus * 0.22)
                        p.line(x, y, vessel.x, vessel.y)
                    }

                    if (node.id === iconHubNodeId && eventGain > 0.12) {
                        let hubStrength = Math.max(0, connectorField * 0.45 + focus * 0.45)
                        for (const other of nodes) {
                            if (other.id === iconHubNodeId) continue
                            const c = delayedConnectorByNode[other.id] || 0
                            const f = focusFieldByNode[other.id] || 0
                            if (c > 0.06 && f > 0.26) {
                                hubStrength = Math.max(hubStrength, c * 0.7 + f * 0.6)
                            }
                        }
                        if (hubStrength > 0.16) {
                            const polyPulse = pulseWave(
                                auraPhase * 0.75 + x * 0.008 + y * 0.008,
                                node.ringIndex * 0.31 + 0.9
                            )
                            const tone = poeticEnvelope(x, y, depth, p.millis() * 0.00055)
                            const sides = 4
                            const polyRadius =
                                (6.5 + hubStrength * 9 + buildWave * 1.1 + coreBoost * 3.6 + tone * 1.5 + focus * 3.4) * scale
                            const polyRotation = p.millis() * MICRO_TIME * 0.9 + depth * 0.25
                            const layerTight = 0.92 + tone * 0.06

                            p.noFill()
                            p.stroke(
                                255,
                                255,
                                255,
                                (8 + hubStrength * 70 + polyPulse * 9 + coreBoost * 10 + tone * 8 + focus * 20) *
                                    lifecycleGate *
                                    silenceGate
                            )
                            p.strokeWeight(1)
                            drawNodePolygon(x, y, polyRadius, sides, polyRotation)
                            p.stroke(235, 235, 235, (6 + hubStrength * 34 + tone * 10) * lifecycleGate * silenceGate)
                            p.strokeWeight(1)
                            drawNodePolygon(x, y, polyRadius * 1.03 * layerTight, sides, polyRotation * 0.99)
                            p.stroke(220, 220, 220, (4 + hubStrength * 22 + tone * 7) * lifecycleGate * silenceGate)
                            p.strokeWeight(1)
                            drawNodePolygon(x, y, polyRadius * 0.9 * layerTight, sides, polyRotation * 1.01)

                            const sparkleBase = (5 + hubStrength * 10) * scale
                            const sparkleAmp = 1.6 + hubStrength * 2.8
                            for (let i = 0; i < 4; i += 1) {
                                const localPhase = auraPhase * (0.5 + i * 0.08) + i * 1.6 + node.ringIndex * 0.12
                                const angle = localPhase + polyRotation * 0.15
                                const radius = sparkleBase + Math.sin(localPhase * 1.4) * sparkleAmp
                                const sx = x + Math.cos(angle) * radius
                                const sy = y + Math.sin(angle) * radius
                                const twinkle = 0.35 + 0.65 * pulseWave(localPhase, i * 0.3 + 0.2)
                                p.noStroke()
                                p.fill(255, 255, 255, (8 + twinkle * 30) * lifecycleGate * silenceGate)
                                p.circle(sx, sy, 0.9 + twinkle * 1.5)
                            }
                        }
                    }

                    if (core?.isCore) {
                        const corePulse = pulseWave(
                            p.millis() * 0.0016 + x * 0.01 + y * 0.01,
                            node.ringIndex * 0.19 + 1.3
                        )
                        p.noFill()
                        p.stroke(255, 255, 255, (84 + corePulse * 120) * startup)
                        p.strokeWeight(1.5 + corePulse * 1.2)
                        p.circle(x, y, (16 + corePulse * 14) * scale)
                    }

                    const size = (4.1 + proximity * 7 + degreeGlow * 2 + force * 2.2 + coreBoost * 3.8 + buildWave * 1.8) * scale
                    p.noStroke()
                    p.fill(
                        245,
                        245,
                        245,
                        (20 + (proximity * 34 + depthLift * 18 + force * 24 + coreBoost * 38 + buildWave * 16 + focus * 70) * startup) *
                            (0.4 + lifecycleGate * 0.6) *
                            silenceGate
                    )
                    p.circle(x, y, size)
                }
            }

            p.draw = () => {
                p.translate(p.width / 2, p.height / 2)
                updateVessel()
                updateTensionPoint()
                updateWarmPressure()
                updateMetaCenterMode()
                const projected = projectedNodes()
                updateEdgeStrain(projected)
                updateDelayedConnectorField(projected)
                updateFocusField(projected)
                refreshCoreInteractionWeights()
                updateEventLifecycle()
                updateMetaField(projected)
                updateMicroSpheres(projected)
                drawBackground()
                drawMetaLattice()
                drawShadowMicroSpheres()
                drawMicroSpheres()
                drawSecondaryStructures(projected)
                drawStructuralEdges(projected)
                drawSubstrateAnchors(projected)
                drawCoreConstellation(projected)
                drawSemanticEdges(projected)
                drawSecondaryIconRipples(projected)
                drawLayerStitches(projected)
                drawNodes(projected)
                drawVessel()
                drawDiagnostics(projected)
            }
        }

        const mountSketch = async () => {
            try {
                const { default: P5 } = await import("p5")
                if (cancelled || !containerRef.current) return
                instance = new P5(sketch, containerRef.current)
            } catch {
                setLoadError("Renderer failed to start.")
            }
        }

        void mountSketch()

        return () => {
            cancelled = true
            if (semanticTimer) clearInterval(semanticTimer)
            instance?.remove()
        }
    }, [])

    return (
        <div className="grid-engine">
            {loadError ? <div className="grid-banner-error">{loadError}</div> : null}
            <div className="grid-canvas-host" ref={containerRef} />
        </div>
    )
}
