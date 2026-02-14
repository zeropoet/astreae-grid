import type { NodeRecord } from "@/lib/types"

export function cosineSimilarity(a: number[], b: number[]) {
    if (a.length !== b.length || a.length === 0) return 0

    let dot = 0
    let normA = 0
    let normB = 0

    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i]
        normA += a[i] * a[i]
        normB += b[i] * b[i]
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB)
    if (denom === 0) return 0
    return dot / denom
}

export function interpretationScore(
    a: NodeRecord,
    b: NodeRecord,
    vessel: { x: number; y: number },
    structuralDegree: Record<string, number>,
    maxDegree: number,
    attunement: Record<string, number>
) {
    const semantic = (cosineSimilarity(a.embedding, b.embedding) + 1) / 2

    const ringProximity =
        1 / (Math.abs(a.ringIndex - b.ringIndex) + 1)

    const density =
        (structuralDegree[b.id] || 0) / (maxDegree || 1)

    const dx = vessel.x - b.xPosition
    const dy = vessel.y - b.yPosition
    const dist = Math.sqrt(dx * dx + dy * dy)

    const gravity = 1 / (dist + 1)

    const attune = attunement[b.id] || 0

    return (
        0.45 * semantic +
        0.15 * ringProximity +
        0.15 * density +
        0.15 * gravity +
        0.10 * attune
    )
}
