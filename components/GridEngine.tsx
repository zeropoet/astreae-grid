"use client"

import { useEffect, useRef } from "react"
import type p5 from "p5"

const HELIOS_BACKGROUND = [12, 16, 30] as const
const HELIOS_TRAIL_WARM = [255, 193, 120] as const
const HELIOS_TRAIL_COOL = [126, 208, 255] as const
const HELIOS_BODY_WARM = [255, 220, 166] as const
const HELIOS_BODY_COOL = [155, 226, 255] as const
const HELIOS_SUN_STROKE = [245, 240, 219] as const

type GridNode = {
    bx: number
    by: number
    x: number
    y: number
    vx: number
    vy: number
    phase: number
}

export default function GridEngine() {
    const hostRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        let instance: p5 | null = null
        let cancelled = false
        let hostWidth = 1
        let hostHeight = 1
        let handleResize: (() => void) | null = null

        const sketch = (p: p5) => {
            let cols = 0
            let rows = 0
            let spacingX = 0
            let spacingY = 0
            let spacingDiag = 0
            let nodes: GridNode[] = []
            let facetSignalPrev = new Float32Array(0)
            let facetGlow = new Float32Array(0)
            let drift = 0
            let pointerX = 0
            let pointerY = 0
            let pointerPrevX = 0
            let pointerPrevY = 0
            let pointerReady = false

            const indexOf = (r: number, c: number) => r * cols + c
            const facetIndexOf = (r: number, c: number) => r * (cols - 1) + c

            function viewport() {
                return {
                    width: Math.max(1, hostWidth),
                    height: Math.max(1, hostHeight)
                }
            }

            function rebuildGrid() {
                const { width, height } = viewport()
                const unit = Math.min(width, height)
                const area = width * height
                const baselineArea = 1440 * 900
                const densityScale = Math.pow(area / baselineArea, 0.1)
                const baseSpacing = Math.max(15, Math.min(42, Math.floor(unit / 28)))
                const responsiveSpacing = Math.max(
                    14,
                    Math.min(46, baseSpacing / densityScale)
                )

                const aspect = width / Math.max(1, height)
                const baselineAspect = 16 / 10
                const aspectInfluence = Math.max(
                    -0.16,
                    Math.min(0.16, (aspect - baselineAspect) * 0.16)
                )
                const sizeInfluence = Math.max(
                    -0.08,
                    Math.min(0.08, (unit - 920) / 4200)
                )
                const cellRatio = Math.max(
                    0.82,
                    Math.min(1.22, 1 + aspectInfluence + sizeInfluence)
                )

                spacingX = responsiveSpacing * cellRatio
                spacingY = responsiveSpacing / cellRatio
                spacingDiag = Math.hypot(spacingX, spacingY)

                const overscanX = Math.max(spacingX * 8, width * 0.45)
                const overscanY = Math.max(spacingY * 8, height * 0.45)
                const totalWidth = width + overscanX * 2
                const totalHeight = height + overscanY * 2

                cols = Math.floor(totalWidth / spacingX) + 1
                rows = Math.floor(totalHeight / spacingY) + 1
                const startX = -((cols - 1) * spacingX) * 0.5
                const startY = -((rows - 1) * spacingY) * 0.5

                nodes = []
                for (let r = 0; r < rows; r += 1) {
                    for (let c = 0; c < cols; c += 1) {
                        const bx = startX + c * spacingX
                        const by = startY + r * spacingY
                        nodes.push({
                            bx,
                            by,
                            x: bx,
                            y: by,
                            vx: 0,
                            vy: 0,
                            phase: p.noise(r * 0.09, c * 0.09) * Math.PI * 2
                        })
                    }
                }

                const facetCount = Math.max(0, (rows - 1) * (cols - 1))
                facetSignalPrev = new Float32Array(facetCount)
                facetGlow = new Float32Array(facetCount)
            }

            function pointerIsActive() {
                const hasTouch = Array.isArray((p as unknown as { touches?: unknown[] }).touches)
                    ? ((p as unknown as { touches?: unknown[] }).touches?.length ?? 0) > 0
                    : false
                const mouseDown =
                    (p as unknown as { mouseIsPressed?: boolean }).mouseIsPressed === true
                return hasTouch || mouseDown
            }

            function pointerPosition() {
                const { width, height } = viewport()
                const touches = (p as unknown as { touches?: Array<{ x?: number; y?: number }> })
                    .touches
                if (touches && touches.length > 0) {
                    const touch = touches[0]
                    const tx = touch.x ?? width * 0.5
                    const ty = touch.y ?? height * 0.5
                    return { x: tx - width * 0.5, y: ty - height * 0.5 }
                }

                const mx = Number.isFinite(p.mouseX) ? p.mouseX : width * 0.5
                const my = Number.isFinite(p.mouseY) ? p.mouseY : height * 0.5
                return { x: mx - width * 0.5, y: my - height * 0.5 }
            }

            p.setup = () => {
                const { width, height } = viewport()
                p.pixelDensity(1)
                const canvas = p.createCanvas(width, height)
                canvas.style("display", "block")
                canvas.style("position", "absolute")
                canvas.style("left", "0")
                canvas.style("top", "0")
                canvas.style("width", "100%")
                canvas.style("height", "100%")
                p.background(
                    HELIOS_BACKGROUND[0],
                    HELIOS_BACKGROUND[1],
                    HELIOS_BACKGROUND[2]
                )
                rebuildGrid()
            }

            handleResize = () => {
                const { width, height } = viewport()
                p.pixelDensity(1)
                p.resizeCanvas(width, height)
                rebuildGrid()
            }

            p.draw = () => {
                drift += 0.0055
                const t = drift
                const { width, height } = viewport()
                const centerX = width * 0.5
                const centerY = height * 0.5
                const hasTouch =
                    ((p as unknown as { touches?: unknown[] }).touches?.length ?? 0) > 0
                const pulling = pointerIsActive()
                const focus = pointerPosition()

                if (!pointerReady) {
                    pointerX = focus.x
                    pointerY = focus.y
                    pointerPrevX = focus.x
                    pointerPrevY = focus.y
                    pointerReady = true
                } else {
                    pointerPrevX = pointerX
                    pointerPrevY = pointerY
                    pointerX = focus.x
                    pointerY = focus.y
                }

                const moveLimit = Math.max(0.6, Math.min(spacingX, spacingY) * 0.09)
                const rawMoveX = pointerX - pointerPrevX
                const rawMoveY = pointerY - pointerPrevY
                const moveX = Math.max(-moveLimit, Math.min(moveLimit, rawMoveX))
                const moveY = Math.max(-moveLimit, Math.min(moveLimit, rawMoveY))

                p.background(
                    HELIOS_BACKGROUND[0],
                    HELIOS_BACKGROUND[1],
                    HELIOS_BACKGROUND[2]
                )
                p.translate(centerX, centerY)

                const ax = new Float32Array(nodes.length)
                const ay = new Float32Array(nodes.length)

                const structuralK = 0.09
                const springFriction = 0.095
                const anchorK = 0.024
                const damping = 0.205
                const idleWave = 0.06

                for (let i = 0; i < nodes.length; i += 1) {
                    const node = nodes[i]
                    const restoreX = (node.bx - node.x) * anchorK
                    const restoreY = (node.by - node.y) * anchorK
                    const dragX = -node.vx * damping
                    const dragY = -node.vy * damping
                    const wave = Math.sin(t * 1.6 + node.phase)
                    ax[i] += restoreX + dragX + wave * idleWave * 0.08
                    ay[i] += restoreY + dragY + wave * idleWave
                }

                const applySpring = (a: number, b: number, restLength: number) => {
                    const na = nodes[a]
                    const nb = nodes[b]
                    const dx = nb.x - na.x
                    const dy = nb.y - na.y
                    const dist = Math.hypot(dx, dy) || 1
                    const ux = dx / dist
                    const uy = dy / dist
                    const extension = dist - restLength
                    const relativeSpeed = (nb.vx - na.vx) * ux + (nb.vy - na.vy) * uy
                    const force = extension * structuralK + relativeSpeed * springFriction
                    const fx = ux * force
                    const fy = uy * force
                    ax[a] += fx
                    ay[a] += fy
                    ax[b] -= fx
                    ay[b] -= fy
                }

                const constrainEdge = (a: number, b: number, minLength: number, maxLength: number) => {
                    const na = nodes[a]
                    const nb = nodes[b]
                    const dx = nb.x - na.x
                    const dy = nb.y - na.y
                    const dist = Math.hypot(dx, dy) || 1
                    const target = Math.min(maxLength, Math.max(minLength, dist))
                    if (Math.abs(target - dist) < 0.0001) return

                    const correction = ((dist - target) / dist) * 0.5
                    const ox = dx * correction
                    const oy = dy * correction
                    na.x += ox
                    na.y += oy
                    nb.x -= ox
                    nb.y -= oy
                }

                for (let r = 0; r < rows; r += 1) {
                    for (let c = 0; c < cols; c += 1) {
                        const i = indexOf(r, c)
                        if (c + 1 < cols) applySpring(i, indexOf(r, c + 1), spacingX)
                        if (r + 1 < rows) applySpring(i, indexOf(r + 1, c), spacingY)
                    }
                }

                const prevX = new Float32Array(nodes.length)
                const prevY = new Float32Array(nodes.length)

                for (let i = 0; i < nodes.length; i += 1) {
                    const node = nodes[i]
                    prevX[i] = node.x
                    prevY[i] = node.y
                    const dx = node.x - pointerX
                    const dy = node.y - pointerY
                    const d = Math.hypot(dx, dy) || 1
                    const radius = hasTouch ? 10 : Math.min(width, height) * (pulling ? 0.3 : 0.24)
                    if (d < radius) {
                        const influence = (1 - d / radius) ** 2
                        const dirX = -dx / d
                        const dirY = -dy / d
                        const pullForce = (pulling ? 1.2 : 0.24) * influence
                        const dragForce = (pulling ? 6.5 : 0.9) * influence
                        ax[i] += dirX * pullForce + moveX * dragForce
                        ay[i] += dirY * pullForce + moveY * dragForce
                    }

                    node.vx += ax[i]
                    node.vy += ay[i]
                    node.x += node.vx
                    node.y += node.vy
                }

                const minEdgeX = spacingX * 0.68
                const maxEdgeX = spacingX * 1.52
                const minEdgeY = spacingY * 0.68
                const maxEdgeY = spacingY * 1.52
                const minDiag = spacingDiag * 0.76
                const maxDiag = spacingDiag * 1.5
                for (let iteration = 0; iteration < 2; iteration += 1) {
                    for (let r = 0; r < rows; r += 1) {
                        for (let c = 0; c < cols; c += 1) {
                            const i = indexOf(r, c)
                            if (c + 1 < cols) {
                                constrainEdge(i, indexOf(r, c + 1), minEdgeX, maxEdgeX)
                            }
                            if (r + 1 < rows) {
                                constrainEdge(i, indexOf(r + 1, c), minEdgeY, maxEdgeY)
                            }
                            if (c + 1 < cols && r + 1 < rows) {
                                constrainEdge(i, indexOf(r + 1, c + 1), minDiag, maxDiag)
                            }
                            if (c > 0 && r + 1 < rows) {
                                constrainEdge(i, indexOf(r + 1, c - 1), minDiag, maxDiag)
                            }
                        }
                    }
                }

                const plasticRadius = Math.min(width, height) * 0.34
                for (let i = 0; i < nodes.length; i += 1) {
                    const node = nodes[i]
                    node.vx = (node.x - prevX[i]) * 0.86
                    node.vy = (node.y - prevY[i]) * 0.86

                    if (!pulling) continue
                    const dx = node.x - pointerX
                    const dy = node.y - pointerY
                    const d = Math.hypot(dx, dy)
                    if (d > plasticRadius) continue
                    const influence = (1 - d / plasticRadius) ** 2
                    const settle = 0.075 * influence
                    node.bx += (node.x - node.bx) * settle + moveX * 0.22 * influence
                    node.by += (node.y - node.by) * settle + moveY * 0.22 * influence
                }

                p.noStroke()
                for (let r = 0; r + 1 < rows; r += 1) {
                    for (let c = 0; c + 1 < cols; c += 1) {
                        const a = nodes[indexOf(r, c)]
                        const b = nodes[indexOf(r, c + 1)]
                        const cNode = nodes[indexOf(r + 1, c + 1)]
                        const d = nodes[indexOf(r + 1, c)]
                        const fIndex = facetIndexOf(r, c)

                        const diagMain = Math.hypot(cNode.x - a.x, cNode.y - a.y)
                        const diagCross = Math.hypot(d.x - b.x, d.y - b.y)
                        const shear = (diagMain - diagCross) / Math.max(1, spacingDiag)

                        const edgeTop = Math.hypot(b.x - a.x, b.y - a.y) - spacingX
                        const edgeBottom = Math.hypot(cNode.x - d.x, cNode.y - d.y) - spacingX
                        const edgeRight = Math.hypot(cNode.x - b.x, cNode.y - b.y) - spacingY
                        const edgeLeft = Math.hypot(d.x - a.x, d.y - a.y) - spacingY
                        const strain =
                            (edgeTop + edgeBottom + edgeRight + edgeLeft) /
                            (2 * Math.max(1, spacingX + spacingY))

                        const signal = shear + strain * 0.42
                        const prevSignal = facetSignalPrev[fIndex]
                        const delta = signal - prevSignal
                        const signFlip =
                            Math.sign(signal) !== 0 &&
                            Math.sign(prevSignal) !== 0 &&
                            Math.sign(signal) !== Math.sign(prevSignal)
                        const flipStrength = signFlip ? Math.min(1, Math.abs(delta) * 7.5) : 0
                        const excitation = Math.max(
                            0,
                            Math.abs(delta) - 0.032
                        )

                        facetGlow[fIndex] = Math.min(
                            1,
                            facetGlow[fIndex] * 0.9 + flipStrength * 0.95 + excitation * 1.6
                        )
                        facetSignalPrev[fIndex] = signal

                        const glow = facetGlow[fIndex]
                        if (glow < 0.05) continue

                        const warm = signal < 0
                        const alpha = 4 + glow * 58
                        if (warm) {
                            p.fill(
                                HELIOS_TRAIL_WARM[0],
                                HELIOS_TRAIL_WARM[1],
                                HELIOS_TRAIL_WARM[2],
                                alpha
                            )
                        } else {
                            p.fill(
                                HELIOS_TRAIL_COOL[0],
                                HELIOS_TRAIL_COOL[1],
                                HELIOS_TRAIL_COOL[2],
                                alpha
                            )
                        }
                        p.quad(a.x, a.y, b.x, b.y, cNode.x, cNode.y, d.x, d.y)
                    }
                }

                p.strokeWeight(0.9)
                for (let r = 0; r < rows; r += 1) {
                    for (let c = 0; c < cols; c += 1) {
                        const node = nodes[indexOf(r, c)]
                        const right = c + 1 < cols ? nodes[indexOf(r, c + 1)] : null
                        const down = r + 1 < rows ? nodes[indexOf(r + 1, c)] : null

                        const glow =
                            0.5 +
                            0.5 * Math.sin(t * 1.2 + node.phase + r * 0.14 + c * 0.09)
                        const stretchX = right
                            ? Math.abs(
                                  Math.hypot(right.x - node.x, right.y - node.y) - spacingX
                              )
                            : 0
                        const stretchY = down
                            ? Math.abs(
                                  Math.hypot(down.x - node.x, down.y - node.y) - spacingY
                              )
                            : 0
                        const strain = Math.min(
                            1,
                            (stretchX + stretchY) / (Math.min(spacingX, spacingY) * 0.35)
                        )
                        const alpha = 14 + glow * 22 + strain * 42

                        if (right) {
                            p.stroke(
                                HELIOS_SUN_STROKE[0],
                                HELIOS_SUN_STROKE[1],
                                HELIOS_SUN_STROKE[2],
                                alpha
                            )
                            p.line(node.x, node.y, right.x, right.y)
                        }
                        if (down) {
                            p.stroke(
                                HELIOS_SUN_STROKE[0],
                                HELIOS_SUN_STROKE[1],
                                HELIOS_SUN_STROKE[2],
                                alpha
                            )
                            p.line(node.x, node.y, down.x, down.y)
                        }
                    }
                }

                p.noStroke()
                for (let i = 0; i < nodes.length; i += 1) {
                    const node = nodes[i]
                    const velocity = Math.min(1, Math.hypot(node.vx, node.vy) / 3.2)
                    const pulse = 0.5 + 0.5 * Math.sin(t * 2.2 + node.phase)
                    const warmMix = 0.5 + 0.5 * Math.sin(t * 0.7 + node.phase * 0.75)
                    const nodeR = p.lerp(HELIOS_BODY_COOL[0], HELIOS_BODY_WARM[0], warmMix)
                    const nodeG = p.lerp(HELIOS_BODY_COOL[1], HELIOS_BODY_WARM[1], warmMix)
                    const nodeB = p.lerp(HELIOS_BODY_COOL[2], HELIOS_BODY_WARM[2], warmMix)
                    p.fill(nodeR, nodeG, nodeB, 42 + pulse * 60 + velocity * 90)
                    const size = 0.95 + pulse * 1.25 + velocity * 1.7
                    p.square(node.x - size * 0.5, node.y - size * 0.5, size)
                }
            }
        }

        const mount = async () => {
            try {
                const { default: P5 } = await import("p5")
                if (cancelled || !hostRef.current) return
                const hostRect = hostRef.current.getBoundingClientRect()
                hostWidth = hostRect.width
                hostHeight = hostRect.height
                instance = new P5(sketch, hostRef.current)
            } catch (error) {
                console.error(error)
            }
        }

        void mount()

        const host = hostRef.current
        const resizeObserver =
            host &&
            new ResizeObserver((entries) => {
                const entry = entries[0]
                if (!entry || !instance) return
                hostWidth = entry.contentRect.width
                hostHeight = entry.contentRect.height
                handleResize?.()
            })
        if (host && resizeObserver) resizeObserver.observe(host)

        return () => {
            cancelled = true
            resizeObserver?.disconnect()
            instance?.remove()
        }
    }, [])

    return (
        <div
            ref={hostRef}
            style={{
                position: "relative",
                width: "100%",
                height: "100%",
                minHeight: "100dvh",
                overflow: "hidden"
            }}
        />
    )
}
