/** Frame-rate independent lerp: same visual result regardless of FPS */
export function damp(current: number, target: number, speed: number, delta: number): number {
  return current + (target - current) * (1 - Math.exp(-speed * delta));
}
