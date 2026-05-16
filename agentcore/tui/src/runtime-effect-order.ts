export class RuntimeEffectOrder {
  private current = 0

  begin(): number {
    this.current += 1
    return this.current
  }

  isCurrent(sequence: number): boolean {
    return sequence === this.current
  }
}
