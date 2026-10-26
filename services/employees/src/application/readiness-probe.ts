export interface ReadinessProbe {
  check(): Promise<void>;
}
